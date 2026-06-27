/**
 * SPEC-002 — tmux inventory collection (read-only).
 *
 * Implements the probe → inventory → introspection → capture pipeline over the
 * injected {@link CollectDeps}. This module imports ONLY from `../types` and never
 * touches `child_process`, redaction internals, or detection/status — all such
 * boundaries arrive via dependency injection so the collector is unit-testable in
 * isolation and the orchestrator wires the hardened real impls later.
 *
 * Invariants enforced here:
 *  - READ-ONLY: only `-V`, `list-sessions`, `list-panes`, `capture-pane` are ever
 *    requested from the injected `tmuxExec` (SPEC-002 §2.1, AC-13).
 *  - NEVER throws / never hangs: every exec is funnelled through `safeExec`, and
 *    per-pane capture/introspection failures are target-isolated (AC-05/AC-16).
 *  - redaction chokepoint: `paneTitle`/`cwd`/`cmdline` pass through `deps.redact`,
 *    capture through `deps.sanitize`; `command` passes RAW (structural id). Raw
 *    capture/title/cmdline are never retained beyond the boundary (SPEC-006 §2.3).
 */
import type {
  AvailabilityState,
  CollectDeps,
  InventoryResult,
  PaneRawRecord,
  SanitizedCapture,
  SessionRawRecord,
  SpawnResult,
  TmuxAvailability,
  TmuxError,
  TmuxExecFn,
} from '../types';
import { CAPTURE_LINES, FMT_P, FMT_S, US } from '../types';

// ---------------------------------------------------------------------------
// Format field counts derived from the frozen format strings (stay in sync).
// ---------------------------------------------------------------------------

const FMT_P_FIELD_COUNT = FMT_P.split(US).length; // 11
const FMT_S_FIELD_COUNT = FMT_S.split(US).length; // 5

/** Stable pane identifier shape (`%12`), SPEC-002 §2.3. */
export const PANE_ID_RE = /^%[0-9]+$/;

type ExecErrorKind = 'spawn_error' | 'timeout' | 'exit_nonzero';

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * tmux "no server running" / "error connecting" stderr classifier (SPEC-002 §2.5).
 * Matches the known variants across tmux versions/platforms, case-insensitively.
 */
export function isNoServerStderr(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return (
    s.includes('no server running') ||
    s.includes('error connecting') ||
    s.includes('no such file or directory') ||
    s.includes('server not found') ||
    s.includes('failed to connect to server')
  );
}

/** Parse `tmux -V` stdout ("tmux 3.3a") → "3.3a"; null if unparseable/empty. */
export function parseVersion(stdout: string): string | null {
  const t = stdout.trim();
  if (t === '') return null;
  const m = /^tmux\s+(.+)$/i.exec(t);
  return m ? m[1]!.trim() : t;
}

/**
 * Convert a `#{pane_activity}`/`#{session_activity}` epoch-seconds token to an
 * ISO 8601 string (UTC, deterministic). PoC hypothesis: tmux emits epoch seconds
 * (SPEC-002 Q2). Missing/invalid/out-of-range values fall back to the injected
 * clock so the field is always a valid ISO string and conversion never throws.
 */
export function epochToIso(raw: string, now: () => Date): string {
  const t = raw.trim();
  if (t !== '') {
    const sec = Number(t);
    if (Number.isFinite(sec)) {
      const d = new Date(sec * 1000);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return now().toISOString();
}

function toInt(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? 0 : n;
}

function toIntOrNull(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number.parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
}

/** Split tmux `-F` output into non-empty records (LF-separated; CR tolerant). */
function splitNonEmptyLines(s: string): string[] {
  return s
    .split('\n')
    .map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
    .filter((l) => l.length > 0);
}

/** Parse one `list-sessions` (FMT_S) line. null on field-count mismatch. */
export function parseSessionLine(
  line: string,
  now: () => Date,
): SessionRawRecord | null {
  const f = line.split(US);
  if (f.length !== FMT_S_FIELD_COUNT) return null;
  return {
    sessionId: f[0]!,
    sessionName: f[1]!,
    windows: toInt(f[2]!),
    attached: f[3] === '1',
    activityAt: epochToIso(f[4]!, now),
  };
}

/** Structural pane fields parsed from FMT_P, BEFORE redaction/introspection. */
export interface ParsedPaneFields {
  paneId: string;
  tmuxTarget: string;
  sessionName: string;
  windowIndex: number;
  paneIndex: number;
  command: string; // raw #{pane_current_command}
  rawTitle: string; // pre-redaction #{pane_title}
  rawCwd: string; // pre-redaction #{pane_current_path}
  lastActivityAt: string;
  panePid: number | null;
  paneDead: boolean;
  paneActive: boolean;
}

/** Parse one `list-panes -a` (FMT_P) line. null on field-count mismatch (parse_error). */
export function parsePaneLine(
  line: string,
  now: () => Date,
): ParsedPaneFields | null {
  const f = line.split(US);
  if (f.length !== FMT_P_FIELD_COUNT) return null;
  const sessionName = f[0]!;
  const windowIndex = toInt(f[1]!);
  const paneIndex = toInt(f[2]!);
  return {
    sessionName,
    windowIndex,
    paneIndex,
    paneId: f[3]!,
    command: f[4]!,
    rawTitle: f[5]!,
    rawCwd: f[6]!,
    lastActivityAt: epochToIso(f[7]!, now),
    panePid: toIntOrNull(f[8]!),
    paneDead: f[9] === '1',
    paneActive: f[10] === '1',
    tmuxTarget: `${sessionName}:${windowIndex}.${paneIndex}`,
  };
}

/** Deterministic ordering: sessionName → windowIndex → paneIndex (SPEC-002 rule 6). */
export function comparePaneFields(a: ParsedPaneFields, b: ParsedPaneFields): number {
  if (a.sessionName !== b.sessionName) {
    return a.sessionName < b.sessionName ? -1 : 1;
  }
  if (a.windowIndex !== b.windowIndex) return a.windowIndex - b.windowIndex;
  return a.paneIndex - b.paneIndex;
}

// --- availability / phase classifiers (pure, unit-tested) ------------------

export type ProbeClassification =
  | { kind: 'not_installed' }
  | { kind: 'ok'; version: string | null }
  | { kind: 'probe_error'; errKind: ExecErrorKind };

export function classifyProbe(r: SpawnResult): ProbeClassification {
  if (r.spawnError !== null) {
    if (r.spawnError.code === 'ENOENT') return { kind: 'not_installed' };
    return { kind: 'probe_error', errKind: 'spawn_error' };
  }
  if (r.timedOut) return { kind: 'probe_error', errKind: 'timeout' };
  if (r.exitCode === 0) return { kind: 'ok', version: parseVersion(r.stdout) };
  return { kind: 'probe_error', errKind: 'exit_nonzero' };
}

export type SessionsClassification =
  | { kind: 'server_not_running' }
  | { kind: 'running_no_session' }
  | { kind: 'normal' }
  | { kind: 'failure'; errKind: ExecErrorKind };

export function classifyListSessions(r: SpawnResult): SessionsClassification {
  if (r.spawnError !== null) return { kind: 'failure', errKind: 'spawn_error' };
  if (r.timedOut) return { kind: 'failure', errKind: 'timeout' };
  if (r.exitCode !== 0) {
    if (isNoServerStderr(r.stderr)) return { kind: 'server_not_running' };
    return { kind: 'failure', errKind: 'exit_nonzero' };
  }
  if (splitNonEmptyLines(r.stdout).length === 0) {
    return { kind: 'running_no_session' };
  }
  return { kind: 'normal' };
}

/** Generic exec-success classifier for list-panes / capture-pane. */
export function classifyExec(
  r: SpawnResult,
): { ok: true } | { ok: false; errKind: ExecErrorKind } {
  if (r.spawnError !== null) return { ok: false, errKind: 'spawn_error' };
  if (r.timedOut) return { ok: false, errKind: 'timeout' };
  if (r.exitCode !== 0) return { ok: false, errKind: 'exit_nonzero' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Error construction (message never includes capture stdout — SPEC-002 AC-07)
// ---------------------------------------------------------------------------

function summarize(
  command: TmuxError['command'],
  kind: TmuxError['kind'],
  r: SpawnResult | null,
): string {
  switch (kind) {
    case 'timeout':
      return `${command}: timed out`;
    case 'spawn_error':
      return `${command}: spawn error (${r?.spawnError?.code ?? 'unknown'})`;
    case 'parse_error':
      return `${command}: field-count mismatch`;
    case 'exit_nonzero': {
      // stderr is tmux's own error channel — NEVER the captured pane content.
      const firstLine =
        (r?.stderr ?? '').split('\n')[0]?.trim().slice(0, 200) ?? '';
      const code = r?.exitCode ?? 'null';
      return firstLine
        ? `${command}: exit ${code}: ${firstLine}`
        : `${command}: exit ${code}`;
    }
  }
}

function mkError(
  phase: TmuxError['phase'],
  command: TmuxError['command'],
  target: string | null,
  kind: TmuxError['kind'],
  r: SpawnResult | null,
): TmuxError {
  return {
    phase,
    command,
    target,
    kind,
    exitCode: r?.exitCode ?? null,
    message: summarize(command, kind, r),
  };
}

// ---------------------------------------------------------------------------
// Exec wrapper — converts any thrown error into a SpawnResult (never throws).
// ---------------------------------------------------------------------------

async function safeExec(
  fn: TmuxExecFn,
  subcommand: string | null,
  args: string[],
): Promise<SpawnResult> {
  try {
    return await fn(subcommand, args);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    return {
      stdout: '',
      stderr: typeof err?.message === 'string' ? err.message : 'exec error',
      exitCode: null,
      timedOut: false,
      spawnError: err ?? (new Error('exec error') as NodeJS.ErrnoException),
      durationMs: 0,
    };
  }
}

function finalize(
  state: AvailabilityState,
  availability: TmuxAvailability,
  sessions: SessionRawRecord[],
  panes: PaneRawRecord[],
  errors: TmuxError[],
  collectedOk: boolean,
  now: () => Date,
): InventoryResult {
  return {
    availability,
    state,
    sessions,
    panes,
    errors,
    collectedOk,
    collectedAt: now().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Collect a read-only tmux inventory snapshot (SPEC-002).
 *
 * Never throws and never hangs: per-command timeouts are enforced by the injected
 * `tmuxExec`/`introspect`; this function only orchestrates, classifies, and
 * isolates failures. `collectedOk=false` is set ONLY on an inventory-phase exec
 * failure (the runner owns last-good/stale fallback — SPEC-002 §2.7, AC-11/AC-12).
 */
export async function collectInventory(
  deps: CollectDeps,
): Promise<InventoryResult> {
  const { tmuxExec, introspect, sanitize, redact, now } = deps;
  const captureLines = deps.captureLines ?? CAPTURE_LINES;
  const errors: TmuxError[] = [];

  let installed = false;
  let version: string | null = null;

  // ---- Phase 0: probe `tmux -V` ----
  const probe = await safeExec(tmuxExec, null, ['-V']);
  const pc = classifyProbe(probe);
  if (pc.kind === 'not_installed') {
    return finalize(
      'not_installed',
      { installed: false, serverRunning: false, version: null },
      [],
      [],
      errors,
      true, // definitive determination; nothing to fall back to (not a failure)
      now,
    );
  }
  if (pc.kind === 'ok') {
    installed = true;
    version = pc.version;
  } else {
    // Binary appears present but probe misbehaved (timeout / non-zero / other
    // spawn error) — record and continue best-effort (SPEC-002 §2.6).
    installed = true;
    errors.push(mkError('probe', 'version', null, pc.errKind, probe));
  }

  // ---- Phase 1: `list-sessions -F FMT_S` ----
  const lsRes = await safeExec(tmuxExec, 'list-sessions', ['-F', FMT_S]);
  const sc = classifyListSessions(lsRes);
  if (sc.kind === 'server_not_running') {
    return finalize(
      'server_not_running',
      { installed, serverRunning: false, version },
      [],
      [],
      errors,
      true,
      now,
    );
  }
  if (sc.kind === 'running_no_session') {
    return finalize(
      'running_no_session',
      { installed, serverRunning: true, version },
      [],
      [],
      errors,
      true,
      now,
    );
  }
  if (sc.kind === 'failure') {
    errors.push(mkError('inventory', 'list-sessions', null, sc.errKind, lsRes));
    return finalize(
      'normal',
      { installed, serverRunning: false, version },
      [],
      [],
      errors,
      false, // inventory failed → do NOT fabricate (runner may use last-good)
      now,
    );
  }

  // normal: parse session records
  const sessions: SessionRawRecord[] = [];
  for (const line of splitNonEmptyLines(lsRes.stdout)) {
    const s = parseSessionLine(line, now);
    if (s === null) {
      errors.push(mkError('inventory', 'list-sessions', null, 'parse_error', null));
      continue;
    }
    sessions.push(s);
  }

  // ---- Phase 2: `list-panes -a -F FMT_P` (single authoritative bulk call) ----
  const lpRes = await safeExec(tmuxExec, 'list-panes', ['-a', '-F', FMT_P]);
  const lpClass = classifyExec(lpRes);
  if (!lpClass.ok) {
    errors.push(mkError('inventory', 'list-panes', null, lpClass.errKind, lpRes));
    return finalize(
      'normal',
      { installed, serverRunning: true, version },
      sessions,
      [], // no fabrication
      errors,
      false,
      now,
    );
  }

  const parsed: ParsedPaneFields[] = [];
  for (const line of splitNonEmptyLines(lpRes.stdout)) {
    const f = parsePaneLine(line, now);
    if (f === null) {
      errors.push(mkError('inventory', 'list-panes', null, 'parse_error', null));
      continue; // skip the malformed pane, keep scanning
    }
    parsed.push(f);
  }
  parsed.sort(comparePaneFields);

  // ---- Phase 3 (introspection) + Phase 4 (capture), per pane, target-isolated ----
  const panes: PaneRawRecord[] = [];
  for (const f of parsed) {
    // Process introspection — optional, degradable, isolated (D-020, §2.8).
    let cmdline: string | null = null;
    let processAlive: boolean | null = null;
    try {
      const ir = await introspect(f.panePid);
      processAlive = ir.alive;
      cmdline = ir.cmdline === null ? null : redact(ir.cmdline).text;
    } catch {
      cmdline = null;
      processAlive = null;
    }

    // Capture only live panes; one capture failure never aborts the scan.
    let capture: SanitizedCapture | null = null;
    if (!f.paneDead) {
      const cap = await safeExec(tmuxExec, 'capture-pane', [
        '-p',
        '-t',
        f.paneId,
        '-S',
        `-${captureLines}`,
      ]);
      const capClass = classifyExec(cap);
      if (!capClass.ok) {
        errors.push(
          mkError('capture', 'capture-pane', f.paneId, capClass.errKind, cap),
        );
        capture = null;
      } else {
        capture = sanitize(cap.stdout);
      }
    }

    panes.push({
      paneId: f.paneId,
      tmuxTarget: f.tmuxTarget,
      sessionName: f.sessionName,
      windowIndex: f.windowIndex,
      paneIndex: f.paneIndex,
      command: f.command, // RAW passthrough (structural id, SPEC-006 §2.3)
      paneTitle: f.rawTitle === '' ? null : redact(f.rawTitle).text,
      cwd: redact(f.rawCwd).text,
      lastActivityAt: f.lastActivityAt,
      panePid: f.panePid,
      paneDead: f.paneDead,
      paneActive: f.paneActive,
      cmdline,
      processAlive,
      capture,
    });
  }

  return finalize(
    'normal',
    { installed, serverRunning: true, version },
    sessions,
    panes,
    errors,
    true,
    now,
  );
}

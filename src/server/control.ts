/**
 * SPEC-400 — control actions (the ONLY state-changing tmux path).
 *
 * `controlExec` is a write-path wrapper PHYSICALLY SEPARATE from the read-only
 * `tmuxExec`: it spawns `send-keys` only, via exactly 3 fixed argv templates,
 * shell:false, with a stable `paneId` `-t` target. The `ControlService` runs the
 * full safety-gate pipeline (schema → controllability → fresh target re-validation
 * → action-specific → execute → audit) and never trusts the cached snapshot for
 * re-validation. Input text is never persisted (byteLength + redactedFlag only).
 */
import { redact } from '../redaction/redact';
import type { ProcessSpawn, SpawnResult } from '../types';
import type { SnapshotRuntime } from './runtime';
import type { ActivityDetail, ActivitySeverity, ActivityType, NewActivity } from './activity';
import type { ExpectedTarget, PassthroughService } from './passthrough';

const PANE_ID_RE = /^%[0-9]+$/;
const ORC_ID_RE = /^pane:%[0-9]+$/;
export const CONTROL_TIMEOUT_MS = 2000;
export const MAX_INPUT_BYTES = 4 * 1024;

// SPEC-400 §2.3.1 — literal `text` control-byte filter: raw C0/DEL bytes would
// deliver Ctrl-C/D/Z/\ via `send-keys -l`, bypassing KEY_ALLOWLIST + /interrupt
// confirm. Reject them (AC-20). Newline/Tab included: submit uses the Enter key
// template, and Tab goes via /key — literal text carries none of these.
// eslint-disable-next-line no-control-regex
const CONTROL_BYTE_RE = /[\x00-\x1f\x7f]/;

export const KEY_ALLOWLIST = new Set([
  'Enter', 'Tab', 'BTab', 'Escape', 'Space', 'BSpace',
  'Up', 'Down', 'Left', 'Right',
  'Home', 'End', 'PageUp', 'PageDown', 'Delete',
]);

// SPEC-401 §2.7 — curated interactive superset, applied ONLY to armed passthrough
// `/key`. Non-destructive readline chords + function keys. Destructive chords
// (C-c/C-d/C-z/C-\) are PERMANENTLY excluded — C-c only via /interrupt (confirm).
export const INTERACTIVE_KEY_ALLOWLIST = new Set([
  ...KEY_ALLOWLIST,
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'C-a', 'C-e', 'C-k', 'C-u', 'C-w', 'C-l', 'C-b', 'C-f', 'C-p', 'C-n', 'C-r',
  'M-b', 'M-f',
]);
// Union of everything `controlExec` may ever send via the key template (defense in
// depth; the ControlService still enforces the context-specific subset).
const KEY_ALLOWLIST_ALL = INTERACTIVE_KEY_ALLOWLIST;

export type ControlOp =
  | { kind: 'literal'; paneId: string; text: string }
  | { kind: 'key'; paneId: string; key: string }
  | { kind: 'interrupt'; paneId: string };

export type ControlExecFn = (op: ControlOp) => Promise<SpawnResult>;

/** The single writer. Builds one of exactly 3 send-keys argv templates; shell:false. */
export function makeControlExec(spawn: ProcessSpawn, timeoutMs = CONTROL_TIMEOUT_MS): ControlExecFn {
  return (op) => {
    if (!PANE_ID_RE.test(op.paneId)) throw new Error('invalid paneId');
    let argv: string[];
    if (op.kind === 'literal') argv = ['send-keys', '-t', op.paneId, '-l', '--', op.text];
    else if (op.kind === 'key') {
      // defense in depth: union of every key the service may send (base ∪ interactive).
      // The ControlService enforces the context-specific subset (base for form /key,
      // interactive only for armed passthrough). Destructive chords are in NEITHER set.
      if (!KEY_ALLOWLIST_ALL.has(op.key)) throw new Error('key not allowed');
      argv = ['send-keys', '-t', op.paneId, op.key];
    } else argv = ['send-keys', '-t', op.paneId, 'C-c'];
    return spawn('tmux', argv, { timeoutMs });
  };
}

export type ControlAction = 'input' | 'key' | 'interrupt';

// ExpectedTarget is owned by ./passthrough (shared with the arm-session baseline).
export interface ControlOutcomeResponse {
  status: number;
  body: Record<string, unknown>;
}

const EXPECTED_KEYS = new Set(['paneId', 'tmuxTarget', 'command', 'agentType']);

function validateExpected(v: unknown): ExpectedTarget | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => !EXPECTED_KEYS.has(k))) return null;
  if (typeof o.paneId !== 'string' || typeof o.tmuxTarget !== 'string' || typeof o.command !== 'string' || typeof o.agentType !== 'string') return null;
  return { paneId: o.paneId, tmuxTarget: o.tmuxTarget, command: o.command, agentType: o.agentType };
}

// SPEC-401 §2.4 — optional passthrough marker on /input & /key. `{ armSessionId }`
// only; a free-form command field would be rejected (R-CTRL-008). Returns:
//   undefined = absent · string = valid armSessionId · false = present but malformed
function parsePassthrough(v: unknown): string | false | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => k !== 'armSessionId')) return false;
  return typeof o.armSessionId === 'string' && o.armSessionId.length > 0 ? o.armSessionId : false;
}

// expected is null only on passthrough egress (server uses the arm-session baseline).
interface ParsedInput { expected: ExpectedTarget | null; requestId: string | null; text: string; submit: boolean; passthrough: string | null }
interface ParsedKey { expected: ExpectedTarget | null; requestId: string | null; key: string; passthrough: string | null }
interface ParsedInterrupt { expected: ExpectedTarget | null; requestId: string | null; passthrough: null }
type Parsed = ParsedInput | ParsedKey | ParsedInterrupt;
type ParseErr = { code: string; status: number; message: string };

function asObject(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
const MAX_REQUEST_ID = 128;
function reqId(o: Record<string, unknown>): string | null {
  return typeof o.requestId === 'string' && o.requestId.length <= MAX_REQUEST_ID ? o.requestId : null;
}

export class ControlService {
  private locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly runtime: SnapshotRuntime,
    private readonly controlExec: ControlExecFn,
    private readonly now: () => Date = () => new Date(),
    private readonly passthrough?: PassthroughService, // SPEC-401 — optional (undefined disables passthrough egress)
  ) {}

  async handle(action: ControlAction, orcId: string, body: unknown): Promise<ControlOutcomeResponse> {
    if (!ORC_ID_RE.test(orcId)) return this.err(422, 'validation_error', 'invalid orcId');
    const paneId = orcId.slice('pane:'.length);

    const parsed = this.parse(action, body);
    if ('code' in parsed) return this.err(parsed.status, parsed.code, parsed.message);

    // SPEC-401 passthrough egress: no client `expected` (server uses the arm-session
    // baseline); Observe = no egress is server-enforced via authorizeEgress.
    if (parsed.passthrough !== null) {
      return this.withPaneLock(paneId, () => this.runPassthrough(action, orcId, paneId, parsed));
    }

    if (parsed.expected === null || parsed.expected.paneId !== paneId) {
      return this.err(422, 'validation_error', 'expected.paneId mismatch');
    }
    // serialize per pane (at-most-one in-flight)
    return this.withPaneLock(paneId, () => this.run(action, orcId, paneId, parsed));
  }

  private parse(action: ControlAction, body: unknown): Parsed | ParseErr {
    const o = asObject(body);
    if (!o) return { code: 'validation_error', status: 422, message: 'body must be an object' };

    // passthrough marker (input/key only) — interrupt never rides passthrough.
    const pt = action === 'interrupt' ? undefined : parsePassthrough(o.passthrough);
    if (pt === false) return { code: 'validation_error', status: 422, message: 'invalid passthrough marker' };
    const passthrough = pt ?? null;

    // expected is required unless this is a passthrough egress (baseline used instead).
    const expected = validateExpected(o.expected);
    if (passthrough === null && !expected) return { code: 'validation_error', status: 422, message: 'invalid or missing expected target' };
    if (o.expected !== undefined && !expected) return { code: 'validation_error', status: 422, message: 'invalid expected target' };

    if (action === 'input') {
      const allowed = new Set(['text', 'submit', 'expected', 'requestId', 'passthrough']);
      if (Object.keys(o).some((k) => !allowed.has(k))) return { code: 'validation_error', status: 422, message: 'unknown field' };
      if (typeof o.text !== 'string') return { code: 'validation_error', status: 422, message: 'text must be a string' };
      if (Buffer.byteLength(o.text, 'utf8') > MAX_INPUT_BYTES) return { code: 'validation_error', status: 422, message: 'text too long' };
      if (CONTROL_BYTE_RE.test(o.text)) return { code: 'control_char_not_allowed', status: 422, message: 'text contains control bytes' };
      if (o.submit !== undefined && typeof o.submit !== 'boolean') return { code: 'validation_error', status: 422, message: 'submit must be a boolean' };
      // passthrough literal is submit:false (Enter is a separate /key); form default is submit:true.
      const submit = passthrough !== null ? false : o.submit !== false;
      return { expected, requestId: reqId(o), text: o.text, submit, passthrough };
    }
    if (action === 'key') {
      const allowed = new Set(['key', 'expected', 'requestId', 'passthrough']);
      if (Object.keys(o).some((k) => !allowed.has(k))) return { code: 'validation_error', status: 422, message: 'unknown field' };
      if (typeof o.key !== 'string') return { code: 'validation_error', status: 422, message: 'key must be a string' };
      // armed passthrough → interactive superset; form /key → base allowlist only.
      const allowedKeys = passthrough !== null ? INTERACTIVE_KEY_ALLOWLIST : KEY_ALLOWLIST;
      if (!allowedKeys.has(o.key)) return { code: 'key_not_allowed', status: 422, message: 'key not allowed' };
      return { expected, requestId: reqId(o), key: o.key, passthrough };
    }
    // interrupt (never passthrough)
    const allowed = new Set(['confirmed', 'expected', 'requestId']);
    if (Object.keys(o).some((k) => !allowed.has(k))) return { code: 'validation_error', status: 422, message: 'unknown field' };
    if (o.confirmed !== true) return { code: 'confirm_required', status: 422, message: 'interrupt requires confirmed:true' };
    return { expected, requestId: reqId(o), passthrough: null };
  }

  private async run(action: ControlAction, orcId: string, paneId: string, parsed: ParsedInput | ParsedKey | ParsedInterrupt): Promise<ControlOutcomeResponse> {
    const { expected, requestId } = parsed;
    if (!expected) return this.err(422, 'validation_error', 'missing expected target'); // guaranteed by handle()

    // Gate 3 — orc resolution (cold start = not-yet-published → 503, not an abort)
    if (this.runtime.snapshotVersion === 0) return this.err(503, 'snapshot_not_ready', 'snapshot not ready');
    const orc = this.runtime.getOrc(orcId);
    if (!orc) return this.abort(action, orcId, paneId, expected.tmuxTarget, 'orc_not_found', 404, 'orc_not_found', requestId, parsed);
    // Gate 4 — controllability
    if (orc.status === 'terminated' || orc.status === 'stale') {
      return this.abort(action, orcId, paneId, orc.tmuxTarget, 'not_controllable', 409, 'not_controllable', requestId, parsed);
    }
    // Gate 5 — fresh target re-validation (never trust cache)
    const fresh = await this.runtime.revalidate(paneId);
    if (!fresh) return this.abort(action, orcId, paneId, expected.tmuxTarget, 'target_gone', 410, 'target_gone', requestId, parsed);
    if (fresh.tmuxTarget !== expected.tmuxTarget || fresh.command !== expected.command || fresh.agentType !== expected.agentType) {
      return this.abort(action, orcId, paneId, fresh.tmuxTarget, 'target_mismatch', 409, 'target_mismatch', requestId, parsed);
    }

    // Gate 7 — execute
    const start = this.now().getTime();
    try {
      let outcome: 'success' | 'partial' = 'success';
      if (action === 'input') {
        const p = parsed as ParsedInput;
        const r1 = await this.controlExec({ kind: 'literal', paneId, text: p.text });
        if (!spawnOk(r1)) return this.failed(action, orcId, paneId, fresh.tmuxTarget, r1, requestId, parsed, start);
        if (p.submit) {
          const r2 = await this.controlExec({ kind: 'key', paneId, key: 'Enter' });
          if (!spawnOk(r2)) outcome = 'partial';
        }
      } else if (action === 'key') {
        const r = await this.controlExec({ kind: 'key', paneId, key: (parsed as ParsedKey).key });
        if (!spawnOk(r)) return this.failed(action, orcId, paneId, fresh.tmuxTarget, r, requestId, parsed, start);
      } else {
        const r = await this.controlExec({ kind: 'interrupt', paneId });
        if (!spawnOk(r)) return this.failed(action, orcId, paneId, fresh.tmuxTarget, r, requestId, parsed, start);
      }

      const durationMs = Math.max(0, this.now().getTime() - start);
      const audit = this.runtime.recordActivity(this.activity(action, orcId, paneId, fresh.tmuxTarget, outcome, null, requestId, parsed, { durationMs, exitCode: 0 }));
      return {
        status: 200,
        body: { ok: true, action, orcId, paneId, tmuxTarget: fresh.tmuxTarget, outcome, executedAt: this.now().toISOString(), requestId, auditEventId: audit.id },
      };
    } catch (err) {
      return this.failed(action, orcId, paneId, fresh.tmuxTarget, null, requestId, parsed, start, err);
    }
  }

  /**
   * SPEC-401 §2.5 — passthrough egress. Observe=no-egress is enforced by
   * authorizeEgress (409 not_armed); the arm-session baseline is the re-validation
   * expected; on drift the session is closed (audit flushed) + abort. No per-action
   * control.result is emitted — the egress is accumulated into the session summary.
   */
  private async runPassthrough(action: ControlAction, orcId: string, paneId: string, parsed: ParsedInput | ParsedKey | ParsedInterrupt): Promise<ControlOutcomeResponse> {
    if (!this.passthrough || parsed.passthrough === null) return this.err(409, 'not_armed', 'passthrough not armed');
    const auth = this.passthrough.authorizeEgress(paneId, parsed.passthrough);
    if (!auth.ok) {
      if (auth.code === 'rate_limited') return this.err(429, 'rate_limited', 'keystroke rate exceeded');
      return this.err(409, 'not_armed', 'passthrough not armed');
    }
    // D-044 continuous gate (SPEC-401 §2.3/§2.6): exposure may have gone off after
    // arm — no blind writes. Close the session (flush audit) and refuse egress.
    if (!this.runtime.previewExposureEnabled()) {
      this.passthrough.closeForPane(paneId, 'exposure_off');
      return this.err(409, 'exposure_off', 'exposure disabled');
    }
    const expected = auth.session.baseline;

    // Gate 3/4 — orc resolution + controllability. Drift → close session (flush audit).
    if (this.runtime.snapshotVersion === 0) return this.err(503, 'snapshot_not_ready', 'snapshot not ready');
    const orc = this.runtime.getOrc(orcId);
    if (!orc) {
      this.passthrough.closeForPane(paneId, 'target_gone');
      return this.err(404, 'orc_not_found', 'orc not found');
    }
    if (orc.status === 'terminated' || orc.status === 'stale') {
      this.passthrough.closeForPane(paneId, 'not_controllable');
      return this.err(409, 'not_controllable', 'not controllable');
    }
    // Gate 5 — fresh re-validation against the arm baseline (never trust cache, §2.5).
    const fresh = await this.runtime.revalidate(paneId);
    if (!fresh) {
      this.passthrough.closeForPane(paneId, 'target_gone');
      return this.err(410, 'target_gone', 'target gone');
    }
    if (fresh.tmuxTarget !== expected.tmuxTarget || fresh.command !== expected.command || fresh.agentType !== expected.agentType) {
      this.passthrough.closeForPane(paneId, 'target_mismatch');
      return this.err(409, 'target_mismatch', 'target mismatch');
    }

    // Gate 7 — execute (single writer, no Enter auto-append for passthrough literal).
    let execOk = true;
    if (action === 'input') {
      const p = parsed as ParsedInput;
      const r = await this.controlExec({ kind: 'literal', paneId, text: p.text });
      execOk = spawnOk(r);
      this.passthrough.recordKeystroke(auth.session, { action: 'input', redacted: redact(p.text).redacted, execOk });
    } else if (action === 'key') {
      const key = (parsed as ParsedKey).key;
      const r = await this.controlExec({ kind: 'key', paneId, key });
      execOk = spawnOk(r);
      this.passthrough.recordKeystroke(auth.session, { action: 'key', key, execOk });
    } else {
      return this.err(422, 'validation_error', 'interrupt cannot be passthrough'); // defense (parse blocks this)
    }

    if (!execOk) return { status: 502, body: { ok: false, error: { code: 'tmux_exec_failed', message: 'tmux send-keys failed' }, passthrough: true } };
    return { status: 200, body: { ok: true, action, orcId, paneId, tmuxTarget: fresh.tmuxTarget, outcome: 'success', passthrough: true, executedAt: this.now().toISOString() } };
  }

  private abort(action: ControlAction, orcId: string, paneId: string, tmuxTarget: string, reason: string, status: number, code: string, requestId: string | null, parsed: ParsedInput | ParsedKey | ParsedInterrupt): ControlOutcomeResponse {
    const audit = this.runtime.recordActivity(this.activity(action, orcId, paneId, tmuxTarget, 'aborted', reason, requestId, parsed, {}));
    return { status, body: { ok: false, error: { code, message: code }, auditEventId: audit.id } };
  }

  private failed(action: ControlAction, orcId: string, paneId: string, tmuxTarget: string, r: SpawnResult | null, requestId: string | null, parsed: ParsedInput | ParsedKey | ParsedInterrupt, start: number, _err?: unknown): ControlOutcomeResponse {
    const durationMs = Math.max(0, this.now().getTime() - start);
    const audit = this.runtime.recordActivity(this.activity(action, orcId, paneId, tmuxTarget, 'failed', 'tmux_exec_failed', requestId, parsed, { durationMs, ...(r?.exitCode !== null && r?.exitCode !== undefined ? { exitCode: r.exitCode } : {}) }));
    return { status: 502, body: { ok: false, error: { code: 'tmux_exec_failed', message: 'tmux send-keys failed' }, auditEventId: audit.id } };
  }

  private activity(
    action: ControlAction, orcId: string, paneId: string, tmuxTarget: string,
    controlOutcome: 'success' | 'partial' | 'aborted' | 'failed', reason: string | null,
    requestId: string | null, parsed: ParsedInput | ParsedKey | ParsedInterrupt, extra: { durationMs?: number; exitCode?: number },
  ): NewActivity {
    const severity: ActivitySeverity = controlOutcome === 'success' ? 'info' : controlOutcome === 'failed' ? 'error' : 'warn';
    const code = controlCode(action, controlOutcome, reason);
    const detail: ActivityDetail = {
      action,
      controlOutcome,
      outcome: controlOutcome === 'success' || controlOutcome === 'partial' ? (controlOutcome === 'success' ? 'success' : 'failure') : 'failure',
      ...(reason ? { reason } : {}),
      ...(action === 'key' ? { keyName: (parsed as ParsedKey).key } : {}),
      ...(action === 'input' ? { inputByteLength: Buffer.byteLength((parsed as ParsedInput).text, 'utf8'), inputRedactedFlag: redact((parsed as ParsedInput).text).redacted } : {}),
      ...(extra.exitCode !== undefined ? { exitCode: extra.exitCode } : {}),
      ...(extra.durationMs !== undefined ? { durationMs: extra.durationMs } : {}),
      ...(requestId ? { correlationId: requestId } : {}),
    };
    return {
      type: 'control.result' as ActivityType,
      severity,
      code,
      target: { orcId, paneId, tmuxTarget },
      message: `control ${action} ${controlOutcome}`,
      detail,
    };
  }

  private err(status: number, code: string, message: string): ControlOutcomeResponse {
    return { status, body: { ok: false, error: { code, message } } };
  }

  private withPaneLock<T extends ControlOutcomeResponse>(paneId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(paneId) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const mine = prev.then(() => gate);
    this.locks.set(paneId, mine);
    return prev.then(async () => {
      try {
        return await fn();
      } finally {
        release();
        if (this.locks.get(paneId) === mine) this.locks.delete(paneId); // free when no waiter chained
      }
    });
  }
}

function spawnOk(r: SpawnResult): boolean {
  return r.spawnError === null && !r.timedOut && r.exitCode === 0;
}

function controlCode(action: ControlAction, outcome: 'success' | 'partial' | 'aborted' | 'failed', reason: string | null): string {
  if (outcome === 'success' || outcome === 'partial') {
    return action === 'input' ? 'control.input_sent' : action === 'key' ? 'control.key_sent' : 'control.interrupt_sent';
  }
  if (outcome === 'failed') return 'control.tmux_exec_failed';
  // aborted
  if (reason === 'target_gone' || reason === 'target_mismatch') return 'control.target_revalidation_failed';
  if (reason === 'confirm_required') return 'control.confirm_required';
  if (reason === 'key_not_allowed') return 'control.key_not_allowed';
  if (reason === 'not_controllable') return 'control.not_controllable';
  return 'control.aborted';
}

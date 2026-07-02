/**
 * SPEC-103 — live pane-view runtime: read-only high-frequency capturer + the
 * per-connection attach session (poll loop, gating, viewSeq, supersede, failure
 * → end). The frozen wire contract lives in ./live-view.ts (1:1 with SPEC-103 §2).
 *
 * Read-only invariant (SPEC-103 §2.5, D-019/D-041): the only tmux commands used are
 * READONLY_ALLOWLIST `list-panes` (geometry+cursor via format vars — no
 * `display-message`) and `capture-pane` (`-p -J`, no `-e` in Phase 1). No write path.
 * Redaction-before-egress (SPEC-006 §2.5): every `lines` is a `sanitizeCapture`
 * output; raw is discarded here and never reaches a frame/log/disk.
 */
import { CAPTURE_LINES, type SanitizedCapture, type SpawnResult, type TmuxExecFn } from '../types';
import {
  MAX_VIEW_CAPTURE_FAILURES,
  PANE_VIEW_INTERVAL_MS,
  type CursorPos,
  type PaneViewEndPayload,
  type PaneViewEndReason,
  type PaneViewPayload,
  type PaneViewSeedPayload,
} from './live-view';

// ── capturer ────────────────────────────────────────────────────────────────────

export interface PaneViewCaptureDeps {
  tmuxExec: TmuxExecFn;
  sanitize: (raw: string) => SanitizedCapture;
  captureLines?: number; // default CAPTURE_LINES
}

/** One read-only capture tick result. `gone` = pane vanished; `failed` = transient. */
export type PaneViewCapture =
  | { ok: true; cols: number; rows: number; cursor: CursorPos | null; lines: string[]; redacted: boolean; byteClamped: boolean }
  | { ok: false; kind: 'gone' | 'failed' };

// SPEC-103 §2.5 — geometry + cursor via list-panes format vars (target-row matched by pane_id).
const LV_FMT = '#{pane_id} #{pane_width} #{pane_height} #{cursor_x} #{cursor_y} #{cursor_flag} #{alternate_on}';

const execOk = (r: SpawnResult): boolean => r.spawnError === null && !r.timedOut && r.exitCode === 0;

interface Geometry {
  cols: number;
  rows: number;
  cursor: CursorPos | null;
}

/** Parse the matching `list-panes` row for `paneId`; null if absent (pane gone) or malformed. */
function parseGeometry(stdout: string, paneId: string): Geometry | null {
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (t.length === 0) continue;
    const f = t.split(' ');
    if (f.length < 7 || f[0] !== paneId) continue;
    const cols = Number(f[1]);
    const rows = Number(f[2]);
    const cx = Number(f[3]);
    const cy = Number(f[4]);
    const cursorVisible = f[5] === '1'; // #{cursor_flag}: 0 → hidden → cursor:null (no separate field)
    // f[6] = #{alternate_on}: collected per SPEC-103 §2.5 but NOT surfaced as a frame field in
    // Phase 1 (no payload field in the frozen contract); a forward contract addition if SPEC-203
    // needs alt-screen handling.
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;
    const cursor: CursorPos | null =
      cursorVisible && Number.isFinite(cx) && Number.isFinite(cy) ? { x: cx, y: cy } : null;
    return { cols, rows, cursor };
  }
  return null;
}

/**
 * One live capture tick for a pane, read-only. Order (SPEC-103 §2.5): list-panes
 * (geometry+cursor, target-row match) → capture-pane (text) → sanitize.
 */
export async function capturePaneView(deps: PaneViewCaptureDeps, paneId: string): Promise<PaneViewCapture> {
  const captureLines = deps.captureLines ?? CAPTURE_LINES;

  const lp = await deps.tmuxExec('list-panes', ['-t', paneId, '-F', LV_FMT]);
  if (!execOk(lp)) return { ok: false, kind: 'failed' };
  const geom = parseGeometry(lp.stdout, paneId);
  if (geom === null) return { ok: false, kind: 'gone' }; // paneId not among the window's panes

  const cap = await deps.tmuxExec('capture-pane', ['-p', '-J', '-t', paneId, '-S', `-${captureLines}`]);
  if (!execOk(cap)) return { ok: false, kind: 'failed' };
  const s = deps.sanitize(cap.stdout); // redaction chokepoint; raw discarded after this

  return { ok: true, cols: geom.cols, rows: geom.rows, cursor: geom.cursor, lines: s.lines, redacted: s.redacted, byteClamped: s.byteClamped };
}

// ── per-connection attach session ────────────────────────────────────────────────

/** Host the session queries — implemented over SnapshotRuntime by the WS layer. */
export interface LiveViewHost {
  /** orcId → paneId ("%12") using the current snapshot, or null if unknown. */
  resolvePaneId(orcId: string): string | null;
  /** global preview exposure gate (D-044). */
  exposureEnabled(): boolean;
  /** one read-only capture tick. */
  capture(paneId: string): Promise<PaneViewCapture>;
  now(): Date;
}

/** Sends a live-view frame on the WS (version:null, seq NOT incremented — §2.1). */
export type LiveViewSend = (
  type: 'pane_view_seed' | 'pane_view' | 'pane_view_end',
  payload: PaneViewSeedPayload | PaneViewPayload | PaneViewEndPayload,
) => void;

export interface PaneViewSessionOptions {
  intervalMs?: number;
  maxFailures?: number;
  setTimer?: (fn: () => void, ms: number) => { clear: () => void }; // injectable for tests
}

const defaultSetTimer = (fn: () => void, ms: number): { clear: () => void } => {
  const t = setTimeout(fn, ms);
  if (typeof t.unref === 'function') t.unref();
  return { clear: () => clearTimeout(t) };
};

/**
 * At-most-one active attach per connection (D-041). Polls only while attached AND
 * exposure is on; a lost/coalesced frame never affects the snapshot channel because
 * these frames carry version:null and do not consume `seq` (§2.1, enforced by the
 * WS `send`). Tab visibility is client-driven (§3.3: hidden → client sends detach).
 */
export class PaneViewSession {
  private orcId: string | null = null;
  private paneId: string | null = null;
  private viewSeq = 0;
  private failCount = 0;
  private timer: { clear: () => void } | null = null;
  private readonly intervalMs: number;
  private readonly maxFailures: number;
  private readonly setTimer: (fn: () => void, ms: number) => { clear: () => void };

  constructor(
    private readonly host: LiveViewHost,
    private readonly send: LiveViewSend,
    opts: PaneViewSessionOptions = {},
  ) {
    this.intervalMs = opts.intervalMs ?? PANE_VIEW_INTERVAL_MS;
    this.maxFailures = opts.maxFailures ?? MAX_VIEW_CAPTURE_FAILURES;
    this.setTimer = opts.setTimer ?? defaultSetTimer;
  }

  /** `view.attach {orcId}` — reject with pane_view_end, or seed + start polling. */
  async onAttach(orcId: string): Promise<void> {
    if (this.orcId === orcId) return; // already attached to this orc → no-op
    if (this.orcId !== null) this.endAndStop('superseded'); // supersede the previous attach (≤1)

    const paneId = this.host.resolvePaneId(orcId);
    if (paneId === null) return this.emitEnd(orcId, 'pane_gone');
    if (!this.host.exposureEnabled()) return this.emitEnd(orcId, 'exposure_off');

    const cap = await this.host.capture(paneId);
    if (this.orcId !== null) return; // a concurrent attach won the race; drop this one
    if (!cap.ok) return this.emitEnd(orcId, cap.kind === 'gone' ? 'pane_gone' : 'error');

    this.orcId = orcId;
    this.paneId = paneId;
    this.viewSeq = 0;
    this.failCount = 0;
    this.send('pane_view_seed', this.seedFrom(orcId, cap));
    this.scheduleNext();
  }

  /** `view.detach {orcId}` — stop + end(detached); no-op if not attached to that orc. */
  onDetach(orcId: string): void {
    if (this.orcId !== orcId) return; // §3.3 no-op
    this.endAndStop('detached');
  }

  /** WS close/error — stop polling silently (connection is gone; no frame). */
  dispose(): void {
    this.clearTimer();
    this.orcId = null;
    this.paneId = null;
  }

  private scheduleNext(): void {
    this.clearTimer();
    this.timer = this.setTimer(() => void this.tick(), this.intervalMs);
  }

  private async tick(): Promise<void> {
    const orcId = this.orcId;
    const paneId = this.paneId;
    if (orcId === null || paneId === null) return;
    if (!this.host.exposureEnabled()) return this.endAndStop('exposure_off'); // gate broke (§3.2)

    const cap = await this.host.capture(paneId);
    if (this.orcId !== orcId || this.paneId !== paneId) return; // detached/superseded during await

    if (!cap.ok) {
      if (cap.kind === 'gone') return this.endAndStop('pane_gone');
      this.failCount += 1;
      if (this.failCount >= this.maxFailures) return this.endAndStop('error');
      this.scheduleNext(); // transient: skip this tick's frame, keep polling
      return;
    }

    this.failCount = 0;
    this.viewSeq += 1;
    this.send('pane_view', this.viewFrom(orcId, cap, this.viewSeq));
    this.scheduleNext();
  }

  private endAndStop(reason: PaneViewEndReason): void {
    const orcId = this.orcId;
    this.clearTimer();
    this.orcId = null;
    this.paneId = null;
    if (orcId !== null) this.emitEnd(orcId, reason);
  }

  private emitEnd(orcId: string, reason: PaneViewEndReason): void {
    this.send('pane_view_end', { orcId, reason });
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.timer.clear();
      this.timer = null;
    }
  }

  private seedFrom(orcId: string, cap: Extract<PaneViewCapture, { ok: true }>): PaneViewSeedPayload {
    return {
      orcId,
      cols: cap.cols,
      rows: cap.rows,
      cursor: cap.cursor,
      lines: cap.lines,
      capturedAt: this.host.now().toISOString(),
      redacted: cap.redacted,
      byteClamped: cap.byteClamped,
      viewSeq: 0,
    };
  }

  private viewFrom(orcId: string, cap: Extract<PaneViewCapture, { ok: true }>, viewSeq: number): PaneViewPayload {
    return {
      orcId,
      cols: cap.cols,
      rows: cap.rows,
      cursor: cap.cursor,
      lines: cap.lines,
      capturedAt: this.host.now().toISOString(),
      redacted: cap.redacted,
      byteClamped: cap.byteClamped,
      viewSeq,
    };
  }
}

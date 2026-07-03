/**
 * SPEC-103 §2.3/§2.4 + SPEC-203 §2.4 — pane live-view reconcile core (the testable brain).
 *
 * A capture-based (not true-stream) terminal: `pane_view_seed` carries the full scrollback seed
 * (oldest→newest); each `pane_view` carries the current visible window (Phase 1 default) that
 * REPLACES the live window on top of the immutable seed scrollback. Ordering is decided ONLY by
 * per-attach `viewSeq` (never the snapshot `version`, invariant ③): seed = 0, each view strictly
 * +1. A forward gap (`viewSeq > prev+1`) cannot be partially resynced — the caller must
 * detach→re-attach for a fresh seed (SPEC-103 §2.4, AC-12/AC-13). Duplicates/stale (≤ prev) drop.
 *
 * All text here is already redacted by the backend `sanitizeCapture` chokepoint (invariant ②):
 * this module NEVER masks, reconstructs, or synthesizes lines — it only slices/joins what arrived.
 * The Phase 1.5 styled overlay (`spans`, SPEC-103 §2.3.1) is carried alongside its `lines` with
 * the same slice indices; a frame whose `spans` violates the length invariant is treated as plain
 * (fail-safe mirror of the server's own plain fallback — never partially styled).
 */
import type { CursorPos, PaneViewPayload, PaneViewSeedPayload, StyleSpan } from '../types/ws';

/**
 * The reconstructed pane screen. `scrollback` is the seed history above the live window (frozen at
 * seed time — capture-based limit, D-045); `window` is the latest visible screen. The rendered
 * buffer is `scrollback ++ window`. `*Spans` are the §2.3.1 styled overlays parallel to the
 * matching lines array — `null` = that region is plain (Phase 1 behavior).
 */
export interface PaneScreen {
  orcId: string;
  cols: number;
  rows: number;
  scrollback: string[]; // seed history above the live window (immutable after seed)
  window: string[]; // current visible window (latest pane_view wins)
  scrollbackSpans: StyleSpan[][] | null; // styled overlay for `scrollback` (frozen with it)
  windowSpans: StyleSpan[][] | null; // styled overlay for `window` (latest pane_view wins)
  cursor: CursorPos | null; // visible-screen relative (origin = top-left of window)
  viewSeq: number;
  redacted: boolean; // last frame flagged a redaction match
  byteClamped: boolean;
  capturedAt: string;
}

export type PaneApplyOutcome =
  | { kind: 'applied'; next: PaneScreen }
  | { kind: 'dropped' } // stale/duplicate viewSeq (≤ current) — idempotent no-op
  | { kind: 'gap' }; // non-contiguous viewSeq → caller must re-attach (no partial resync)

/** §2.3.1 invariant: present ⇒ spans.length === lines.length. Violation ⇒ plain (null). */
function validSpans(spans: StyleSpan[][] | undefined, lineCount: number): StyleSpan[][] | null {
  return Array.isArray(spans) && spans.length === lineCount ? spans : null;
}

/** Build the initial screen from a `pane_view_seed` (viewSeq must be 0). */
export function fromSeed(seed: PaneViewSeedPayload): PaneScreen {
  const rows = Math.max(0, seed.rows);
  const total = seed.lines.length;
  const split = rows > 0 && total > rows ? total - rows : 0;
  const spans = validSpans(seed.spans, total);
  return {
    orcId: seed.orcId,
    cols: seed.cols,
    rows: seed.rows,
    scrollback: seed.lines.slice(0, split),
    window: seed.lines.slice(split),
    scrollbackSpans: spans === null ? null : spans.slice(0, split),
    windowSpans: spans === null ? null : spans.slice(split),
    cursor: seed.cursor,
    viewSeq: seed.viewSeq,
    redacted: seed.redacted,
    byteClamped: seed.byteClamped,
    capturedAt: seed.capturedAt,
  };
}

/**
 * Apply a `pane_view` delta against the current screen, enforcing strict viewSeq ordering.
 * Phase 1: the frame's `lines` are the current visible window and REPLACE the live window
 * (full-window confirmed by SPEC-103 §6 Q2). scrollback is left untouched (capture-based, D-045).
 * The window's styled overlay follows its frame: a plain frame (no/invalid `spans`) resets the
 * live window to plain even if the previous frame was styled (server plain fallback, §2.3.1-6).
 */
export function applyView(prev: PaneScreen, view: PaneViewPayload): PaneApplyOutcome {
  if (view.viewSeq <= prev.viewSeq) return { kind: 'dropped' };
  if (view.viewSeq !== prev.viewSeq + 1) return { kind: 'gap' };
  return {
    kind: 'applied',
    next: {
      ...prev,
      cols: view.cols,
      rows: view.rows,
      window: view.lines,
      windowSpans: validSpans(view.spans, view.lines.length),
      cursor: view.cursor,
      viewSeq: view.viewSeq,
      redacted: view.redacted,
      byteClamped: view.byteClamped,
      capturedAt: view.capturedAt,
    },
  };
}

export interface RenderedPane {
  lines: string[]; // scrollback ++ window (redacted, as-received)
  /** §2.3.1 styled overlay parallel to `lines`, or null when the whole buffer is plain. */
  spans: StyleSpan[][] | null;
  /** Cursor row within `lines` (scrollback.length + cursor.y), or null when no cursor. */
  cursorRow: number | null;
  cursorCol: number | null;
  /** True when the buffer starts at the capture seed (older history does not exist — D-045). */
  seededScrollback: boolean;
}

/** Flatten a screen to the rendered buffer + absolute cursor position (SPEC-203 §2.4). */
export function renderPane(screen: PaneScreen): RenderedPane {
  const lines = screen.scrollback.concat(screen.window);
  const spans =
    screen.scrollbackSpans === null && screen.windowSpans === null
      ? null
      : (screen.scrollbackSpans ?? screen.scrollback.map(() => [])).concat(
          screen.windowSpans ?? screen.window.map(() => []),
        );
  const cursorRow = screen.cursor ? screen.scrollback.length + screen.cursor.y : null;
  const cursorCol = screen.cursor ? screen.cursor.x : null;
  return {
    lines,
    spans,
    cursorRow,
    cursorCol,
    seededScrollback: screen.scrollback.length > 0,
  };
}

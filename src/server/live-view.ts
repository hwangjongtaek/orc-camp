/**
 * SPEC-103 — Pane live view stream: FROZEN WIRE CONTRACT.
 *
 * This module is the single source of truth (mirror base) for the live pane-view
 * channel that rides on the existing WS `/api/events` connection (SPEC-102 §2.2
 * `WsEnvelope`). The frontend session mirrors these types verbatim; they MUST stay
 * 1:1 with SPEC-103 §2.2–§2.5. If the schema must change, update SPEC-103 first,
 * then this file (docs/specs SSOT rule).
 *
 * Channel invariants (SPEC-103 §2.1, unchanged here — enforced by the runtime in
 * `pane-view-runtime.ts`, not by these types):
 *  - read-only: capture/geometry via tmuxExec READONLY_ALLOWLIST only (D-019/D-041).
 *  - redaction-before-egress: every emitted `lines` is a `sanitizeCapture` output
 *    (SPEC-006 §2.5, PF-05 formalized).
 *  - `WsEnvelope.version = null` for ALL live-view frames, and they DO NOT
 *    participate in the connection `seq` sequence — a dropped `pane_view` never
 *    triggers a snapshot resync (SPEC-102 §3.5-2 exemption, SPEC-102-AC-15 /
 *    SPEC-103-AC-13). Ordering within an attach is by `viewSeq` only (§2.4).
 *  - at most 1 concurrent attach per connection (D-041).
 */

// ── frame type tokens (registered in SPEC-102 §2.3 WsFrameType catalog) ──────────

/** client→server live-view control frames (SPEC-103 §2.2). */
export type ViewControlFrameType = 'view.attach' | 'view.detach';
/** server→client live-view frames (SPEC-103 §2.3). */
export type PaneViewFrameType = 'pane_view_seed' | 'pane_view' | 'pane_view_end';

export const VIEW_CONTROL_FRAME_TYPES: readonly ViewControlFrameType[] = ['view.attach', 'view.detach'];
export const PANE_VIEW_FRAME_TYPES: readonly PaneViewFrameType[] = ['pane_view_seed', 'pane_view', 'pane_view_end'];

// ── client→server payloads (SPEC-103 §2.2) ──────────────────────────────────────

export interface ViewAttachPayload {
  orcId: string; // "pane:" + paneId (D-017, SPEC-005)
}
export interface ViewDetachPayload {
  orcId: string; // the currently-attached orcId (mismatch → §3.3-4 no-op)
}

// ── server→client payloads (SPEC-103 §2.3) ──────────────────────────────────────

/**
 * Cursor coordinate frame (SPEC-103 §2.5): origin = top-left of the VISIBLE screen.
 * x ∈ [0, cols-1], y ∈ [0, rows-1] (tmux #{cursor_x}/#{cursor_y}, visible-relative).
 * Because seed `lines[]` includes scrollback, the cursor row inside the seed buffer
 * is `(lines.length - rows) + y`.
 */
export interface CursorPos {
  x: number;
  y: number;
}

/** Stream end reasons (SPEC-103 §2.3) — the LAST frame of an attach. */
export type PaneViewEndReason =
  | 'detached'
  | 'pane_gone'
  | 'exposure_off'
  | 'tab_hidden'
  | 'superseded'
  | 'error';

/** Sent exactly once right after a successful attach; always `viewSeq = 0`. */
export interface PaneViewSeedPayload {
  orcId: string;
  cols: number; // pane native width  (#{pane_width})
  rows: number; // pane native height (#{pane_height})
  cursor: CursorPos | null; // null when the query failed
  lines: string[]; // redacted scrollback seed, oldest→newest
  capturedAt: string; // ISO 8601 server time
  redacted: boolean; // >=1 pattern masked (SanitizedCapture.redacted)
  byteClamped: boolean; // byte cap (B) tail-clamp occurred
  viewSeq: 0; // first frame of the attach
}

/** Sent per polling tick; `viewSeq` strictly +1 from the seed onward (§2.4). */
export interface PaneViewPayload {
  orcId: string;
  cols: number;
  rows: number;
  cursor: CursorPos | null;
  lines: string[]; // redacted current window or changed tail, oldest→newest
  capturedAt: string;
  redacted: boolean;
  byteClamped: boolean; // this tick may also byte-clamp (2026-07-02 review)
  viewSeq: number; // monotonic +1 within this attach
}

/** Terminal frame for the stream (normal / rejected / error alike). */
export interface PaneViewEndPayload {
  orcId: string;
  reason: PaneViewEndReason;
}

// ── payload-by-type maps (for typed send/dispatch in Phase 2) ────────────────────

export interface PaneViewServerPayloads {
  pane_view_seed: PaneViewSeedPayload;
  pane_view: PaneViewPayload;
  pane_view_end: PaneViewEndPayload;
}
export interface ViewControlPayloads {
  'view.attach': ViewAttachPayload;
  'view.detach': ViewDetachPayload;
}

// ── polling policy / load caps (SPEC-103 §3.1, D-041) ────────────────────────────
// PoC-tunable hypotheses except where marked 확정 — SPEC-007 harness calibrates.

/** 250–500ms hypothesis (sub-second refresh target). §3.1 Q1. */
export const PANE_VIEW_INTERVAL_MS = 250;
/** MVP 확정 (D-041): concurrent attach per connection. */
export const MAX_ATTACH_PER_CONNECTION = 1;
/** Consecutive non-`pane_gone` capture failures → pane_view_end reason=error (§3.7). */
export const MAX_VIEW_CAPTURE_FAILURES = 3;

// ── inbound parsing (pure, testable; used by the runtime in Phase 2) ─────────────

/** True if `t` is a client→server live-view control frame type. */
export function isViewControlFrameType(t: unknown): t is ViewControlFrameType {
  return t === 'view.attach' || t === 'view.detach';
}

/**
 * Parse a decoded inbound WS message into a live-view control frame, or null if it
 * is not one / is malformed. Pure: no side effects. The envelope shape is SPEC-102
 * §2.2 `{ type, payload, ... }`; we only read `type` + `payload.orcId`.
 */
export function parseViewControlFrame(
  msg: unknown,
): { type: ViewControlFrameType; orcId: string } | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const type = (msg as { type?: unknown }).type;
  if (!isViewControlFrameType(type)) return null;
  const payload = (msg as { payload?: unknown }).payload;
  if (typeof payload !== 'object' || payload === null) return null;
  const orcId = (payload as { orcId?: unknown }).orcId;
  if (typeof orcId !== 'string' || orcId.length === 0) return null;
  return { type, orcId };
}

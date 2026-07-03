/**
 * SPEC-102 §2.2/§2.3 — WebSocket frame + diff-event shapes consumed by the client.
 * Mirrors `src/server/ws.ts` (frame envelope) and `src/server/diff.ts` (DiffEvent).
 */
import type { Camp, Orc, OrcStatus, StatusSignal, StatusSummary, SummarySource } from './domain';

export type WsFrameType =
  | 'welcome'
  | 'batch'
  | 'server_stale_changed'
  | 'server_heartbeat'
  // SPEC-103 §2.3 — live pane view channel (server→client). version is always null.
  | 'pane_view_seed'
  | 'pane_view'
  | 'pane_view_end';

/** SPEC-103 §2.2 — client→server live-view control frame types (version is null). */
export type ClientWsFrameType = 'view.attach' | 'view.detach';

/** Common envelope: every frame is `{type, seq, version, emittedAt, payload}`. */
export interface WsFrame {
  type: WsFrameType;
  seq: number;
  version: number | null;
  emittedAt: string;
  payload: unknown;
}

export interface WelcomePayload {
  protocolVersion: number;
  version: number;
  stale: boolean;
  lastGoodAt: string | null;
  heartbeatIntervalMs: number;
  runtimeEpoch: string;
  serverStartedAt: string;
}

export interface BatchPayload {
  version: number;
  changes: DiffEvent[];
}

export interface StaleChangedPayload {
  stale: boolean;
  lastGoodAt: string | null;
  version: number;
}

export interface HeartbeatPayload {
  version: number;
  stale: boolean;
}

// --- SPEC-102 §2.3.1 diff events (id-keyed, convergent) ----------------------

export type DiffEventType =
  | 'camp_added'
  | 'camp_removed'
  | 'camp_updated'
  | 'orc_added'
  | 'orc_updated'
  | 'orc_status_changed'
  | 'orc_removed';

export interface CampAddedPayload {
  data: Camp;
}
export interface CampRemovedPayload {
  campId: string;
}
export interface CampUpdatedPayload {
  campId: string;
  tmuxSessionName?: string;
  windowCount?: number;
  paneCount?: number;
  statusSummary?: StatusSummary;
  lastActivityAt?: string | null;
}
export interface OrcAddedPayload {
  campId: string;
  data: Orc;
}
export interface OrcRemovedPayload {
  campId: string;
  orcId: string;
  reason: string;
}
export interface OrcStatusChangedPayload {
  campId: string;
  orcId: string;
  status: OrcStatus;
  statusConfidence: number;
  statusSignals: StatusSignal[];
  currentWorkSummary: string | null;
  summarySource: SummarySource;
  summaryIsEstimated: boolean;
  lastActivityAt: string;
}
export interface OrcUpdatedPayload {
  campId: string;
  orcId: string;
  cwd: string;
  command: string;
  tmuxTarget: string;
}

export type DiffEvent =
  | { type: 'camp_added'; payload: CampAddedPayload }
  | { type: 'camp_removed'; payload: CampRemovedPayload }
  | { type: 'camp_updated'; payload: CampUpdatedPayload }
  | { type: 'orc_added'; payload: OrcAddedPayload }
  | { type: 'orc_removed'; payload: OrcRemovedPayload }
  | { type: 'orc_status_changed'; payload: OrcStatusChangedPayload }
  | { type: 'orc_updated'; payload: OrcUpdatedPayload };

// --- SPEC-103 live pane view channel (mirrors src/server per SPEC-103 doc) ----
//
// These are consumed-only mirrors of SPEC-103 §2.2/§2.3. The frame SSOT is the SPEC-103
// document; if the backend changes the schema it MUST update SPEC-103 first, then this mirror
// is realigned (session coordination rule: schema drift is prevented at the spec, not the code).

/** SPEC-103 §2.2 — client→server attach: begin a live view for one pane. */
export interface ViewAttachPayload {
  orcId: string; // "pane:" + paneId (D-017)
}
/** SPEC-103 §2.2 — client→server detach: stop the current live view. */
export interface ViewDetachPayload {
  orcId: string; // the currently-attached orcId (mismatch → server no-op)
}

/** SPEC-103 §2.3 — cursor is visible-screen relative (origin = top-left of visible screen). */
export interface CursorPos {
  x: number; // [0, cols-1]
  y: number; // [0, rows-1]
}

// --- SPEC-103 §2.3.1 styled overlay (Phase 1.5, D-042 / R-PRIV-008) -----------
// Mirrors src/server/live-view.ts. The wire carries NO raw escape bytes: redacted
// plain `lines` plus a structured SGR overlay. The client's ONLY styled behavior is
// wrapping unmodified `lines[i]` slices in `ESC[<sgr>m … ESC[0m` (invariant ② — the
// text itself is never masked/reconstructed here).

/** Max length of a `StyleSpan.sgr` parameter string (SPEC-006 §2.8). */
export const SGR_MAX = 64;
/** `sgr` MUST match — SGR numeric params only, no ESC/letters (SPEC-103 §2.3.1 rule 3). */
export const SGR_RE = /^[0-9;:]{1,64}$/;
/** Per-line run cap (SPEC-103 §2.3.1 rule 7); a violating frame renders plain. */
export const MAX_SPANS_PER_LINE = 256;

/**
 * One styled run over an already-redacted `lines[i]` string (SPEC-103 §2.3.1):
 * half-open [start, end) UTF-16 code-unit offsets; runs sorted by `start` and
 * non-overlapping; never crossing a `[REDACTED:<class>]` token.
 */
export interface StyleSpan {
  start: number;
  end: number;
  sgr: string;
}

/** SPEC-103 §2.3 — attach-time scrollback seed (exactly once, viewSeq=0). */
export interface PaneViewSeedPayload {
  orcId: string;
  cols: number;
  rows: number;
  cursor: CursorPos | null;
  lines: string[]; // redacted scrollback seed, oldest→newest (Phase 1 shape — never changes)
  spans?: StyleSpan[][]; // §2.3.1 styled overlay; present ⇒ spans.length === lines.length. absent = plain.
  capturedAt: string; // ISO 8601
  redacted: boolean;
  byteClamped: boolean;
  viewSeq: number; // first frame of this attach = 0
}

/** SPEC-103 §2.3 — polling tick: current visible window (or changed tail), redacted. */
export interface PaneViewPayload {
  orcId: string;
  cols: number;
  rows: number;
  cursor: CursorPos | null;
  lines: string[]; // redacted current window / changed tail, oldest→newest
  spans?: StyleSpan[][]; // §2.3.1 styled overlay; present ⇒ spans.length === lines.length. absent = plain.
  capturedAt: string;
  redacted: boolean;
  byteClamped: boolean;
  viewSeq: number; // strict +1 after the seed (within this attach)
}

/** SPEC-103 §2.3 — the last frame of a stream (normal / rejected / error). */
export type PaneViewEndReason =
  | 'detached'
  | 'pane_gone'
  | 'exposure_off'
  | 'tab_hidden'
  | 'superseded'
  | 'error';

export interface PaneViewEndPayload {
  orcId: string;
  reason: PaneViewEndReason;
}

/** Discriminated union of the live-view frames (as the terminal viewport consumes them). */
export type PaneViewFrame =
  | { kind: 'seed'; payload: PaneViewSeedPayload }
  | { kind: 'view'; payload: PaneViewPayload }
  | { kind: 'end'; payload: PaneViewEndPayload };

/** WS close codes used by the server (SPEC-102 §2.1). */
export const WS_CLOSE_TOKEN_INVALID = 4401;
export const WS_CLOSE_ORIGIN_DENIED = 4403;
export const WS_CLOSE_RESYNC_REQUIRED = 4429;

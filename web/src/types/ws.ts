/**
 * SPEC-102 §2.2/§2.3 — WebSocket frame + diff-event shapes consumed by the client.
 * Mirrors `src/server/ws.ts` (frame envelope) and `src/server/diff.ts` (DiffEvent).
 */
import type { Camp, Orc, OrcStatus, StatusSignal, StatusSummary, SummarySource } from './domain';

export type WsFrameType =
  | 'welcome'
  | 'batch'
  | 'server_stale_changed'
  | 'server_heartbeat';

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

/** WS close codes used by the server (SPEC-102 §2.1). */
export const WS_CLOSE_TOKEN_INVALID = 4401;
export const WS_CLOSE_ORIGIN_DENIED = 4403;
export const WS_CLOSE_RESYNC_REQUIRED = 4429;

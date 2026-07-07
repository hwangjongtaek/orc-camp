/**
 * SPEC-101 §2.4 — REST envelopes consumed by the dashboard.
 * Mirrors `src/server/types.ts` (SnapshotResponse/CampResponse/HealthResponse/...).
 */
import type { AgentType, Camp, ScanResult } from './domain';

export interface ActivityEvent {
  id: string;
  at: string;
  type: string;
  message: string;
}

export interface SnapshotResponse {
  snapshotVersion: number;
  runtimeEpoch: string;
  emittedAt: string;
  data: ScanResult;
  recentActivity: ActivityEvent[];
}

export interface CampResponse {
  snapshotVersion: number;
  runtimeEpoch: string;
  emittedAt: string;
  data: Camp;
}

export interface HealthResponse {
  status: 'ok';
  schemaVersion: 1;
  snapshotVersion: number;
  runtimeEpoch: string;
  scannerRunning: boolean;
  lastScanAt: string | null;
  lastScanOk: boolean;
  stale: boolean;
  tmux: { installed: boolean; serverRunning: boolean };
  uptimeMs: number;
}

export interface OrcPreviewResponse {
  snapshotVersion: number;
  runtimeEpoch: string;
  emittedAt: string;
  orcId: string;
  preview: {
    lines: number;
    truncated: boolean;
    redacted: boolean;
    exposureEnabled: boolean;
    text?: string[];
  } | null;
}

export interface SettingsResponse {
  configVersion: 1;
  scanInterval: number;
  preview: { exposureEnabled: boolean; lineCount: number };
  redactionEnabled: boolean;
  browserAutoOpen: boolean;
  liveViewBridge: boolean; // SPEC-104 §2.7 control-mode bridge opt-in (default false, D-052)
  bounds: {
    scanInterval: { min: number; max: number };
    previewLineCount: { min: number; max: number };
  };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    fieldErrors?: Array<{
      field: string;
      code: string;
      message: string;
      allowed?: string;
    }>;
  };
}

// --- SPEC-400 control actions ------------------------------------------------

export type ControlAction = 'input' | 'key' | 'interrupt';

/** SPEC-400 §2.2 — "what you see = what's revalidated" (cwd is context-only, not here). */
export interface ExpectedTarget {
  paneId: string;
  tmuxTarget: string;
  command: string;
  agentType: AgentType;
}

/** SPEC-401 §2.4 — passthrough-origin marker (armSessionId is the ONLY field; no free command). */
export interface PassthroughMarker {
  armSessionId: string;
}

export interface InputRequest {
  text: string;
  submit?: boolean;
  expected: ExpectedTarget;
  requestId?: string;
  /** SPEC-401 §2.4 — armed keystroke mirroring; requires submit:false. */
  passthrough?: PassthroughMarker;
}
export interface KeyRequest {
  key: string;
  expected: ExpectedTarget;
  requestId?: string;
  /** SPEC-401 §2.4 — armed named-key egress (INTERACTIVE_KEY_ALLOWLIST). */
  passthrough?: PassthroughMarker;
}

// --- SPEC-401 §2.3 arm/disarm (egress-free; controlExec is NOT called) -------
export interface PassthroughArmRequest {
  expected: ExpectedTarget;
}
export interface PassthroughArmResponse {
  ok: true;
  armSessionId: string;
  armedAt: string;
  idleTimeoutMs: number; // = PASSTHROUGH_IDLE_MS; the UI countdown MUST use this (not its own)
}
export interface PassthroughDisarmRequest {
  armSessionId: string;
}
export interface PassthroughDisarmResponse {
  ok: true;
  auditEventId: string | null;
}
export interface InterruptRequest {
  confirmed: true;
  expected: ExpectedTarget;
  requestId?: string;
}

/** SPEC-400 §2.2 — success body (HTTP 200). */
export interface ControlResultBody {
  ok: true;
  action: ControlAction;
  orcId: string;
  paneId: string;
  tmuxTarget: string;
  outcome: 'success' | 'partial';
  executedAt: string;
  requestId: string | null;
  auditEventId: string;
}

// --- SPEC-402 command broadcast (mirror of §2.1/§2.2 — contract SSOT) ---------

/** SPEC-402 §2.1 — one broadcast target: the orc + the `expected` the server re-validates. */
export interface BroadcastTarget {
  orcId: string;
  expected: ExpectedTarget;
}
/** SPEC-402 §2.1 — the shared input fanned out to every target (inherits InputRequest limits). */
export interface BroadcastInput {
  text: string;
  submit?: boolean; // default true (literal + Enter per orc)
}
export interface BroadcastRequest {
  input: BroadcastInput;
  targets: BroadcastTarget[]; // 1..BROADCAST_MAX_TARGETS, all within :campId
  confirmed?: boolean; // required true when N≥2 (§2.3); ignored for N==1
  requestId?: string;
}
/** SPEC-402 §2.1 — per-orc aggregated result (targets order preserved). */
export interface BroadcastPerOrcResult {
  orcId: string;
  paneId: string;
  ok: boolean;
  outcome: 'success' | 'partial' | null; // null on failure
  errorCode: string | null; // SPEC-400 §2.9 code on failure
  auditEventId: string | null;
}
/** SPEC-402 §2.1 — 200 body. `ok:true` = request accepted+processed; per-orc failures live in results. */
export interface BroadcastResult {
  ok: true;
  campId: string;
  targetCount: number;
  successCount: number;
  failureCount: number;
  /** Present (>0) only when the server de-duped repeated target ids (§2.8 P1-I). */
  duplicatesRemoved?: number;
  results: BroadcastPerOrcResult[];
  batchAuditEventId: string;
  requestId: string | null;
}

/** SPEC-200 §2.4 — client-side error mapping (user-safe message only). */
export interface ClientApiError {
  code: string;
  message: string; // already redacted server-side; displayed verbatim
  requestId: string; // diagnostic only, never shown
  scope: 'global' | 'camp' | 'orc';
  status: number | null; // HTTP status, when available
}

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

export interface InputRequest {
  text: string;
  submit?: boolean;
  expected: ExpectedTarget;
  requestId?: string;
}
export interface KeyRequest {
  key: string;
  expected: ExpectedTarget;
  requestId?: string;
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

/** SPEC-200 §2.4 — client-side error mapping (user-safe message only). */
export interface ClientApiError {
  code: string;
  message: string; // already redacted server-side; displayed verbatim
  requestId: string; // diagnostic only, never shown
  scope: 'global' | 'camp' | 'orc';
  status: number | null; // HTTP status, when available
}

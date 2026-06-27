/**
 * SPEC-101 §2.4 — server-runtime envelopes for the REST API.
 *
 * The `data` payloads reuse SPEC-005 domain types verbatim (ScanResult/Camp); this
 * file only adds the thin server envelope (snapshotVersion/runtimeEpoch/emittedAt).
 */
import type { Camp, ScanResult } from '../types';

/** Bootstrap activity tail item (SPEC-600 owns the full taxonomy; this is the subset served). */
export interface ActivityEvent {
  id: string;
  at: string; // ISO 8601
  type: string; // e.g. 'scan.ok' | 'scan.fail' | 'orc.status' | 'control.result'
  message: string; // redacted, user-safe
}

export interface SnapshotResponse {
  snapshotVersion: number; // >=1 once published
  runtimeEpoch: string; // server-lifetime id (SPEC-101 §3.5)
  emittedAt: string; // ISO 8601 — when this response was built
  data: ScanResult; // SPEC-005 ScanResult, preview text-free (metadata only)
  recentActivity: ActivityEvent[]; // bootstrap tail
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
  snapshotVersion: number; // 0 = no published snapshot yet
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
    text?: string[]; // only when exposureEnabled; redacted tail; never raw
  } | null;
}

export interface ApiError {
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

/** Server runtime settings (SPEC-500 owns persistence; this is the in-memory view). */
export interface ServerSettings {
  scanIntervalS: number; // [1,5], default 3
  preview: {
    exposureEnabled: boolean; // default false (privacy)
    lineCount: number; // <= PREVIEW_LINES
  };
}

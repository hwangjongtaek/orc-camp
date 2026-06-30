/**
 * SPEC-005 domain types mirrored for the dashboard SPA.
 *
 * SSOT is the server's `src/types.ts` (ScanResult/Camp/Orc/...). These are read-only
 * mirrors; the frontend never mutates server data outside the reconcile store
 * (SPEC-200 invariant ②). Keep field names identical to the wire contract.
 */

export type SchemaVersion = 1;

/** SPEC-003 §2.2 */
export type AgentType = 'claude-code' | 'codex' | 'unknown';

/** SPEC-004 §2.1 — 7-state status enum (the `roaming` visual state is NOT a status). */
export type OrcStatus =
  | 'active'
  | 'waiting'
  | 'idle'
  | 'stale'
  | 'error'
  | 'unknown'
  | 'terminated';

export type SummarySource =
  | 'pane_title'
  | 'recent_output'
  | 'recent_prompt'
  | 'user_label'
  | 'unknown';

export interface TmuxAvailability {
  installed: boolean;
  serverRunning: boolean;
  version: string | null;
}

export interface StatusSummary {
  active: number;
  waiting: number;
  idle: number;
  stale: number;
  error: number;
  unknown: number;
  terminated: number;
}

export interface AgentSignal {
  signal: 'command' | 'title' | 'cmdline' | 'output';
  tier: 'A' | 'B' | 'C';
  matchedType: AgentType;
  ruleId: string;
}

export interface StatusSignal {
  signal: 'change' | 'prompt' | 'idle_time' | 'error' | 'lifecycle' | 'stale';
  status: OrcStatus;
  strength: 'A' | 'B' | 'C';
  ruleId: string;
}

export interface Preview {
  lines: number;
  truncated: boolean;
  redacted: boolean;
  text?: string[];
}

/**
 * SPEC-302 §2.2 / SPEC-008 §2 — best-effort cumulative LLM usage for an orc's session. A CLOSED set
 * of 4 aggregate scalars (mirrors the server `OrcUsage` in src/types.ts). `null` (the field or the
 * whole object) = unmeasured / uncollectable — NEVER asserted, and drives prestige tier 0 (SPEC-302
 * §3.2). No raw transcript content / paths ever live here.
 */
export interface OrcUsage {
  cumulativeTokens: number | null;
  cumulativeCostUsd: number | null;
  source: 'transcript' | 'estimated' | 'unknown';
  measuredAt: string | null;
}

export interface Orc {
  id: string; // "pane:" + paneId
  paneId: string;
  tmuxTarget: string; // display-only
  sessionName: string;
  windowIndex: number;
  paneIndex: number;
  cwd: string;
  command: string;

  agentType: AgentType;
  agentTypeConfidence: number;
  agentSignals: AgentSignal[];

  status: OrcStatus;
  statusConfidence: number;
  statusSignals: StatusSignal[];
  currentWorkSummary: string | null;
  summarySource: SummarySource;
  summaryIsEstimated: boolean;

  lastActivityAt: string;
  preview: Preview | null;

  // usage axis (SPEC-302 §2.2 / SPEC-008) — best-effort cumulative tokens/cost. null = unmeasured.
  usage: OrcUsage | null;
}

export interface Camp {
  id: string; // "session:" + sessionId
  sessionId: string;
  tmuxSessionName: string; // display-only
  windowCount: number;
  paneCount: number;
  orcCount: number;
  statusSummary: StatusSummary;
  lastActivityAt: string | null;
  orcs: Orc[];
}

export interface TmuxError {
  phase: 'probe' | 'inventory' | 'capture';
  command: 'list-sessions' | 'list-windows' | 'list-panes' | 'capture-pane' | 'version';
  target: string | null; // capture errors → paneId; bulk → null
  kind: 'spawn_error' | 'timeout' | 'exit_nonzero' | 'parse_error';
  exitCode: number | null;
  message: string;
}

export interface Diagnostics {
  tmuxErrors: TmuxError[];
  scanDurationMs: number;
}

export interface ScanResult {
  schemaVersion: SchemaVersion;
  scannedAt: string;
  stale: boolean;
  lastGoodAt: string | null;
  tmux: TmuxAvailability;
  statusSummary: StatusSummary;
  camps: Camp[];
  diagnostics: Diagnostics;
}

export const EMPTY_STATUS_SUMMARY: StatusSummary = {
  active: 0,
  waiting: 0,
  idle: 0,
  stale: 0,
  error: 0,
  unknown: 0,
  terminated: 0,
};

/** Ordered status keys for redundant (icon+label) rendering. */
export const STATUS_KEYS: OrcStatus[] = [
  'active',
  'waiting',
  'idle',
  'stale',
  'error',
  'unknown',
  'terminated',
];

/** SPEC-003/004 confidence bands (boundaries mirror src/types.ts). */
export const AGENT_BAND = { lowMax: 0.5, mediumMax: 0.85 } as const;
export const STATUS_BAND = { lowMax: 0.5, mediumMax: 0.8 } as const;

export type ConfidenceTier = 'low' | 'medium' | 'high';

export function confidenceTier(
  value: number,
  band: { lowMax: number; mediumMax: number },
): ConfidenceTier {
  if (value < band.lowMax) return 'low';
  if (value < band.mediumMax) return 'medium';
  return 'high';
}

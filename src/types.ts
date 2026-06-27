/**
 * Orc Camp — scan slice SSOT types & constants.
 *
 * This file is the single, frozen contract for the `orc-camp scan` slice (Epic 1).
 * Every module imports ONLY from here for shared types; cross-module wiring is done
 * by dependency injection (see the `*Fn` function-type aliases) so each module can be
 * implemented and unit-tested in isolation.
 *
 * Spec ownership (docs/specs/ is SSOT):
 *  - wire output types  → SPEC-005 (data contract)
 *  - PaneSignal/detection → SPEC-003 (agent detection)
 *  - status inference   → SPEC-004 (status inference)
 *  - redaction/exec     → SPEC-006 (privacy/redaction/read-only)
 *  - tmux raw records   → SPEC-002 (tmux discovery)
 *
 * Do NOT change a type here without first updating the owning spec (spec-first rule,
 * docs/specs/README.md).
 */

// ---------------------------------------------------------------------------
// Shared enums (SPEC-005 §2.1)
// ---------------------------------------------------------------------------

export type SchemaVersion = 1;

/** SPEC-003 §2.2 */
export type AgentType = 'claude-code' | 'codex' | 'unknown';

/** SPEC-004 §2.1 — 7-state status enum (the `roaming` visual state is NOT here). */
export type OrcStatus =
  | 'active'
  | 'waiting'
  | 'idle'
  | 'stale'
  | 'error'
  | 'unknown'
  | 'terminated';

/** SPEC-004 §2.1 */
export type SummarySource =
  | 'pane_title'
  | 'recent_output'
  | 'recent_prompt'
  | 'user_label'
  | 'unknown';

// ===========================================================================
// SPEC-005 — wire output types (`orc-camp scan --json`)
// ===========================================================================

export interface ScanResult {
  schemaVersion: SchemaVersion; // always 1
  scannedAt: string; // ISO 8601 — when this scan ran
  stale: boolean; // true = this data is a last-good fallback (R-TMUX-005)
  lastGoodAt: string | null; // when the serialized inventory was actually collected
  tmux: TmuxAvailability;
  statusSummary: StatusSummary; // aggregate over all camps' orcs
  camps: Camp[]; // [] when empty
  diagnostics: Diagnostics;
}

export interface TmuxAvailability {
  installed: boolean; // phase 0 `tmux -V` succeeded
  serverRunning: boolean; // phase 1 `list-sessions` succeeded. false if !installed
  version: string | null; // parsed from `tmux -V`. null if unavailable
}

/** 7 keys, always present (0 included). */
export interface StatusSummary {
  active: number;
  waiting: number;
  idle: number;
  stale: number;
  error: number;
  unknown: number;
  terminated: number;
}

export interface Camp {
  id: string; // "session:" + sessionId, e.g. "session:$0"
  sessionId: string; // #{session_id}, e.g. "$0"
  tmuxSessionName: string; // #{session_name} (display-only, mutable)
  windowCount: number;
  paneCount: number; // all panes incl. non-orc
  orcCount: number; // = orcs.length
  statusSummary: StatusSummary;
  lastActivityAt: string | null; // max of pane lastActivityAt; null if none
  orcs: Orc[]; // detected agent panes only
}

export interface Orc {
  // identity (paneId is authoritative; tmuxTarget is display-only)
  id: string; // "pane:" + paneId; matches ^pane:%[0-9]+$
  paneId: string; // #{pane_id}, e.g. "%12"
  tmuxTarget: string; // "session:window.pane" (display-only)
  sessionName: string;
  windowIndex: number;
  paneIndex: number;
  cwd: string; // redacted (SPEC-006 §2.3)
  command: string; // #{pane_current_command} (raw passthrough)

  // agent type axis (SPEC-003)
  agentType: AgentType;
  agentTypeConfidence: number; // [0,1]
  agentSignals: AgentSignal[]; // redaction-safe provenance; minItems 1

  // status axis (SPEC-004)
  status: OrcStatus;
  statusConfidence: number; // [0,1], always with status
  statusSignals: StatusSignal[]; // redaction-safe provenance; may be empty
  currentWorkSummary: string | null; // redacted-derived; null if none
  summarySource: SummarySource; // 'unknown' if none
  summaryIsEstimated: boolean; // auto-estimated=true; only user_label may be false

  // time / preview
  lastActivityAt: string; // ISO 8601
  preview: Preview | null; // null if capture failed; never raw text
}

/** SPEC-005 §2.1 — serialized form of SPEC-003 SignalMatch (matchedSignals→agentSignals). */
export interface AgentSignal {
  signal: 'command' | 'title' | 'cmdline' | 'output';
  tier: 'A' | 'B' | 'C';
  matchedType: AgentType;
  ruleId: string; // matched rule id (never raw text)
}

/** SPEC-005 §2.1 — serialized form of SPEC-004 StatusSignalMatch. */
export interface StatusSignal {
  signal: 'change' | 'prompt' | 'idle_time' | 'error' | 'lifecycle' | 'stale';
  status: OrcStatus;
  strength: 'A' | 'B' | 'C';
  ruleId: string;
}

export interface Preview {
  lines: number; // redacted tail line count (>=0)
  truncated: boolean; // lines > PREVIEW_LINES or byteClamped
  redacted: boolean; // >=1 redaction match occurred
  text?: string[]; // optional redacted tail (<= PREVIEW_LINES). default absent (metadata-only)
}

export interface Diagnostics {
  tmuxErrors: TmuxError[];
  scanDurationMs: number; // >=0
}

export interface TmuxError {
  phase: 'probe' | 'inventory' | 'capture';
  command:
    | 'list-sessions'
    | 'list-windows'
    | 'list-panes'
    | 'capture-pane'
    | 'version';
  target: string | null; // capture errors → paneId; bulk → null
  kind: 'spawn_error' | 'timeout' | 'exit_nonzero' | 'parse_error';
  exitCode: number | null;
  message: string; // tmux stderr/meta summary; NEVER capture content (R-PRIV-005)
}

// ===========================================================================
// SPEC-006 — redaction / sanitize
// ===========================================================================

export interface RedactionResult {
  text: string; // redacted text (never raw)
  redacted: boolean; // >=1 pattern matched
  matchCount: number; // test-harness/debug-log only; NOT serialized to wire (§3.5 ④)
}

export interface SanitizedCapture {
  lines: string[]; // redacted, oldest→newest
  redacted: boolean;
  byteClamped: boolean;
  matchCount: number; // test-harness/debug-log only; NOT serialized to wire
}

// ===========================================================================
// SPEC-002 — tmux raw collection
// ===========================================================================

/** Result of a single hardened subprocess spawn (SPEC-006 §2.6). */
export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null; // null when killed/timed-out/spawn-failed
  timedOut: boolean;
  spawnError: NodeJS.ErrnoException | null; // e.g. ENOENT (binary missing)
  durationMs: number;
}

/** Semantic tmux availability state (SPEC-002 §2.5). `stale` is decided by the runner. */
export type AvailabilityState =
  | 'not_installed'
  | 'server_not_running'
  | 'running_no_session'
  | 'normal';

/** Parsed `list-sessions` record (FMT_S). */
export interface SessionRawRecord {
  sessionId: string; // #{session_id}, e.g. "$0"
  sessionName: string; // #{session_name}
  windows: number; // #{session_windows}
  attached: boolean; // #{session_attached}
  activityAt: string; // ISO 8601 from #{session_activity}
}

/**
 * Parsed pane record (FMT_P) AFTER redaction has been applied at the collection
 * boundary. Free-text fields (paneTitle, cwd, cmdline) are redacted; `command`
 * passes through raw (structural identifier, SPEC-006 §2.3); `capture` is sanitized
 * (never raw). This is the single redaction chokepoint output for panes.
 */
export interface PaneRawRecord {
  paneId: string; // #{pane_id}, ^%[0-9]+$
  tmuxTarget: string; // sessionName:windowIndex.paneIndex (display-only)
  sessionName: string;
  windowIndex: number;
  paneIndex: number;
  command: string; // #{pane_current_command} (raw passthrough)
  paneTitle: string | null; // #{pane_title} (redacted)
  cwd: string; // #{pane_current_path} (redacted)
  lastActivityAt: string; // ISO 8601 from #{pane_activity}
  panePid: number | null; // #{pane_pid}
  paneDead: boolean; // #{pane_dead}
  paneActive: boolean; // #{pane_active}
  cmdline: string | null; // ps argv (redacted); null if unavailable (D-020)
  processAlive: boolean | null; // from ps; null if unavailable (fallback to !paneDead)
  capture: SanitizedCapture | null; // null if capture-pane failed (target-isolated)
}

/** Output of the inventory collection step (SPEC-002). */
export interface InventoryResult {
  availability: TmuxAvailability;
  state: AvailabilityState;
  sessions: SessionRawRecord[];
  panes: PaneRawRecord[]; // sanitized; empty for empty-states
  errors: TmuxError[]; // collection-phase errors
  /** true iff the inventory phase (list-sessions/list-panes) collected successfully. */
  collectedOk: boolean;
  collectedAt: string; // ISO 8601
}

// ===========================================================================
// SPEC-003 — agent detection
// ===========================================================================

/** Redacted, read-only signal bundle consumed by detectors (SPEC-003 §2.1). */
export interface PaneSignal {
  paneId: string; // provenance only
  tmuxTarget: string; // provenance only
  command: string; // #{pane_current_command} raw (basename derived by detector, once)
  paneTitle: string | null; // redacted
  cmdline: string | null; // redacted; null if unavailable
  cwd: string; // not a type signal (passthrough)
  recentOutput: string[]; // sanitized capture tail, oldest→newest; may be empty
}

export interface SignalMatch {
  signal: 'command' | 'title' | 'cmdline' | 'output';
  tier: 'A' | 'B' | 'C'; // A=direct, B=wrapper+signature, C=output corroboration
  matchedType: AgentType; // 'unknown' = generic agent marker
  ruleId: string; // matched rule id (never raw text)
}

export interface OrcCandidate {
  agentType: AgentType; // undecidable candidate → 'unknown' (R-ORC-002)
  agentTypeConfidence: number; // [0,1]
  matchedSignals: SignalMatch[]; // always >=1 (else not a candidate)
}

export interface AgentDetector {
  readonly id: AgentType; // 'claude-code' | 'codex' (MVP)
  detect(pane: PaneSignal): OrcCandidate | null; // null = no claim
}

// ===========================================================================
// SPEC-004 — status inference
// ===========================================================================

export interface PriorOrcState {
  paneId: string;
  captureFingerprint: string[]; // normalized line-hashes (never raw text)
  status: OrcStatus;
  lastActivityAt: string;
  observedAt: string; // when the prior snapshot was collected
}

export interface StatusInput {
  candidate: OrcCandidate; // SPEC-003 result (type axis)
  pane: PaneSignal; // redacted signals (recentOutput, paneTitle, ...)
  lifecycle: {
    paneId: string; // authoritative identity "%12"
    paneDead: boolean; // #{pane_dead}
    panePid: number | null; // #{pane_pid}
    processAlive: boolean | null; // from ps (S-PID); null if unknown
    lastActivityAt: string; // ISO 8601
  };
  scannedAt: string; // ISO 8601
  snapshotStale: boolean; // this data is a last-good fallback
  captureUnavailable: boolean; // this pane's capture-pane failed (isolated)
  prior?: PriorOrcState | null; // prior scan state; null on single-shot first run
  userLabel?: string | null; // user alias/note (usually null in scan MVP)
}

export interface StatusSignalMatch {
  signal: 'change' | 'prompt' | 'idle_time' | 'error' | 'lifecycle' | 'stale';
  status: OrcStatus;
  ruleId: string; // matched rule id (never raw text)
  strength: 'A' | 'B' | 'C';
}

export interface StatusInference {
  status: OrcStatus;
  statusConfidence: number; // [0,1] — always returned
  statusSignals: StatusSignalMatch[];
  currentWorkSummary: string | null; // redacted-derived; null if none
  summarySource: SummarySource;
  summaryIsEstimated: boolean; // only user_label may be false
}

// ===========================================================================
// Dependency-injection function-type aliases (cross-module wiring)
// ===========================================================================

/** Hardened low-level spawn primitive (SPEC-006 §2.6/§2.7): shell:false, fixed argv, timeout. */
export type ProcessSpawn = (
  file: string,
  args: string[],
  opts: { timeoutMs: number },
) => Promise<SpawnResult>;

/** The single tmux entry point (SPEC-006 §2.6). `subcommand=null,args=['-V']` for version probe. */
export type TmuxExecFn = (
  subcommand: string | null,
  args: string[],
) => Promise<SpawnResult>;

export type RedactFn = (text: string) => RedactionResult;
export type SanitizeFn = (raw: string) => SanitizedCapture;

/** Process introspection (SPEC-002 §2.8): pane_pid → ps for cmdline + alive. */
export type IntrospectFn = (
  pid: number | null,
) => Promise<{ cmdline: string | null; alive: boolean | null }>;

export type DetectOrcFn = (
  pane: PaneSignal,
  detectors: AgentDetector[],
) => OrcCandidate | null;

export type InferStatusFn = (input: StatusInput) => StatusInference;

/** Injected dependencies for the inventory collector (SPEC-002). */
export interface CollectDeps {
  tmuxExec: TmuxExecFn;
  introspect: IntrospectFn;
  sanitize: SanitizeFn; // capture → SanitizedCapture (raw never escapes collector)
  redact: RedactFn; // single-field redaction for paneTitle/cwd/cmdline
  now: () => Date; // injectable clock (determinism)
  timeoutMs?: number; // per-command timeout (default TMUX_TIMEOUT_MS)
  captureLines?: number; // capture-pane -S -N (default CAPTURE_LINES)
}

// ===========================================================================
// Constants (SPEC-002/004/006 — all PoC-tunable hypotheses unless noted)
// ===========================================================================

export const SCHEMA_VERSION: SchemaVersion = 1; // SPEC-005 (fixed)

/** Unit separator (0x1F) used as `-F` field delimiter (SPEC-002 §2.2). */
export const US = '\x1f';

/** tmux `-F` format strings (SPEC-002 §2.2). */
export const FMT_S = [
  '#{session_id}',
  '#{session_name}',
  '#{session_windows}',
  '#{session_attached}',
  '#{session_activity}',
].join(US);

export const FMT_P = [
  '#{session_name}',
  '#{window_index}',
  '#{pane_index}',
  '#{pane_id}',
  '#{pane_current_command}',
  '#{pane_title}',
  '#{pane_current_path}',
  '#{pane_activity}',
  '#{pane_pid}',
  '#{pane_dead}',
  '#{pane_active}',
].join(US);

export const FMT_W = [
  '#{session_id}',
  '#{session_name}',
  '#{window_id}',
  '#{window_index}',
  '#{window_name}',
  '#{window_panes}',
  '#{window_active}',
  '#{window_activity}',
].join(US);

/** Privacy/capture limits (SPEC-006 §2.1 / §3.4) — hypotheses. */
export const CAPTURE_LINES = 200; // N: capture line window
export const BYTE_CAP = 64 * 1024; // B: 64 KiB tail-preserving clamp
export const PREVIEW_LINES = 12; // P: preview redacted tail
export const RP10_MIN_LEN = 32; // generic high-entropy token min length

/** tmux per-command timeout (SPEC-002 §2.6) — hypothesis. */
export const TMUX_TIMEOUT_MS = 2000;

/** Status thresholds (SPEC-004 §3.9) — hypotheses. */
export const T_ACTIVE_MS = 5_000; // active recent-activity ceiling
export const T_IDLE_MS = 30_000; // idle inactivity floor
export const T_TERM_MS = 10_000; // terminated retention grace
export const FINGERPRINT_K = 40; // region-compare trailing lines
export const SUMMARY_MAX_LEN = 80; // currentWorkSummary truncation

/** `--watch` interval bounds (SPEC-001 §3.1) — derived from non-functional req. */
export const WATCH_INTERVAL_DEFAULT_S = 3;
export const WATCH_INTERVAL_MIN_S = 1;
export const WATCH_INTERVAL_MAX_S = 5;

/**
 * Confidence band boundaries. Numeric edges are PoC-tunable, but the bands MUST
 * always cover [0,1] contiguously with no gaps (SPEC-003 §3.2, SPEC-004 §2.3).
 */
export const AGENT_BAND = { lowMax: 0.5, mediumMax: 0.85 } as const; // LOW [0,0.5) MED [0.5,0.85) HIGH [0.85,1]
export const STATUS_BAND = { lowMax: 0.5, mediumMax: 0.8 } as const; // LOW [0,0.5) MED [0.5,0.8) HIGH [0.8,1]

/** Read-only tmux allowlist (SPEC-006 §2.6). Authoritative (fail-closed). */
export const READONLY_ALLOWLIST: ReadonlySet<string> = new Set([
  'list-sessions',
  'list-windows',
  'list-panes',
  'capture-pane',
]);

/** Defense-in-depth denylist (SPEC-006 §2.6). Allowlist is authoritative. */
export const STATE_CHANGING_DENYLIST: ReadonlySet<string> = new Set([
  'send-keys',
  'paste-buffer',
  'set-buffer',
  'load-buffer',
  'run-shell',
  'if-shell',
  'new-session',
  'new-window',
  'split-window',
  'kill-session',
  'kill-server',
  'kill-pane',
  'kill-window',
  'respawn-pane',
  'respawn-window',
  'rename-session',
  'set-option',
]);

/** Empty StatusSummary helper shape (assembly convenience). */
export const EMPTY_STATUS_SUMMARY: StatusSummary = {
  active: 0,
  waiting: 0,
  idle: 0,
  stale: 0,
  error: 0,
  unknown: 0,
  terminated: 0,
};

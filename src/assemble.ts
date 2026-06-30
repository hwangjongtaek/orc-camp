/**
 * SPEC-005 — scan output assembly (aggregator).
 *
 * Pure, deterministic transform: take an InventoryResult (already redacted at the
 * collection boundary), run agent detection + status inference per candidate pane,
 * and assemble the wire `ScanResult` (camps/orcs/statusSummary/diagnostics) with
 * stable ordering. Non-candidate panes are excluded from `orcs[]` but still counted
 * in `paneCount` (SPEC-005 §3.2-2).
 *
 * Detection/status RULES live in their own modules; this file only invokes them and
 * serializes the result (internal `matchedSignals`→wire `agentSignals` rename, §3.2-7).
 */
import {
  PREVIEW_LINES,
  SCHEMA_VERSION,
  type AgentDetector,
  type AgentSignal,
  type AgentType,
  type Camp,
  type DetectOrcFn,
  type InferStatusFn,
  type InventoryResult,
  type Orc,
  type PaneRawRecord,
  type PaneSignal,
  type Preview,
  type PriorOrcState,
  type ScanResult,
  type StatusSignal,
  type StatusSummary,
  type UsageCollectFn,
  type UsageLocateHint,
} from './types';
import { computeFingerprint } from './status/fingerprint';

/** Default usage collector: emit `usage=null` (forward-safe; SPEC-302 §3.2 → tier 0). */
const NULL_USAGE_COLLECT: UsageCollectFn = async () => null;

export interface AssembleInput {
  inventory: InventoryResult;
  scannedAt: string; // ISO 8601
  stale: boolean; // this data is a last-good fallback
  lastGoodAt: string | null;
  scanDurationMs: number;
  detectOrc: DetectOrcFn;
  inferStatus: InferStatusFn;
  detectors: AgentDetector[];
  priors: Map<string, PriorOrcState>; // by paneId (prior cycle); empty on first/single-shot
  /** Retained terminated orcs (S-GONE, SPEC-004 §3.7) to fold into matching camps by sessionId. */
  retainedTerminated?: Orc[];
  /**
   * SPEC-008 — best-effort, never-throwing per-orc usage collector. Injected (testable,
   * swappable). Defaults to a null-emitter so the pipeline is forward-safe when usage is
   * unconfigured (`usage=null` → SPEC-302 tier 0).
   */
  collectUsage?: UsageCollectFn;
}

export interface AssembleOutput {
  result: ScanResult;
  /** Fingerprints/state to carry into the next --watch cycle. */
  nextPriors: Map<string, PriorOrcState>;
  /** Live orcs this cycle keyed by paneId (source for next cycle's S-GONE retention). */
  liveOrcsByPaneId: Map<string, Orc>;
}

function emptyStatusSummary(): StatusSummary {
  return {
    active: 0,
    waiting: 0,
    idle: 0,
    stale: 0,
    error: 0,
    unknown: 0,
    terminated: 0,
  };
}

function tallyStatus(summary: StatusSummary, orc: Orc): void {
  summary[orc.status] += 1;
}

function addSummary(into: StatusSummary, from: StatusSummary): void {
  into.active += from.active;
  into.waiting += from.waiting;
  into.idle += from.idle;
  into.stale += from.stale;
  into.error += from.error;
  into.unknown += from.unknown;
  into.terminated += from.terminated;
}

function paneToSignal(rec: PaneRawRecord): PaneSignal {
  return {
    paneId: rec.paneId,
    tmuxTarget: rec.tmuxTarget,
    command: rec.command,
    paneTitle: rec.paneTitle,
    cmdline: rec.cmdline,
    processTree: rec.processTree ?? null,
    cwd: rec.cwd,
    recentOutput: rec.capture ? rec.capture.lines : [],
  };
}

/**
 * SPEC-004 §2.1 liveness-gate input. Derived from subtree availability + detector's
 * process-corroboration (no re-detection):
 *   processTree === undefined → undefined (legacy/no-info → gate inert)
 *   processTree === null      → null      (introspection unavailable → degrade)
 *   else                      → candidate.processCorroborated (live agent? true : false)
 */
function deriveAgentProcessAlive(
  rec: PaneRawRecord,
  processCorroborated: boolean,
): boolean | null | undefined {
  if (rec.processTree === undefined) return undefined;
  if (rec.processTree === null) return null;
  return processCorroborated;
}

function buildPreview(rec: PaneRawRecord): Preview | null {
  if (!rec.capture) return null; // capture failed (target-isolated) → null (SPEC-005 §2.7)
  const total = rec.capture.lines.length;
  return {
    lines: Math.min(total, PREVIEW_LINES),
    truncated: total > PREVIEW_LINES || rec.capture.byteClamped,
    redacted: rec.capture.redacted,
  };
}

/**
 * Build the redaction-bound usage hint for a candidate pane (SPEC-008 §4.4). Carries ONLY
 * already-redacted/structural fields: the redacted cwd, the redacted subtree argv strings, the
 * agentType (provider selector), paneId (authority), and lastActivityAt. No raw tmux data.
 */
function buildUsageHint(rec: PaneRawRecord, agentType: Orc['agentType']): UsageLocateHint {
  const processTreeCommands = (rec.processTree ?? []).map((n) => n.command);
  if (rec.cmdline && !processTreeCommands.includes(rec.cmdline)) {
    processTreeCommands.push(rec.cmdline); // depth-0 argv (redacted) as a fallback id source
  }
  // SPEC-008 §4.2a — the pane's OWN subtree pids for open-handle (fd) correlation. Numbers only
  // (no content); empty when processTree is null → fd correlation is skipped. Only positive
  // integers (a stale/garbled pid never reaches lsof/`/proc`).
  const agentPids = (rec.processTree ?? [])
    .map((n) => n.pid)
    .filter((p) => Number.isInteger(p) && p > 0);
  return {
    paneId: rec.paneId,
    agentType,
    cwd: rec.cwd, // redacted (SPEC-006 §2.3)
    processTreeCommands,
    agentPids,
    lastActivityAt: rec.lastActivityAt,
  };
}

/**
 * SPEC-302 §3.7 / D-040 — agent-runtime argv signatures used to locate the orc's agent
 * runtime process within its subtree (mirrors the SPEC-003 adapters' signature, kept minimal
 * because uptime is a SOFT longevity proxy on an ALREADY-confirmed agent pane). `unknown`
 * agents have no reliable runtime token → no uptime (null → tier 0, SPEC-302 §2.6).
 */
const AGENT_RUNTIME_SIGNATURE: Record<AgentType, RegExp | null> = {
  'claude-code': /@anthropic-ai\/claude-code|claude-code|\bclaude\b/i,
  codex: /@openai\/codex|codex-cli|\bcodex\b/i,
  unknown: null,
};

/**
 * SPEC-302 §3.7 — the agent runtime process's elapsed seconds (uptime), best-effort.
 *
 * The detection candidate does not carry the matched node's pid, so we select the
 * **longest-lived** (max `etimeSec`) live subtree node whose redacted argv matches the agent
 * runtime for this orc's agentType — the agent process's start anchor. Returns null when:
 *   - paneDead (terminated pane), OR
 *   - processTree is null/undefined/empty (introspection unavailable, or no live process — ps
 *     lists ONLY live processes, so a terminated agent simply isn't present), OR
 *   - no live node matches the agent runtime / has a usable `etimeSec`.
 * Pure & total: any doubt → null (never throws, never blocks assembly).
 */
function selectAgentUptimeSec(rec: PaneRawRecord, agentType: AgentType): number | null {
  if (rec.paneDead) return null;
  const tree = rec.processTree;
  if (!tree || tree.length === 0) return null;
  const sig = AGENT_RUNTIME_SIGNATURE[agentType];
  if (!sig) return null;
  let best: number | null = null;
  for (const node of tree) {
    const e = node.etimeSec;
    if (typeof e !== 'number' || !Number.isFinite(e) || e < 0) continue;
    if (!sig.test(node.command)) continue;
    if (best === null || e > best) best = e; // longest-lived = largest elapsed seconds
  }
  return best;
}

/** Build an Orc from a candidate pane (detection already ran). */
async function buildOrc(
  rec: PaneRawRecord,
  input: AssembleInput,
): Promise<{ orc: Orc; fingerprint: string[] } | null> {
  const signal = paneToSignal(rec);
  const candidate = input.detectOrc(signal, input.detectors);
  if (!candidate) return null; // non-candidate

  const inference = input.inferStatus({
    candidate,
    pane: signal,
    lifecycle: {
      paneId: rec.paneId,
      paneDead: rec.paneDead,
      panePid: rec.panePid,
      processAlive: rec.processAlive,
      agentProcessAlive: deriveAgentProcessAlive(rec, candidate.processCorroborated ?? false),
      lastActivityAt: rec.lastActivityAt,
    },
    scannedAt: input.scannedAt,
    snapshotStale: input.stale,
    captureUnavailable: rec.capture === null,
    prior: input.priors.get(rec.paneId) ?? null,
    userLabel: null,
  });

  const agentSignals: AgentSignal[] = candidate.matchedSignals.map((s) => ({
    signal: s.signal,
    tier: s.tier,
    matchedType: s.matchedType,
    ruleId: s.ruleId,
  }));
  const statusSignals: StatusSignal[] = inference.statusSignals.map((s) => ({
    signal: s.signal,
    status: s.status,
    strength: s.strength,
    ruleId: s.ruleId,
  }));

  // SPEC-008 best-effort usage. The injected collector never throws; if it somehow rejects we
  // still degrade to null so one orc's collection can't abort assembly (AC-10).
  const collectUsage = input.collectUsage ?? NULL_USAGE_COLLECT;
  let usage = null as Orc['usage'];
  try {
    usage = await collectUsage(buildUsageHint(rec, candidate.agentType));
  } catch {
    usage = null;
  }

  // SPEC-302 §3.7 / D-040 — agent-process uptime (token-fallback tier signal). Per-orc isolated,
  // best-effort. A terminated orc has no live agent process → null (the agent node is absent from
  // the ps snapshot; selectAgentUptimeSec also null-guards paneDead and the inferred terminated state).
  const uptimeSec =
    inference.status === 'terminated' ? null : selectAgentUptimeSec(rec, candidate.agentType);

  const orc: Orc = {
    id: `pane:${rec.paneId}`,
    paneId: rec.paneId,
    tmuxTarget: rec.tmuxTarget,
    sessionName: rec.sessionName,
    windowIndex: rec.windowIndex,
    paneIndex: rec.paneIndex,
    cwd: rec.cwd,
    command: rec.command,
    agentType: candidate.agentType,
    agentTypeConfidence: candidate.agentTypeConfidence,
    agentSignals,
    status: inference.status,
    statusConfidence: inference.statusConfidence,
    statusSignals,
    currentWorkSummary: inference.currentWorkSummary,
    summarySource: inference.summarySource,
    summaryIsEstimated: inference.summaryIsEstimated,
    lastActivityAt: rec.lastActivityAt,
    preview: buildPreview(rec),
    usage,
    uptimeSec,
  };

  const fingerprint = computeFingerprint(rec.capture ? rec.capture.lines : []);
  return { orc, fingerprint };
}

function maxActivity(values: (string | null)[]): string | null {
  let max: string | null = null;
  for (const v of values) {
    if (v === null) continue;
    if (max === null || v > max) max = v;
  }
  return max;
}

export async function assembleScanResult(input: AssembleInput): Promise<AssembleOutput> {
  const { inventory } = input;
  const nextPriors = new Map<string, PriorOrcState>();
  const liveOrcsByPaneId = new Map<string, Orc>();

  // Group panes by session name (panes carry sessionName; sessionId comes from the
  // matching list-sessions record — SPEC-005 §3.2-1).
  const panesBySession = new Map<string, PaneRawRecord[]>();
  for (const pane of inventory.panes) {
    const list = panesBySession.get(pane.sessionName);
    if (list) list.push(pane);
    else panesBySession.set(pane.sessionName, [pane]);
  }

  // Retained terminated orcs (S-GONE) grouped by sessionId to fold into their camp.
  const retainedBySessionId = new Map<string, Orc[]>();
  for (const orc of input.retainedTerminated ?? []) {
    // sessionId for a retained orc is derived from its camp id later; we key on
    // sessionName→sessionId via the session records below. Store by sessionName first.
    const list = retainedBySessionId.get(orc.sessionName);
    if (list) list.push(orc);
    else retainedBySessionId.set(orc.sessionName, [orc]);
  }

  const topSummary = emptyStatusSummary();
  const camps: Camp[] = [];

  for (const session of inventory.sessions) {
    const panes = panesBySession.get(session.sessionName) ?? [];
    const orcs: Orc[] = [];

    // Build orcs concurrently within the session so the bounded usage I/O of independent panes
    // overlaps (latency); Promise.all preserves input order → deterministic orcs array.
    const built = await Promise.all(panes.map((rec) => buildOrc(rec, input)));
    for (let i = 0; i < panes.length; i++) {
      const b = built[i];
      if (!b) continue;
      const rec = panes[i]!;
      orcs.push(b.orc);
      liveOrcsByPaneId.set(rec.paneId, b.orc);
      nextPriors.set(rec.paneId, {
        paneId: rec.paneId,
        captureFingerprint: b.fingerprint,
        status: b.orc.status,
        lastActivityAt: rec.lastActivityAt,
        observedAt: input.scannedAt,
      });
    }

    // Fold retained terminated orcs (whose live pane disappeared this cycle).
    for (const term of retainedBySessionId.get(session.sessionName) ?? []) {
      if (!orcs.some((o) => o.paneId === term.paneId)) orcs.push(term);
    }

    // Stable sort: windowIndex → paneIndex (SPEC-005 §3.4).
    orcs.sort((a, b) =>
      a.windowIndex !== b.windowIndex
        ? a.windowIndex - b.windowIndex
        : a.paneIndex - b.paneIndex,
    );

    const windowSet = new Set(panes.map((p) => p.windowIndex));
    const campSummary = emptyStatusSummary();
    for (const orc of orcs) tallyStatus(campSummary, orc);
    addSummary(topSummary, campSummary);

    camps.push({
      id: `session:${session.sessionId}`,
      sessionId: session.sessionId,
      tmuxSessionName: session.sessionName,
      windowCount: windowSet.size,
      paneCount: panes.length,
      orcCount: orcs.length,
      statusSummary: campSummary,
      lastActivityAt: maxActivity(panes.map((p) => p.lastActivityAt)),
      orcs,
    });
  }

  // Stable sort: camps by tmuxSessionName (SPEC-005 §3.4).
  camps.sort((a, b) => (a.tmuxSessionName < b.tmuxSessionName ? -1 : a.tmuxSessionName > b.tmuxSessionName ? 1 : 0));

  const result: ScanResult = {
    schemaVersion: SCHEMA_VERSION,
    scannedAt: input.scannedAt,
    stale: input.stale,
    lastGoodAt: input.lastGoodAt,
    tmux: inventory.availability,
    statusSummary: topSummary,
    camps,
    diagnostics: {
      tmuxErrors: inventory.errors,
      scanDurationMs: input.scanDurationMs,
    },
  };

  return { result, nextPriors, liveOrcsByPaneId };
}

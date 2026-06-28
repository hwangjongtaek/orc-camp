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
} from './types';
import { computeFingerprint } from './status/fingerprint';

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

/** Build an Orc from a candidate pane (detection already ran). */
function buildOrc(
  rec: PaneRawRecord,
  input: AssembleInput,
): { orc: Orc; fingerprint: string[] } | null {
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

export function assembleScanResult(input: AssembleInput): AssembleOutput {
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

    for (const rec of panes) {
      const built = buildOrc(rec, input);
      if (!built) continue;
      orcs.push(built.orc);
      liveOrcsByPaneId.set(rec.paneId, built.orc);
      nextPriors.set(rec.paneId, {
        paneId: rec.paneId,
        captureFingerprint: built.fingerprint,
        status: built.orc.status,
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

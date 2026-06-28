/**
 * SPEC-007 §2.4 / §3.3 — PoC measurement harness (M1–M5).
 *
 * Pure metric computation over labeled pane samples. The harness applies the SAME
 * redaction-before-consumption boundary as the real pipeline (sanitizeCapture +
 * redact) before invoking detectOrc/inferStatus, so detection/status accuracy is
 * measured on exactly the data the product would see (§3.4).
 *
 * Fixture-based M1/M2/M3/M5 are deterministic → CI-gated (§3.1-1). Live latency
 * (M4) lives outside this file (scripts/measure-latency.mts).
 */
import {
  AGENT_BAND,
  STATUS_BAND,
  type AgentType,
  type OrcCandidate,
  type OrcStatus,
  type PaneSignal,
  type PriorOrcState,
  type ProcessNode,
  type StatusInput,
} from '../../src/types';
import { redact, sanitizeCapture } from '../../src/redaction/redact';
import { detectOrc, defaultDetectors } from '../../src/detection/detect';
import { inferStatus } from '../../src/status/infer';
import { computeFingerprint } from '../../src/status/fingerprint';

export type DetectClass = AgentType | 'non-candidate';

export interface LabeledPaneSample {
  id: string;
  source: 'fixture' | 'captured';
  rawCapture: string;
  paneMeta: {
    currentCommand: string;
    paneTitle: string | null;
    cmdline: string | null;
    cwd: string;
    paneId: string;
    tmuxTarget: string;
    lastActivityAt: string;
    paneDead: boolean;
    panePid: number | null;
    processAlive?: boolean | null;
    /** SPEC-002 §2.9 pane subtree (RAW argv; harness redacts each node). Absent = legacy (null). */
    processTree?: ProcessNode[] | null;
  };
  /** Prior orc state (status diff). Either supply directly or via `priorCapture`. */
  prior?: PriorOrcState | null;
  /** Convenience: raw prior capture → fingerprint is derived for the prior. */
  priorCapture?: string;
  scannedAt: string;
  snapshotStale?: boolean;
  captureUnavailable?: boolean;
  gold: {
    isAgent?: boolean; // required for detection samples; omitted for status-only samples
    agentType?: AgentType | null; // null = non-agent
    status?: OrcStatus;
    waiting?: boolean;
  };
}

// --- redaction-before-consumption builders (mirror collectInventory) ----------

export function toPaneSignal(s: LabeledPaneSample): PaneSignal {
  const cap = sanitizeCapture(s.rawCapture);
  // Absent processTree ≡ legacy sample → null (no G-PROC, no residual cap — existing M1 unchanged).
  // Present → redact EACH node argv (SPEC-006 §2.7 chokepoint), mirroring collectInventory.
  const rawTree = s.paneMeta.processTree;
  const processTree =
    rawTree == null ? null : rawTree.map((n) => ({ ...n, command: redact(n.command).text }));
  return {
    paneId: s.paneMeta.paneId,
    tmuxTarget: s.paneMeta.tmuxTarget,
    command: s.paneMeta.currentCommand, // raw passthrough (structural id)
    paneTitle: s.paneMeta.paneTitle === null ? null : redact(s.paneMeta.paneTitle).text,
    cmdline: s.paneMeta.cmdline === null ? null : redact(s.paneMeta.cmdline).text,
    processTree,
    cwd: redact(s.paneMeta.cwd).text,
    recentOutput: cap.lines,
  };
}

export function toStatusInput(s: LabeledPaneSample, candidate: OrcCandidate): StatusInput {
  let prior = s.prior ?? null;
  if (!prior && s.priorCapture !== undefined) {
    prior = {
      paneId: s.paneMeta.paneId,
      captureFingerprint: computeFingerprint(sanitizeCapture(s.priorCapture).lines),
      status: 'active',
      lastActivityAt: s.paneMeta.lastActivityAt,
      observedAt: s.scannedAt,
    };
  }
  // agentProcessAlive (SPEC-004 §2.1): legacy (no processTree) → undefined (gate inert);
  // present → processTree==null ? null : candidate.processCorroborated.
  const hasTree = s.paneMeta.processTree !== undefined;
  const agentProcessAlive = hasTree
    ? s.paneMeta.processTree === null
      ? null
      : (candidate.processCorroborated ?? false)
    : undefined;
  return {
    candidate,
    pane: toPaneSignal(s),
    lifecycle: {
      paneId: s.paneMeta.paneId,
      paneDead: s.paneMeta.paneDead,
      panePid: s.paneMeta.panePid,
      processAlive: s.paneMeta.processAlive ?? null,
      agentProcessAlive,
      lastActivityAt: s.paneMeta.lastActivityAt,
    },
    scannedAt: s.scannedAt,
    snapshotStale: s.snapshotStale ?? false,
    captureUnavailable: s.captureUnavailable ?? false,
    prior,
    userLabel: null,
  };
}

function goldClass(s: LabeledPaneSample): DetectClass {
  if (!s.gold.isAgent) return 'non-candidate';
  return s.gold.agentType ?? 'unknown';
}

// --- M1: detection precision/recall ------------------------------------------

export interface PerType {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
}
export interface DetectionMetrics {
  n: number;
  perType: Record<'claude-code' | 'codex', PerType>;
  microPrecision: number;
  microRecall: number;
  /** predictions for downstream calibration: confidence + correctness (candidates only). */
  calibrationPoints: { confidence: number; correct: boolean }[];
}

const CONCRETE: ('claude-code' | 'codex')[] = ['claude-code', 'codex'];

export function computeDetectionMetrics(samples: LabeledPaneSample[]): DetectionMetrics {
  const acc: Record<'claude-code' | 'codex', { tp: number; fp: number; fn: number }> = {
    'claude-code': { tp: 0, fp: 0, fn: 0 },
    codex: { tp: 0, fp: 0, fn: 0 },
  };
  const calibrationPoints: { confidence: number; correct: boolean }[] = [];

  for (const s of samples) {
    const cand = detectOrc(toPaneSignal(s), defaultDetectors);
    const pred: DetectClass = cand ? cand.agentType : 'non-candidate';
    const gold = goldClass(s);
    for (const T of CONCRETE) {
      if (pred === T && gold === T) acc[T].tp += 1;
      else if (pred === T && gold !== T) acc[T].fp += 1;
      else if (gold === T && pred !== T) acc[T].fn += 1;
    }
    if (cand) calibrationPoints.push({ confidence: cand.agentTypeConfidence, correct: pred === gold });
  }

  const perType = {} as Record<'claude-code' | 'codex', PerType>;
  let TP = 0;
  let FP = 0;
  let FN = 0;
  for (const T of CONCRETE) {
    const { tp, fp, fn } = acc[T];
    TP += tp;
    FP += fp;
    FN += fn;
    perType[T] = {
      tp,
      fp,
      fn,
      precision: tp + fp === 0 ? 1 : tp / (tp + fp),
      recall: tp + fn === 0 ? 1 : tp / (tp + fn),
    };
  }
  return {
    n: samples.length,
    perType,
    microPrecision: TP + FP === 0 ? 1 : TP / (TP + FP),
    microRecall: TP + FN === 0 ? 1 : TP / (TP + FN),
    calibrationPoints,
  };
}

// --- M2: status accuracy / waiting recall ------------------------------------

export interface StatusMetrics {
  n: number;
  accuracy: number;
  waitingN: number;
  waitingRecall: number;
  waitingPrecision: number;
  calibrationPoints: { confidence: number; correct: boolean }[];
  confusion: { id: string; gold: OrcStatus; pred: OrcStatus }[]; // mismatches only
}

export function computeStatusMetrics(samples: LabeledPaneSample[]): StatusMetrics {
  let correct = 0;
  let waitingGold = 0;
  let waitingHit = 0;
  let waitingPred = 0;
  const calibrationPoints: { confidence: number; correct: boolean }[] = [];
  const confusion: { id: string; gold: OrcStatus; pred: OrcStatus }[] = [];

  for (const s of samples) {
    if (!s.gold.status) continue;
    const cand = detectOrc(toPaneSignal(s), defaultDetectors) ?? {
      agentType: 'unknown' as AgentType,
      agentTypeConfidence: 0.3,
      matchedSignals: [{ signal: 'output', tier: 'C', matchedType: 'unknown', ruleId: 'measure/fallback' }],
    };
    const inf = inferStatus(toStatusInput(s, cand));
    const isCorrect = inf.status === s.gold.status;
    if (isCorrect) correct += 1;
    else confusion.push({ id: s.id, gold: s.gold.status, pred: inf.status });
    calibrationPoints.push({ confidence: inf.statusConfidence, correct: isCorrect });

    const goldWaiting = s.gold.waiting ?? s.gold.status === 'waiting';
    if (goldWaiting) waitingGold += 1;
    if (inf.status === 'waiting') waitingPred += 1;
    if (goldWaiting && inf.status === 'waiting') waitingHit += 1;
  }

  const n = samples.filter((s) => s.gold.status).length;
  return {
    n,
    accuracy: n === 0 ? 1 : correct / n,
    waitingN: waitingGold,
    waitingRecall: waitingGold === 0 ? 1 : waitingHit / waitingGold,
    waitingPrecision: waitingPred === 0 ? 1 : waitingHit / waitingPred,
    calibrationPoints,
    confusion,
  };
}

// --- M3: confidence calibration monotonicity ---------------------------------

export type Band = 'LOW' | 'MEDIUM' | 'HIGH';
export interface CalibrationRow {
  band: Band;
  n: number;
  correct: number;
  acc: number;
}

export function bandOf(confidence: number, bands: { lowMax: number; mediumMax: number }): Band {
  if (confidence < bands.lowMax) return 'LOW';
  if (confidence < bands.mediumMax) return 'MEDIUM';
  return 'HIGH';
}

export function computeCalibration(
  points: { confidence: number; correct: boolean }[],
  bands: { lowMax: number; mediumMax: number },
): CalibrationRow[] {
  const order: Band[] = ['LOW', 'MEDIUM', 'HIGH'];
  const buckets: Record<Band, { n: number; correct: number }> = {
    LOW: { n: 0, correct: 0 },
    MEDIUM: { n: 0, correct: 0 },
    HIGH: { n: 0, correct: 0 },
  };
  for (const p of points) {
    const b = bandOf(p.confidence, bands);
    buckets[b].n += 1;
    if (p.correct) buckets[b].correct += 1;
  }
  return order.map((band) => ({
    band,
    n: buckets[band].n,
    correct: buckets[band].correct,
    acc: buckets[band].n === 0 ? Number.NaN : buckets[band].correct / buckets[band].n,
  }));
}

/** Non-decreasing accuracy across bands with at least `nMin` samples (LOW→MEDIUM→HIGH). */
export function isMonotonic(rows: CalibrationRow[], nMin = 1): boolean {
  const usable = rows.filter((r) => r.n >= nMin && !Number.isNaN(r.acc));
  for (let i = 1; i < usable.length; i++) {
    if (usable[i]!.acc < usable[i - 1]!.acc - 1e-9) return false;
  }
  return true;
}

// --- M5: false-redaction + secret-recall -------------------------------------

export interface RedactionMetrics {
  secretRecall: number;
  falseRedactionRate: number;
  leaked: string[]; // secret samples whose literal survived (should be empty)
  falsePositives: string[]; // keep samples that got redacted (should be small)
}

export function computeRedactionMetrics(
  secretCorpus: { text: string; secret: string }[],
  keepCorpus: string[],
): RedactionMetrics {
  const leaked: string[] = [];
  for (const { text, secret } of secretCorpus) {
    if (redact(text).text.includes(secret)) leaked.push(secret);
  }
  const falsePositives: string[] = [];
  for (const keep of keepCorpus) {
    if (redact(keep).redacted) falsePositives.push(keep);
  }
  return {
    secretRecall: secretCorpus.length === 0 ? 1 : (secretCorpus.length - leaked.length) / secretCorpus.length,
    falseRedactionRate: keepCorpus.length === 0 ? 0 : falsePositives.length / keepCorpus.length,
    leaked,
    falsePositives,
  };
}

export { AGENT_BAND, STATUS_BAND };

/**
 * SPEC-003 — agent-type detection combiner.
 *
 * `detectOrc(pane, detectors)` runs registered adapters in order and combines
 * their claims into a single `OrcCandidate | null` (SPEC-003 §3.3/§3.4):
 *   - null            = non-candidate (no adapter claim + no generic agent marker)
 *   - 'unknown' LOW   = ambiguous candidate (generic marker, or tie conflict)
 *   - concrete type   = one adapter (or a unique-best-tier winner) claimed it
 *
 * The confidence model (§3.2) lives HERE so it is centralized and deterministic:
 * base by tier, corroboration `min(0.99, maxBase + 0.03*(N-1))`, output-only cap
 * 0.60, conflict cap to MEDIUM, ambiguous 0.30. `currentCommand` is derived from
 * the raw `pane.command` exactly once at this SPEC-003 stage (upstream passes the
 * raw `#{pane_current_command}` — SPEC-002 does NOT basename).
 *
 * Open-for-extension (R-ORC-007): NOTHING here hardcodes 'claude-code'/'codex';
 * the combiner only reads `claim.agentType`, tiers and the generic-marker rule,
 * so adding a new `AgentDetector` to the list extends detection with no edits
 * here or to existing adapters.
 *
 * Imports ONLY from the frozen contract (`../types`) + the sibling adapters.
 * Every threshold below is a PoC HYPOTHESIS (SPEC-003 §6).
 */
import type { AgentDetector, AgentType, OrcCandidate, SignalMatch } from '../types';
import type { PaneSignal } from '../types';
import { claudeCode } from './adapters/claude-code';
import { codex } from './adapters/codex';

/** Tier base confidences (SPEC-003 §3.2 — hypotheses). */
const TIER_BASE: Record<'A' | 'B' | 'C', number> = { A: 0.95, B: 0.7, C: 0.45 };
/** Tier strength rank for conflict resolution (A strongest). */
const TIER_RANK: Record<'A' | 'B' | 'C', number> = { A: 0, B: 1, C: 2 };

/** Confidence for ambiguous candidates (generic marker / tie conflict). */
const AMBIGUOUS_CONFIDENCE = 0.3;
/** Conflict winner cap — kept strictly inside MEDIUM band (< AGENT_BAND.mediumMax). */
const CONFLICT_CAP = 0.84;

/**
 * Generic runtimes whose presence (with an explicit AI-agent marker) makes a
 * pane an ambiguous candidate rather than a plain process (SPEC-003 §3.3).
 */
const GENERIC_RUNTIMES = new Set([
  'node',
  'nodejs',
  'node.js',
  'python',
  'python3',
  'python2',
  'deno',
  'bun',
  'ts-node',
  'tsx',
]);

/**
 * Conservative generic agent markers (SPEC-003 §3.3 — hypothesis). Deliberately
 * narrow: we only raise an `unknown` candidate when a generic runtime ALSO shows
 * an explicit AI-agent marker, so plain `node` web servers stay non-candidates.
 * Tuning this set is a PoC false-positive/false-negative tradeoff (SPEC-003 §6).
 */
const GENERIC_AGENT_MARKER = /(^|[^a-z])(assistant|agentic|ai[- ]?agent|llm)\b|--agent\b/i;

/** Minimal path-basename (idempotent; SPEC-003 §2.1 — derived exactly once here). */
export function basename(command: string): string {
  const trimmed = command.trim();
  if (trimmed === '') return '';
  const noTrailing = trimmed.replace(/[/\\]+$/, '');
  const parts = noTrailing.split(/[/\\]/);
  return (parts[parts.length - 1] ?? noTrailing).toLowerCase();
}

/** §3.2 confidence from a set of same-type signals. */
function computeConfidence(signals: SignalMatch[]): number {
  const maxBase = Math.max(...signals.map((s) => TIER_BASE[s.tier]));
  const corroborated = Math.min(0.99, maxBase + 0.03 * (signals.length - 1));
  const outputOnly = signals.every((s) => s.tier === 'C');
  return outputOnly ? Math.min(corroborated, 0.6) : corroborated;
}

/** Best (lowest-rank = strongest) tier among a claim's signals. */
function bestRank(signals: SignalMatch[]): number {
  return Math.min(...signals.map((s) => TIER_RANK[s.tier]));
}

/** De-duplicate signal provenance (stable order) so merges stay deterministic. */
function dedupeSignals(signals: SignalMatch[]): SignalMatch[] {
  const seen = new Set<string>();
  const out: SignalMatch[] = [];
  for (const s of signals) {
    const key = `${s.signal}|${s.tier}|${s.matchedType}|${s.ruleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Detect a conservative generic AI-agent marker (ambiguous candidate, §3.3). */
function genericMarkerSignal(pane: PaneSignal, currentCommand: string): SignalMatch | null {
  if (!GENERIC_RUNTIMES.has(currentCommand)) return null;
  if (pane.paneTitle && GENERIC_AGENT_MARKER.test(pane.paneTitle)) {
    return { signal: 'title', tier: 'C', matchedType: 'unknown', ruleId: 'generic/agent.marker.title' };
  }
  if (pane.cmdline && GENERIC_AGENT_MARKER.test(pane.cmdline)) {
    return { signal: 'cmdline', tier: 'C', matchedType: 'unknown', ruleId: 'generic/agent.marker.cmdline' };
  }
  if (pane.recentOutput.length > 0 && GENERIC_AGENT_MARKER.test(pane.recentOutput.join('\n'))) {
    return { signal: 'output', tier: 'C', matchedType: 'unknown', ruleId: 'generic/agent.marker.output' };
  }
  return null;
}

/**
 * Combine adapter claims into a single candidate. Deterministic: the same
 * `pane` + same `detectors` order always yields the same `OrcCandidate | null`.
 */
export function detectOrc(pane: PaneSignal, detectors: AgentDetector[]): OrcCandidate | null {
  // Derive currentCommand from the raw command EXACTLY ONCE at this stage.
  const currentCommand = basename(pane.command);

  const claims: OrcCandidate[] = [];
  for (const d of detectors) {
    const claim = d.detect(pane);
    if (claim !== null) claims.push(claim);
  }

  // No concrete claim → ambiguous candidate (generic marker) or non-candidate.
  if (claims.length === 0) {
    const marker = genericMarkerSignal(pane, currentCommand);
    if (marker) {
      return { agentType: 'unknown', agentTypeConfidence: AMBIGUOUS_CONFIDENCE, matchedSignals: [marker] };
    }
    return null;
  }

  // Group claims by the type each adapter asserted.
  const types = [...new Set(claims.map((c) => c.agentType))];

  // Single type (one adapter, or several agreeing) → corroborate (§3.2-1).
  if (types.length === 1) {
    const onlyType: AgentType = types[0] ?? 'unknown';
    const signals = dedupeSignals(claims.flatMap((c) => c.matchedSignals));
    return { agentType: onlyType, agentTypeConfidence: computeConfidence(signals), matchedSignals: signals };
  }

  // Conflict: different concrete types (§3.4).
  const ranked = claims.map((c) => ({ claim: c, rank: bestRank(c.matchedSignals) }));
  const minRank = Math.min(...ranked.map((r) => r.rank));
  const top = ranked.filter((r) => r.rank === minRank);
  const allSignals = dedupeSignals(claims.flatMap((c) => c.matchedSignals));

  if (top.length === 1) {
    // Unique strongest tier → pick it, but cap confidence into MEDIUM and keep
    // the conflicting signals as provenance.
    const winner = top[0]?.claim;
    if (winner) {
      const capped = Math.min(computeConfidence(winner.matchedSignals), CONFLICT_CAP);
      return { agentType: winner.agentType, agentTypeConfidence: capped, matchedSignals: allSignals };
    }
  }

  // Tie at the strongest tier → do not assert a false concrete type (R-ORC-002).
  return { agentType: 'unknown', agentTypeConfidence: AMBIGUOUS_CONFIDENCE, matchedSignals: allSignals };
}

/**
 * MVP detector registry (SPEC-003 §2.3). Extend by appending adapters.
 *
 * These are the inline BUILTIN detectors (SPEC-800 §3.3 MVP row) and remain the
 * production default for `scan`. The config-driven extension path (SPEC-800 §3.2,
 * R-P1-011) is additive and lives in `./config`: call `buildDetectors(config)` to
 * get `[...builtins, ...configDetectors]` and pass the result to THIS SAME
 * `detectOrc` — no combiner/adapter edits needed to add an agent (R-ORC-007,
 * SPEC-003-AC-07 / SPEC-800-AC-01/03). `buildDetectors()` with no config compiles
 * the SAME calibrated builtins (proven equivalent in tests/unit/extensibility.test.ts).
 */
export const defaultDetectors: AgentDetector[] = [claudeCode, codex];

// SPEC-800 §3.2 (R-P1-011) — config-driven detector rules. Re-exported here so the
// detection module surface includes the extension path next to the combiner.
// (One-directional: config.ts imports nothing from detect.ts → no import cycle.)
export {
  DETECTOR_API_VERSION,
  DETECTOR_CONFIG_SCHEMA_VERSION,
  DEFAULT_DETECTOR_CONFIG,
  DEFAULT_GENERIC_RUNTIMES,
  MAX_PATTERN_SOURCE_LEN,
  createDetectorFromRule,
  compileDetectors,
  buildDetectors,
} from './config';
export type {
  PatternSpec,
  DetectorRuleConfig,
  DetectorRulesConfig,
  DetectorDiagnostic,
  CompileResult,
  BuildOptions,
} from './config';

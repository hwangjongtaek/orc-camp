/**
 * SPEC-003 — `claude-code` AgentDetector adapter.
 *
 * Owns ONLY claude-code's own signature/banner/prompt patterns (SPEC-003 §3.1).
 * `detect(pane)` returns an OrcCandidate when at least one claude-code signal
 * fires, else `null` (no claim — never invades other agents / non-agents).
 *
 * Imports ONLY from the frozen shared contract (`../../types`). The combiner
 * (`detect.ts`) recomputes/combines confidence; the per-adapter confidence here
 * is the §3.2 model applied to this adapter's own signals so a standalone
 * `claudeCode.detect(pane)` call still returns a well-formed candidate.
 *
 * NOTE: every threshold / pattern below is a PoC HYPOTHESIS (SPEC-003 §6),
 * to be calibrated by SPEC-007 measurement, not a frozen value.
 */
import type { AgentDetector, OrcCandidate, PaneSignal, SignalMatch } from '../../types';

/** Tier base confidences (SPEC-003 §3.2 — hypotheses). */
const TIER_BASE: Record<'A' | 'B' | 'C', number> = { A: 0.95, B: 0.7, C: 0.45 };

/** Generic runtimes that may shim claude-code → wrapper case (SPEC-003 §3.1 G-WRAP). */
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

/** claude-code signature in argv/title (G-WRAP / G-TITLE) — hypothesis. */
const CLAUDE_SIGNATURE = /@anthropic-ai\/claude-code|claude-code|\bclaude\b/i;

/** claude-code banner / prompt markers in output tail (G-OUT) — hypothesis. */
const CLAUDE_BANNER = /claude code|anthropic|welcome to claude|do you want to proceed\?/i;

/** Direct command basenames that ARE claude-code (G-CMD). */
const CLAUDE_COMMANDS = new Set(['claude', 'claude-code']);

/** Minimal path-basename (idempotent; pipeline applies it exactly once at SPEC-003). */
function cmdBasename(command: string): string {
  const trimmed = command.trim();
  if (trimmed === '') return '';
  const noTrailing = trimmed.replace(/[/\\]+$/, '');
  const parts = noTrailing.split(/[/\\]/);
  return (parts[parts.length - 1] ?? noTrailing).toLowerCase();
}

/** §3.2 confidence from this adapter's own (single-type) signals. */
function confFromSignals(signals: SignalMatch[]): number {
  const maxBase = Math.max(...signals.map((s) => TIER_BASE[s.tier]));
  const corroborated = Math.min(0.99, maxBase + 0.03 * (signals.length - 1));
  const outputOnly = signals.every((s) => s.tier === 'C');
  return outputOnly ? Math.min(corroborated, 0.6) : corroborated;
}

export const claudeCode: AgentDetector = {
  id: 'claude-code',
  detect(pane: PaneSignal): OrcCandidate | null {
    const signals: SignalMatch[] = [];
    const currentCommand = cmdBasename(pane.command);

    // G-CMD (Tier A) — direct command basename match.
    if (CLAUDE_COMMANDS.has(currentCommand)) {
      signals.push({
        signal: 'command',
        tier: 'A',
        matchedType: 'claude-code',
        ruleId: 'claude-code/cmd.basename',
      });
    }

    const isRuntime = GENERIC_RUNTIMES.has(currentCommand);
    if (isRuntime) {
      // G-WRAP (Tier B) — generic runtime + signature in argv (preferred) or title.
      if (pane.cmdline && CLAUDE_SIGNATURE.test(pane.cmdline)) {
        signals.push({
          signal: 'cmdline',
          tier: 'B',
          matchedType: 'claude-code',
          ruleId: 'claude-code/wrap.cmdline',
        });
      } else if (pane.paneTitle && CLAUDE_SIGNATURE.test(pane.paneTitle)) {
        signals.push({
          signal: 'title',
          tier: 'B',
          matchedType: 'claude-code',
          ruleId: 'claude-code/wrap.title',
        });
      }
    } else if (pane.paneTitle && CLAUDE_SIGNATURE.test(pane.paneTitle)) {
      // G-TITLE (Tier B) — title signature regardless of runtime.
      signals.push({
        signal: 'title',
        tier: 'B',
        matchedType: 'claude-code',
        ruleId: 'claude-code/title.signature',
      });
    }

    // G-OUT (Tier C) — banner / prompt marker in the redacted output tail.
    if (pane.recentOutput.length > 0 && CLAUDE_BANNER.test(pane.recentOutput.join('\n'))) {
      signals.push({
        signal: 'output',
        tier: 'C',
        matchedType: 'claude-code',
        ruleId: 'claude-code/out.banner',
      });
    }

    if (signals.length === 0) return null;
    return {
      agentType: 'claude-code',
      agentTypeConfidence: confFromSignals(signals),
      matchedSignals: signals,
    };
  },
};

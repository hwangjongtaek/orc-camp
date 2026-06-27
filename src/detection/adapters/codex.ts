/**
 * SPEC-003 — `codex` AgentDetector adapter.
 *
 * Owns ONLY codex's own signature/banner/approval-prompt patterns (SPEC-003
 * §3.1). Mirror of the claude-code adapter; the two share NO code (adapters
 * import only from `../../types`) so each stays independently extensible
 * (R-ORC-007).
 *
 * NOTE: every threshold / pattern below is a PoC HYPOTHESIS (SPEC-003 §6).
 */
import type { AgentDetector, OrcCandidate, PaneSignal, SignalMatch } from '../../types';

/** Tier base confidences (SPEC-003 §3.2 — hypotheses). */
const TIER_BASE: Record<'A' | 'B' | 'C', number> = { A: 0.95, B: 0.7, C: 0.45 };

/** Generic runtimes that may shim codex → wrapper case (SPEC-003 §3.1 G-WRAP). */
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

/** codex signature in argv/title (G-WRAP / G-TITLE) — hypothesis. */
const CODEX_SIGNATURE = /@openai\/codex|codex-cli|\bcodex\b/i;

/**
 * codex OUTPUT banner / approval-prompt markers (G-OUT, Tier C) — hypothesis.
 * Calibration (2026-06-27, SPEC-003 §6): the bare word `\bcodex\b` was REMOVED
 * from the OUTPUT path. Live M1 measurement showed it false-fires on non-agent
 * panes (`nvim`/`zsh`) whose captured content merely mentions the word "codex".
 * OUTPUT now requires a DISTINCTIVE product marker. The TITLE/cmdline signature
 * (`CODEX_SIGNATURE`) intentionally keeps the bare word — title matches measured
 * correct — and is unaffected by this calibration.
 */
const CODEX_BANNER = /openai codex|@openai\/codex|codex-cli|approve this command\?|allow command\?/i;

/** Direct command basenames that ARE codex (G-CMD). */
const CODEX_COMMANDS = new Set(['codex']);

/** Minimal path-basename (idempotent). */
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

export const codex: AgentDetector = {
  id: 'codex',
  detect(pane: PaneSignal): OrcCandidate | null {
    const signals: SignalMatch[] = [];
    const currentCommand = cmdBasename(pane.command);

    // G-CMD (Tier A).
    if (CODEX_COMMANDS.has(currentCommand)) {
      signals.push({
        signal: 'command',
        tier: 'A',
        matchedType: 'codex',
        ruleId: 'codex/cmd.basename',
      });
    }

    const isRuntime = GENERIC_RUNTIMES.has(currentCommand);
    if (isRuntime) {
      // G-WRAP (Tier B).
      if (pane.cmdline && CODEX_SIGNATURE.test(pane.cmdline)) {
        signals.push({
          signal: 'cmdline',
          tier: 'B',
          matchedType: 'codex',
          ruleId: 'codex/wrap.cmdline',
        });
      } else if (pane.paneTitle && CODEX_SIGNATURE.test(pane.paneTitle)) {
        signals.push({
          signal: 'title',
          tier: 'B',
          matchedType: 'codex',
          ruleId: 'codex/wrap.title',
        });
      }
    } else if (pane.paneTitle && CODEX_SIGNATURE.test(pane.paneTitle)) {
      // G-TITLE (Tier B).
      signals.push({
        signal: 'title',
        tier: 'B',
        matchedType: 'codex',
        ruleId: 'codex/title.signature',
      });
    }

    // G-OUT (Tier C).
    if (pane.recentOutput.length > 0 && CODEX_BANNER.test(pane.recentOutput.join('\n'))) {
      signals.push({
        signal: 'output',
        tier: 'C',
        matchedType: 'codex',
        ruleId: 'codex/out.banner',
      });
    }

    if (signals.length === 0) return null;
    return {
      agentType: 'codex',
      agentTypeConfidence: confFromSignals(signals),
      matchedSignals: signals,
    };
  },
};

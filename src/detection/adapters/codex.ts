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

/** codex package/module exec identifiers for G-PROC rule 2 (SPEC-003 §3.1.1). */
const CODEX_PACKAGE_IDS = ['@openai/codex', 'codex-cli'];

/** Minimal path-basename (idempotent). */
function cmdBasename(command: string): string {
  const trimmed = command.trim();
  if (trimmed === '') return '';
  const noTrailing = trimmed.replace(/[/\\]+$/, '');
  const parts = noTrailing.split(/[/\\]/);
  return (parts[parts.length - 1] ?? noTrailing).toLowerCase();
}

/** Exec basename: path-basename lowercased with a single known runtime extension stripped. */
function execBasename(token: string): string {
  return cmdBasename(token).replace(/\.(js|mjs|cjs|ts|py|exe)$/i, '');
}

/** Path segments of a token (lowercased, separator-split, empties removed). */
function pathSegments(token: string): string[] {
  return token.toLowerCase().split(/[/\\]/).filter((s) => s.length > 0);
}

/** True iff package-id (possibly `@scope/name`) appears as consecutive path segments. */
function segmentsContain(hay: string[], packageId: string): boolean {
  const needle = packageId.toLowerCase().split('/').filter((s) => s.length > 0);
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** G-PROC node match (SPEC-003 §3.1.1) — exec/module token, NOT arbitrary substring. */
function nodeMatchesAgent(
  command: string,
  commands: Set<string>,
  runtimes: Set<string>,
  packageIds: string[],
): boolean {
  const tokens = command.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return false;
  const arg0 = execBasename(tokens[0]!);
  if (commands.has(arg0)) return true; // rule 1
  if (!runtimes.has(arg0)) return false; // rule 2 requires a generic runtime arg0
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (packageIds.some((p) => t.toLowerCase() === p.toLowerCase())) return true; // 2a
    if (packageIds.some((p) => segmentsContain(pathSegments(t), p))) return true; // 2b
    // 2c installed-entry PATH only (must contain a separator) — a bare arg/flag-value must
    // NOT match (SPEC-003 §3.1.1: exec/path token, not arbitrary word).
    if (/[/\\]/.test(t) && commands.has(execBasename(t))) return true;
  }
  return false;
}

/** Scan the redacted subtree for a live agent process; returns the minimum match depth. */
function detectProcSubtree(
  pane: PaneSignal,
  commands: Set<string>,
  runtimes: Set<string>,
  packageIds: string[],
): { matched: boolean; minDepth: number } {
  const tree = pane.processTree;
  if (!tree || tree.length === 0) return { matched: false, minDepth: Number.POSITIVE_INFINITY };
  let minDepth = Number.POSITIVE_INFINITY;
  for (const node of tree) {
    if (nodeMatchesAgent(node.command, commands, runtimes, packageIds) && node.depth < minDepth) {
      minDepth = node.depth;
    }
  }
  return { matched: minDepth !== Number.POSITIVE_INFINITY, minDepth };
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

    // G-PROC (Tier A) — live agent process anywhere in the pane subtree (SPEC-003 §3.1.1).
    const proc = detectProcSubtree(pane, CODEX_COMMANDS, GENERIC_RUNTIMES, CODEX_PACKAGE_IDS);
    if (proc.matched) {
      signals.push({
        signal: 'process',
        tier: 'A',
        matchedType: 'codex',
        ruleId: 'codex/proc.subtree',
        depth: proc.minDepth,
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
      processCorroborated: signals.some((s) => s.signal === 'command' || s.signal === 'process'),
    };
  },
};

/**
 * SPEC-007 M1 (real-environment) — non-self-confirming detection measurement.
 *
 * Collects the LIVE tmux inventory (read-only, redacted) and compares the engine's
 * detection against an INDEPENDENT, command-based OBJECTIVE ground truth:
 *   - claude / claude-code command  → objectively claude-code
 *   - codex command                 → objectively codex
 *   - shell/editor/known tool       → objectively NON-agent
 *   - generic runtime (node/python…)→ uncertain (excluded from the strict metric)
 *
 * The objective labeler uses ONLY unambiguous signals, so disagreements are real
 * findings: over-detection (a non-agent flagged as an orc) and misses.
 *
 *   npx tsx scripts/measure-detection-live.mts   (env: WRITE=1 to dump redacted JSON locally)
 *
 * PRIVACY: prints aggregates + command basenames only (never capture content, cwd, or
 * session names). With WRITE=1 it writes a REDACTED dataset to tests/measurement/.local/
 * (gitignored) for the user's own review — nothing here is committed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { collectInventory } from '../src/tmux/inventory';
import { tmuxExec, safeSpawn } from '../src/tmux/exec';
import { makeProcessSnapshot } from '../src/tmux/introspect';
import { redact, sanitizeCapture } from '../src/redaction/redact';
import { detectOrc, defaultDetectors, basename } from '../src/detection/detect';
import type { PaneRawRecord, PaneSignal } from '../src/types';

type Truth = 'claude-code' | 'codex' | 'non-agent' | 'uncertain';

const NON_AGENT = new Set([
  'zsh', 'bash', 'fish', 'sh', 'dash', '-zsh', '-bash', '-fish', 'login',
  'vim', 'nvim', 'vi', 'emacs', 'nano', 'less', 'more', 'man', 'view',
  'git', 'ssh', 'top', 'htop', 'btop', 'tmux', 'tail', 'cat', 'watch',
  'lazygit', 'gitui', 'fzf', 'grep', 'rg', 'make', 'docker', 'kubectl',
]);

function toSignal(p: PaneRawRecord): PaneSignal {
  return {
    paneId: p.paneId,
    tmuxTarget: p.tmuxTarget,
    command: p.command,
    paneTitle: p.paneTitle,
    cmdline: p.cmdline,
    processTree: p.processTree ?? null,
    cwd: p.cwd,
    recentOutput: p.capture ? p.capture.lines : [],
  };
}

/** Independent, command-only objective ground truth. */
function objectiveTruth(p: PaneRawRecord): Truth {
  const cmd = basename(p.command).toLowerCase();
  if (cmd === 'claude' || cmd === 'claude-code') return 'claude-code';
  if (cmd === 'codex') return 'codex';
  if (NON_AGENT.has(cmd)) return 'non-agent';
  return 'uncertain';
}

async function main(): Promise<void> {
  const inv = await collectInventory({
    tmuxExec,
    processSnapshot: makeProcessSnapshot(safeSpawn),
    sanitize: sanitizeCapture,
    redact,
    now: () => new Date(),
  });

  let agentN = 0;
  let agentCorrect = 0;
  let nonAgentN = 0;
  const overDetections: { cmd: string; agentType: string; conf: number; sig: string }[] = [];
  let uncertainN = 0;
  const uncertainPred: Record<string, number> = { 'claude-code': 0, codex: 0, unknown: 0, 'non-candidate': 0 };
  const dump: unknown[] = [];

  for (const pane of inv.panes) {
    const truth = objectiveTruth(pane);
    const cand = detectOrc(toSignal(pane), defaultDetectors);
    const pred = cand ? cand.agentType : 'non-candidate';
    const cmd = basename(pane.command).toLowerCase();

    if (truth === 'claude-code' || truth === 'codex') {
      agentN += 1;
      if (pred === truth) agentCorrect += 1;
    } else if (truth === 'non-agent') {
      nonAgentN += 1;
      if (cand) {
        const sig = cand.matchedSignals.map((s) => `${s.signal}:${s.tier}:${s.ruleId}`).join(',');
        overDetections.push({ cmd, agentType: cand.agentType, conf: cand.agentTypeConfidence, sig });
      }
    } else {
      uncertainN += 1;
      uncertainPred[pred] = (uncertainPred[pred] ?? 0) + 1;
    }

    if (process.env.WRITE === '1') {
      dump.push({ paneId: pane.paneId, command: pane.command, truth, predicted: pred, confidence: cand?.agentTypeConfidence ?? null });
    }
  }

  // Precision on the CERTAIN set (concrete types). FP = non-agent or wrong concrete flagged as T.
  // Recall on certain agents.
  const fpCount = overDetections.filter((o) => o.agentType !== 'unknown').length; // concrete over-detection
  const precisionDenom = agentCorrect + fpCount;
  const precision = precisionDenom === 0 ? 1 : agentCorrect / precisionDenom;
  const recall = agentN === 0 ? 1 : agentCorrect / agentN;
  const overDetectRate = nonAgentN === 0 ? 0 : overDetections.length / nonAgentN;

  // aggregate over-detections by command (privacy-safe)
  const byCmd: Record<string, { n: number; types: Record<string, number> }> = {};
  for (const o of overDetections) {
    (byCmd[o.cmd] ??= { n: 0, types: {} }).n += 1;
    byCmd[o.cmd]!.types[o.agentType] = (byCmd[o.cmd]!.types[o.agentType] ?? 0) + 1;
  }

  const lines: string[] = [];
  lines.push(`[M1 LIVE] panes=${inv.panes.length}  (read-only, redacted; command-based objective truth)`);
  lines.push(`  objective AGENT (claude/codex command): ${agentN}  → engine correct type: ${agentCorrect}/${agentN} (recall ${(recall * 100).toFixed(0)}%)`);
  lines.push(`  objective NON-AGENT (shell/editor/tool): ${nonAgentN}  → flagged as orc (OVER-DETECTION): ${overDetections.length}/${nonAgentN} (${(overDetectRate * 100).toFixed(0)}%)`);
  lines.push(`  uncertain (generic runtime wrappers): ${uncertainN}  → pred ${JSON.stringify(uncertainPred)}`);
  lines.push(`  precision (certain set, concrete over-detection counts): ${(precision * 100).toFixed(0)}%`);
  if (Object.keys(byCmd).length) {
    lines.push(`  over-detection by command:`);
    for (const [cmd, info] of Object.entries(byCmd).sort((a, b) => b[1].n - a[1].n)) {
      lines.push(`    ${cmd.padEnd(10)} x${info.n}  → ${JSON.stringify(info.types)}`);
    }
    // why were they flagged? (ruleId/tier — privacy-safe, no content)
    const bySig: Record<string, number> = {};
    for (const o of overDetections) bySig[o.sig] = (bySig[o.sig] ?? 0) + 1;
    lines.push(`  over-detection by matched signal (ruleId:tier):`);
    for (const [sig, n] of Object.entries(bySig).sort((a, b) => b[1] - a[1])) {
      lines.push(`    x${n}  ${sig}`);
    }
  }
  process.stdout.write(lines.join('\n') + '\n');

  if (process.env.WRITE === '1') {
    mkdirSync('tests/measurement/.local', { recursive: true });
    writeFileSync('tests/measurement/.local/live-detection.json', JSON.stringify(dump, null, 2));
    process.stdout.write(`  (redacted dataset written to tests/measurement/.local/live-detection.json — gitignored)\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`measure-detection-live failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});

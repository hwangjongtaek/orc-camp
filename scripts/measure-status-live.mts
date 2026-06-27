/**
 * SPEC-007 M2 (real-environment) — live status measurement / consistency check.
 *
 * Runs N read-only watch cycles (real prior handoff) and, for each detected orc,
 * records the engine status vs INDEPENDENT raw-temporal observations:
 *   - rawChanged  : did the (redacted) capture lines change vs the previous cycle?
 *   - normChanged : did the normalized fingerprint change (volatile masked)?
 *   - activityAge : scannedAt − pane_activity
 *   - tailPrompt  : does the tail match a broad, independent input-prompt regex?
 *
 * It then surfaces inconsistencies that indicate status calibration issues:
 *   - over-active: engine=active while nothing meaningfully changed AND activity is old
 *   - waiting visibility: of orcs whose tail looks like a prompt, how many the engine
 *     ever labels `waiting` (an approximate, independent waiting-recall probe).
 *
 *   npx tsx scripts/measure-status-live.mts   (env: CYCLES=6 INTERVAL_MS=1500)
 *
 * PRIVACY: prints counts / command basenames / statuses only — never capture content.
 */
import { collectInventory } from '../src/tmux/inventory';
import { tmuxExec, safeSpawn } from '../src/tmux/exec';
import { makeIntrospect } from '../src/tmux/introspect';
import { redact, sanitizeCapture } from '../src/redaction/redact';
import { detectOrc, defaultDetectors, basename } from '../src/detection/detect';
import { inferStatus } from '../src/status/infer';
import { computeFingerprint } from '../src/status/fingerprint';
import { T_ACTIVE_MS, type PaneRawRecord, type PaneSignal, type PriorOrcState } from '../src/types';

const CYCLES = Number(process.env.CYCLES ?? 6);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 1500);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function toSignal(p: PaneRawRecord): PaneSignal {
  return {
    paneId: p.paneId,
    tmuxTarget: p.tmuxTarget,
    command: p.command,
    paneTitle: p.paneTitle,
    cmdline: p.cmdline,
    cwd: p.cwd,
    recentOutput: p.capture ? p.capture.lines : [],
  };
}
function eqLines(a: string[] | undefined, b: string[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}
function tailLooksLikePrompt(lines: string[]): boolean {
  const last = [...lines].reverse().find((l) => l.trim() !== '');
  if (!last) return false;
  return /\(y\/n\)|\[y\/n\]|\[y\/n\]|❯\s*$|>\s*$|\?\s*$|:\s*$|\bcontinue\b|\bproceed\b|press enter|overwrite|do you want/i.test(last);
}

interface Rec {
  paneId: string;
  cmd: string;
  status: string;
  conf: number;
  rawChanged: boolean | null;
  normChanged: boolean | null;
  activityAgeMs: number;
  tailPrompt: boolean;
}

async function main(): Promise<void> {
  const deps = {
    tmuxExec,
    introspect: makeIntrospect(safeSpawn),
    sanitize: sanitizeCapture,
    redact,
    now: () => new Date(),
  };
  const priors = new Map<string, PriorOrcState>();
  const prevLines = new Map<string, string[]>();
  const records: Rec[] = [];
  const lastByPane = new Map<string, Rec>();

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    const inv = await collectInventory(deps);
    const scannedAt = new Date().toISOString();
    const scannedMs = Date.parse(scannedAt);

    for (const pane of inv.panes) {
      const signal = toSignal(pane);
      const cand = detectOrc(signal, defaultDetectors);
      if (!cand) continue;
      const lines = pane.capture ? pane.capture.lines : [];
      const fp = computeFingerprint(lines);
      const prior = priors.get(pane.paneId) ?? null;
      const inf = inferStatus({
        candidate: cand,
        pane: signal,
        lifecycle: {
          paneId: pane.paneId,
          paneDead: pane.paneDead,
          panePid: pane.panePid,
          processAlive: pane.processAlive,
          lastActivityAt: pane.lastActivityAt,
        },
        scannedAt,
        snapshotStale: false,
        captureUnavailable: pane.capture === null,
        prior,
        userLabel: null,
      });

      const rec: Rec = {
        paneId: pane.paneId,
        cmd: basename(pane.command).toLowerCase(),
        status: inf.status,
        conf: inf.statusConfidence,
        rawChanged: prevLines.has(pane.paneId) ? !eqLines(prevLines.get(pane.paneId), lines) : null,
        normChanged: prior ? !eqLines(prior.captureFingerprint, fp) : null,
        activityAgeMs: scannedMs - Date.parse(pane.lastActivityAt),
        tailPrompt: tailLooksLikePrompt(lines),
      };
      records.push(rec);
      lastByPane.set(pane.paneId, rec);
      priors.set(pane.paneId, {
        paneId: pane.paneId,
        captureFingerprint: fp,
        status: inf.status,
        lastActivityAt: pane.lastActivityAt,
        observedAt: scannedAt,
      });
      prevLines.set(pane.paneId, lines);
    }
    if (cycle < CYCLES - 1) await sleep(INTERVAL_MS);
  }

  // --- analysis (cycles 2+ have priors) ---
  const withPrior = records.filter((r) => r.rawChanged !== null);
  // over-active: active claimed while nothing meaningfully changed AND activity is old
  const overActive = withPrior.filter(
    (r) => r.status === 'active' && r.normChanged === false && r.activityAgeMs > T_ACTIVE_MS,
  );
  // active that is genuinely backed by a normalized change
  const activeChanged = withPrior.filter((r) => r.status === 'active' && r.normChanged === true);
  const activeTotal = withPrior.filter((r) => r.status === 'active');

  // waiting visibility: orcs whose final-cycle tail looks like a prompt
  const lastRecs = [...lastByPane.values()];
  const promptOrcs = lastRecs.filter((r) => r.tailPrompt);
  const promptAsWaiting = promptOrcs.filter((r) => r.status === 'waiting');

  // status distribution in the final cycle
  const dist: Record<string, number> = {};
  for (const r of lastRecs) dist[r.status] = (dist[r.status] ?? 0) + 1;
  // confidence band of the final-cycle active orcs
  const activeLast = lastRecs.filter((r) => r.status === 'active');
  const activeHigh = activeLast.filter((r) => r.conf >= 0.8).length;

  const out: string[] = [];
  out.push(`[M2 LIVE] cycles=${CYCLES} interval=${INTERVAL_MS}ms  orcs(final cycle)=${lastRecs.length}`);
  out.push(`  final-cycle status distribution: ${JSON.stringify(dist)}`);
  out.push(`  active(final): ${activeLast.length}  of which HIGH(≥0.80, real change): ${activeHigh}  LOW/weak: ${activeLast.length - activeHigh}`);
  out.push(`  --- over-active check (orc-cycles with a prior) ---`);
  out.push(`  active total=${activeTotal.length}  backed-by-normChange=${activeChanged.length}  OVER-ACTIVE(no change & old activity)=${overActive.length}`);
  out.push(`  --- waiting visibility (final cycle, independent prompt probe) ---`);
  out.push(`  tail-looks-like-prompt orcs=${promptOrcs.length}  engine labeled waiting=${promptAsWaiting.length}  (approx waiting recall=${promptOrcs.length ? ((promptAsWaiting.length / promptOrcs.length) * 100).toFixed(0) + '%' : 'n/a'})`);
  if (promptOrcs.length) {
    const missByStatus: Record<string, number> = {};
    for (const r of promptOrcs.filter((r) => r.status !== 'waiting')) missByStatus[r.status] = (missByStatus[r.status] ?? 0) + 1;
    out.push(`  prompt-tail orcs NOT labeled waiting → ${JSON.stringify(missByStatus)}`);
  }
  process.stdout.write(out.join('\n') + '\n');
}

main().catch((e) => {
  process.stderr.write(`measure-status-live failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});

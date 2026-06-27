/**
 * SPEC-007 §3.3 M4 — scan latency p50/p95 over a LIVE tmux server.
 *
 * Non-gated measurement (real tmux, machine-dependent). Runs the real watch-cycle
 * path (ScanRunner.scanOnce, incl. cross-cycle prior handoff) for R cycles and
 * reports nearest-rank p50/p95 of diagnostics.scanDurationMs.
 *
 *   npx tsx scripts/measure-latency.mts      (env: CYCLES=30 INTERVAL_MS=300)
 *
 * The formal hypothesis is p95 < 1s at ~20 panes; this reports whatever the current
 * server holds (pane count is printed for context).
 */
import { ScanRunner, createDefaultDeps } from '../src/scan';

const CYCLES = Number(process.env.CYCLES ?? 30);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 300);
const WARMUP = 2;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function nearestRank(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.ceil(q * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]!;
}

async function main(): Promise<void> {
  const runner = new ScanRunner(createDefaultDeps());
  const durations: number[] = [];
  let panes = 0;
  let orcs = 0;

  for (let i = 0; i < CYCLES + WARMUP; i++) {
    const r = await runner.scanOnce();
    if (i >= WARMUP) {
      durations.push(r.diagnostics.scanDurationMs);
      panes = r.camps.reduce((s, c) => s + c.paneCount, 0);
      orcs = r.camps.reduce((s, c) => s + c.orcCount, 0);
    }
    if (i < CYCLES + WARMUP - 1) await sleep(INTERVAL_MS);
  }

  durations.sort((a, b) => a - b);
  const p50 = nearestRank(durations, 0.5);
  const p95 = nearestRank(durations, 0.95);
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;

  process.stdout.write(
    `[M4] scan latency over live tmux\n` +
      `  panes=${panes} orcs=${orcs} cycles=${durations.length} (warmup ${WARMUP} dropped)\n` +
      `  p50=${p50}ms  p95=${p95}ms  mean=${mean.toFixed(0)}ms  min=${durations[0]}ms  max=${durations[durations.length - 1]}ms\n` +
      `  hypothesis: p95 < 1000ms at ~20 panes (this server holds ${panes})\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`measure-latency failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});

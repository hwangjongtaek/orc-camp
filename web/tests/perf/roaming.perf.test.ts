/**
 * SPEC-301 §3.3 / AC-11 — roaming scene-engine perf measurement harness (M-layer).
 *
 * Follows the SPEC-007 §2.1 measurement pattern (input · method · formula · threshold).
 *
 *   input   : a worst-case 20-session / 100-pane (100-sprite) camp, all roaming at once.
 *   method  : drive RoamingController.snapshot(id, t) for all 100 orcs per "tick" across N
 *             ticks spread over the roam window, plus computeLayout() over M iterations.
 *   formula : per-tick cost = Σ snapshot(id, t) for 100 ids; report p50 / p95 / max (ms).
 *   threshold (AC-11(a), NON-GATING): the true 60fps paint-frame p95 ≤ 16.7ms is a success
 *             *hypothesis* measured in a real browser (forward — see note below), NOT a CI
 *             gate. Here we PRINT the numbers and assert only generous structural ceilings so
 *             CI never flakes, plus the gateable invariant that snapshot() is pure /
 *             allocation-light (AC-11(b)). The shared-clock single-loop / per-sprite-timer-0
 *             invariant (AC-13a) is gated in tests/roaming.test.ts.
 *
 * NOTE (forward): this measures the JS scene-engine cost only (Node/jsdom timers). True
 * paint-frame p95 (style/layout/paint of 100 DOM sprites) requires browser profiling and is
 * tracked as the SPEC-200/SPEC-007 FE measurement layer (Q4), not asserted here.
 *
 * Runnable standalone via `npm run measure:roaming`.
 */
import { describe, it, expect } from 'vitest';
import { computeLayout, type OrcMapInput } from '../../src/scene/layout';
import { RoamingController } from '../../src/scene/roaming';
import { ROAM_MAX_MS } from '../../src/scene/stations';
import type { OrcStatus } from '../../src/types/domain';

const SESSIONS = 20;
const PANES_PER_SESSION = 5; // 20 × 5 = 100 panes (= 100 sprites)
const PANE_COUNT = SESSIONS * PANES_PER_SESSION;
const N_TICKS = 300; // snapshot ticks (each = 100 snapshot calls) → percentile samples
const LAYOUT_ITERS = 120; // computeLayout samples
const CEILING_MS = 50; // generous, non-flaky CI ceiling (real values are far below this)

// All-roaming worst case: rotate over the 6 non-terminated stations so every status change
// moves the target (→ roaming). windowIndex spreads 100 panes across 20 zones.
const ROAMING_STATUSES: OrcStatus[] = ['active', 'waiting', 'idle', 'error', 'stale', 'unknown'];

function makeOrcs(shift: number): OrcMapInput[] {
  const orcs: OrcMapInput[] = [];
  for (let i = 0; i < PANE_COUNT; i += 1) {
    orcs.push({
      id: `pane:%${i + 1}`,
      paneId: `%${i + 1}`,
      windowIndex: Math.floor(i / PANES_PER_SESSION),
      status: ROAMING_STATUSES[(i + shift) % ROAMING_STATUSES.length] as OrcStatus,
    });
  }
  return orcs;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx] ?? 0;
}

function summarize(samplesMs: number[]): { p50: number; p95: number; max: number } {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

const fmt = (n: number): string => n.toFixed(4);

describe('SPEC-301 §3.3 / AC-11 roaming perf measurement (M-layer, non-gating)', () => {
  it('measures snapshot()×100 per-tick and computeLayout() cost; asserts only generous ceilings', () => {
    // --- computeLayout cost (M iterations) ---
    const orcsA = makeOrcs(0);
    const orcsB = makeOrcs(1); // every status shifted → every target moves
    const layoutSamples: number[] = [];
    let layoutOut = computeLayout(orcsB);
    for (let i = 0; i < LAYOUT_ITERS; i += 1) {
      const t0 = performance.now();
      layoutOut = computeLayout(i % 2 === 0 ? orcsA : orcsB);
      layoutSamples.push(performance.now() - t0);
    }

    // --- put all 100 orcs into a simultaneous roam ---
    const controller = new RoamingController();
    const layoutB = computeLayout(orcsB);
    const entriesA = orcsA.map((o) => ({
      id: o.id,
      paneId: o.paneId,
      status: o.status,
      target: computeLayout(orcsA).targets.get(o.id)!.target,
    }));
    controller.sync(entriesA, 0, { reducedMotion: false }); // spawn (arrived)
    const entriesB = orcsB.map((o) => ({
      id: o.id,
      paneId: o.paneId,
      status: o.status,
      target: layoutB.targets.get(o.id)!.target,
    }));
    controller.sync(entriesB, 0, { reducedMotion: false }); // all roam from A→B

    const ids = orcsB.map((o) => o.id);

    // --- per-tick snapshot cost across the roam window ---
    const tickSamples: number[] = [];
    let sink = 0;
    for (let tick = 0; tick < N_TICKS; tick += 1) {
      const t = (tick / N_TICKS) * ROAM_MAX_MS; // spread across [0, ROAM_MAX_MS]
      const t0 = performance.now();
      for (let k = 0; k < ids.length; k += 1) {
        const snap = controller.snapshot(ids[k] as string, t);
        if (snap) sink += snap.renderedPos.x; // prevent dead-code elimination
      }
      tickSamples.push(performance.now() - t0);
    }
    expect(Number.isFinite(sink)).toBe(true);

    const tick = summarize(tickSamples);
    const layout = summarize(layoutSamples);
    const perSnapshotP95Us = (tick.p95 / PANE_COUNT) * 1000;

    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '── SPEC-301 §3.3 roaming perf (M-layer, non-gating) ──────────────────────',
        `input   : ${SESSIONS} sessions × ${PANES_PER_SESSION} panes = ${PANE_COUNT} sprites, all roaming`,
        `method  : RoamingController.snapshot(id,t) ×${PANE_COUNT}/tick × ${N_TICKS} ticks; computeLayout ×${LAYOUT_ITERS}`,
        '',
        `snapshot ×${PANE_COUNT}/tick (ms)  p50=${fmt(tick.p50)}  p95=${fmt(tick.p95)}  max=${fmt(tick.max)}`,
        `per-snapshot          (µs)  p95≈${fmt(perSnapshotP95Us)}`,
        `computeLayout/100     (ms)  p50=${fmt(layout.p50)}  p95=${fmt(layout.p95)}  max=${fmt(layout.max)}`,
        '',
        'threshold: 60fps paint-frame p95 ≤ 16.7ms is a NON-GATING hypothesis measured in a',
        '           real browser (forward); this harness measures JS scene-engine cost only.',
        '──────────────────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );

    // --- structural / gateable assertions (generous, never-flaky) ---
    expect(ids.length).toBe(100);
    expect(layoutOut.windows.length).toBe(SESSIONS);
    expect(layoutB.targets.size).toBe(PANE_COUNT);
    expect(tick.p95).toBeLessThan(CEILING_MS);
    expect(layout.p95).toBeLessThan(CEILING_MS);

    // AC-11(b) — snapshot is pure / allocation-light: same (id, t) → equal value, fresh object,
    // and no mutation of controller state across repeated calls.
    const id0 = ids[0] as string;
    const s1 = controller.snapshot(id0, 321)!;
    const s2 = controller.snapshot(id0, 321)!;
    expect(s2.renderedPos).toEqual(s1.renderedPos);
    expect(s2.movementState).toBe(s1.movementState);
    expect(s2).not.toBe(s1); // a fresh object per call (no shared mutable buffer)
    expect(controller.snapshot(id0, 321)!.renderedPos).toEqual(s1.renderedPos); // still pure
  });
});

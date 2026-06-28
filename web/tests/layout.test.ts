/**
 * SPEC-301 layout — pure determinism (AC-01/02/03/12/14).
 * No DOM. Position is a function of windowIndex/status/paneId only (INV-1/INV-2).
 * Geometry re-decision (F2): a large logical WORLD = grid of FIXED-size zones; MapDims is
 * derived purely from the window count (mapDims), never from the background image.
 */
import { describe, it, expect } from 'vitest';
import {
  computeLayout,
  innerRect,
  mapDims,
  slotOffset,
  slotRank,
  stationAnchor,
  targetPosition,
  terminatedOffset,
  zoneRect,
  type OrcMapInput,
} from '../src/scene/layout';
import {
  MIN_ZONE,
  SCALED_FOOTPRINT,
  STATIONS,
  ZONE_COLS_MAX,
  ZONE_GUTTER,
  ZONE_H,
  ZONE_W,
} from '../src/scene/stations';
import { STATUS_KEYS, type OrcStatus } from '../src/types/domain';

function orc(p: Partial<OrcMapInput> & { paneId: string }): OrcMapInput {
  return {
    id: `pane:${p.paneId}`,
    paneId: p.paneId,
    windowIndex: p.windowIndex ?? 0,
    status: p.status ?? 'idle',
  };
}

function within(
  r: { x: number; y: number; w: number; h: number },
  world: { w: number; h: number },
): boolean {
  return (
    r.x >= -0.001 &&
    r.y >= -0.001 &&
    r.x + r.w <= world.w + 0.001 &&
    r.y + r.h <= world.h + 0.001
  );
}

describe('SPEC-301-AC-01 zone partition determinism', () => {
  it('AC-01: zone count = distinct windowIndex, row-major, within world, reproducible', () => {
    const orcs = [
      orc({ paneId: '%1', windowIndex: 2 }),
      orc({ paneId: '%2', windowIndex: 0 }),
      orc({ paneId: '%3', windowIndex: 5 }),
      orc({ paneId: '%4', windowIndex: 0 }),
    ];
    const a = computeLayout(orcs);
    expect(a.windows).toEqual([0, 2, 5]); // ascending distinct
    expect(a.zones.length).toBe(3);
    // row-major order matches ascending windows
    expect(a.zones.map((z) => z.windowIndex)).toEqual([0, 2, 5]);
    expect(a.zones.map((z) => z.zoneIndex)).toEqual([0, 1, 2]);
    // every zone lies inside the derived world (= zone-grid extent, §2.2)
    for (const z of a.zones) expect(within(z.rect, a.dims.world)).toBe(true);
    // world is the grid extent: 3 windows → cols=3, rows=1
    expect(a.dims.cols).toBe(3);
    expect(a.dims.world.w).toBe(3 * ZONE_W + 2 * ZONE_GUTTER);
    expect(a.dims.world.h).toBe(ZONE_H);
    // determinism: identical re-run
    const b = computeLayout(orcs);
    expect([...b.targets.entries()]).toEqual([...a.targets.entries()]);
  });

  it('AC-01: zoneRect is a deterministic, world-origin function of (windowIndex, windows, dims)', () => {
    const windows = [0, 1, 2, 3];
    const dims = mapDims(windows.length);
    expect(zoneRect(2, windows, dims)).toEqual(zoneRect(2, windows, dims));
    // distinct windows occupy distinct cells, all at fixed ZONE_W × ZONE_H
    const rects = windows.map((w) => zoneRect(w, windows, dims));
    const keys = new Set(rects.map((r) => `${r.x},${r.y}`));
    expect(keys.size).toBe(4);
    for (const r of rects) {
      expect(r.w).toBe(ZONE_W);
      expect(r.h).toBe(ZONE_H);
    }
    // first zone is anchored at the world origin
    expect(zoneRect(0, windows, dims)).toEqual({ x: 0, y: 0, w: ZONE_W, h: ZONE_H });
  });
});

describe('SPEC-301-AC-02 station mapping + terminated edge', () => {
  it('AC-02: 7 statuses map to 7 distinct station anchors in a zone', () => {
    const inner = innerRect(zoneRect(0, [0], mapDims(1)));
    const points = STATUS_KEYS.map((s) => stationAnchor(s, inner));
    const keys = new Set(points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
    expect(keys.size).toBe(7);
    // table anchors honored
    expect(STATIONS.active.prop).toBe('workbench');
    expect(STATIONS.terminated.prop).toBe('locked-chest');
    expect(STATIONS.terminated.edge).toBe(true);
  });

  it('AC-02: 7 single-occupant stations do not overlap at ≈209px footprint', () => {
    const inner = innerRect(zoneRect(0, [0], mapDims(1)));
    const points = STATUS_KEYS.map((s) => stationAnchor(s, inner));
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const d = Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y);
        expect(d).toBeGreaterThanOrEqual(SCALED_FOOTPRINT);
      }
    }
  });

  it('AC-02: terminated stacks 1-D along the edge (no centered ring, no corner overflow)', () => {
    const dims = mapDims(1);
    const inner = innerRect(zoneRect(0, [0], dims));
    const o0 = terminatedOffset(0, inner);
    const o1 = terminatedOffset(1, inner);
    const o2 = terminatedOffset(2, inner);
    expect(o0).toEqual({ x: 0, y: 0 }); // first sits on the anchor
    // stack moves along one axis at a time (1-D), inward/upward (negative)
    expect(o1.x).toBeLessThanOrEqual(0);
    expect(o1.y).toBeLessThanOrEqual(0);
    expect(o2).not.toEqual(o1);
    // terminated target is anchored at the (0.95,0.95) corner
    const term = orc({ paneId: '%1', status: 'terminated' });
    const t = targetPosition(term, computeLayout([term]).ctx, dims);
    expect(t).toEqual(stationAnchor('terminated', inner));
  });
});

describe('SPEC-301-AC-03 slot determinism + tmuxTarget reindex invariance', () => {
  it('AC-03: slotRank follows paneId ascending (numeric), not display order', () => {
    const peers = ['%12', '%3', '%100'];
    expect(slotRank('%3', peers)).toBe(0);
    expect(slotRank('%12', peers)).toBe(1);
    expect(slotRank('%100', peers)).toBe(2);
  });

  it('AC-03: same paneId ⇒ same offset; tmuxTarget reindex does NOT move any orc', () => {
    // tmuxTarget is not even an input to layout — placement keys are paneId/windowIndex/status.
    const orcsA = [
      orc({ paneId: '%5', windowIndex: 0, status: 'active' }),
      orc({ paneId: '%9', windowIndex: 0, status: 'active' }),
    ];
    // "reindex" only changes display target/order; same paneIds.
    const orcsB = [orcsA[1]!, orcsA[0]!]; // different array order, identical paneIds
    const a = computeLayout(orcsA);
    const b = computeLayout(orcsB);
    for (const o of orcsA) {
      expect(b.targets.get(o.id)!.target).toEqual(a.targets.get(o.id)!.target);
    }
    // rank0 sits exactly on the station anchor
    const inner = innerRect(zoneRect(0, [0], mapDims(1)));
    expect(a.targets.get('pane:%5')!.target).toEqual(stationAnchor('active', inner));
  });
});

describe('SPEC-301-AC-12 target purity + no server coordinate', () => {
  it('AC-12: targetPosition is pure (repeat calls identical)', () => {
    const o = orc({ paneId: '%7', windowIndex: 1, status: 'waiting' });
    const ctx = computeLayout([o]).ctx;
    const dims = mapDims(1);
    const p1 = targetPosition(o, ctx, dims);
    const p2 = targetPosition(o, ctx, dims);
    expect(p1).toEqual(p2);
  });

  it('AC-12: OrcMapInput carries no x/y/position field', () => {
    const o = orc({ paneId: '%7' });
    expect(Object.keys(o).sort()).toEqual(['id', 'paneId', 'status', 'windowIndex']);
    expect('x' in o).toBe(false);
    expect('y' in o).toBe(false);
    expect('position' in o).toBe(false);
  });
});

describe('SPEC-301-AC-14 geometry feasibility + uniform scale (full-size sprites)', () => {
  it('AC-14a: scaled sprite footprint fits zone inner rect; ring spacing is non-overlapping', () => {
    const inner = innerRect(zoneRect(0, [0], mapDims(1)));
    expect(inner.w).toBeGreaterThan(SCALED_FOOTPRINT);
    expect(inner.h).toBeGreaterThan(SCALED_FOOTPRINT);
    // adjacent slots on the first ring keep at least one footprint of clearance
    const a = slotOffset(1, inner);
    const b = slotOffset(2, inner);
    const chord = Math.hypot(a.x - b.x, a.y - b.y);
    expect(chord).toBeGreaterThanOrEqual(SCALED_FOOTPRINT);
  });

  it('AC-14b: zones are ALWAYS fixed ZONE_W×ZONE_H (=MIN_ZONE); many windows grow the world', () => {
    expect(MIN_ZONE).toEqual({ w: ZONE_W, h: ZONE_H });
    const one = mapDims(1);
    const many = mapDims(16); // 4 cols × 4 rows
    expect(many.cols).toBe(ZONE_COLS_MAX);
    expect(many.zone).toEqual({ w: ZONE_W, h: ZONE_H }); // fixed regardless of count
    // a many-window camp produces a strictly larger world → the viewport scrolls (§2.7)
    expect(many.world.w).toBeGreaterThan(one.world.w);
    expect(many.world.h).toBeGreaterThan(one.world.h);
    expect(many.world.w).toBe(4 * ZONE_W + 3 * ZONE_GUTTER);
    expect(many.world.h).toBe(4 * ZONE_H + 3 * ZONE_GUTTER);
    // every zone inner rect stays non-degenerate (never shrinks below MIN_ZONE)
    const windows = Array.from({ length: 16 }, (_, i) => i);
    for (const w of windows) {
      const zr = zoneRect(w, windows, many);
      expect(zr.w).toBe(ZONE_W);
      expect(zr.h).toBe(ZONE_H);
      const ir = innerRect(zr);
      expect(ir.w).toBeGreaterThan(0);
      expect(ir.h).toBeGreaterThan(0);
    }
  });

  it('AC-14b: cols cap at ZONE_COLS_MAX; few-window camp stays a single row', () => {
    expect(mapDims(3).cols).toBe(3);
    expect(mapDims(3).world.h).toBe(ZONE_H); // single row
    expect(mapDims(7).cols).toBe(ZONE_COLS_MAX); // 7 → 4 cols, 2 rows
    expect(mapDims(7).world.h).toBe(2 * ZONE_H + ZONE_GUTTER);
  });
});

// AC-10 placeholder parity: positions are STRUCTURALLY asset-independent — computeLayout has
// no manifest/background input; MapDims derives only from the window count.
describe('SPEC-301-AC-10 placeholder parity (positions asset-independent)', () => {
  it('AC-10: layout is deterministic and depends only on the window count', () => {
    const orcs: OrcMapInput[] = STATUS_KEYS.map((s: OrcStatus, i) =>
      orc({ paneId: `%${i + 1}`, windowIndex: i % 2, status: s }),
    );
    const a = computeLayout(orcs);
    const b = computeLayout(orcs);
    for (const o of orcs) {
      expect(b.targets.get(o.id)!.target).toEqual(a.targets.get(o.id)!.target);
    }
    // dims are exactly mapDims(distinct window count) — no asset/background influence
    expect(a.dims).toEqual(mapDims(a.windows.length));
  });
});

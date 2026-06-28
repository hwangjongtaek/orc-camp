/**
 * SPEC-301 layout — pure determinism (AC-01/02/03/12/14).
 * No DOM. Position is a function of windowIndex/status/paneId only (INV-1/INV-2).
 */
import { describe, it, expect } from 'vitest';
import {
  computeLayout,
  gridShape,
  innerRect,
  mapDimsFromManifest,
  slotOffset,
  slotRank,
  stationAnchor,
  targetPosition,
  terminatedOffset,
  zoneRect,
  type OrcMapInput,
} from '../src/scene/layout';
import {
  DEFAULT_MAP_DIMS,
  MIN_ZONE_H,
  MIN_ZONE_W,
  SCALED_FOOTPRINT,
  STATIONS,
} from '../src/scene/stations';
import { STATUS_KEYS, type OrcStatus } from '../src/types/domain';

const DIMS = DEFAULT_MAP_DIMS;

function orc(p: Partial<OrcMapInput> & { paneId: string }): OrcMapInput {
  return {
    id: `pane:${p.paneId}`,
    paneId: p.paneId,
    windowIndex: p.windowIndex ?? 0,
    status: p.status ?? 'idle',
  };
}

function within(r: { x: number; y: number; w: number; h: number }, pf = DIMS.playField): boolean {
  return (
    r.x >= pf.x - 0.001 &&
    r.y >= pf.y - 0.001 &&
    r.x + r.w <= pf.x + pf.w + 0.001 &&
    r.y + r.h <= pf.y + pf.h + 0.001
  );
}

describe('SPEC-301-AC-01 zone partition determinism', () => {
  it('AC-01: zone count = distinct windowIndex, row-major, within playField, reproducible', () => {
    const orcs = [
      orc({ paneId: '%1', windowIndex: 2 }),
      orc({ paneId: '%2', windowIndex: 0 }),
      orc({ paneId: '%3', windowIndex: 5 }),
      orc({ paneId: '%4', windowIndex: 0 }),
    ];
    const a = computeLayout(orcs, DIMS);
    expect(a.windows).toEqual([0, 2, 5]); // ascending distinct
    expect(a.zones.length).toBe(3);
    // row-major order matches ascending windows
    expect(a.zones.map((z) => z.windowIndex)).toEqual([0, 2, 5]);
    expect(a.zones.map((z) => z.zoneIndex)).toEqual([0, 1, 2]);
    for (const z of a.zones) expect(within(z.rect)).toBe(true);
    // determinism: identical re-run
    const b = computeLayout(orcs, DIMS);
    expect([...b.targets.entries()]).toEqual([...a.targets.entries()]);
  });

  it('AC-01: zoneRect is a deterministic function of (windowIndex, windows, dims)', () => {
    const windows = [0, 1, 2, 3];
    expect(zoneRect(2, windows, DIMS)).toEqual(zoneRect(2, windows, DIMS));
    // distinct windows occupy distinct cells
    const rects = windows.map((w) => zoneRect(w, windows, DIMS));
    const keys = new Set(rects.map((r) => `${r.x},${r.y}`));
    expect(keys.size).toBe(4);
  });
});

describe('SPEC-301-AC-02 station mapping + terminated edge', () => {
  it('AC-02: 7 statuses map to 7 distinct station anchors in a zone', () => {
    const inner = innerRect(zoneRect(0, [0], DIMS));
    const points = STATUS_KEYS.map((s) => stationAnchor(s, inner));
    const keys = new Set(points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
    expect(keys.size).toBe(7);
    // table anchors honored
    expect(STATIONS.active.prop).toBe('workbench');
    expect(STATIONS.terminated.prop).toBe('locked-chest');
    expect(STATIONS.terminated.edge).toBe(true);
  });

  it('AC-02: terminated stacks 1-D along the edge (no centered ring, no corner overflow)', () => {
    const inner = innerRect(zoneRect(0, [0], DIMS));
    const o0 = terminatedOffset(0, inner);
    const o1 = terminatedOffset(1, inner);
    const o2 = terminatedOffset(2, inner);
    expect(o0).toEqual({ x: 0, y: 0 }); // first sits on the anchor
    // stack moves along one axis at a time (1-D), inward/upward (negative)
    expect(o1.x).toBeLessThanOrEqual(0);
    expect(o1.y).toBeLessThanOrEqual(0);
    expect(o2).not.toEqual(o1);
    // terminated target is anchored at the (0.95,0.95) corner
    const t = targetPosition(orc({ paneId: '%1', status: 'terminated' }), computeLayout([orc({ paneId: '%1', status: 'terminated' })], DIMS).ctx, DIMS);
    const anchor = stationAnchor('terminated', inner);
    expect(t).toEqual(anchor);
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
    const a = computeLayout(orcsA, DIMS);
    const b = computeLayout(orcsB, DIMS);
    for (const o of orcsA) {
      expect(b.targets.get(o.id)!.target).toEqual(a.targets.get(o.id)!.target);
    }
    // rank0 sits exactly on the station anchor
    const inner = innerRect(zoneRect(0, [0], DIMS));
    expect(a.targets.get('pane:%5')!.target).toEqual(stationAnchor('active', inner));
  });
});

describe('SPEC-301-AC-12 target purity + no server coordinate', () => {
  it('AC-12: targetPosition is pure (repeat calls identical)', () => {
    const o = orc({ paneId: '%7', windowIndex: 1, status: 'waiting' });
    const ctx = computeLayout([o], DIMS).ctx;
    const p1 = targetPosition(o, ctx, DIMS);
    const p2 = targetPosition(o, ctx, DIMS);
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

describe('SPEC-301-AC-14 geometry feasibility + uniform scale', () => {
  it('AC-14a: scaled sprite footprint fits zone inner rect; ring spacing is non-overlapping', () => {
    const inner = innerRect(zoneRect(0, [0], DIMS));
    expect(inner.w).toBeGreaterThan(SCALED_FOOTPRINT);
    expect(inner.h).toBeGreaterThan(SCALED_FOOTPRINT);
    // adjacent slots on the first ring keep at least one footprint of clearance
    const a = slotOffset(1, inner);
    const b = slotOffset(2, inner);
    const chord = Math.hypot(a.x - b.x, a.y - b.y);
    expect(chord).toBeGreaterThanOrEqual(SCALED_FOOTPRINT);
  });

  it('AC-14b: many-window camp (rows≥4) triggers scroll with non-degenerate MIN_ZONE cells', () => {
    const shape = gridShape(16, DIMS); // 4 cols × 4 rows
    expect(shape.cols).toBe(4);
    expect(shape.rows).toBe(4);
    expect(shape.scroll).toBe(true);
    expect(shape.cw).toBeGreaterThanOrEqual(MIN_ZONE_W);
    expect(shape.ch).toBeGreaterThanOrEqual(MIN_ZONE_H);
    // play-field grows vertically to host the grid (scroll commitment, §2.2)
    expect(shape.field.h).toBeGreaterThan(DIMS.playField.h);
    // each zone inner rect remains non-degenerate
    const windows = Array.from({ length: 16 }, (_, i) => i);
    for (const w of windows) {
      const ir = innerRect(zoneRect(w, windows, DIMS));
      expect(ir.w).toBeGreaterThan(0);
      expect(ir.h).toBeGreaterThan(0);
    }
  });

  it('AC-14b: few-window camp does not scroll and stays inside the play-field', () => {
    const shape = gridShape(3, DIMS);
    expect(shape.scroll).toBe(false);
    expect(shape.field).toEqual({ ...DIMS.playField, w: DIMS.playField.w, h: DIMS.playField.h });
  });

  it('mapDimsFromManifest falls back to spec defaults when background is absent', () => {
    expect(mapDimsFromManifest(null)).toEqual(DEFAULT_MAP_DIMS);
    const dims = mapDimsFromManifest({
      characters: {},
      backgrounds: {
        'warbase-sunset-dashboard': { logical_size: [1672, 941], safe_area: [390, 520, 890, 330] },
      },
    });
    expect(dims).toEqual(DEFAULT_MAP_DIMS);
  });
});

// AC-10 placeholder parity is partly a pure assertion: asset-present dims == asset-absent dims.
describe('SPEC-301-AC-10 placeholder parity (positions asset-independent)', () => {
  it('AC-10: zone/station/slot targets are identical with and without background asset', () => {
    const orcs: OrcMapInput[] = STATUS_KEYS.map((s: OrcStatus, i) =>
      orc({ paneId: `%${i + 1}`, windowIndex: i % 2, status: s }),
    );
    const noAsset = computeLayout(orcs, mapDimsFromManifest(null));
    const withAsset = computeLayout(
      orcs,
      mapDimsFromManifest({
        characters: {},
        backgrounds: {
          'warbase-sunset-dashboard': { logical_size: [1672, 941], safe_area: [390, 520, 890, 330] },
        },
      }),
    );
    for (const o of orcs) {
      expect(withAsset.targets.get(o.id)!.target).toEqual(noAsset.targets.get(o.id)!.target);
    }
  });
});

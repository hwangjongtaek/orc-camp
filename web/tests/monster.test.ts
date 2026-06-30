/**
 * SPEC-303 (Phase 1) — epic monster NPC motion + variant resolution.
 * Pure/deterministic: continuous polygon roam, footprint stays in the polygon, reduced-motion
 * snaps to a static spot, and resolution is status-gated (2-step forward link / reverse lookup).
 */
import { describe, it, expect } from 'vitest';
import {
  MonsterController,
  monsterWaypoint,
  buildMonsterLoop,
  pingpongIndex,
  footprintInPolygon,
  avoidOrcs,
  resolveMonsterVariant,
  MONSTER_LEG_MS,
  MONSTER_STEP_MAX,
  MONSTER_FOOTPRINT_RATIO,
  MONSTER_FOOTPRINT_ASPECT,
  ORC_AVOID_RADIUS,
  MONSTER_AVOID_FOOTPRINT_FACTOR,
  MONSTER_AVOID_PUSH_MAX,
  monsterScaleFor,
} from '../src/scene/monster';
import { pointInPolygon, type GroundContext } from '../src/scene/ground';
import { DIRECTIONS } from '../src/scene/direction';
import type { AssetManifest, MonsterDef } from '../src/assets/manifest';

// Default orccamp-default ground (logical px).
const POLY: { x: number; y: number }[] = (
  [[1080, 910], [2400, 910], [3000, 1380], [2660, 1800], [880, 1800], [580, 1270]] as [number, number][]
).map(([x, y]) => ({ x, y }));
const GROUND: GroundContext = {
  world: { w: 3344, h: 1882 },
  safeArea: { x: 1080, y: 950, w: 1320, h: 800 },
  polygon: POLY,
};
const FRAME = 256;
const SCALE = 1.4;
const halfW = (FRAME * SCALE * MONSTER_FOOTPRINT_RATIO) / 2;
const halfH = halfW * MONSTER_FOOTPRINT_ASPECT;

function monsterDef(over: Partial<MonsterDef> = {}): MonsterDef {
  return {
    display_name: 'Mosshide Behemoth',
    status: 'available',
    pixellab_character_id: 'abc',
    background: 'orccamp-default',
    root: 'sprites/monsters/monster-mosshide-behemoth',
    frame_size: [256, 256],
    anchor: [128, 186],
    animations: {
      roaming: { frames: 9, fps: 8, frame_pattern: 'frame_%03d.png', folders: { south: 'animations/roaming/south' } },
    },
    ...over,
  };
}

function manifest(over: Partial<AssetManifest> = {}): AssetManifest {
  return {
    characters: {},
    backgrounds: { 'orccamp-default': { epic_monster: 'monster-mosshide-behemoth' } },
    monsters: { 'monster-mosshide-behemoth': monsterDef() },
    ...over,
  } as AssetManifest;
}

describe('SPEC-303 Phase 1 — resolveMonsterVariant', () => {
  it('resolves the forward backgrounds.<bg>.epic_monster link', () => {
    const r = resolveMonsterVariant(manifest(), 'orccamp-default');
    expect(r?.key).toBe('monster-mosshide-behemoth');
  });

  it('falls back to reverse lookup (monsters[k].background) when no forward link', () => {
    const m = manifest({ backgrounds: { 'orccamp-default': {} } });
    const r = resolveMonsterVariant(m, 'orccamp-default');
    expect(r?.key).toBe('monster-mosshide-behemoth'); // matched via .background
  });

  it('gates on status:"available" + a set pixellab_character_id (else not rendered)', () => {
    expect(resolveMonsterVariant(manifest({ monsters: { 'monster-mosshide-behemoth': monsterDef({ status: 'planned' }) } }), 'orccamp-default')).toBeNull();
    expect(resolveMonsterVariant(manifest({ monsters: { 'monster-mosshide-behemoth': monsterDef({ pixellab_character_id: null }) } }), 'orccamp-default')).toBeNull();
  });

  it('returns null with no monsters block, no bg ref, or an unknown bg', () => {
    expect(resolveMonsterVariant({ characters: {} } as AssetManifest, 'orccamp-default')).toBeNull();
    expect(resolveMonsterVariant(manifest(), null)).toBeNull();
    expect(resolveMonsterVariant(manifest(), 'sunscorch-camp')).toBeNull();
  });
});

describe('SPEC-303 Phase 1 — MonsterController roam', () => {
  it('returns null until synced with a monster + ground', () => {
    const c = new MonsterController();
    expect(c.snapshot(0)).toBeNull();
    c.sync(null, GROUND, FRAME, SCALE, 0, { reducedMotion: false });
    expect(c.snapshot(0)).toBeNull();
    c.sync('monster-mosshide-behemoth', null, FRAME, SCALE, 0, { reducedMotion: false });
    expect(c.snapshot(0)).toBeNull();
  });

  it('is deterministic: same (key, polygon, t) ⇒ identical snapshot', () => {
    const a = new MonsterController();
    const b = new MonsterController();
    a.sync('m', GROUND, FRAME, SCALE, 0, { reducedMotion: false });
    b.sync('m', GROUND, FRAME, SCALE, 0, { reducedMotion: false });
    for (const t of [0, 1234, MONSTER_LEG_MS * 2.5, 999999]) {
      expect(a.snapshot(t)).toEqual(b.snapshot(t));
    }
  });

  it('always plays roaming, faces a valid 8-direction, and keeps tEnter constant', () => {
    const c = new MonsterController();
    c.sync('m', GROUND, FRAME, SCALE, 1000, { reducedMotion: false });
    for (const t of [1000, 3000, 1000 + MONSTER_LEG_MS, 1000 + MONSTER_LEG_MS * 3.2]) {
      const s = c.snapshot(t)!;
      expect(s.movementState).toBe('roaming');
      expect(DIRECTIONS).toContain(s.direction);
      expect(s.tEnter).toBe(1000); // constant ⇒ continuous walk-cycle phase
    }
  });

  it('keeps the footprint inside the polygon across the whole roam', () => {
    const c = new MonsterController();
    c.sync('m', GROUND, FRAME, SCALE, 0, { reducedMotion: false });
    for (let t = 0; t <= MONSTER_LEG_MS * 12; t += 137) {
      const p = c.snapshot(t)!.renderedPos;
      expect(footprintInPolygon(p, POLY, halfW, halfH)).toBe(true);
    }
  });

  it('reduced-motion: a single static in-polygon spot, no movement over time', () => {
    const c = new MonsterController();
    c.sync('m', GROUND, FRAME, SCALE, 0, { reducedMotion: true });
    const s0 = c.snapshot(0)!;
    expect(s0.movementState).toBe('arrived');
    expect(pointInPolygon(s0.renderedPos, POLY)).toBe(true);
    expect(c.snapshot(50_000)!.renderedPos).toEqual(s0.renderedPos); // frozen
  });

  it('preserves the roam-loop start across same-scene re-syncs (no teleport)', () => {
    const c = new MonsterController();
    c.sync('m', GROUND, FRAME, SCALE, 1000, { reducedMotion: false });
    const before = c.snapshot(4000)!;
    c.sync('m', GROUND, FRAME, SCALE, 3000, { reducedMotion: false }); // re-sync (same key+polygon)
    expect(c.snapshot(4000)).toEqual(before); // t0 preserved
  });
});

describe('SPEC-303 Phase 1 — waypoint + scale helpers', () => {
  const bbox = { x: 580, y: 910, w: 2420, h: 890 };
  it('monsterWaypoint is deterministic and footprint-feasible', () => {
    for (let k = 0; k < 20; k += 1) {
      const w1 = monsterWaypoint(123, POLY, bbox, GROUND.safeArea, k, halfW, halfH);
      const w2 = monsterWaypoint(123, POLY, bbox, GROUND.safeArea, k, halfW, halfH);
      expect(w1).toEqual(w2);
      expect(footprintInPolygon(w1, POLY, halfW, halfH)).toBe(true);
    }
  });

  it('necropolis uses a reduced render scale; others the default', () => {
    expect(monsterScaleFor('necropolis-camp')).toBeLessThan(monsterScaleFor('orccamp-default'));
    expect(monsterScaleFor('orccamp-default')).toBe(2.24);
  });
});

describe('SPEC-303 Phase 1 — short legs (bounded step) + ping-pong loop', () => {
  const bbox = { x: 580, y: 910, w: 2420, h: 890 };
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  it('builds a loop whose consecutive waypoints are short (≤ MONSTER_STEP_MAX) and in-polygon', () => {
    const loop = buildMonsterLoop(42, POLY, bbox, GROUND.safeArea, halfW, halfH);
    expect(loop.length).toBeGreaterThan(8);
    for (let i = 1; i < loop.length; i += 1) {
      expect(dist(loop[i]!, loop[i - 1]!)).toBeLessThanOrEqual(MONSTER_STEP_MAX + 1e-6);
      expect(footprintInPolygon(loop[i]!, POLY, halfW, halfH)).toBe(true);
    }
  });

  it('controller never moves more than one short step per leg (no map-spanning treks)', () => {
    const c = new MonsterController();
    c.sync('m', GROUND, FRAME, SCALE, 0, { reducedMotion: false });
    let prev = c.snapshot(0)!.renderedPos;
    for (let n = 1; n <= 60; n += 1) {
      const pos = c.snapshot(n * MONSTER_LEG_MS)!.renderedPos; // leg-boundary positions
      expect(dist(pos, prev)).toBeLessThanOrEqual(MONSTER_STEP_MAX + 1e-6);
      prev = pos;
    }
  });

  it('pingpongIndex bounces 0..P-1..0 with consecutive indices differing by ≤ 1', () => {
    const P = 5;
    const seq = Array.from({ length: 14 }, (_, n) => pingpongIndex(n, P));
    expect(seq.slice(0, 9)).toEqual([0, 1, 2, 3, 4, 3, 2, 1, 0]); // forward then back
    for (let i = 1; i < seq.length; i += 1) expect(Math.abs(seq[i]! - seq[i - 1]!)).toBeLessThanOrEqual(1);
  });
});

describe('SPEC-303 Phase 1 — orc avoidance (no overlap)', () => {
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const center = { x: 1740, y: 1350 }; // deep inside the default polygon (safe_area centre)
  const minSep = halfW * MONSTER_AVOID_FOOTPRINT_FACTOR + ORC_AVOID_RADIUS; // narrowed clearance
  const expectedClear = Math.min(minSep, MONSTER_AVOID_PUSH_MAX); // sidestep is capped

  it('avoidOrcs pushes the monster aside (capped) when an orc is on top of it', () => {
    const out = avoidOrcs(center, [center], minSep, MONSTER_AVOID_PUSH_MAX, POLY, halfW, halfH);
    expect(dist(out, center)).toBeGreaterThan(expectedClear - 1);
    expect(dist(out, center)).toBeLessThanOrEqual(MONSTER_AVOID_PUSH_MAX + 1e-6); // gentle, capped
    expect(footprintInPolygon(out, POLY, halfW, halfH)).toBe(true);
  });

  it('a far orc has no effect; a near orc is partially pushed away', () => {
    expect(avoidOrcs(center, [{ x: center.x + 9999, y: center.y }], minSep, MONSTER_AVOID_PUSH_MAX, POLY, halfW, halfH)).toEqual(center);
    const near = { x: center.x + minSep * 0.5, y: center.y };
    const out = avoidOrcs(center, [near], minSep, MONSTER_AVOID_PUSH_MAX, POLY, halfW, halfH);
    expect(dist(out, near)).toBeGreaterThan(dist(center, near)); // moved further from the orc
    expect(out.x).toBeLessThan(center.x); // pushed away from the orc (which is to the +x side)
  });

  it('avoidance is NARROW: an orc just outside the clearance is ignored', () => {
    const just = { x: center.x + minSep + 5, y: center.y }; // 5px beyond the clearance
    expect(avoidOrcs(center, [just], minSep, MONSTER_AVOID_PUSH_MAX, POLY, halfW, halfH)).toEqual(center);
  });

  it('controller.snapshot(t, orcCenters) steers away and never overlaps more (stays in-polygon)', () => {
    const c = new MonsterController();
    c.sync('m', GROUND, FRAME, SCALE, 0, { reducedMotion: false });
    for (const t of [800, 2000, MONSTER_LEG_MS * 2 + 400]) {
      const base = c.snapshot(t)!.renderedPos; // bare path
      const orc = { x: base.x + 30, y: base.y + 12 }; // a near orc (inside the clearance disc)
      const avoided = c.snapshot(t, [orc])!.renderedPos; // with the orc
      // Avoidance never moves the monster CLOSER to the orc, and keeps the footprint in-polygon.
      expect(dist(avoided, orc)).toBeGreaterThanOrEqual(dist(base, orc) - 1e-6);
      expect(footprintInPolygon(avoided, POLY, halfW, halfH)).toBe(true);
    }
  });

  it('still deterministic with an orc stream (same inputs ⇒ same output)', () => {
    const a = new MonsterController();
    const b = new MonsterController();
    a.sync('m', GROUND, FRAME, SCALE, 0, { reducedMotion: false });
    b.sync('m', GROUND, FRAME, SCALE, 0, { reducedMotion: false });
    const orcs = [{ x: 1700, y: 1300 }, { x: 1820, y: 1400 }];
    for (const t of [500, 2500, MONSTER_LEG_MS * 3 + 100]) {
      expect(a.snapshot(t, orcs)).toEqual(b.snapshot(t, orcs));
    }
  });
});

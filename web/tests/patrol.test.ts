/**
 * SPEC-301 §3.1-10 — active patrol path + non-active rest (pure, deterministic).
 */
import { describe, it, expect } from 'vitest';
import { patrolAt, patrolWaypoint, restOffset } from '../src/scene/patrol';
import { dist } from '../src/scene/layout';
import {
  PATROL_MARGIN,
  PATROL_MIN_BAND,
  PATROL_R_MAX,
  PATROL_R_MIN,
  REST_R,
  type Rect,
  type Vec2,
} from '../src/scene/stations';
import { DIRECTIONS } from '../src/scene/direction';

const home: Vec2 = { x: 1000, y: 600 };

describe('patrolWaypoint', () => {
  it('waypoint 0 is the home post (so the cycle starts where the orc arrived)', () => {
    expect(patrolWaypoint(home, 12345, 0)).toEqual(home);
  });

  it('waypoints k≥1 sit on the seeded ring [PATROL_R_MIN, PATROL_R_MAX] around home', () => {
    for (let k = 1; k < 12; k += 1) {
      const wp = patrolWaypoint(home, 999, k);
      const r = dist(wp, home);
      expect(r).toBeGreaterThanOrEqual(PATROL_R_MIN - 1e-6);
      expect(r).toBeLessThanOrEqual(PATROL_R_MAX + 1e-6);
    }
  });

  it('is deterministic (same args → same point)', () => {
    expect(patrolWaypoint(home, 7, 3)).toEqual(patrolWaypoint(home, 7, 3));
  });

  it('clamps into a tight walkable bound (sprite stays in-bounds)', () => {
    const bound: Rect = { x: 980, y: 580, w: 60, h: 60 };
    for (let k = 1; k < 8; k += 1) {
      const wp = patrolWaypoint(home, 42, k, bound, 0);
      expect(wp.x).toBeGreaterThanOrEqual(bound.x - 1e-6);
      expect(wp.x).toBeLessThanOrEqual(bound.x + bound.w + 1e-6);
      expect(wp.y).toBeGreaterThanOrEqual(bound.y - 1e-6);
      expect(wp.y).toBeLessThanOrEqual(bound.y + bound.h + 1e-6);
    }
  });

  it('§2.4b cell-collapse fix — a sub-footprint cell still yields a VISIBLE patrol span', () => {
    // A crowded/narrowed camp gives each orc a cell smaller than 2×PATROL_MARGIN (≈209). With the
    // old fixed-margin clamp every waypoint collapsed onto the cell centre → the orc froze. The
    // adaptive clamp floors the reachable band at ±PATROL_MIN_BAND, so motion stays visible.
    const cellW = 200; // < 2×PATROL_MARGIN ⇒ the old clamp would invert and collapse
    const cellH = 200;
    const center: Vec2 = { x: 1000, y: 600 };
    const bound: Rect = { x: center.x - cellW / 2, y: center.y - cellH / 2, w: cellW, h: cellH };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let k = 1; k < 24; k += 1) {
      const wp = patrolWaypoint(center, 7, k, bound, PATROL_MARGIN);
      minX = Math.min(minX, wp.x); maxX = Math.max(maxX, wp.x);
      minY = Math.min(minY, wp.y); maxY = Math.max(maxY, wp.y);
    }
    // The reachable band is at least ±PATROL_MIN_BAND on each axis (not a frozen point).
    expect(maxX - minX).toBeGreaterThanOrEqual(PATROL_MIN_BAND);
    expect(maxY - minY).toBeGreaterThanOrEqual(PATROL_MIN_BAND);
  });

  it('a COMFORTABLE cell keeps the strict half-footprint clamp (no overlap, unchanged)', () => {
    // Cell big enough to hold the full ring + footprint inset → identical to the natural ring,
    // clamped to [margin, w-margin]: the no-overlap contract for spacious camps is untouched.
    const bound: Rect = { x: 500, y: 500, w: 900, h: 900 };
    const center: Vec2 = { x: 950, y: 950 };
    for (let k = 1; k < 12; k += 1) {
      const wp = patrolWaypoint(center, 99, k, bound, PATROL_MARGIN);
      expect(wp.x).toBeGreaterThanOrEqual(bound.x + PATROL_MARGIN - 1e-6);
      expect(wp.x).toBeLessThanOrEqual(bound.x + bound.w - PATROL_MARGIN + 1e-6);
      expect(wp.y).toBeGreaterThanOrEqual(bound.y + PATROL_MARGIN - 1e-6);
      expect(wp.y).toBeLessThanOrEqual(bound.y + bound.h - PATROL_MARGIN + 1e-6);
    }
  });
});

describe('patrolAt (roam ↔ active-dwell loop)', () => {
  it('at the arrival instant the orc dwells at home, anim from frame 0', () => {
    const f = patrolAt(home, '%1', 0, 0);
    expect(f.moving).toBe(false);
    expect(f.pos).toEqual(home);
    expect(DIRECTIONS).toContain(f.direction); // dwell faces a valid 8-direction (#50)
    expect(f.tEnter).toBe(0); // dwell entered at arrivalT → frameAt anchors to frame 0
  });

  it('§3.1-10 (#50) dwell faces a RANDOM (seeded) direction — not always south', () => {
    // Sample the facing at the start of many dwell cycles; it should vary across directions.
    const dirs = new Set<string>();
    for (let t = 0; t <= 120000; t += 50) {
      const f = patrolAt(home, '%4', 0, t);
      if (!f.moving) dirs.add(f.direction);
    }
    expect(dirs.size).toBeGreaterThan(1); // multiple distinct dwell facings (not just south)
    for (const d of dirs) expect(DIRECTIONS).toContain(d);
  });

  it('eventually roams (a walk leg) with a valid 8-direction facing', () => {
    let sawRoam = false;
    for (let t = 0; t <= 12000; t += 50) {
      const f = patrolAt(home, '%7', 0, t);
      if (f.moving) {
        sawRoam = true;
        expect(DIRECTIONS).toContain(f.direction);
      }
    }
    expect(sawRoam).toBe(true);
  });

  it('the path is continuous — consecutive ticks never teleport', () => {
    let prev = patrolAt(home, '%3', 0, 0).pos;
    for (let t = 10; t <= 20000; t += 10) {
      const pos = patrolAt(home, '%3', 0, t).pos;
      expect(dist(prev, pos)).toBeLessThan(15); // ≤ max patrol speed × 10ms (+ slack)
      prev = pos;
    }
  });

  it('is pure: same (paneId, arrivalT, t) → equal frame, fresh object', () => {
    const a = patrolAt(home, '%9', 0, 4321);
    const b = patrolAt(home, '%9', 0, 4321);
    expect(b.pos).toEqual(a.pos);
    expect(b.moving).toBe(a.moving);
    expect(b).not.toBe(a);
  });

  it('desyncs the fleet — two orcs are not in lockstep', () => {
    let differ = false;
    for (let t = 0; t <= 12000; t += 100) {
      const a = patrolAt(home, '%1', 0, t);
      const b = patrolAt(home, '%2', 0, t);
      if (a.moving !== b.moving) differ = true; // one walks while the other dwells ⇒ desynced
    }
    expect(differ).toBe(true);
  });
});

describe('restOffset (non-active seeded rest)', () => {
  it('is deterministic, bounded in REST_R, and off-centre (never exactly on the slot)', () => {
    const o = restOffset('%5');
    expect(restOffset('%5')).toEqual(o);
    const r = Math.hypot(o.x, o.y);
    expect(r).toBeGreaterThan(0.3 * REST_R);
    expect(r).toBeLessThanOrEqual(REST_R + 1e-6);
  });

  it('scatters different orcs to different spots', () => {
    expect(restOffset('%5')).not.toEqual(restOffset('%6'));
  });
});

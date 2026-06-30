/**
 * SPEC-301 §3.1-10 — active patrol path + non-active rest (pure, deterministic).
 */
import { describe, it, expect } from 'vitest';
import { patrolAt, patrolWaypoint, restOffset } from '../src/scene/patrol';
import { dist } from '../src/scene/layout';
import {
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

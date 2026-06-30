/**
 * SPEC-301 roaming controller + shared clock (AC-04/07/13).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RoamingController } from '../src/scene/roaming';
import { quantizeVector } from '../src/scene/direction';
import { dist } from '../src/scene/layout';
import { PATROL_R_MAX } from '../src/scene/stations';
import {
  __setClockDriverForTest,
  frameAt,
  isRunning,
  listenerCount,
  subscribe,
} from '../src/scene/clock';

const posIdle = { x: 100, y: 100 };
const posActive = { x: 400, y: 100 };

describe('SPEC-301-AC-04 roaming entry on status change + arrival', () => {
  it('AC-04: target change → roaming walk-cycle; arrival → status anim facing south', () => {
    const c = new RoamingController();
    c.sync([{ id: 'a', status: 'idle', target: posIdle }], 0, { reducedMotion: false });
    let s = c.snapshot('a', 0)!;
    expect(s.movementState).toBe('arrived');
    expect(s.displayedState).toBe('idle');
    expect(s.renderedPos).toEqual(posIdle);

    // status idle→active moves the target → roaming entered (no separate signal, INV-1)
    c.sync([{ id: 'a', status: 'active', target: posActive }], 1000, { reducedMotion: false });
    s = c.snapshot('a', 1000)!;
    expect(s.movementState).toBe('roaming');
    expect(s.displayedState).toBe('roaming');
    expect(s.direction).toBe(quantizeVector(posActive.x - posIdle.x, posActive.y - posIdle.y));
    expect(s.renderedPos.x).toBeCloseTo(posIdle.x, 1); // tween starts at current pos

    // far in the future → arrived at target, status animation, facing south
    const s2 = c.snapshot('a', 1000 + 5000)!;
    expect(s2.movementState).toBe('arrived');
    expect(s2.displayedState).toBe('active');
    expect(s2.direction).toBe('south');
    expect(s2.renderedPos).toEqual(posActive);
  });

  it('AC-04: mid-walk retarget continues from current position (no teleport)', () => {
    const c = new RoamingController();
    c.sync([{ id: 'a', status: 'idle', target: posIdle }], 0, { reducedMotion: false });
    c.sync([{ id: 'a', status: 'active', target: posActive }], 0, { reducedMotion: false });
    const mid = c.snapshot('a', 500)!; // somewhere along the walk
    expect(mid.movementState).toBe('roaming');
    // retarget to a third station while still walking
    const posErr = { x: 250, y: 300 };
    c.sync([{ id: 'a', status: 'error', target: posErr }], 500, { reducedMotion: false });
    const after = c.snapshot('a', 500)!;
    // new tween starts from the mid position, not from the original station
    expect(after.renderedPos.x).toBeCloseTo(mid.renderedPos.x, 0);
    expect(after.renderedPos.y).toBeCloseTo(mid.renderedPos.y, 0);
    expect(after.movementState).toBe('roaming');
  });
});

describe('SPEC-301-AC-07 reduced-motion snap', () => {
  it('AC-07: reduced-motion snaps to target instantly with no roaming', () => {
    const c = new RoamingController();
    c.sync([{ id: 'a', status: 'idle', target: posIdle }], 0, { reducedMotion: true });
    expect(c.snapshot('a', 0)!.movementState).toBe('arrived');
    // status change still snaps (no walk cycle)
    c.sync([{ id: 'a', status: 'active', target: posActive }], 100, { reducedMotion: true });
    const s = c.snapshot('a', 100)!;
    expect(s.movementState).toBe('arrived');
    expect(s.renderedPos).toEqual(posActive);
    // even a tiny moment later it never enters roaming
    expect(c.snapshot('a', 101)!.movementState).toBe('arrived');
  });

  it('AC-07/§3.1-5: terminated snaps statically (no roaming interpolation)', () => {
    const c = new RoamingController();
    c.sync([{ id: 'a', status: 'active', target: posActive }], 0, { reducedMotion: false });
    c.sync([{ id: 'a', status: 'terminated', target: posIdle }], 50, { reducedMotion: false });
    const s = c.snapshot('a', 50)!;
    expect(s.movementState).toBe('arrived');
    expect(s.renderedPos).toEqual(posIdle);
  });
});

describe('SPEC-301 §3.1-10 active patrol + non-active rest (opt-in)', () => {
  it('active orc patrols: dwells at its post then roams, looping (patrol ON)', () => {
    const c = new RoamingController({ patrol: true });
    c.sync([{ id: 'a', status: 'active', target: posActive }], 0, { reducedMotion: false });
    // At the arrival instant it dwells at its post (plays the active anim).
    const s0 = c.snapshot('a', 0)!;
    expect(s0.movementState).toBe('arrived');
    expect(s0.displayedState).toBe('active');
    expect(s0.renderedPos).toEqual(posActive);
    // Across a patrol window it both roams and leaves its post (does not stand still).
    let roamed = false;
    let movedAway = false;
    for (let t = 0; t <= 12000; t += 100) {
      const s = c.snapshot('a', t)!;
      if (s.movementState === 'roaming') roamed = true;
      if (Math.hypot(s.renderedPos.x - posActive.x, s.renderedPos.y - posActive.y) > 1) {
        movedAway = true;
      }
    }
    expect(roamed).toBe(true);
    expect(movedAway).toBe(true);
  });

  it('default controller (patrol OFF) keeps an active orc parked at its post', () => {
    const c = new RoamingController();
    c.sync([{ id: 'a', status: 'active', target: posActive }], 0, { reducedMotion: false });
    expect(c.snapshot('a', 9000)!.renderedPos).toEqual(posActive);
    expect(c.snapshot('a', 9000)!.movementState).toBe('arrived');
  });

  it('non-active orc rests at a seeded spot off its slot, but never drifts (patrol ON)', () => {
    const c = new RoamingController({ patrol: true });
    c.sync([{ id: 'a', status: 'waiting', target: posIdle }], 0, { reducedMotion: false });
    const s1 = c.snapshot('a', 1000)!;
    const s2 = c.snapshot('a', 9000)!;
    expect(s1.movementState).toBe('arrived');
    expect(s1.displayedState).toBe('waiting');
    expect(s1.renderedPos).not.toEqual(posIdle); // seeded rest displacement applied
    expect(s2.renderedPos).toEqual(s1.renderedPos); // …but it holds that spot (no drift)
  });

  it('reduced-motion disables patrol AND rest (snap to the exact target)', () => {
    const c = new RoamingController({ patrol: true });
    c.sync([{ id: 'a', status: 'active', target: posActive }], 0, { reducedMotion: true });
    expect(c.snapshot('a', 5000)!.renderedPos).toEqual(posActive);
    expect(c.snapshot('a', 5000)!.movementState).toBe('arrived');
    c.sync([{ id: 'b', status: 'waiting', target: posIdle }], 0, { reducedMotion: true });
    expect(c.snapshot('b', 5000)!.renderedPos).toEqual(posIdle);
  });
});

describe('SPEC-301-AC-13 single shared clock + state-entry anchored phase', () => {
  beforeEach(() => {
    __setClockDriverForTest({ raf: () => 1, caf: () => {} });
  });

  it('AC-13a: many subscribers share ONE rAF loop (no per-sprite timers)', () => {
    let rafCalls = 0;
    __setClockDriverForTest({
      raf: () => {
        rafCalls += 1;
        return 1;
      },
      caf: () => {},
    });
    const u1 = subscribe(() => {});
    const u2 = subscribe(() => {});
    const u3 = subscribe(() => {});
    expect(listenerCount()).toBe(3);
    expect(isRunning()).toBe(true);
    // Only the first subscribe starts the loop; extra subscribers do not schedule rAF.
    expect(rafCalls).toBe(1);
    u1();
    u2();
    u3();
    expect(isRunning()).toBe(false); // loop stops when the last subscriber leaves
  });

  it('AC-13b: frameAt is state-entry anchored — transition→frame 0, hold→phase preserved', () => {
    // transition: tEnter == t → frame 0
    expect(frameAt(1000, 1000, 8, 7)).toBe(0);
    // hold: same tEnter, time advances → phase advances (not forced to 0)
    expect(frameAt(1000 + 1000, 1000, 8, 7)).toBe((Math.floor((1000 * 8) / 1000)) % 7);
    expect(frameAt(1000 + 1000, 1000, 8, 7)).not.toBe(0);
    // single-frame / zero fps → frame 0
    expect(frameAt(5000, 0, 8, 1)).toBe(0);
  });

  it('AC-13b: arrival sets tEnter so the status anim starts at frame 0, then preserves phase', () => {
    const c = new RoamingController();
    c.sync([{ id: 'a', status: 'idle', target: posIdle }], 0, { reducedMotion: false });
    c.sync([{ id: 'a', status: 'active', target: posActive }], 0, { reducedMotion: false });
    const arrived = c.snapshot('a', 100000)!; // long after arrival
    expect(arrived.movementState).toBe('arrived');
    const tEnter = arrived.tEnter;
    // active starts at frame 0 at the entry instant
    expect(frameAt(tEnter, tEnter, 8, 7)).toBe(0);
    // a later identical-status sync does NOT reset tEnter (phase preserved, AC-13b)
    c.sync([{ id: 'a', status: 'active', target: posActive }], 200000, { reducedMotion: false });
    const held = c.snapshot('a', 200000)!;
    expect(held.tEnter).toBe(tEnter);
  });
});

describe('SPEC-301 §3.1-11 place() — drag-drop drop snaps the orc + resumes status behavior', () => {
  const drop = { x: 700, y: 500 };

  it('snaps to the drop instantly (no walk-back) and a same-home sync is a no-op', () => {
    const c = new RoamingController(); // no patrol/wander → renderedPos is the exact target
    c.sync([{ id: 'a', status: 'waiting', target: posIdle }], 0, { reducedMotion: false });

    c.place('a', drop, 1000);
    const s = c.snapshot('a', 1000)!;
    expect(s.movementState).toBe('arrived'); // snapped, not roaming
    expect(s.renderedPos).toEqual(drop); // exact drop (no walk tween, no jitter)
    expect(s.status).toBe('waiting'); // status preserved across the place

    // the subsequent sync with the new home (= drop) must NOT start a walk (target unchanged)
    c.sync([{ id: 'a', status: 'waiting', target: drop }], 1000, { reducedMotion: false });
    expect(c.snapshot('a', 1000)!.movementState).toBe('arrived');
  });

  it('a dropped ACTIVE orc patrols AROUND the drop (never reverts toward its old cell)', () => {
    // patrol + wander ON, and the orc had a SMALL old cell bound far from the drop — the previous
    // bug clamped patrol into that old cell, reverting the orc toward its pre-drag home.
    const c = new RoamingController({ patrol: true, ambientWander: true });
    c.sync(
      [{ id: 'a', status: 'active', target: posIdle, bound: { x: 80, y: 80, w: 60, h: 60 } }],
      0,
      { reducedMotion: false },
    );
    c.place('a', drop, 0);
    // At the drop instant it dwells exactly on the drop (the active anim plays there).
    const s0 = c.snapshot('a', 0)!;
    expect(s0.renderedPos).toEqual(drop);
    expect(s0.displayedState).toBe('active');
    // Across the patrol window it both roams and stays clustered around the DROP — within the
    // natural patrol ring (no `bound`), never drifting back toward the old cell at {80,80}.
    let roamed = false;
    for (let t = 0; t <= 20000; t += 250) {
      const s = c.snapshot('a', t)!;
      expect(dist(s.renderedPos, drop)).toBeLessThanOrEqual(PATROL_R_MAX + 1e-6);
      if (s.movementState === 'roaming') roamed = true;
    }
    expect(roamed).toBe(true);
    // a same-home sync (e.g. live refresh) keeps it pinned (still patrolling around the drop)
    c.sync([{ id: 'a', status: 'active', target: drop, pinned: true }], 5000, { reducedMotion: false });
    expect(dist(c.snapshot('a', 5000)!.renderedPos, drop)).toBeLessThanOrEqual(PATROL_R_MAX + 1e-6);
  });

  it('a waiting dropped orc rests at the EXACT drop even with the rest-offset spread on', () => {
    const c = new RoamingController({ patrol: true }); // patrol on ⇒ non-active orcs get restOffset…
    c.sync([{ id: 'a', status: 'waiting', target: posIdle }], 0, { reducedMotion: false });
    c.place('a', drop, 0);
    // …but a pinned orc skips the offset → renders exactly where it was dropped (the "slightly off" fix)
    expect(c.snapshot('a', 3000)!.renderedPos).toEqual(drop);
  });
});

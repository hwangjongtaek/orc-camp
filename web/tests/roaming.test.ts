/**
 * SPEC-301 roaming controller + shared clock (AC-04/07/13).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RoamingController } from '../src/scene/roaming';
import { quantizeVector } from '../src/scene/direction';
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

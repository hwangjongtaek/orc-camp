/**
 * SPEC-301 §3.1-9 — idle ambient micro-wander (P1, DEFAULT OFF, non-load-bearing).
 *
 * Verifies: OFF by default (no movement), deterministic given (paneId, t), reduced-motion
 * disables it, and it never changes the logical target/slot or movement state (pure visual
 * jitter on renderedPos only). No Math.random / Date.now in the seed (paneId + clock t).
 */
import { describe, it, expect } from 'vitest';
import { RoamingController } from '../src/scene/roaming';
import { wanderOffset, paneHash } from '../src/scene/wander';
import { dist } from '../src/scene/layout';
import { WANDER_R } from '../src/scene/stations';

const idle = { x: 100, y: 100 };
const active = { x: 400, y: 200 };
const e = (status: 'idle' | 'active', target = idle, paneId = '%1') => ({
  id: `pane:${paneId}`,
  paneId,
  status,
  target,
});

describe('SPEC-301 §3.1-9 wanderOffset (pure, deterministic)', () => {
  it('is deterministic for the same (paneId, t) and bounded inside WANDER_R', () => {
    const a = wanderOffset('%7', 1234);
    const b = wanderOffset('%7', 1234);
    expect(a).toEqual(b); // same input → same offset
    for (const t of [0, 250, 1000, 5000, 99999]) {
      expect(dist({ x: 0, y: 0 }, wanderOffset('%7', t))).toBeLessThanOrEqual(WANDER_R + 1e-9);
    }
  });

  it('varies over time and across paneIds (seed = paneId hash + clock t)', () => {
    expect(wanderOffset('%1', 1000)).not.toEqual(wanderOffset('%1', 4000)); // moves over t
    expect(wanderOffset('%1', 1000)).not.toEqual(wanderOffset('%2', 1000)); // per-pane seed
    expect(paneHash('%1')).not.toBe(paneHash('%2'));
    expect(paneHash('%42')).toBe(paneHash('%42')); // stable hash
  });
});

describe('SPEC-301 §3.1-9 RoamingController ambient wander gate', () => {
  it('is OFF by default: an arrived idle orc never moves from its target', () => {
    const c = new RoamingController(); // no opts → wander OFF
    c.sync([e('idle')], 0, { reducedMotion: false });
    expect(c.snapshot('pane:%1', 0)!.renderedPos).toEqual(idle);
    expect(c.snapshot('pane:%1', 5000)!.renderedPos).toEqual(idle); // still static when off
  });

  it('when ON: arrived idle orc wanders deterministically within WANDER_R', () => {
    const c = new RoamingController({ ambientWander: true });
    c.sync([e('idle')], 0, { reducedMotion: false });
    const at1 = c.snapshot('pane:%1', 1000)!;
    const at1b = c.snapshot('pane:%1', 1000)!;
    const at2 = c.snapshot('pane:%1', 4000)!;
    expect(at1.renderedPos).toEqual(at1b.renderedPos); // same t → same pos (deterministic)
    expect(at2.renderedPos).not.toEqual(at1.renderedPos); // drifts over time
    expect(dist(at1.renderedPos, idle)).toBeLessThanOrEqual(WANDER_R + 1e-9);
    expect(at1.movementState).toBe('arrived'); // logical state unchanged (not roaming)
  });

  it('reduced-motion disables wander even when the flag is ON', () => {
    const c = new RoamingController({ ambientWander: true });
    c.sync([e('idle')], 0, { reducedMotion: true });
    expect(c.snapshot('pane:%1', 3000)!.renderedPos).toEqual(idle);
  });

  it('only idle wanders; arrived non-idle orcs stay exactly on target', () => {
    const c = new RoamingController({ ambientWander: true });
    c.sync([e('active', active, '%2')], 0, { reducedMotion: false });
    expect(c.snapshot('pane:%2', 3000)!.renderedPos).toEqual(active);
  });

  it('does not change the logical target/slot: re-sync stays arrived (no roam triggered)', () => {
    const c = new RoamingController({ ambientWander: true });
    c.sync([e('idle')], 0, { reducedMotion: false });
    // wander moved renderedPos away from target, but re-syncing the SAME logical target must
    // NOT enter roaming (the target/slot is untouched — INV-1).
    c.sync([e('idle')], 5000, { reducedMotion: false });
    expect(c.snapshot('pane:%1', 5000)!.movementState).toBe('arrived');
  });
});

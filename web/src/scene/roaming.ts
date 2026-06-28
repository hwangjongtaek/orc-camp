/**
 * SPEC-301 §3.1 — roaming movement controller (driven by the shared clock).
 *
 * Design: state mutates ONLY in `sync()` (when targets/status change); `snapshot(id, t)`
 * is a PURE read that derives rendered position, movement/animation state, facing
 * direction, and the state-entry time `tEnter` from the stored tween descriptor. This
 * lets the React layer write transform/frame via refs on each shared-clock tick WITHOUT a
 * per-frame re-render (perf, §3.3) while keeping the transitions unit-testable by
 * injecting `t`. No Date.now()/RAF here — the clock owns time.
 *
 * Behavior: target change (status/zone/slot) → roam from the CURRENT rendered position
 * (mid-walk retarget keeps walk-cycle phase, §3.1-8); arrival snaps to target, switches to
 * the status animation facing south (§3.1-3); new orc spawns instantly (§3.1-4); terminated
 * and reduced-motion snap instantly with no walk cycle (§3.1-5/7).
 */
import type { OrcStatus } from '../types/domain';
import { dist, lerp } from './layout';
import { quantizeVector } from './direction';
import {
  ARRIVE_EPSILON,
  MVP_DIRECTION,
  ROAM_MAX_MS,
  ROAM_MIN_MS,
  ROAM_SPEED,
  type Vec2,
} from './stations';

export type MovementState = 'roaming' | 'arrived';

export interface MotionSnapshot {
  renderedPos: Vec2;
  movementState: MovementState;
  /** Animation-state identity for phase anchoring: 'roaming' while moving, else status. */
  displayedState: string;
  direction: string;
  /** Shared-clock time the displayed animation state was entered (AC-13b). */
  tEnter: number;
  status: OrcStatus;
}

export interface OrcSyncEntry {
  id: string;
  status: OrcStatus;
  target: Vec2;
}

interface MotionDescriptor {
  status: OrcStatus;
  from: Vec2;
  target: Vec2;
  tweenStart: number;
  duration: number; // ms; 0 = instant (snap)
  roamTEnter: number; // when the 'roaming' state was entered (walk-cycle phase)
  roamDir: string;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

const easeInOut = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

function durationFor(distance: number): number {
  return clamp((distance / ROAM_SPEED) * 1000, ROAM_MIN_MS, ROAM_MAX_MS);
}

function isRoamingAt(d: MotionDescriptor, t: number): boolean {
  return d.duration > 0 && t < d.tweenStart + d.duration;
}

function positionAt(d: MotionDescriptor, t: number): Vec2 {
  if (d.duration <= 0) return d.target;
  const p = clamp((t - d.tweenStart) / d.duration, 0, 1);
  if (p >= 1) return d.target;
  return lerp(d.from, d.target, easeInOut(p));
}

export class RoamingController {
  private readonly motions = new Map<string, MotionDescriptor>();

  /** Apply new targets/statuses at shared-clock time `t`. */
  sync(entries: OrcSyncEntry[], t: number, opts: { reducedMotion: boolean }): void {
    const seen = new Set<string>();
    for (const e of entries) {
      seen.add(e.id);
      const snap = opts.reducedMotion || e.status === 'terminated';
      const prev = this.motions.get(e.id);

      if (!prev) {
        // §3.1-4 — new orc spawns instantly at its target.
        this.motions.set(e.id, {
          status: e.status,
          from: e.target,
          target: e.target,
          tweenStart: t,
          duration: 0,
          roamTEnter: t,
          roamDir: MVP_DIRECTION,
        });
        continue;
      }

      const targetMoved = dist(prev.target, e.target) > ARRIVE_EPSILON;
      const statusChanged = prev.status !== e.status;
      if (!targetMoved && !statusChanged) {
        // Nothing relevant changed → keep descriptor (preserve phase, AC-13b).
        continue;
      }

      const cur = positionAt(prev, t);

      if (snap) {
        // §3.1-5/7 — terminated / reduced-motion: instant snap, no walk cycle.
        this.motions.set(e.id, {
          status: e.status,
          from: e.target,
          target: e.target,
          tweenStart: t,
          duration: 0,
          roamTEnter: t,
          roamDir: MVP_DIRECTION,
        });
        continue;
      }

      const d = dist(cur, e.target);
      if (d <= ARRIVE_EPSILON) {
        // Effectively already there → arrive into the (possibly new) status.
        this.motions.set(e.id, {
          status: e.status,
          from: e.target,
          target: e.target,
          tweenStart: t,
          duration: 0,
          roamTEnter: t,
          roamDir: MVP_DIRECTION,
        });
        continue;
      }

      const wasRoaming = isRoamingAt(prev, t);
      this.motions.set(e.id, {
        status: e.status,
        from: cur,
        target: e.target,
        tweenStart: t,
        duration: durationFor(d),
        // §3.1-8 — mid-walk retarget preserves walk-cycle phase; fresh roam resets it.
        roamTEnter: wasRoaming ? prev.roamTEnter : t,
        roamDir: quantizeVector(e.target.x - cur.x, e.target.y - cur.y),
      });
    }

    for (const id of [...this.motions.keys()]) {
      if (!seen.has(id)) this.motions.delete(id);
    }
  }

  /** PURE read of the motion state at shared-clock time `t`. */
  snapshot(id: string, t: number): MotionSnapshot | null {
    const d = this.motions.get(id);
    if (!d) return null;
    const arrivalT = d.tweenStart + d.duration;
    if (d.duration > 0 && t < arrivalT) {
      return {
        renderedPos: positionAt(d, t),
        movementState: 'roaming',
        displayedState: 'roaming',
        direction: d.roamDir,
        tEnter: d.roamTEnter,
        status: d.status,
      };
    }
    return {
      renderedPos: d.target,
      movementState: 'arrived',
      displayedState: d.status,
      direction: MVP_DIRECTION,
      tEnter: arrivalT,
      status: d.status,
    };
  }

  has(id: string): boolean {
    return this.motions.has(id);
  }

  ids(): string[] {
    return [...this.motions.keys()];
  }

  clear(): void {
    this.motions.clear();
  }
}

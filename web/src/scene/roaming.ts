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
import { add, dist, lerp } from './layout';
import { quantizeVector } from './direction';
import { clampToRect } from './ground';
import { wanderOffset } from './wander';
import { patrolAt, restOffset } from './patrol';
import {
  ARRIVE_EPSILON,
  MVP_DIRECTION,
  PATROL_MARGIN,
  ROAM_MAX_MS,
  ROAM_MIN_MS,
  ROAM_SPEED,
  type Rect,
  type Vec2,
} from './stations';

export type MovementState = 'roaming' | 'arrived';

/**
 * Controller options. Both default OFF (non-load-bearing): CampMap opts in.
 * - `ambientWander` (§3.1-9): subtle idle micro-wander.
 * - `patrol` (§3.1-10): active orcs run a continuous roam ↔ active loop and non-active orcs
 *   settle at a seeded rest spot near their station.
 */
export interface RoamingOptions {
  ambientWander?: boolean;
  patrol?: boolean;
}

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
  /** §3.1-9 wander seed (authority paneId). Falls back to `id` when omitted. */
  paneId?: string;
  /** §3.1-10 walkable bound (zone inner rect / ground safe area) — patrol/rest clamp inside it. */
  bound?: Rect;
  /**
   * §3.1-11 — a user drag-drop placement. A pinned orc carries no `bound` (no cell-clamp that would
   * pull it back toward its old cell). An ACTIVE pinned orc patrols around the drop `target` itself;
   * a NON-active pinned orc rests EXACTLY at `target` (no rest/wander offset) — its status animation
   * still plays in place.
   */
  pinned?: boolean;
}

interface MotionDescriptor {
  status: OrcStatus;
  from: Vec2;
  target: Vec2;
  tweenStart: number;
  duration: number; // ms; 0 = instant (snap)
  roamTEnter: number; // when the 'roaming' state was entered (walk-cycle phase)
  roamDir: string;
  paneId: string; // §3.1-9 wander seed
  bound?: Rect; // §3.1-10 patrol/rest clamp bound
  pinned?: boolean; // §3.1-11 user-placed → no cell-bound; active patrols around target, else rests on it
}

const ZERO: Vec2 = { x: 0, y: 0 };

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
  /** §3.1-9 — idle ambient micro-wander (OFF by default, non-load-bearing). */
  private readonly ambientWander: boolean;
  /** §3.1-10 — active patrol loop + non-active rest (OFF by default, non-load-bearing). */
  private readonly patrol: boolean;
  /** Latest reduced-motion flag (set each sync) — wander/patrol are disabled when true. */
  private reducedMotion = false;

  constructor(opts: RoamingOptions = {}) {
    this.ambientWander = opts.ambientWander ?? false;
    this.patrol = opts.patrol ?? false;
  }

  /** Apply new targets/statuses at shared-clock time `t`. */
  sync(entries: OrcSyncEntry[], t: number, opts: { reducedMotion: boolean }): void {
    this.reducedMotion = opts.reducedMotion;
    const seen = new Set<string>();
    for (const e of entries) {
      seen.add(e.id);
      const snap = opts.reducedMotion || e.status === 'terminated';
      const prev = this.motions.get(e.id);
      const paneId = e.paneId ?? e.id;

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
          paneId,
          bound: e.bound,
          pinned: e.pinned,
        });
        continue;
      }

      const targetMoved = dist(prev.target, e.target) > ARRIVE_EPSILON;
      const statusChanged = prev.status !== e.status;
      if (!targetMoved && !statusChanged) {
        // Nothing relevant changed → keep descriptor (preserve phase, AC-13b).
        continue;
      }

      // Start the retarget from the orc's ACTUAL rendered position — including a patrol/rest
      // offset (§3.1-10) — so a status change mid-patrol roams smoothly from where it stands,
      // not from the stale station anchor. (During an approach roam this equals positionAt.)
      const cur = this.snapshot(e.id, t)?.renderedPos ?? positionAt(prev, t);

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
          paneId,
          bound: e.bound,
          pinned: e.pinned,
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
          paneId,
          bound: e.bound,
          pinned: e.pinned,
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
        paneId,
        bound: e.bound,
        pinned: e.pinned,
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

    // §3.1-10/§3.1-11 — ACTIVE patrol: once arrived an active orc never just stands — it runs an
    // endless roam ↔ active-dwell loop anchored at the arrival instant (so it walks to the post,
    // THEN patrols). This runs whether the orc is auto-placed OR pinned (a user drop): a pinned orc
    // has no `bound`, so it patrols around the DROP point itself (no revert toward its old cell —
    // §3.1-11), while an auto-placed orc patrols within its cell (adaptive-clamped, §2.4b). Pure
    // function of (paneId, t); disabled under reduced-motion.
    if (this.patrol && !this.reducedMotion && d.status === 'active') {
      const f = patrolAt(d.target, d.paneId, arrivalT, t, d.bound, PATROL_MARGIN);
      return {
        renderedPos: f.pos,
        movementState: f.moving ? 'roaming' : 'arrived',
        displayedState: f.moving ? 'roaming' : d.status,
        direction: f.direction,
        tEnter: f.tEnter,
        status: d.status,
      };
    }

    // §3.1-11 — a PINNED, NON-active (user drag-dropped) orc rests EXACTLY at its drop point: skip
    // the rest/wander offset AND the bound-clamp (which would pull it off the chosen spot or back
    // toward its old cell — the drop-revert/offset bug). Its status animation still plays in place
    // (waiting/idle = their loops). Direction is the MVP facing.
    if (d.pinned) {
      return {
        renderedPos: d.target,
        movementState: 'arrived',
        displayedState: d.status,
        direction: MVP_DIRECTION,
        tEnter: arrivalT,
        status: d.status,
      };
    }

    // Arrived, non-active (or patrol/wander off). renderedPos jitter is PURE visual (the logical
    // target/slot is untouched → zero layout shift, no AC outcome changes), composed of:
    //  • §3.1-10 rest offset — a fixed seeded spread so waiting orcs scatter naturally near their
    //    station (away from the active patrol band), applied to ALL non-active orcs when patrol on;
    //  • §3.1-9 idle micro-wander — a subtle ongoing drift, idle-only.
    // Both are disabled under reduced-motion (exact target). Clamped inside the walkable bound.
    let renderedPos = d.target;
    if (!this.reducedMotion) {
      const rest = this.patrol ? restOffset(d.paneId) : ZERO;
      const wander =
        this.ambientWander && d.status === 'idle' ? wanderOffset(d.paneId, t) : ZERO;
      if (rest !== ZERO || wander !== ZERO) {
        renderedPos = add(d.target, add(rest, wander));
        if (this.patrol && d.bound) renderedPos = clampToRect(renderedPos, d.bound, PATROL_MARGIN);
      }
    }
    return {
      renderedPos,
      movementState: 'arrived',
      displayedState: d.status,
      direction: MVP_DIRECTION,
      tEnter: arrivalT,
      status: d.status,
    };
  }

  /**
   * §3.1-11 — instantly PLACE an orc at `pos` (user drag-drop drop). Snaps the descriptor (no walk)
   * and marks it PINNED. The bound is dropped (so the orc never reverts toward its old cell — the
   * drop-revert bug): an ACTIVE orc then patrols around the drop `pos`, while a NON-active orc rests
   * EXACTLY at it (no rest/wander offset). Status/paneId are preserved. The subsequent `sync()`
   * (with the same home + `pinned`) is a no-op, so the placement sticks.
   */
  place(id: string, pos: Vec2, t: number): void {
    const prev = this.motions.get(id);
    this.motions.set(id, {
      status: prev?.status ?? 'idle',
      from: pos,
      target: pos,
      tweenStart: t,
      duration: 0,
      roamTEnter: t,
      roamDir: MVP_DIRECTION,
      paneId: prev?.paneId ?? id,
      pinned: true,
    });
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

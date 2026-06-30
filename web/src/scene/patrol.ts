/**
 * SPEC-301 §3.1-10 — active PATROL path + non-active REST, PURE & shared-clock-driven.
 *
 * `patrolAt(home, paneId, arrivalT, t)` derives, for an ACTIVE orc, where it is in its endless
 * roam ↔ active-dwell loop at shared-clock time `t` — a deterministic function of (paneId, t),
 * never Math.random / Date.now (INV-1, AC-12). The loop is anchored at `arrivalT` (the instant
 * the orc reached its post) and waypoint 0 IS `home`, so an orc first walks to its station and
 * only THEN begins patrolling (no teleport). Per-orc seeded leg/dwell durations + waypoint
 * angles/radii desync the fleet so no two orcs move together (the goal's "randomize 동선").
 *
 * `restOffset(paneId)` is a fixed seeded displacement for a NON-active orc so each waiting orc
 * sits at its own natural-looking spot near its station (the goal's "랜덤한 위치에서 대기").
 * Both clamp to the walkable bound so the body stays in-bounds; both are renderedPos-only (the
 * logical target/slot is untouched → zero layout shift, no AC outcome changes).
 */
import { DIRECTIONS, quantizeVector } from './direction';
import { add, lerp } from './layout';
import { paneHash } from './wander';
import {
  MVP_DIRECTION,
  PATROL_DWELL_MAX_MS,
  PATROL_DWELL_MIN_MS,
  PATROL_LEG_MAX_MS,
  PATROL_LEG_MIN_MS,
  PATROL_MIN_BAND,
  PATROL_R_MAX,
  PATROL_R_MIN,
  REST_R,
  type Rect,
  type Vec2,
} from './stations';

const easeInOut = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/** Deterministic integer mix → a fresh 32-bit hash from (base seed, integer k). */
function mix(h: number, k: number): number {
  let x = (h ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** Map a 32-bit hash to a fraction in [0, 1). */
const frac = (h: number): number => (h >>> 8) / 0x1000000;

/**
 * §2.4b/§3.1-10 — clamp a patrol waypoint into the orc's cell, ADAPTIVELY. A comfortable cell uses
 * the full half-footprint inset (`margin`) so the whole sprite stays inside its cell and adjacent
 * orcs never overlap (strict no-overlap preserved). But once a cell is smaller than a sprite
 * (crowded camp / narrowed 50:50·30:70 layout), the fixed-margin inset inverts and collapses every
 * waypoint onto the center — the active orc freezes in place. So the reachable band is FLOORED at
 * ±PATROL_MIN_BAND from the cell center: the orc keeps a visible patrol radius at the cost of a
 * small, bounded overlap (accepted only where the cell can't hold a full sprite anyway). No bound
 * (e.g. a pinned drop, §3.1-11) ⇒ the natural ring, unclamped.
 */
const clampAxis = (v: number, start: number, extent: number, margin: number): number => {
  const center = start + extent / 2;
  // Normal half-footprint inset, floored at PATROL_MIN_BAND so a sub-footprint cell still roams,
  // but never wider than the cell half-extent so the anchor stays inside its own cell.
  const half = Math.min(Math.max(extent / 2 - margin, PATROL_MIN_BAND), extent / 2);
  return Math.min(Math.max(v, center - half), center + half);
};

const clamp = (p: Vec2, bound: Rect | undefined, margin: number): Vec2 =>
  bound
    ? { x: clampAxis(p.x, bound.x, bound.w, margin), y: clampAxis(p.y, bound.y, bound.h, margin) }
    : p;

/**
 * Seeded patrol waypoint `k` around `home`. Waypoint 0 IS the home post (so the cycle's first
 * dwell happens exactly where the orc arrived); k ≥ 1 are bounded seeded points on a ring.
 */
export function patrolWaypoint(
  home: Vec2,
  seed: number,
  k: number,
  bound?: Rect,
  margin = 0,
): Vec2 {
  if (k <= 0) return clamp(home, bound, margin);
  const ang = frac(mix(seed, k * 2 + 1)) * Math.PI * 2;
  const rad = PATROL_R_MIN + frac(mix(seed, k * 2 + 2)) * (PATROL_R_MAX - PATROL_R_MIN);
  return clamp(add(home, { x: Math.cos(ang) * rad, y: Math.sin(ang) * rad }), bound, margin);
}

export interface PatrolFrame {
  pos: Vec2;
  /** true ⇒ on a roaming leg (walk-cycle); false ⇒ dwelling (play the status/active anim). */
  moving: boolean;
  /** facing for the current leg, or south while dwelling (MVP). */
  direction: string;
  /** shared-clock time the current leg/dwell was entered (frameAt phase anchor, AC-13b). */
  tEnter: number;
}

/**
 * Where an active orc is in its patrol loop at time `t`. Each cycle = [dwell at waypoint n]
 * then [roam waypoint n → n+1]; consecutive cycles chain (dwell n+1 starts where roam n ended),
 * so the path is continuous. Before `arrivalT` (still walking to post) callers use the roaming
 * tween instead; here `local` is floored at 0 so t==arrivalT yields the first dwell at home.
 */
export function patrolAt(
  home: Vec2,
  paneId: string,
  arrivalT: number,
  t: number,
  bound?: Rect,
  margin = 0,
): PatrolFrame {
  const seed = paneHash(paneId);
  const legDur =
    PATROL_LEG_MIN_MS + frac(mix(seed, 7)) * (PATROL_LEG_MAX_MS - PATROL_LEG_MIN_MS);
  const dwellDur =
    PATROL_DWELL_MIN_MS + frac(mix(seed, 11)) * (PATROL_DWELL_MAX_MS - PATROL_DWELL_MIN_MS);
  const cycle = legDur + dwellDur;
  const local = Math.max(0, t - arrivalT);
  const n = Math.floor(local / cycle);
  const within = local - n * cycle;
  const wpN = patrolWaypoint(home, seed, n, bound, margin);

  if (within < dwellDur) {
    // §3.1-10 (#50) — after a roam the active anim faces a RANDOM (seeded per cycle) direction
    // instead of always south, so a yard of dwelling orcs faces every which way.
    const dir = DIRECTIONS[mix(seed, 1000 + n) % DIRECTIONS.length] ?? MVP_DIRECTION;
    return { pos: wpN, moving: false, direction: dir, tEnter: arrivalT + n * cycle };
  }
  const wpN1 = patrolWaypoint(home, seed, n + 1, bound, margin);
  const p = (within - dwellDur) / legDur;
  return {
    pos: lerp(wpN, wpN1, easeInOut(p)),
    moving: true,
    direction: quantizeVector(wpN1.x - wpN.x, wpN1.y - wpN.y),
    tEnter: arrivalT + n * cycle + dwellDur,
  };
}

/**
 * Fixed seeded rest displacement for a non-active orc (never dead-centre on its slot, so a row
 * of waiting orcs scatters naturally). Pure function of paneId; bounded inside `radius`.
 */
export function restOffset(paneId: string, radius: number = REST_R): Vec2 {
  const seed = paneHash(paneId);
  const ang = frac(mix(seed, 3)) * Math.PI * 2;
  const rad = (0.35 + frac(mix(seed, 5)) * 0.65) * radius; // 35–100% of radius
  return { x: Math.cos(ang) * rad, y: Math.sin(ang) * rad };
}

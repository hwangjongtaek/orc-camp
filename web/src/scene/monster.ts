/**
 * SPEC-303 (Phase 1, roaming-only) — epic monster ambient NPC motion (PURE, deterministic).
 *
 * The single scene monster continuously roams the active background's `ground.polygon`: a seeded
 * chain of waypoints (each kept so the monster footprint stays inside the polygon), walked at a
 * fixed leg duration with the `roaming` walk-cycle, 8-direction facing from the movement vector.
 *
 * Phase 1 (current, SPEC-303 §3 적용 단계) shows ONLY `roaming` — no dwell hold and no
 * orc-intersection `error` (those are Phase 2). Motion is a pure function of the monster key
 * (seed) + the shared clock — never `Math.random`/`Date.now` (INV-1). One monster per scene.
 */
import type { AssetManifest, MonsterDef } from '../assets/manifest';
import type { GroundContext } from './ground';
import { clampToRect, pointInPolygon } from './ground';
import { quantizeVector } from './direction';
import { lerp } from './layout';
import { paneHash } from './wander';
import { MVP_DIRECTION, type Rect, type Vec2 } from './stations';

/** Fixed leg duration between consecutive (short) waypoints — slow, heavy lumber. */
export const MONSTER_LEG_MS = 3000;
/** Max distance of a single leg (a "move at once"): the monster takes SHORT steps, not map-spanning
 *  treks. Consecutive loop waypoints are within this radius (SPEC-303 §3.4 — bounded step). */
export const MONSTER_STEP_MAX = 300;
/** Length of the pre-built short-step waypoint loop (traversed ping-pong so every leg stays short). */
export const MONSTER_LOOP_LEN = 48;
/** Ground-contact footprint width / frame edge (the monster's "feet", far smaller than the sprite). */
export const MONSTER_FOOTPRINT_RATIO = 0.35;
/** Footprint height / width (flat). */
export const MONSTER_FOOTPRINT_ASPECT = 0.4;
/**
 * Orc avoidance — narrow + gentle (user tuning 2026-06-30: the big monster was avoiding too far/too
 * fast). The monster only nudges aside when an orc gets within
 *   clearance = halfW·MONSTER_AVOID_FOOTPRINT_FACTOR + ORC_AVOID_RADIUS
 * of its centre, and any single-frame sidestep is capped at MONSTER_AVOID_PUSH_MAX. Smaller radius +
 * smaller cap ⇒ fewer, softer avoidance moves (orcs are allowed to pass closer to the big monster).
 */
export const MONSTER_AVOID_FOOTPRINT_FACTOR = 0.5; // only part of the (large) feet half-width counts
export const ORC_AVOID_RADIUS = 20;                // small fixed buffer beyond that
export const MONSTER_AVOID_PUSH_MAX = 60;          // max per-frame sidestep (gentle, not a dart)
const WAYPOINT_MAX_ATTEMPTS = 24;

/**
 * On-screen render scale — epic (clearly larger than an orc). Doubled (2026-06-30, user request):
 * a 256px sprite renders at ~717px (nearest-neighbor upscale), accepting some resolution loss
 * (chunkier pixels) for a more imposing boss. Smaller scenes use a reduced scale (§3.4).
 */
export const MONSTER_SCALE_DEFAULT = 2.8;
const SCALE_BY_BG: Record<string, number> = { 'necropolis-camp': 2.0 };
export function monsterScaleFor(bgRef: string | null | undefined): number {
  return (bgRef && SCALE_BY_BG[bgRef]) || MONSTER_SCALE_DEFAULT;
}

const easeInOut = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/** Deterministic integer mix → a fresh 32-bit hash (mirror of scene/patrol.ts). */
function mix(h: number, k: number): number {
  let x = (h ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}
const frac = (h: number): number => (h >>> 8) / 0x1000000;

function bboxOf(polygon: readonly Vec2[]): Rect {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
const rectCenter = (r: Rect): Vec2 => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** The footprint box (center ± half-extents) lies fully inside the polygon (4 corners + center). */
export function footprintInPolygon(
  c: Vec2,
  polygon: readonly Vec2[],
  halfW: number,
  halfH: number,
): boolean {
  const pts: Vec2[] = [
    c,
    { x: c.x - halfW, y: c.y - halfH },
    { x: c.x + halfW, y: c.y - halfH },
    { x: c.x - halfW, y: c.y + halfH },
    { x: c.x + halfW, y: c.y + halfH },
  ];
  return pts.every((p) => pointInPolygon(p, polygon));
}

/**
 * Deterministic waypoint `k` for the monster: a seeded point in the polygon bbox re-sampled until
 * its footprint is inside the polygon; on exhaustion, the inscribed `safeArea` centre (always inside
 * the polygon) clamped by the footprint margin. Pure function of (seed, k).
 */
export function monsterWaypoint(
  seed: number,
  polygon: readonly Vec2[],
  bbox: Rect,
  safeArea: Rect,
  k: number,
  halfW: number,
  halfH: number,
): Vec2 {
  for (let a = 0; a < WAYPOINT_MAX_ATTEMPTS; a += 1) {
    const h = mix(seed, k * 131 + a);
    const cx = bbox.x + frac(h) * bbox.w;
    const cy = bbox.y + frac(mix(h, 1)) * bbox.h;
    if (footprintInPolygon({ x: cx, y: cy }, polygon, halfW, halfH)) return { x: cx, y: cy };
  }
  return clampToRect(rectCenter(safeArea), safeArea, Math.max(halfW, halfH));
}

/**
 * Pre-build a deterministic loop of SHORT-step waypoints (a seeded random walk): waypoint 0 is an
 * independent feasible spot; each subsequent point is a bounded step (≤ MONSTER_STEP_MAX) from the
 * previous, re-sampled until its footprint is in-polygon, else nudged toward the safe-area centre
 * (always inside) so it never sticks at a wall. Traversed ping-pong (§snapshot) so EVERY leg is a
 * short step (no map-spanning treks) while still wandering the polygon. Built once per scene.
 */
export function buildMonsterLoop(
  seed: number,
  polygon: readonly Vec2[],
  bbox: Rect,
  safeArea: Rect,
  halfW: number,
  halfH: number,
  len: number = MONSTER_LOOP_LEN,
  stepMax: number = MONSTER_STEP_MAX,
): Vec2[] {
  const center = rectCenter(safeArea);
  let cur = monsterWaypoint(seed, polygon, bbox, safeArea, 0, halfW, halfH);
  const loop: Vec2[] = [cur];
  for (let k = 1; k < len; k += 1) {
    let next: Vec2 | null = null;
    for (let a = 0; a < WAYPOINT_MAX_ATTEMPTS; a += 1) {
      const h = mix(seed, k * 131 + a);
      const ang = frac(h) * Math.PI * 2;
      const rad = (0.4 + frac(mix(h, 1)) * 0.6) * stepMax; // 40–100% of the cap
      const cand = { x: cur.x + Math.cos(ang) * rad, y: cur.y + Math.sin(ang) * rad };
      if (footprintInPolygon(cand, polygon, halfW, halfH)) {
        next = cand;
        break;
      }
    }
    if (!next) {
      // Boundary fallback: step toward the safe-area centre (guaranteed inside), bounded by stepMax.
      const dx = center.x - cur.x;
      const dy = center.y - cur.y;
      const len2 = Math.hypot(dx, dy) || 1;
      const step = Math.min(stepMax, len2);
      next = { x: cur.x + (dx / len2) * step, y: cur.y + (dy / len2) * step };
    }
    cur = next;
    loop.push(cur);
  }
  return loop;
}

/** Ping-pong index into a length-P loop: 0,1,…,P-1,P-2,…,1,0,1,… (consecutive differ by 1 ⇒ short legs). */
export function pingpongIndex(n: number, p: number): number {
  if (p <= 1) return 0;
  const period = 2 * (p - 1);
  const m = ((n % period) + period) % period;
  return m < p ? m : period - m;
}

/**
 * Steer the monster AROUND orcs: push `base` out of every orc's clearance disc (radius `minSep`
 * from the orc centre), summed and capped at `minSep`, then kept inside the polygon (back off
 * toward `base` if a full push would leave it). Smooth (linear falloff) and pure given the orc
 * centres — so the monster bends around orcs instead of overlapping/walking through them.
 */
export function avoidOrcs(
  base: Vec2,
  orcCenters: readonly Vec2[],
  minSep: number,
  pushMax: number,
  polygon: readonly Vec2[],
  halfW: number,
  halfH: number,
): Vec2 {
  let px = 0;
  let py = 0;
  for (const o of orcCenters) {
    const dx = base.x - o.x;
    const dy = base.y - o.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= minSep) continue;
    if (dist > 1e-6) {
      const f = (minSep - dist) / minSep; // 1 at contact → 0 at the rim
      px += (dx / dist) * f * minSep;
      py += (dy / dist) * f * minSep;
    } else {
      px += minSep; // exactly coincident → deterministic arbitrary push
    }
  }
  if (px === 0 && py === 0) return base;
  // Cap the per-frame sidestep so a big monster nudges gently instead of darting.
  const pm = Math.hypot(px, py);
  if (pm > pushMax) {
    px = (px / pm) * pushMax;
    py = (py / pm) * pushMax;
  }
  for (const gain of [1, 0.6, 0.3]) {
    const c = { x: base.x + px * gain, y: base.y + py * gain };
    if (footprintInPolygon(c, polygon, halfW, halfH)) return c;
  }
  return base;
}

export interface MonsterSnapshot {
  renderedPos: Vec2;
  direction: string;
  /** shared-clock time the roam loop started (constant → continuous walk-cycle phase). */
  tEnter: number;
  /** Phase 1: always 'roaming' while moving; 'arrived' only under reduced-motion (static). */
  movementState: 'roaming' | 'arrived';
}

interface MonsterState {
  seed: number;
  polygon: Vec2[];
  loop: Vec2[]; // pre-built short-step waypoint loop (traversed ping-pong)
  safeArea: Rect;
  halfW: number;
  halfH: number;
  t0: number;
  reduced: boolean;
}

/**
 * Single-monster motion controller mirroring RoamingController's "mutate in sync(), pure
 * snapshot(t)" shape. Phase 1: continuous polygon roam (no dwell/error).
 */
export class MonsterController {
  private s: MonsterState | null = null;

  /** Apply the active monster + ground. `key=null`/`ground=null` ⇒ nothing to render. */
  sync(
    key: string | null,
    ground: GroundContext | null,
    frameEdge: number,
    scale: number,
    t: number,
    opts: { reducedMotion: boolean },
  ): void {
    if (!key || !ground) {
      this.s = null;
      return;
    }
    const halfW = (frameEdge * scale * MONSTER_FOOTPRINT_RATIO) / 2;
    const halfH = halfW * MONSTER_FOOTPRINT_ASPECT;
    const seed = paneHash(key);
    const prev = this.s;
    // Preserve the roam loop + its start across re-syncs of the SAME scene (key + polygon ref stable);
    // reset on a scene change so the new monster starts its loop fresh (no teleport mid-walk).
    const sameScene = prev != null && prev.seed === seed && prev.polygon === ground.polygon;
    const loop = sameScene
      ? prev.loop
      : buildMonsterLoop(seed, ground.polygon, bboxOf(ground.polygon), ground.safeArea, halfW, halfH);
    this.s = {
      seed,
      polygon: ground.polygon,
      loop,
      safeArea: ground.safeArea,
      halfW,
      halfH,
      t0: sameScene ? prev.t0 : t,
      reduced: opts.reducedMotion,
    };
  }

  /**
   * PURE read of the monster motion at shared-clock time `t` (null ⇒ nothing to render). Pass the
   * current orc CENTRES to make the monster steer around them (no overlap); omit for the bare path.
   */
  snapshot(t: number, orcCenters: readonly Vec2[] = []): MonsterSnapshot | null {
    const s = this.s;
    if (!s) return null;
    if (s.reduced) {
      // reduced-motion: a single static spot (loop start), facing south, no walk (§3.10).
      return { renderedPos: s.loop[0]!, direction: MVP_DIRECTION, tEnter: s.t0, movementState: 'arrived' };
    }
    // Each leg is one SHORT step between adjacent loop waypoints (ping-pong traversal), so the
    // monster never moves a long distance "at once" while still wandering.
    const local = Math.max(0, t - s.t0);
    const n = Math.floor(local / MONSTER_LEG_MS);
    const within = local - n * MONSTER_LEG_MS;
    const a = s.loop[pingpongIndex(n, s.loop.length)]!;
    const b = s.loop[pingpongIndex(n + 1, s.loop.length)]!;
    const base = lerp(a, b, easeInOut(within / MONSTER_LEG_MS));
    // Steer AROUND orcs (push out of each orc's clearance disc, kept in-polygon); facing stays along
    // the path (b−a). Narrow radius + capped sidestep ⇒ gentle, infrequent avoidance. Deterministic.
    const minSep = s.halfW * MONSTER_AVOID_FOOTPRINT_FACTOR + ORC_AVOID_RADIUS;
    const pos = orcCenters.length
      ? avoidOrcs(base, orcCenters, minSep, MONSTER_AVOID_PUSH_MAX, s.polygon, s.halfW, s.halfH)
      : base;
    return {
      renderedPos: pos,
      direction: quantizeVector(b.x - a.x, b.y - a.y),
      tEnter: s.t0, // constant → the roaming walk-cycle runs continuously across legs
      movementState: 'roaming',
    };
  }

  has(): boolean {
    return this.s != null;
  }
}

/**
 * SPEC-303 §3.1 — resolve the epic monster variant for the active background (2-step, deterministic):
 * (i) `backgrounds[bg].epic_monster` forward link, else (ii) the first `monsters[k]` whose
 * `background === bg` (key sort order). Renders only when the variant is `status:"available"` with a
 * set `pixellab_character_id` (else not generated → not shown). Returns null when nothing renders.
 */
export function resolveMonsterVariant(
  manifest: AssetManifest | null | undefined,
  bgRef: string | null | undefined,
): { key: string; def: MonsterDef } | null {
  if (!manifest?.monsters || !bgRef) return null;
  let key: string | undefined = manifest.backgrounds?.[bgRef]?.epic_monster;
  if (!key) {
    key = Object.keys(manifest.monsters)
      .sort()
      .find((k) => manifest.monsters![k]!.background === bgRef);
  }
  if (!key) return null;
  const def = manifest.monsters[key];
  if (!def || def.status !== 'available' || !def.pixellab_character_id) return null;
  return { key, def };
}

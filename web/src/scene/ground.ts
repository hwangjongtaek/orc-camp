/**
 * SPEC-301 §2.1 — image-ground geometry (PURE, deterministic; no Date.now / Math.random).
 *
 * A background image can carry a `ground` polygon = the walkable area (image px). In image-ground
 * mode the image IS the world (native resolution, drag-pan) and orc targets are placed inside the
 * inscribed `safe_area` rect (a conservative, always-inside subset of the polygon). The polygon is
 * the source of truth for the ground RATIO gate: a new background may only be registered if its
 * walkable ratio is ≥ the reference (so future camps never have less room than the default).
 */
import type { BackgroundDef } from '../assets/manifest';
import type { Rect, Vec2 } from './stations';

/** Ground-mode placement context derived from a background (null = legacy zone-grid mode). */
export interface GroundContext {
  world: { w: number; h: number }; // = background logical_size (native px)
  safeArea: Rect; // inscribed walkable rect — orc targets clamp to this
  polygon: Vec2[]; // walkable polygon (image px)
}

/**
 * Reference ground ratio (floor). The default `orccamp-default` measures 0.2815; the floor is set
 * just below so the reference passes its own gate, and every future background must meet it.
 */
export const REFERENCE_GROUND_RATIO = 0.281;

/** Shoelace polygon area (absolute px²). */
export function shoelaceArea(polygon: readonly Vec2[]): number {
  const n = polygon.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % n]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Walkable ratio = ground area / world area (recomputed from the polygon, never trusted). */
export function groundRatio(polygon: readonly Vec2[], world: { w: number; h: number }): number {
  const area = world.w * world.h;
  if (area <= 0) return 0;
  return shoelaceArea(polygon) / area;
}

export interface RatioGateResult {
  ok: boolean;
  ratio: number;
  reason?: string;
}

/**
 * SPEC-301 ground-ratio gate: a background is registerable iff its recomputed walkable ratio is
 * ≥ REFERENCE_GROUND_RATIO. Returns the measured ratio and a reason on rejection.
 */
export function meetsGroundRatio(
  polygon: readonly Vec2[],
  world: { w: number; h: number },
  floor: number = REFERENCE_GROUND_RATIO,
): RatioGateResult {
  const ratio = groundRatio(polygon, world);
  if (ratio + 1e-9 < floor) {
    return { ok: false, ratio, reason: `ground_ratio ${ratio.toFixed(4)} < reference ${floor}` };
  }
  return { ok: true, ratio };
}

/** Clamp a point into a rect, inset by `margin` (so the sprite body stays inside). */
export function clampToRect(p: Vec2, rect: Rect, margin = 0): Vec2 {
  const minX = rect.x + margin;
  const maxX = rect.x + rect.w - margin;
  const minY = rect.y + margin;
  const maxY = rect.y + rect.h - margin;
  return {
    x: Math.min(Math.max(p.x, Math.min(minX, maxX)), Math.max(minX, maxX)),
    y: Math.min(Math.max(p.y, Math.min(minY, maxY)), Math.max(minY, maxY)),
  };
}

/** Ray-cast point-in-polygon (used by tests / the placement INV). */
export function pointInPolygon(p: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersect =
      a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Derive the image-ground context from a background, or null if the background does not declare a
 * walkable polygon (→ legacy zone-grid mode / placeholder parity). Requires logical_size + a
 * polygon with ≥3 vertices; falls back to the polygon bbox when safe_area is absent.
 */
export function groundFromBackground(bg: BackgroundDef | null | undefined): GroundContext | null {
  if (!bg?.logical_size || !bg.ground?.polygon || bg.ground.polygon.length < 3) return null;
  const [w, h] = bg.logical_size;
  const polygon: Vec2[] = bg.ground.polygon.map(([x, y]) => ({ x, y }));
  const sa = bg.safe_area;
  const safeArea: Rect = sa
    ? { x: sa[0], y: sa[1], w: sa[2], h: sa[3] }
    : bboxOf(polygon);
  return { world: { w, h }, safeArea, polygon };
}

function bboxOf(polygon: Vec2[]): Rect {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

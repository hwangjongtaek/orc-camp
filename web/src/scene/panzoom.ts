/**
 * SPEC-301 §2.7 (#42) — PURE pan/zoom math for the map viewport.
 *
 * The viewport (a fixed on-screen scroll panel) pans over a large logical WORLD and can be
 * zoomed by applying scale() to `.oc-map__world`. To keep scroll math correct, the world
 * box size is ALSO multiplied by the scale (so scrollWidth/Height track the visual size).
 * These helpers are pure (no DOM, no Date.now/Math.random) so they are unit-testable and
 * deterministic; the React wiring lives in CampMap.
 */

export interface Size {
  w: number;
  h: number;
}

/** Zoom bounds + step (hypothesis tuning, Q-perf). `1` = original BASE_SCALE (1 logical px). */
export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 1.5;
export const ZOOM_STEP = 1.25;
/** Pointer drag distance (px) before a background drag becomes a pan (so clicks survive). */
export const DRAG_THRESHOLD = 4;

/** Clamp a scale into [ZOOM_MIN, ZOOM_MAX]. */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(Math.max(scale, ZOOM_MIN), ZOOM_MAX);
}

/** One zoom-in step (× ZOOM_STEP), clamped. */
export function zoomIn(scale: number): number {
  return clampScale(scale * ZOOM_STEP);
}

/** One zoom-out step (÷ ZOOM_STEP), clamped. */
export function zoomOut(scale: number): number {
  return clampScale(scale / ZOOM_STEP);
}

/**
 * Scale that makes the whole WORLD fit inside the VIEWPORT (both axes), clamped to the zoom
 * bounds. `world`/`viewport` are in css px at BASE_SCALE. Degenerate inputs → 1 (no-op).
 */
export function fitScale(world: Size, viewport: Size): number {
  if (world.w <= 0 || world.h <= 0 || viewport.w <= 0 || viewport.h <= 0) return 1;
  return clampScale(Math.min(viewport.w / world.w, viewport.h / world.h));
}

/**
 * New scroll offset that keeps the world point currently under `anchor` (a viewport-relative
 * pixel, e.g. the viewport center) fixed across a scale change. Pure; the caller clamps to the
 * scroll range by assignment (the browser clamps scrollLeft/Top to [0, scrollMax]).
 */
export function scrollForZoom(
  prevScroll: { left: number; top: number },
  prevScale: number,
  nextScale: number,
  anchor: { x: number; y: number },
): { left: number; top: number } {
  const worldX = (prevScroll.left + anchor.x) / prevScale;
  const worldY = (prevScroll.top + anchor.y) / prevScale;
  return {
    left: worldX * nextScale - anchor.x,
    top: worldY * nextScale - anchor.y,
  };
}

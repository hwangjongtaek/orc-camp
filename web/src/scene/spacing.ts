/**
 * SPEC-301 §2.4b (#51) — personal-space "bubble" spacing, PURE & deterministic.
 *
 * `computeCells(area, count)` partitions the walkable `area` into `count` near-square cells laid
 * out row-major (spread across the WHOLE map). Each orc owns one cell; confining its patrol/rest
 * motion to that cell (the controller clamps with PATROL_MARGIN = half-footprint) keeps every orc's
 * sprite box inside its own cell, so adjacent orcs never overlap — a deterministic personal-space
 * bubble (the goal's "캐릭터 간 겹치지 않도록"). No Math.random / Date.now. When a camp is too
 * crowded for full-footprint cells the grid densifies (best-effort; centers still stay spaced).
 */
import type { Rect, Vec2 } from './stations';

export interface Cell {
  center: Vec2;
  rect: Rect;
}

/** Near-square column count for `count` cells over a `w×h` area (≥1, ≤count). */
export function gridCols(count: number, w: number, h: number): number {
  if (count <= 1) return 1;
  const ratio = w / Math.max(1, h);
  const cols = Math.round(Math.sqrt(count * ratio));
  return Math.max(1, Math.min(count, cols));
}

/**
 * Shrink a walkable `area` to the slice that's actually visible in the map viewport, keeping it
 * CENTERED on the area's center (so it stays over the walkable ground). When the viewport is at
 * least as large as the area in a dimension, that dimension is left unchanged. Used so that when
 * the camp map is narrowed (the 50/50 & 30/70 layout modes), the orc cells re-pack into the
 * visible band and the orcs "gather" on-screen instead of being pushed off the right edge.
 *
 * PURE & deterministic (no Date.now / Math.random). `viewport` is in the same logical px as `area`
 * (BASE_SCALE = 1). `pad` insets the slice from the viewport edges so edge sprites keep some
 * breathing room. A zero/empty viewport (not yet measured) returns the area unchanged.
 */
export function gatherArea(area: Rect, viewport: { w: number; h: number }, pad = 0): Rect {
  if (viewport.w <= 0 || viewport.h <= 0) return area;
  const w = Math.min(area.w, Math.max(1, viewport.w - 2 * pad));
  const h = Math.min(area.h, Math.max(1, viewport.h - 2 * pad));
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

/**
 * Lay `count` non-overlapping cells over `area`, row-major. cells[i] is the home of the orc at
 * sequential index `i`. Returns [] for count ≤ 0; count === 1 yields the whole area as one cell.
 */
export function computeCells(area: Rect, count: number): Cell[] {
  if (count <= 0) return [];
  const cols = gridCols(count, area.w, area.h);
  const rows = Math.max(1, Math.ceil(count / cols));
  const cellW = area.w / cols;
  const cellH = area.h / rows;
  const cells: Cell[] = [];
  for (let i = 0; i < count; i += 1) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const rect: Rect = { x: area.x + c * cellW, y: area.y + r * cellH, w: cellW, h: cellH };
    cells.push({ rect, center: { x: rect.x + cellW / 2, y: rect.y + cellH / 2 } });
  }
  return cells;
}

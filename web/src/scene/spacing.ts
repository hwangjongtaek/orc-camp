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

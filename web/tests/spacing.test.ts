/**
 * SPEC-301 §2.4b (#51) — personal-space bubble grid (pure, deterministic).
 */
import { describe, it, expect } from 'vitest';
import { computeCells, gridCols } from '../src/scene/spacing';
import type { Rect } from '../src/scene/stations';

const area: Rect = { x: 1000, y: 600, w: 1320, h: 800 };

/** Positive overlap area of two rects (0 when they only touch / are disjoint). */
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return Math.max(0, w) * Math.max(0, h);
}

describe('computeCells', () => {
  it('returns one full-area cell for a single orc and none for zero', () => {
    expect(computeCells(area, 0)).toEqual([]);
    const [only] = computeCells(area, 1);
    expect(only?.rect).toEqual(area);
    expect(only?.center).toEqual({ x: area.x + area.w / 2, y: area.y + area.h / 2 });
  });

  it('cells never overlap and every orc gets a distinct cell (the bubble guarantee)', () => {
    for (const count of [2, 3, 5, 8, 20, 100]) {
      const cells = computeCells(area, count);
      expect(cells).toHaveLength(count);
      for (let i = 0; i < cells.length; i += 1) {
        for (let j = i + 1; j < cells.length; j += 1) {
          expect(overlap(cells[i]!.rect, cells[j]!.rect)).toBeLessThanOrEqual(1e-6);
        }
      }
      const centers = new Set(cells.map((c) => `${c.center.x.toFixed(2)},${c.center.y.toFixed(2)}`));
      expect(centers.size).toBe(count);
    }
  });

  it('cells stay inside the walkable area', () => {
    for (const c of computeCells(area, 12)) {
      expect(c.rect.x).toBeGreaterThanOrEqual(area.x - 1e-6);
      expect(c.rect.y).toBeGreaterThanOrEqual(area.y - 1e-6);
      expect(c.rect.x + c.rect.w).toBeLessThanOrEqual(area.x + area.w + 1e-6);
      expect(c.rect.y + c.rect.h).toBeLessThanOrEqual(area.y + area.h + 1e-6);
    }
  });

  it('spreads orcs across the whole map (centers span most of the area)', () => {
    const cells = computeCells(area, 9);
    const xs = cells.map((c) => c.center.x);
    const ys = cells.map((c) => c.center.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(area.w * 0.5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(area.h * 0.4);
  });

  it('gridCols keeps cells near-square (more columns for a wide area)', () => {
    expect(gridCols(1, 1000, 800)).toBe(1);
    expect(gridCols(4, 800, 800)).toBe(2); // square area → 2×2
    expect(gridCols(4, 3200, 200)).toBeGreaterThan(2); // very wide → more columns
  });

  it('is deterministic', () => {
    expect(computeCells(area, 7)).toEqual(computeCells(area, 7));
  });
});

/**
 * SPEC-300 §2.6 / SPEC-301 §2.8 — pure rich-map depth toolkit.
 *
 * Covers: Wang mask→bbox selection + base fallback (SPEC-300-AC-14), terrain field
 * purity/determinism + no server coords/RNG (SPEC-301-AC-15), flat-fallback mandatory
 * accent variety / no single-tile regression (SPEC-300-AC-15, SPEC-301-AC-20), decor
 * determinism + reserved-prop exclusion + keep-out (SPEC-300-AC-17, SPEC-301-AC-18), and
 * backdrop parallax transform-only + reduced-motion off (SPEC-301-AC-16/AC-19).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  cornerMask,
  decorPlacements,
  flatAccentForCell,
  hashInt,
  isReservedRef,
  makeTerrainField,
  parallaxTransform,
  wangBBox,
  DECOR_MAX,
  TERRAIN_TILE,
} from '../src/scene/terrain';
import type { WangDef } from '../src/assets/manifest';
import { innerRect, stationAnchor, zoneRect, mapDims } from '../src/scene/layout';
import { SCALED_FOOTPRINT, ZONE_HEADER_H } from '../src/scene/stations';
import { STATUS_KEYS, type OrcStatus } from '../src/types/domain';

const WANG: WangDef = {
  kind: 'corner',
  corner_count: 4,
  terrains: ['moss', 'dirt'],
  base_terrain: 'moss',
  corner_order: ['NW', 'NE', 'SE', 'SW'],
  base_tile_ids: { moss: '0000', dirt: '1111' },
  tiles: {
    '0000': { x: 64, y: 32, w: 32, h: 32 },
    '0001': { x: 64, y: 64, w: 32, h: 32 },
    '0010': { x: 96, y: 32, w: 32, h: 32 },
    '0011': { x: 32, y: 64, w: 32, h: 32 },
    '0100': { x: 64, y: 0, w: 32, h: 32 },
    '0101': { x: 0, y: 32, w: 32, h: 32 },
    '0110': { x: 96, y: 64, w: 32, h: 32 },
    '0111': { x: 96, y: 96, w: 32, h: 32 },
    '1000': { x: 32, y: 32, w: 32, h: 32 },
    '1001': { x: 32, y: 0, w: 32, h: 32 },
    '1010': { x: 64, y: 96, w: 32, h: 32 },
    '1011': { x: 0, y: 64, w: 32, h: 32 },
    '1100': { x: 96, y: 0, w: 32, h: 32 },
    '1101': { x: 32, y: 96, w: 32, h: 32 },
    '1110': { x: 0, y: 0, w: 32, h: 32 },
    '1111': { x: 0, y: 96, w: 32, h: 32 },
  },
};

describe('SPEC-300-AC-14 Wang corner mask → bbox selection', () => {
  it('AC-14: cornerMask samples shared corners in corner_order (MSB→LSB)', () => {
    // field with ONLY the NE corner of cell (0,0) = dirt → mask 0100
    const field = { terrainAt: (x: number, y: number) => (x === 1 && y === 0 ? 1 : 0) as 0 | 1 };
    expect(cornerMask(field, 0, 0, WANG.corner_order)).toBe('0100');
    expect(wangBBox(WANG, '0100')).toEqual({ x: 64, y: 0, w: 32, h: 32 });
  });

  it('AC-14: every 4-bit mask resolves to a distinct declared bbox', () => {
    const seen = new Set<string>();
    for (let m = 0; m < 16; m += 1) {
      const mask = m.toString(2).padStart(4, '0');
      const bb = wangBBox(WANG, mask);
      seen.add(`${bb.x},${bb.y}`);
    }
    expect(seen.size).toBe(16); // all 16 tiles are distinct sheet positions
  });

  it('AC-14: a missing/unknown mask degrades to the base-terrain fill (no gap)', () => {
    expect(wangBBox(WANG, 'zzzz')).toEqual(WANG.tiles['0000']); // base_terrain = moss = "0000"
  });
});

describe('SPEC-301-AC-15 terrain field purity / determinism / no server coords', () => {
  const geom = { world: { w: 1200, h: 900 }, zones: [{ x: 0, y: 0, w: 1200, h: 900 }] };

  it('AC-15: terrainAt is pure — repeated calls + rebuilt field are byte-identical', () => {
    const a = makeTerrainField(geom);
    const b = makeTerrainField(geom);
    for (let cy = 0; cy < 14; cy += 1) {
      for (let cx = 0; cx < 18; cx += 1) {
        const v = a.terrainAt(cx, cy);
        expect(a.terrainAt(cx, cy)).toBe(v); // repeat call stable
        expect(b.terrainAt(cx, cy)).toBe(v); // independent build identical
      }
    }
  });

  it('AC-15: field has variety (both moss and dirt) — never a single-terrain plane', () => {
    const f = makeTerrainField(geom);
    const vals = new Set<number>();
    for (let cy = 0; cy < 14; cy += 1)
      for (let cx = 0; cx < 18; cx += 1) vals.add(f.terrainAt(cx, cy));
    expect(vals.has(0)).toBe(true);
    expect(vals.has(1)).toBe(true);
  });

  it('AC-15: gutter/margin corners (outside every zone) classify as dirt path', () => {
    const f = makeTerrainField(geom);
    // a corner far outside the single zone (world margin)
    expect(f.terrainAt(100, 100)).toBe(1);
  });

  it('AC-15: hashInt is a deterministic integer hash (no RNG)', () => {
    expect(hashInt(3, 7)).toBe(hashInt(3, 7));
    expect(Number.isInteger(hashInt(3, 7))).toBe(true);
    expect(hashInt(3, 7)).not.toBe(hashInt(7, 3)); // order-sensitive
  });

  it('AC-14/AC-15: terrain.ts CODE uses NO Math.random / Date.now / performance.now', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../src/scene/terrain.ts'), 'utf8');
    // strip block + line comments so docstrings mentioning the APIs don't false-positive
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/Math\.random/);
    expect(code).not.toMatch(/Date\.now/);
    expect(code).not.toMatch(/performance\.now/);
  });
});

describe('SPEC-300-AC-15 / SPEC-301-AC-20 flat-fallback accent (no single repeated tile)', () => {
  const accentKeys = ['packed-dirt', 'stone-path', 'variation-08', 'variation-12'];

  it('AC-15: accent scatter is deterministic per cell', () => {
    for (let cy = 0; cy < 12; cy += 1)
      for (let cx = 0; cx < 12; cx += 1)
        expect(flatAccentForCell(cx, cy, accentKeys)).toBe(flatAccentForCell(cx, cy, accentKeys));
  });

  it('AC-15: produces MULTIPLE distinct accents + base cells (not a single repeated tile)', () => {
    const distinct = new Set<string>();
    let baseCells = 0;
    for (let cy = 0; cy < 16; cy += 1) {
      for (let cx = 0; cx < 16; cx += 1) {
        const a = flatAccentForCell(cx, cy, accentKeys);
        if (a === null) baseCells += 1;
        else distinct.add(a);
      }
    }
    expect(distinct.size).toBeGreaterThanOrEqual(2); // genuine variety
    expect(baseCells).toBeGreaterThan(0); // base + accent mix, not all-accent either
  });

  it('AC-15: empty accent set is safe (returns null)', () => {
    expect(flatAccentForCell(1, 2, [])).toBeNull();
  });
});

describe('SPEC-300-AC-17 / SPEC-301-AC-18 decor scatter determinism + exclusion + keep-out', () => {
  const dims = mapDims(1);
  const rect = zoneRect(0, [0], dims);
  const inner = innerRect(rect);
  const items = [
    { ref: 'props/log-pile', weight: 3 },
    { ref: 'props/barrel', weight: 2 },
    { ref: 'wartable-warbase/ember-brazier', weight: 1 },
    { ref: 'props/campfire', weight: 5 }, // RESERVED station prop — must be excluded
  ];

  it('AC-18: isReservedRef flags station/header props, not decor props', () => {
    expect(isReservedRef('props/campfire')).toBe(true);
    expect(isReservedRef('props/workbench')).toBe(true);
    expect(isReservedRef('command-tent')).toBe(true);
    expect(isReservedRef('props/log-pile')).toBe(false);
    expect(isReservedRef('wartable-warbase/ember-brazier')).toBe(false);
  });

  it('AC-18: decorPlacements is deterministic (identical set on repeat)', () => {
    const a = decorPlacements({ zoneIndex: 0, rect, items });
    const b = decorPlacements({ zoneIndex: 0, rect, items });
    expect(a).toEqual(b);
  });

  it('AC-17: reserved props never appear; count within DECOR_MAX', () => {
    const placed = decorPlacements({ zoneIndex: 0, rect, items });
    expect(placed.length).toBeLessThanOrEqual(DECOR_MAX);
    for (const inst of placed) expect(isReservedRef(inst.ref)).toBe(false);
  });

  it('AC-18: placements avoid station anchors/ring + the zone header band', () => {
    const placed = decorPlacements({ zoneIndex: 0, rect, items });
    expect(placed.length).toBeGreaterThan(0);
    const stations = STATUS_KEYS.map((s: OrcStatus) => stationAnchor(s, inner));
    const keepR = SCALED_FOOTPRINT * 0.55;
    for (const inst of placed) {
      for (const st of stations) {
        expect(Math.hypot(inst.x - st.x, inst.y - st.y)).toBeGreaterThanOrEqual(keepR - 0.001);
      }
      expect(inst.y).toBeGreaterThan(rect.y + ZONE_HEADER_H); // below the header band
    }
  });

  it('AC-18: distinct zones (different seed) yield distinct scatter', () => {
    const z0 = decorPlacements({ zoneIndex: 0, rect, items });
    const z1 = decorPlacements({ zoneIndex: 1, rect, items });
    expect(z0).not.toEqual(z1);
  });
});

describe('SPEC-301-AC-16 / AC-19 backdrop parallax (transform-only, reduced-motion off)', () => {
  it('AC-16: transform = scroll × parallax (slower than 1× terrain)', () => {
    expect(parallaxTransform(100, 200, 0.3, false)).toBe('translate(30px, 60px)');
    expect(parallaxTransform(100, 200, 1, false)).toBe('translate(100px, 200px)'); // pinned
    expect(parallaxTransform(0, 0, 0.3, false)).toBe('translate(0px, 0px)');
  });

  it('AC-19: reduced-motion disables parallax (no transform)', () => {
    expect(parallaxTransform(100, 200, 0.3, true)).toBe('translate(0px, 0px)');
  });

  it('AC-16: cell size matches the declared on-screen terrain tile', () => {
    expect(TERRAIN_TILE).toBeGreaterThan(0);
  });
});

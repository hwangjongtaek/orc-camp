/**
 * SPEC-301 §2.1 image-ground mode — ground geometry + ratio gate + image-ground layout.
 *
 * Validates the walkable-area contract for the default background `orccamp-default`: the polygon
 * area (shoelace), the ratio gate (a new background must have walkable ratio ≥ reference), and the
 * image-ground layout (world = native image size; every orc target stays inside the walkable rect;
 * deterministic). Also asserts the manifest actually registers the background per the contract.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  REFERENCE_GROUND_RATIO,
  clampToRect,
  groundFromBackground,
  groundRatio,
  meetsGroundRatio,
  pointInPolygon,
  shoelaceArea,
} from '../src/scene/ground';
import { computeLayout, type OrcMapInput } from '../src/scene/layout';
import type { BackgroundDef } from '../src/assets/manifest';
import type { OrcStatus } from '../src/types/domain';

const here = dirname(fileURLToPath(import.meta.url));

// World = 2× native (the background is rendered at a fixed 2× so orcs keep original sprite size);
// ground coords are in this 2× logical space. Ratio is scale-invariant (still 0.2815).
const DEFAULT_POLY: [number, number][] = [
  [1080, 910],
  [2400, 910],
  [3000, 1380],
  [2660, 1800],
  [880, 1800],
  [580, 1270],
];
const WORLD = { w: 3344, h: 1882 };
const SAFE: [number, number, number, number] = [1080, 950, 1320, 800];

const defaultBg: BackgroundDef = {
  file: 'backgrounds/orccamp-default-background.png',
  logical_size: [WORLD.w, WORLD.h],
  safe_area: SAFE,
  ground: { polygon: DEFAULT_POLY, area: 1771900, ratio: 0.2815 },
};

const asVecs = (poly: [number, number][]): { x: number; y: number }[] =>
  poly.map(([x, y]) => ({ x, y }));

function mkOrc(id: string, paneId: string, windowIndex: number, status: OrcStatus): OrcMapInput {
  return { id, paneId, windowIndex, status };
}

describe('SPEC-301-AC-23 ground polygon area (shoelace)', () => {
  it('default background polygon area === 1771900 px² (2× world)', () => {
    expect(shoelaceArea(asVecs(DEFAULT_POLY))).toBe(1771900);
  });
});

describe('SPEC-301-AC-23 ground ratio = area / (w*h)', () => {
  it('default ratio rounds to 0.282 and matches the stored field', () => {
    const r = groundRatio(asVecs(DEFAULT_POLY), WORLD);
    expect(Number(r.toFixed(3))).toBe(0.282);
    expect(Math.abs(r - 0.2815)).toBeLessThan(1e-3);
  });
});

describe('SPEC-301-AC-23 safe_area is inscribed in the polygon', () => {
  it('all four safe_area corners are inside ground.polygon', () => {
    const [x, y, w, h] = SAFE;
    const corners = [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
    for (const c of corners) expect(pointInPolygon(c, asVecs(DEFAULT_POLY))).toBe(true);
  });
});

describe('SPEC-301-AC-23 ground-ratio registration gate', () => {
  it('accepts the reference background (0.2815 ≥ 0.281)', () => {
    const res = meetsGroundRatio(asVecs(DEFAULT_POLY), WORLD);
    expect(res.ok).toBe(true);
    expect(res.ratio).toBeGreaterThanOrEqual(REFERENCE_GROUND_RATIO);
  });

  it('rejects a background with a smaller walkable ratio, with a reason', () => {
    // a tiny 100×100 box in the same world → ratio ≈ 0.0064 < 0.281
    const small: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const res = meetsGroundRatio(asVecs(small), WORLD);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/ground_ratio/);
  });
});

describe('clampToRect keeps a point inside the inset rect', () => {
  it('projects an out-of-rect point onto the margin-inset edge', () => {
    const rect = { x: 540, y: 475, w: 660, h: 400 };
    const p = clampToRect({ x: 5000, y: -5000 }, rect, 35);
    expect(p.x).toBe(540 + 660 - 35);
    expect(p.y).toBe(475 + 35);
  });
});

describe('SPEC-301-AC-22 groundFromBackground', () => {
  it('builds a ground context when logical_size + polygon are present', () => {
    const g = groundFromBackground(defaultBg);
    expect(g).not.toBeNull();
    expect(g!.world).toEqual(WORLD);
    expect(g!.safeArea).toEqual({ x: 1080, y: 950, w: 1320, h: 800 });
    expect(g!.polygon.length).toBe(6);
  });

  it('returns null for a background without a ground polygon (→ legacy zone-grid mode)', () => {
    expect(groundFromBackground({ file: 'x.png', logical_size: [1672, 941] })).toBeNull();
    expect(groundFromBackground(null)).toBeNull();
  });
});

describe('SPEC-301-AC-22 image-ground layout places every orc inside the walkable rect', () => {
  const ground = groundFromBackground(defaultBg)!;
  const MARGIN = 104.4; // (232 * 0.9) / 2 — original sprite half-footprint

  it('world = native image size; targets stay inside safe_area; deterministic', () => {
    const orcs: OrcMapInput[] = [
      mkOrc('a', '%1', 0, 'active'),
      mkOrc('b', '%2', 0, 'active'),
      mkOrc('c', '%3', 1, 'idle'),
      mkOrc('d', '%4', 2, 'error'),
      mkOrc('e', '%5', 0, 'terminated'),
      mkOrc('f', '%6', 0, 'terminated'),
    ];
    const a = computeLayout(orcs, ground);
    expect(a.dims.world).toEqual(WORLD);
    for (const o of orcs) {
      const t = a.targets.get(o.id)!.target;
      expect(t.x).toBeGreaterThanOrEqual(ground.safeArea.x + MARGIN - 0.001);
      expect(t.x).toBeLessThanOrEqual(ground.safeArea.x + ground.safeArea.w - MARGIN + 0.001);
      expect(t.y).toBeGreaterThanOrEqual(ground.safeArea.y + MARGIN - 0.001);
      expect(t.y).toBeLessThanOrEqual(ground.safeArea.y + ground.safeArea.h - MARGIN + 0.001);
    }
    // deterministic: identical inputs → identical targets
    const b = computeLayout(orcs, ground);
    for (const o of orcs) {
      expect(b.targets.get(o.id)!.target).toEqual(a.targets.get(o.id)!.target);
    }
  });

  it('same-status orcs in different windows get distinct ground slots (status-keyed peers)', () => {
    const orcs: OrcMapInput[] = [
      mkOrc('a', '%1', 0, 'active'),
      mkOrc('b', '%2', 1, 'active'),
    ];
    const lay = computeLayout(orcs, ground);
    const ta = lay.targets.get('a')!.target;
    const tb = lay.targets.get('b')!.target;
    expect(ta).not.toEqual(tb);
    // zoneIndex still tracks the window rank (keyboard grouping preserved)
    expect(lay.targets.get('a')!.zoneIndex).toBe(0);
    expect(lay.targets.get('b')!.zoneIndex).toBe(1);
  });
});

describe('SPEC-301 manifest registers orccamp-default per the ground contract', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(here, '../../asset-packs/orc-camp-default/manifest.json'), 'utf8'),
  ) as { backgrounds: Record<string, BackgroundDef>; scene: { backdrop: { background_ref: string } } };

  it('default backdrop points at orccamp-default with logical_size + a gate-passing ground', () => {
    expect(manifest.scene.backdrop.background_ref).toBe('orccamp-default');
    const bg = manifest.backgrounds['orccamp-default']!;
    expect(bg.logical_size).toEqual([3344, 1882]);
    const g = groundFromBackground(bg)!;
    expect(g).not.toBeNull();
    const gate = meetsGroundRatio(g.polygon, g.world);
    expect(gate.ok).toBe(true);
  });
});

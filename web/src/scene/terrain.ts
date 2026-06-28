/**
 * SPEC-301 §2.8 + SPEC-300 §2.6 — PURE deterministic rich-map depth toolkit.
 *
 * Everything here is a pure function of integer world coordinates / layout geometry +
 * client constants. There is NO Math.random / Date.now / server coordinate anywhere
 * (INV-1; SPEC-301-AC-15/AC-18). Given the same world (window set + MapDims) the terrain
 * field, Wang tile selection, flat-fallback accent, and decor scatter are byte-identical on
 * every call, so the same scene re-renders identically after scroll/refresh.
 *
 * Ownership split: this module decides WHAT terrain/decor goes WHERE (field, scatter,
 * mask assembly) — the manifest (SPEC-300 §2.5) supplies the tile sheet/bbox and decor
 * sprites that the layer components paint.
 */
import type { WangDef, WangTileBBox } from '../assets/manifest';
import { innerRect, stationAnchor } from './layout';
import { SCALED_FOOTPRINT, ZONE_HEADER_H, type Rect, type Vec2 } from './stations';
import { STATUS_KEYS, type OrcStatus } from '../types/domain';

/** On-screen logical size of one terrain cell (the 32px sheet tile is drawn at this size). */
export const TERRAIN_TILE = 64;
export const DEFAULT_CORNER_ORDER = ['NW', 'NE', 'SE', 'SW'] as const;

/** Deterministic 32-bit integer hash of two ints (+ optional seed). Pure — no RNG/clock. */
export function hashInt(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

// --- terrain field (§2.8b) ---

export interface TerrainGeom {
  world: { w: number; h: number };
  zones: Rect[]; // absolute zone rectangles (gutters between them become dirt paths)
}

export interface TerrainField {
  /** terrain index at a world CORNER lattice point: 0 = moss (base), 1 = dirt (accent). */
  terrainAt(cornerX: number, cornerY: number): 0 | 1;
}

// Field tuning (hypothesis, Q6): patch density + sparse sprinkle. Structure (deterministic,
// no RNG) is fixed; only the thresholds are tunable.
const REGION = 3; // coarse blob size (cells) → trodden-dirt patches
const DIRT_BLOB_PCT = 26; // % of coarse regions that are dirt patches
const SPRINKLE_MOD = 13; // 1/13 corners get a sparse dirt fleck

function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/**
 * Build the deterministic terrain field for a world. Corners inside a zone are mostly moss
 * with deterministic dirt patches + sprinkle; corners in the gutters/margins between zones
 * are dirt paths. The field never reads asset data, so terrain placement is identical with
 * or without the tileset (placeholder parity / zero layout shift, §3.4).
 */
export function makeTerrainField(geom: TerrainGeom): TerrainField {
  const zones = geom.zones;
  return {
    terrainAt(cx: number, cy: number): 0 | 1 {
      const wx = cx * TERRAIN_TILE;
      const wy = cy * TERRAIN_TILE;
      const inAnyZone = zones.some((z) => pointInRect(wx, wy, z));
      if (!inAnyZone) return 1; // gutter / world margin → dirt path
      const rx = Math.floor(cx / REGION);
      const ry = Math.floor(cy / REGION);
      if (hashInt(rx, ry, 11) % 100 < DIRT_BLOB_PCT) return 1; // trodden patch
      if (hashInt(cx, cy, 7) % SPRINKLE_MOD === 0) return 1; // sparse fleck
      return 0;
    },
  };
}

// --- Wang corner auto-tiling (§2.6a) ---

/** Assemble the 4-bit corner mask for a cell, sampling shared lattice corners (§2.6a-2). */
export function cornerMask(
  field: TerrainField,
  cellX: number,
  cellY: number,
  order: readonly string[] = DEFAULT_CORNER_ORDER,
): string {
  const sample = (corner: string): 0 | 1 => {
    switch (corner) {
      case 'NW':
        return field.terrainAt(cellX, cellY);
      case 'NE':
        return field.terrainAt(cellX + 1, cellY);
      case 'SE':
        return field.terrainAt(cellX + 1, cellY + 1);
      case 'SW':
        return field.terrainAt(cellX, cellY + 1);
      default:
        return 0;
    }
  };
  return order.map((c) => String(sample(c))).join('');
}

/** Resolve a mask → source bbox; missing mask degrades to the base-terrain fill (§2.6a-5). */
export function wangBBox(wang: WangDef, mask: string): WangTileBBox {
  const hit = wang.tiles[mask];
  if (hit) return hit;
  const baseMask = wang.base_tile_ids[wang.base_terrain] ?? '0000';
  const base = wang.tiles[baseMask];
  if (base) return base;
  // Absolute last resort: first declared tile (never reached for a complete 16-tile set).
  const first = Object.values(wang.tiles)[0];
  return first ?? { x: 0, y: 0, w: 32, h: 32 };
}

// --- flat-variant fallback accent (§2.6d / §3.9 — NEVER a single repeated tile) ---

/**
 * Deterministic accent tile key for a flat-fallback cell, or null for a base cell. Spreads
 * the variation tiles so the L1 (flat) ground is never a single repeated tile (SPEC-300
 * §3.9 / AC-15, SPEC-301-AC-20). Pure: same cell ⇒ same accent.
 */
export function flatAccentForCell(
  cellX: number,
  cellY: number,
  accentKeys: string[],
): string | null {
  if (accentKeys.length === 0) return null;
  const h = hashInt(cellX, cellY, 23);
  if (h % 10 < 3) return accentKeys[(h >>> 4) % accentKeys.length] ?? null; // ≈30% accented
  return null;
}

// --- decor scatter (§2.8c) ---

/** Station / zone-header props that must NEVER be used as decor (§2.5c, AC-17). */
export const RESERVED_PROPS: ReadonlySet<string> = new Set([
  'workbench',
  'campfire',
  'bedroll',
  'notice-board',
  'stone-marker',
  'utility-totem',
  'locked-chest',
  'command-tent',
  'banner-pole',
]);

/** True if a `group/name` decor ref names a reserved station/header prop. */
export function isReservedRef(ref: string): boolean {
  const name = ref.includes('/') ? ref.slice(ref.indexOf('/') + 1) : ref;
  return RESERVED_PROPS.has(name);
}

export const DECOR_MAX = 6; // §2.8c-3 per-zone budget (hypothesis)
export const DECOR_SIZE = 96; // logical px footprint of a decor sprite (64px art upscaled)

export interface DecorWeightedItem {
  ref: string;
  weight: number;
}

export interface DecorInstance {
  ref: string; // 'group/name'
  group: string;
  name: string;
  x: number; // world center x
  y: number; // world center y
  size: number;
  key: string;
}

function weightedPick(items: DecorWeightedItem[], roll: number): DecorWeightedItem {
  const total = items.reduce((s, it) => s + Math.max(0, it.weight), 0) || items.length;
  let r = roll % total;
  for (const it of items) {
    r -= Math.max(0, it.weight) || 1;
    if (r < 0) return it;
  }
  return items[items.length - 1]!;
}

/**
 * Deterministic per-zone decor scatter (§2.8c). seed = zoneIndex. Candidates avoid the 7
 * station anchors (+ their slot ring), the zone header band, and the world margin; rejected
 * candidates are simply dropped (non-load-bearing). Same (zoneIndex, rect, items) ⇒ same set.
 */
export function decorPlacements(args: {
  zoneIndex: number;
  rect: Rect;
  items: DecorWeightedItem[];
  max?: number;
  size?: number;
}): DecorInstance[] {
  const { zoneIndex, rect } = args;
  const items = args.items.filter((it) => !isReservedRef(it.ref));
  if (items.length === 0) return [];
  const max = args.max ?? DECOR_MAX;
  const size = args.size ?? DECOR_SIZE;

  const inner = innerRect(rect);
  // Keep-out: a station anchor + ~half a sprite footprint (covers the inner slot ring).
  const keepR = SCALED_FOOTPRINT * 0.55;
  const stations: Vec2[] = STATUS_KEYS.map((s: OrcStatus) => stationAnchor(s, inner));
  const headerBottom = rect.y + ZONE_HEADER_H; // header band along the zone top

  const margin = size / 2 + 8;
  const minX = rect.x + margin;
  const maxX = rect.x + rect.w - margin;
  const minY = headerBottom + margin;
  const maxY = rect.y + rect.h - margin;

  const placed: DecorInstance[] = [];
  const attempts = max * 8;
  for (let i = 0; i < attempts && placed.length < max; i += 1) {
    const hx = hashInt(zoneIndex, i, 101);
    const hy = hashInt(zoneIndex, i, 211);
    const x = minX + ((hx % 100000) / 100000) * (maxX - minX);
    const y = minY + ((hy % 100000) / 100000) * (maxY - minY);

    // reject near any station (anchor + ring) or other placed decor
    let ok = true;
    for (const st of stations) {
      if (Math.hypot(x - st.x, y - st.y) < keepR) {
        ok = false;
        break;
      }
    }
    if (ok) {
      for (const p of placed) {
        if (Math.hypot(x - p.x, y - p.y) < size) {
          ok = false;
          break;
        }
      }
    }
    if (!ok) continue;

    const pick = weightedPick(items, hashInt(zoneIndex, i, 7));
    const slash = pick.ref.indexOf('/');
    const group = slash >= 0 ? pick.ref.slice(0, slash) : 'props';
    const name = slash >= 0 ? pick.ref.slice(slash + 1) : pick.ref;
    placed.push({ ref: pick.ref, group, name, x, y, size, key: `${zoneIndex}:${i}` });
  }
  return placed;
}

// --- backdrop parallax (§2.8a) ---

/**
 * Backdrop transform for a scroll offset (§2.8a): translate = scroll × parallax, so a
 * parallax of 0.3 makes the backdrop move at 0.3× and appear behind the 1× terrain; 1.0
 * pins it (infinitely far). reduced-motion disables parallax entirely (§3.5-4, AC-19). The
 * result is TRANSFORM-ONLY (no top/left/scroll mutation → zero layout shift, AC-16).
 */
export function parallaxTransform(
  scrollLeft: number,
  scrollTop: number,
  parallax: number,
  reducedMotion: boolean,
): string {
  if (reducedMotion) return 'translate(0px, 0px)';
  const f = Math.min(Math.max(parallax, 0), 1);
  return `translate(${scrollLeft * f}px, ${scrollTop * f}px)`;
}

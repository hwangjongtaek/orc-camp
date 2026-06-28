/**
 * SPEC-300 §2.6a/§3.9 + SPEC-301 §2.8b — world ground via corner-Wang auto-tiling.
 *
 * L0: corner-Wang tileset → per-cell tile selected by the deterministic terrain field
 *     (CSS background-image of the 4×4 sheet + per-cell background-position to the bbox,
 *     image-rendering:pixelated). Cells are rendered per zone (the playable ground); the
 *     gutters between zones reveal the backdrop/ground for depth.
 * L1: no Wang, flat-variant present → base `moss-ground` tiling + a MANDATORY deterministic
 *     accent scatter (so the flat path is NEVER a single repeated tile, §3.9/AC-15).
 * L2: no tileset → render nothing; CampMap's CSS gradient ground shows through.
 *
 * Terrain is a STATIC paint (no per-frame work, §3.5-1) and pointer-events:none. The field
 * is asset-independent, so terrain looks/places identically with or without the sheet (zero
 * layout shift / placeholder parity, AC-20).
 */
import { useMemo } from 'react';
import type { AssetManifest, TilesetDef } from '../../assets/manifest';
import type { ZoneInfo } from '../../scene/layout';
import {
  TERRAIN_TILE,
  cornerMask,
  flatAccentForCell,
  makeTerrainField,
  wangBBox,
} from '../../scene/terrain';

function findWang(manifest: AssetManifest | null): TilesetDef | null {
  const tilesets = manifest?.tilesets;
  if (!tilesets) return null;
  for (const ts of Object.values(tilesets)) {
    if (ts?.type === 'wang_corner' && ts.wang && ts.image) return ts;
  }
  return null;
}

interface CellRange {
  c0: number;
  c1: number;
  r0: number;
  r1: number;
}

function zoneCellRange(rect: ZoneInfo['rect']): CellRange {
  return {
    c0: Math.floor(rect.x / TERRAIN_TILE),
    c1: Math.ceil((rect.x + rect.w) / TERRAIN_TILE),
    r0: Math.floor(rect.y / TERRAIN_TILE),
    r1: Math.ceil((rect.y + rect.h) / TERRAIN_TILE),
  };
}

export function TerrainLayer({
  zones,
  world,
  manifest,
  assetBase,
}: {
  zones: ZoneInfo[];
  world: { w: number; h: number };
  manifest: AssetManifest | null;
  assetBase: string;
}): JSX.Element | null {
  const base = assetBase.replace(/\/+$/, '');
  const field = useMemo(
    () => makeTerrainField({ world, zones: zones.map((z) => z.rect) }),
    [world, zones],
  );

  const wang = findWang(manifest);
  const flat = manifest?.tilesets?.['orc-camp-terrain-square-topdown'] ?? null;

  // --- L0: Wang corner auto-tiling ---
  if (wang?.wang && wang.image) {
    const wdef = wang.wang;
    const sheet = `${base}/${wang.root}/${wang.image}`;
    const srcTile = wang.tile_size?.[0] ?? 32;
    const k = TERRAIN_TILE / srcTile; // source→logical scale
    const sheetW = (wang.image_size?.[0] ?? 128) * k;
    const sheetH = (wang.image_size?.[1] ?? 128) * k;
    return (
      <div className="oc-terrain" aria-hidden="true" data-testid="terrain-wang">
        {zones.map((zone) => {
          const { c0, c1, r0, r1 } = zoneCellRange(zone.rect);
          const cells: JSX.Element[] = [];
          for (let cy = r0; cy < r1; cy += 1) {
            for (let cx = c0; cx < c1; cx += 1) {
              const bb = wangBBox(wdef, cornerMask(field, cx, cy, wdef.corner_order));
              cells.push(
                <div
                  key={`${cx}:${cy}`}
                  className="oc-terrain__cell"
                  data-mask={cornerMask(field, cx, cy, wdef.corner_order)}
                  style={{
                    left: `${cx * TERRAIN_TILE - zone.rect.x}px`,
                    top: `${cy * TERRAIN_TILE - zone.rect.y}px`,
                    width: `${TERRAIN_TILE}px`,
                    height: `${TERRAIN_TILE}px`,
                    backgroundImage: `url("${sheet}")`,
                    backgroundPosition: `${-bb.x * k}px ${-bb.y * k}px`,
                    backgroundSize: `${sheetW}px ${sheetH}px`,
                  }}
                />,
              );
            }
          }
          return (
            <div
              key={zone.windowIndex}
              className="oc-terrain__zone"
              style={{
                left: `${zone.rect.x}px`,
                top: `${zone.rect.y}px`,
                width: `${zone.rect.w}px`,
                height: `${zone.rect.h}px`,
              }}
            >
              {cells}
            </div>
          );
        })}
      </div>
    );
  }

  // --- L1: flat-variant base + mandatory deterministic accent ---
  const baseFile = flat?.tiles?.['moss-ground'];
  if (flat?.tiles && baseFile) {
    const accentKeys = Object.keys(flat.tiles).filter((k) => k !== 'moss-ground');
    const baseUrl = `${base}/${flat.root}/${baseFile}`;
    return (
      <div className="oc-terrain" aria-hidden="true" data-testid="terrain-flat">
        {zones.map((zone) => {
          const { c0, c1, r0, r1 } = zoneCellRange(zone.rect);
          const accents: JSX.Element[] = [];
          for (let cy = r0; cy < r1; cy += 1) {
            for (let cx = c0; cx < c1; cx += 1) {
              const key = flatAccentForCell(cx, cy, accentKeys);
              const file = key ? flat.tiles?.[key] : undefined;
              if (!key || !file) continue;
              accents.push(
                <div
                  key={`${cx}:${cy}`}
                  className="oc-terrain__cell oc-terrain__accent"
                  data-accent={key}
                  style={{
                    left: `${cx * TERRAIN_TILE - zone.rect.x}px`,
                    top: `${cy * TERRAIN_TILE - zone.rect.y}px`,
                    width: `${TERRAIN_TILE}px`,
                    height: `${TERRAIN_TILE}px`,
                    backgroundImage: `url("${base}/${flat.root}/${file}")`,
                    backgroundSize: `${TERRAIN_TILE}px ${TERRAIN_TILE}px`,
                  }}
                />,
              );
            }
          }
          return (
            <div
              key={zone.windowIndex}
              className="oc-terrain__zone oc-terrain__zone--tiled"
              style={{
                left: `${zone.rect.x}px`,
                top: `${zone.rect.y}px`,
                width: `${zone.rect.w}px`,
                height: `${zone.rect.h}px`,
                backgroundImage: `url("${baseUrl}")`,
                backgroundSize: `${TERRAIN_TILE}px ${TERRAIN_TILE}px`,
              }}
            >
              {accents}
            </div>
          );
        })}
      </div>
    );
  }

  // --- L2: no tileset → CampMap's CSS gradient ground is the terrain ---
  return null;
}

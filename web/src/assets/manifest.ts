/**
 * SPEC-300 §2.2 — asset manifest types (consumed subset) + loader.
 *
 * SSOT is `asset-packs/orc-camp-default/manifest.json` (D-013). We resolve frame_size/
 * anchor/fps/frames/folders from the manifest — never hardcode them. The pack is fetched
 * from a runtime-configured base path; on any failure we return null and the renderer
 * degrades to the CSS pixel placeholder (SPEC-300 §3.6 L2).
 */

export interface AnimationDef {
  frames?: number;
  fps?: number;
  frame_pattern?: string;
  coverage?: string; // e.g. 'south-only' | 'none'
  folders?: Record<string, string>;
  runtime_behavior?: string;
}

export interface ReducedMotionDef {
  fallback_state: string;
  fallback_direction: string;
  fallback_frame: string; // relative to characterRoot
}

export interface CharacterDef {
  root: string; // relative to packRoot
  frame_size: [number, number];
  scale: number;
  anchor: [number, number];
  directions: string[];
  animations: Record<string, AnimationDef>;
  reduced_motion: ReducedMotionDef;
}

export interface StatusUiDef {
  root: string; // relative to packRoot
  items: Record<string, { file: string }>;
}

/** SPEC-301 §2.1 — camp-map background (logical size + play-field safe area). */
export interface BackgroundDef {
  file?: string; // relative to packRoot
  logical_size?: [number, number];
  safe_area?: [number, number, number, number]; // [x, y, w, h]
}

/** SPEC-301 §2.3/§2.2 — station + zone-header prop images. */
export interface PropsDef {
  root: string; // relative to packRoot
  items: Record<string, { file?: string }>;
}

/** SPEC-300 §2.5a — a single Wang tile's source rect inside the tileset sheet (px). */
export interface WangTileBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** SPEC-300 §2.5a — corner-based Wang tileset block (4-corner auto-tiling). */
export interface WangDef {
  kind: string; // 'corner'
  corner_count: number; // 4
  terrains: string[]; // ['moss','dirt'] — index 0 base, 1 accent
  base_terrain: string; // 'moss'
  corner_order: string[]; // ['NW','NE','SE','SW'] — mask bit order (MSB→LSB)
  base_tile_ids: Record<string, string>; // terrain → single-fill mask key
  tiles: Record<string, WangTileBBox>; // 4-bit mask → source bbox in the sheet
}

/**
 * SPEC-300 §2.5a / SPEC-301 §3.4 — terrain tileset. Flat `tiles_pro` variants expose a
 * `tiles` name→file map (accent/fallback); the `wang_corner` variant exposes `image`
 * (the 4×4 sheet) + a `wang` corner block (mask→bbox).
 */
export interface TilesetDef {
  type?: string; // 'tiles_pro' | 'wang_corner'
  root: string; // relative to packRoot
  tile_size?: [number, number];
  tile_count?: number;
  image?: string; // wang_corner: spritesheet filename relative to root
  image_size?: [number, number];
  tiles?: Record<string, string>; // flat variants: name → file
  wang?: WangDef; // wang_corner only
}

/** SPEC-300 §2.5b — non-constraining backdrop/horizon layer (references a background). */
export interface SceneBackdropDef {
  background_ref: string;
  role?: string;
  fit?: string; // 'cover-width'
  vertical_anchor?: string; // 'top'
  repeat_x?: boolean;
  parallax?: number; // 0..1 scroll ratio
}

/** SPEC-300 §2.5c — one decor source declaration (weighted). */
export interface SceneDecorItemDef {
  ref: string; // 'group/name'
  category?: string;
  weight?: number;
}

export interface SceneDecorDef {
  source_objects?: string[];
  items: SceneDecorItemDef[];
  exclude_reserved?: boolean;
  reserved?: string[]; // station/zone-header prop keys never used as decor
}

/** SPEC-300 §2.5d — per-sprite ground shadow declaration. */
export interface SceneShadowDef {
  mode: 'css' | 'asset';
  asset_ref?: string | null;
  css?: { shape?: string; opacity?: number; footprint_ratio?: number };
}

export interface SceneDef {
  backdrop?: SceneBackdropDef;
  decor?: SceneDecorDef;
  shadow?: SceneShadowDef;
}

export interface AssetManifest {
  characters: Record<string, CharacterDef>;
  backgrounds?: Record<string, BackgroundDef>;
  tilesets?: Record<string, TilesetDef>;
  scene?: SceneDef;
  objects?: {
    'status-ui'?: StatusUiDef;
    props?: PropsDef;
    /** Other prop groups (e.g. `wartable-warbase`) consumed by scene.decor (§2.6c). */
    [group: string]: PropsDef | StatusUiDef | undefined;
  };
}

export async function loadManifest(assetBase: string): Promise<AssetManifest | null> {
  try {
    const res = await fetch(`${assetBase}/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    return (await res.json()) as AssetManifest;
  } catch {
    return null;
  }
}

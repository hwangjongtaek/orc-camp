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

/**
 * SPEC-302 §2.1 — one prestige tier variant (tier 1..3) of a character. Geometry mirrors
 * CharacterDef (root/frame_size/anchor/animations/reduced_motion). `rotations` (dir → static frame
 * file, relative to the variant `root`) backs the §3.4 `static_tier` fallback when the variant has
 * no animation for the requested state. `animations` may be empty (current pack: T1 ships a partial
 * set, T2/T3 rotation-only). All fields beyond status/pixellab_character_id are optional so the
 * loader stays permissive.
 */
export interface PrestigeTierDef {
  tier: 1 | 2 | 3;
  label?: string;
  suffix?: string; // appearance-key suffix (e.g. '-veteran'); SPEC-302 §3.3 appearanceKey source
  status: 'planned' | 'staged' | 'available' | 'deprecated';
  pixellab_character_id: string | null;
  root?: string; // relative to packRoot
  frame_size?: [number, number];
  scale?: number;
  anchor?: [number, number];
  directions?: string[];
  rotations?: Record<string, string>; // dir → static frame file, relative to `root`
  animations?: Record<string, AnimationDef>;
  reduced_motion?: ReducedMotionDef;
}

/** SPEC-302 §2.1 — per-tier threshold override (manifest beats the §3.1 default seed when present). */
export interface PrestigeThresholdDef {
  min_tokens?: number;
  min_cost_usd?: number;
}

/**
 * SPEC-302 §2.1 — a character's usage-driven prestige block. Presence of this block is the
 * DATA-DRIVEN gate (SPEC-302 §3.2): only characters that carry it are eligible for a tier > 0.
 */
export interface PrestigeDef {
  note?: string;
  axis?: string; // 'cumulative_tokens'
  thresholds?: {
    tier1?: PrestigeThresholdDef;
    tier2?: PrestigeThresholdDef;
    tier3?: PrestigeThresholdDef;
  };
  tiers: PrestigeTierDef[];
}

export interface CharacterDef {
  root: string; // relative to packRoot
  frame_size: [number, number];
  scale: number;
  anchor: [number, number];
  directions: string[];
  /** Base static rotations (dir → file relative to `root`); optional, base path uses animations. */
  rotations?: Record<string, string>;
  animations: Record<string, AnimationDef>;
  reduced_motion: ReducedMotionDef;
  /** SPEC-302 §2.1 — usage-driven prestige tiers (absent ⇒ character is never tiered). */
  prestige?: PrestigeDef;
}

export interface StatusUiDef {
  root: string; // relative to packRoot
  items: Record<string, { file: string }>;
}

/** SPEC-304 §2.1 — BG-style 2:3 bust portrait for a single prestige tier. */
export interface PortraitTierDef {
  file: string; // relative to portraits root
  source_size?: [number, number]; // actual exported px (overrides item/block default)
}

/** SPEC-304 §2.1 — one character's portrait set (base + optional prestige tiers). */
export interface PortraitItemDef {
  file: string; // base portrait, relative to portraits root
  source_size?: [number, number]; // actual base px (overrides block default)
  tiers?: Record<string, PortraitTierDef>; // suffix → tier portrait (SPEC-302/doc13 suffixes)
}

/**
 * SPEC-304 §2.1 — character avatar portraits block (sibling to `characters`). Keyed by the same
 * character keys; `frame_aspect` is always "2:3" and the decorative frame is owned by the web UI.
 */
export interface PortraitsDef {
  version?: number;
  root: string; // relative to packRoot (e.g. 'portraits')
  frame_aspect?: string; // '2:3'
  source_size?: [number, number]; // block default (e.g. [512, 768])
  items: Record<string, PortraitItemDef>;
}

/**
 * SPEC-301 §2.1 — camp-map background. When `logical_size` + `ground` are present the image is
 * the WORLD (native resolution, drag-pan) and orcs are placed inside `ground` (image-ground
 * mode); otherwise the legacy zone-grid world is used (placeholder/fallback).
 */
export interface GroundPolyDef {
  polygon: [number, number][]; // image-px vertices (origin top-left), walkable area
  area?: number; // px² (shoelace) — recomputed at the gate, not trusted
  ratio?: number; // area / (logical_w × logical_h)
}
export interface BackgroundDef {
  file?: string; // relative to packRoot
  display_name?: string;
  aspect_ratio?: string;
  usage?: string;
  native_size?: [number, number]; // the PNG's native px (doc; the image is upscaled to logical_size)
  world_scale?: number; // logical_size / native_size factor (doc; e.g. 2 = fixed 2× world)
  logical_size?: [number, number]; // = world size in image-ground mode (native × world_scale)
  safe_area?: [number, number, number, number]; // [x, y, w, h] — inscribed walkable rect (logical px)
  ground?: GroundPolyDef; // walkable polygon (SPEC-301 ground contract; logical px)
  /** SPEC-303 — the epic monster NPC variant key shown on this background (forward link). */
  epic_monster?: string;
}

/**
 * SPEC-303 / 16-Epic-Monster-NPC — an epic ambient boss monster NPC. Mirrors CharacterDef but is
 * scene-bound (one per background), status-less, and non-interactive. `status:"available"` + a set
 * `pixellab_character_id` gate whether it renders (else not generated → not shown).
 */
export interface MonsterDef {
  display_name?: string;
  status?: string; // 'planned' | 'available' | 'deprecated' — render only when 'available'
  pixellab_character_id?: string | null;
  background?: string; // the background this monster belongs to (reverse link)
  body_type?: string;
  root: string; // relative to packRoot
  frame_size: [number, number];
  scale?: number;
  anchor: [number, number];
  directions?: string[];
  rotations?: Record<string, string>;
  animations: Record<string, AnimationDef>;
  reduced_motion?: ReducedMotionDef;
}

/** SPEC-301 §2.3/§2.2 — station + zone-header prop images. */
export interface PropsDef {
  root: string; // relative to packRoot
  items: Record<string, { file?: string }>;
}

/** SPEC-301 §2.6c (#51) — UI marker group (e.g. selection-markers), file paths relative to root. */
export interface UiGroupDef {
  root: string; // relative to packRoot
  size?: [number, number];
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
  /** SPEC-303 — epic ambient boss monster NPCs (one per background; status-gated, non-interactive). */
  monsters?: Record<string, MonsterDef>;
  backgrounds?: Record<string, BackgroundDef>;
  tilesets?: Record<string, TilesetDef>;
  scene?: SceneDef;
  objects?: {
    'status-ui'?: StatusUiDef;
    props?: PropsDef;
    /** Other prop groups (e.g. `wartable-warbase`) consumed by scene.decor (§2.6c). */
    [group: string]: PropsDef | StatusUiDef | undefined;
  };
  /** SPEC-301 §2.6c (#51) — UI marker groups (selection_markers, buttons, frames, …). */
  ui?: {
    selection_markers?: UiGroupDef;
    [group: string]: UiGroupDef | undefined;
  };
  /** SPEC-304 §2.1 — BG-style 2:3 bust portraits shown in the OrcInspector (Details) slot. */
  portraits?: PortraitsDef;
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

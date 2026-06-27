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

export interface AssetManifest {
  characters: Record<string, CharacterDef>;
  objects?: { 'status-ui'?: StatusUiDef };
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

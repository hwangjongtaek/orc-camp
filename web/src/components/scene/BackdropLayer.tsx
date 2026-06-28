/**
 * SPEC-300 §2.6b + SPEC-301 §2.8a — non-constraining backdrop / horizon layer.
 *
 * Resolves `scene.backdrop.background_ref` → `backgrounds[ref].file` and paints it as the
 * backmost world layer (cover-width, anchored top, repeat-x). It does NOT constrain the
 * world/zone/sprite coordinates (those are layout constants) — missing backdrop just leaves
 * the terrain as the background (§3.4). Parallax is applied by CampMap as a TRANSFORM only
 * (zero layout shift, AC-16); reduced-motion pins it (AC-19). The element is aria-hidden and
 * pointer-events:none so it never intercepts selection/keyboard.
 */
import { forwardRef } from 'react';
import type { AssetManifest } from '../../assets/manifest';

function backdropSrc(manifest: AssetManifest | null, assetBase: string): string | null {
  const bd = manifest?.scene?.backdrop;
  if (!bd?.background_ref) return null;
  const bg = manifest?.backgrounds?.[bd.background_ref];
  if (!bg?.file) return null;
  return `${assetBase.replace(/\/+$/, '')}/${bg.file}`;
}

export const BackdropLayer = forwardRef<
  HTMLDivElement,
  { manifest: AssetManifest | null; assetBase: string }
>(function BackdropLayer({ manifest, assetBase }, ref): JSX.Element | null {
  const src = backdropSrc(manifest, assetBase);
  if (!src) return null;
  const repeatX = manifest?.scene?.backdrop?.repeat_x ?? true;
  return (
    <div
      ref={ref}
      className="oc-map__backdrop"
      aria-hidden="true"
      data-testid="map-backdrop"
      style={{
        backgroundImage: `url("${src}")`,
        backgroundRepeat: repeatX ? 'repeat-x' : 'no-repeat',
      }}
    />
  );
});

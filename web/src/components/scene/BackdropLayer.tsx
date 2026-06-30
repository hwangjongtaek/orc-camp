/**
 * SPEC-300 §2.6b + SPEC-301 §2.8a — full-cover background image layer.
 *
 * Resolves `scene.backdrop.background_ref` → `backgrounds[ref].file` and paints it as the
 * backmost world layer, covering the ENTIRE world (background-size: cover, centered). This
 * replaces the per-zone Wang/flat terrain tiling: a single background image IS the ground.
 * It does NOT constrain the world/zone/sprite coordinates (those are layout constants) — a
 * missing backdrop just leaves the CSS gradient ground as the background (§3.4). The element
 * is static (no parallax → zero layout shift, AC-16), aria-hidden, and pointer-events:none so
 * it never intercepts selection/keyboard.
 */
import type { AssetManifest } from '../../assets/manifest';

function backdropSrc(
  manifest: AssetManifest | null,
  assetBase: string,
  backgroundRef?: string | null,
): string | null {
  const ref = backgroundRef ?? manifest?.scene?.backdrop?.background_ref;
  if (!ref) return null;
  const bg = manifest?.backgrounds?.[ref];
  if (!bg?.file) return null;
  return `${assetBase.replace(/\/+$/, '')}/${bg.file}`;
}

export function BackdropLayer({
  manifest,
  assetBase,
  backgroundRef,
}: {
  manifest: AssetManifest | null;
  assetBase: string;
  /** Override the active background (camp switcher); falls back to scene.backdrop default. */
  backgroundRef?: string | null;
}): JSX.Element | null {
  const src = backdropSrc(manifest, assetBase, backgroundRef);
  if (!src) return null;
  return (
    <div
      className="oc-map__backdrop"
      aria-hidden="true"
      data-testid="map-backdrop"
      style={{ backgroundImage: `url("${src}")` }}
    />
  );
}

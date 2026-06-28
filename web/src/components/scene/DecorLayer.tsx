/**
 * SPEC-300 §2.6c + SPEC-301 §2.8c — deterministic ground scenery scatter.
 *
 * For each zone, decorPlacements() picks weighted props from `scene.decor.items` at seeded
 * positions (seed = zoneIndex) that avoid the station anchors/slot ring, the zone header,
 * and the margins (no Math.random). Reserved station/header props are excluded both in the
 * manifest and by isReservedRef (AC-17). Each ref resolves to objects[group].items[name];
 * a missing sprite drops just that instance (non-load-bearing — layout unchanged, AC-17).
 * The layer is aria-hidden + pointer-events:none and sits BELOW sprites/labels (§2.7 ③).
 */
import { useMemo } from 'react';
import type { AssetManifest } from '../../assets/manifest';
import type { ZoneInfo } from '../../scene/layout';
import { decorPlacements, type DecorInstance } from '../../scene/terrain';

function resolveDecorSrc(
  manifest: AssetManifest | null,
  assetBase: string,
  inst: DecorInstance,
): string | null {
  const group = manifest?.objects?.[inst.group];
  const file = group?.items?.[inst.name]?.file;
  if (!group || !file) return null;
  return `${assetBase.replace(/\/+$/, '')}/${group.root}/${file}`;
}

export function DecorLayer({
  zones,
  manifest,
  assetBase,
}: {
  zones: ZoneInfo[];
  manifest: AssetManifest | null;
  assetBase: string;
}): JSX.Element | null {
  const decor = manifest?.scene?.decor;
  const instances = useMemo(() => {
    if (!decor?.items?.length) return [];
    const items = decor.items.map((it) => ({ ref: it.ref, weight: it.weight ?? 1 }));
    return zones.flatMap((zone) =>
      decorPlacements({ zoneIndex: zone.zoneIndex, rect: zone.rect, items }),
    );
  }, [decor, zones]);

  if (!decor || instances.length === 0) return null;

  return (
    <div className="oc-decor" aria-hidden="true" data-testid="decor-layer">
      {instances.map((inst) => {
        const src = resolveDecorSrc(manifest, assetBase, inst);
        if (!src) return null; // missing sprite → drop this instance only
        return (
          <img
            key={inst.key}
            className="oc-decor__item"
            src={src}
            alt=""
            data-decor-ref={inst.ref}
            style={{
              left: `${inst.x - inst.size / 2}px`,
              top: `${inst.y - inst.size / 2}px`,
              width: `${inst.size}px`,
              height: `${inst.size}px`,
            }}
          />
        );
      })}
    </div>
  );
}

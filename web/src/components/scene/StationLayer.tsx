/**
 * SPEC-301 §2.2/§2.3/§3.4 — ground layer: zone headers + 7 status stations per zone.
 *
 * Stations are drawn at the SAME deterministic anchors whether or not the prop image
 * exists (placeholder parity, AC-10): a missing prop degrades to a CSS marker (box +
 * glyph + label) at the identical coordinate, so position == status information is
 * preserved. This layer is BELOW sprites/labels in z (§2.3-1) and aria-hidden (the
 * accessible status info lives on each orc button).
 */
import { useState } from 'react';
import type { AssetManifest } from '../../assets/manifest';
import type { ZoneInfo } from '../../scene/layout';
import { stationAnchor } from '../../scene/layout';
import { STATIONS, ZONE_HEADER_H } from '../../scene/stations';
import { STATUS_KEYS, type OrcStatus } from '../../types/domain';
import { STATUS_META } from '../status/statusMeta';

function propSrc(
  manifest: AssetManifest | null,
  assetBase: string,
  key: string,
): string | null {
  const props = manifest?.objects?.props;
  const item = props?.items?.[key];
  if (!props || !item?.file) return null;
  return `${assetBase.replace(/\/+$/, '')}/${props.root}/${item.file}`;
}

function PropMarker({
  src,
  glyph,
  label,
  size,
  left,
  top,
  className,
}: {
  src: string | null;
  glyph: string;
  label: string;
  size: number;
  left: number;
  top: number;
  className: string;
}): JSX.Element {
  const [error, setError] = useState(false);
  const style = {
    left: `${left - size / 2}px`,
    top: `${top - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
  } as const;
  if (src && !error) {
    return (
      <img
        className={`oc-station__prop ${className}`}
        style={style}
        src={src}
        alt=""
        onError={() => setError(true)}
      />
    );
  }
  return (
    <span className={`oc-station__marker ${className}`} style={style} title={label}>
      <span aria-hidden="true">{glyph}</span>
    </span>
  );
}

export function StationLayer({
  zones,
  manifest,
  assetBase,
}: {
  zones: ZoneInfo[];
  manifest: AssetManifest | null;
  assetBase: string;
}): JSX.Element {
  const stationSize = 40;
  return (
    <div className="oc-stations" aria-hidden="true">
      {zones.map((zone) => {
        const headerSrc = propSrc(manifest, assetBase, 'command-tent');
        return (
          <div key={zone.windowIndex} className="oc-zone">
            {/* zone header (ground prop + label) */}
            <PropMarker
              src={headerSrc}
              glyph="⛺"
              label={`window ${zone.windowIndex}`}
              size={stationSize}
              left={zone.rect.x + zone.rect.w / 2}
              top={zone.rect.y + ZONE_HEADER_H / 2}
              className="oc-station__header-prop"
            />
            <span
              className="oc-zone__label"
              style={{
                left: `${zone.rect.x}px`,
                top: `${zone.rect.y + ZONE_HEADER_H / 2}px`,
                width: `${zone.rect.w}px`,
              }}
            >
              window {zone.windowIndex}
            </span>
            {/* zone boundary guide */}
            <span
              className="oc-zone__rect"
              style={{
                left: `${zone.rect.x}px`,
                top: `${zone.rect.y}px`,
                width: `${zone.rect.w}px`,
                height: `${zone.rect.h}px`,
              }}
            />
            {/* 7 status stations */}
            {STATUS_KEYS.map((status: OrcStatus) => {
              const def = STATIONS[status];
              const a = stationAnchor(status, zone.inner);
              return (
                <PropMarker
                  key={status}
                  src={propSrc(manifest, assetBase, def.prop)}
                  glyph={STATUS_META[status].glyph}
                  label={`${STATUS_META[status].label} (${def.prop})`}
                  size={stationSize}
                  left={a.x}
                  top={a.y}
                  className={`oc-station--${status}`}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

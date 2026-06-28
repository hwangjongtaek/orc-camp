/**
 * SPEC-301 — game-like camp MAP scene (replaces the static lane/slot CampScene).
 *
 * Layers (back→front, §2.7): background → terrain/ground → zone headers + station props →
 * orc layer (absolute OrcSprite buttons). Everything lives in one fixed-aspect logical
 * coordinate layer scaled as a single unit (zero layout shift on resize, §3.2). Orc
 * positions are the deterministic computeLayout() targets; movement is driven by the shared
 * RoamingController on the single shared clock.
 *
 * Keyboard (AC-09): each zone is ONE roving-tabindex group (one tab stop). Tab moves
 * between zones, Arrow moves within the focused zone (row-major order), Enter/Space selects
 * (→ ?orc=). Placeholder parity (AC-10): a missing background/terrain degrades to a CSS
 * ground; missing props degrade to CSS station markers at identical coordinates.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAssets } from '../../assets/AssetContext';
import type { AssetManifest } from '../../assets/manifest';
import { useStore } from '../../store/store';
import { computeLayout, type OrcMapInput } from '../../scene/layout';
import { getTime } from '../../scene/clock';
import { RoamingController } from '../../scene/roaming';
import { BASE_SCALE, MAP_SPRITE_SCALE } from '../../scene/stations';
import type { Orc } from '../../types/domain';
import { OrcSprite } from '../sprite/OrcSprite';
import { StationLayer } from './StationLayer';

const EMPTY: string[] = [];

const ARROW_NEXT = new Set(['ArrowRight', 'ArrowDown']);
const ARROW_PREV = new Set(['ArrowLeft', 'ArrowUp']);

function toInput(o: Orc): OrcMapInput {
  return { id: o.id, paneId: o.paneId, windowIndex: o.windowIndex, status: o.status };
}

/** §3.4 — world-sized tiled terrain ground tile (moss-ground), null when absent. */
function terrainTileSrc(manifest: AssetManifest | null, assetBase: string): string | null {
  const ts = manifest?.tilesets?.['orc-camp-terrain-square-topdown'];
  const file = ts?.tiles?.['moss-ground'];
  if (!ts || !file) return null;
  return `${assetBase.replace(/\/+$/, '')}/${ts.root}/${file}`;
}

export function CampMap({
  campId,
  selectedOrcId,
  onSelect,
}: {
  campId: string;
  selectedOrcId: string | null;
  onSelect: (orcId: string) => void;
}): JSX.Element {
  const orcIds = useStore((s) => s.server.orcIdsByCamp[campId] ?? EMPTY);
  const version = useStore((s) => s.server.snapshotVersion);
  const reducedMotion = useStore((s) => s.reducedMotion);
  const { manifest, assetBase } = useAssets();

  const controllerRef = useRef<RoamingController | null>(null);
  if (controllerRef.current === null) controllerRef.current = new RoamingController();
  const controller = controllerRef.current;

  // Read the live orcs for this camp (re-derived per applied version).
  const orcs = useMemo(() => {
    const byId = useStore.getState().server.orcsById;
    return orcIds.map((id) => byId[id]).filter((o): o is Orc => o !== undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orcIds, version]);

  const layout = useMemo(() => computeLayout(orcs.map(toInput)), [orcs]);
  const { world } = layout.dims;

  // Drive the movement controller from the deterministic targets (§3.1).
  useEffect(() => {
    const entries = orcs.map((o) => ({
      id: o.id,
      paneId: o.paneId, // §3.1-9 wander seed (authority paneId, reindex-stable)
      status: o.status,
      target: layout.targets.get(o.id)?.target ?? { x: 0, y: 0 },
    }));
    controller.sync(entries, getTime(), { reducedMotion });
  }, [layout, orcs, reducedMotion, controller]);

  // --- per-zone roving tabindex (AC-09) ---
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const zoneOrder = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const o of orcs) {
      const zi = layout.targets.get(o.id)?.zoneIndex ?? 0;
      const list = m.get(zi) ?? [];
      list.push(o.id);
      m.set(zi, list);
    }
    for (const [zi, ids] of m) {
      ids.sort((a, b) => {
        const ta = layout.targets.get(a)?.target ?? { x: 0, y: 0 };
        const tb = layout.targets.get(b)?.target ?? { x: 0, y: 0 };
        if (Math.abs(ta.y - tb.y) > 0.5) return ta.y - tb.y;
        if (Math.abs(ta.x - tb.x) > 0.5) return ta.x - tb.x;
        return a < b ? -1 : 1;
      });
      m.set(zi, ids);
    }
    return m;
  }, [orcs, layout]);

  const [activeByZone, setActiveByZone] = useState<Record<number, string>>({});
  useLayoutEffect(() => {
    setActiveByZone((prev) => {
      const next: Record<number, string> = {};
      for (const [zi, ids] of zoneOrder) {
        const keep = prev[zi];
        next[zi] = keep && ids.includes(keep) ? keep : ids[0] ?? '';
      }
      return next;
    });
  }, [zoneOrder]);

  const onFocusOrc = (orcId: string): void => {
    const zi = layout.targets.get(orcId)?.zoneIndex ?? 0;
    setActiveByZone((prev) => (prev[zi] === orcId ? prev : { ...prev, [zi]: orcId }));
  };

  const onKeyNav = (orcId: string, key: string): boolean => {
    const next = ARROW_NEXT.has(key) ? 1 : ARROW_PREV.has(key) ? -1 : 0;
    if (next === 0) return false;
    const zi = layout.targets.get(orcId)?.zoneIndex ?? 0;
    const ids = zoneOrder.get(zi) ?? [];
    const i = ids.indexOf(orcId);
    if (i < 0) return true;
    const ni = Math.min(Math.max(i + next, 0), ids.length - 1);
    const nid = ids[ni];
    if (nid && nid !== orcId) {
      setActiveByZone((prev) => ({ ...prev, [zi]: nid }));
      buttonRefs.current.get(nid)?.focus();
    }
    return true;
  };

  const registerButton = (orcId: string, el: HTMLButtonElement | null): void => {
    if (el) buttonRefs.current.set(orcId, el);
    else buttonRefs.current.delete(orcId);
  };

  // §2.7 — the .oc-map panel IS the fixed on-screen viewport; the world div below is rendered
  // at BASE_SCALE (1 logical px = 1 css px) so sprites show near original size. The viewport
  // scrolls/pans over the large world (small camps fit, large camps scroll). World layout is
  // stable, so data refresh/hover/select never reflow or jump the scroll position (§3.2).
  // This ref is ALSO the IntersectionObserver root for the off-screen sprite gate (§3.3-3),
  // so sprites scrolled out of the world are correctly frozen.
  const containerRef = useRef<HTMLDivElement | null>(null);

  // §3.4 — world-sized tiled terrain ground (moss-ground), else CSS gradient fallback.
  const groundTile = terrainTileSrc(manifest, assetBase);

  if (orcs.length === 0) {
    return (
      <div className="oc-scene">
        <div className="oc-state" style={{ minHeight: '160px' }}>
          <div className="oc-state__title">No agents detected</div>
          <div className="oc-muted">This camp has sessions/panes but no detected agents.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="oc-map" ref={containerRef}>
      <div
        className="oc-map__world"
        role="group"
        aria-label="Camp map"
        style={{ width: `${world.w * BASE_SCALE}px`, height: `${world.h * BASE_SCALE}px` }}
      >
        <div
          className={`oc-map__ground${groundTile ? ' oc-map__ground--tiled' : ''}`}
          aria-hidden="true"
          style={groundTile ? { backgroundImage: `url("${groundTile}")` } : undefined}
        />

        <StationLayer zones={layout.zones} manifest={manifest} assetBase={assetBase} />

        <div className="oc-map__orcs">
          {orcs.map((o) => {
            const t = layout.targets.get(o.id);
            const zi = t?.zoneIndex ?? 0;
            // One tab stop per zone: the active orc, falling back to the zone's first orc
            // until activeByZone settles (so every zone is always reachable).
            const active = activeByZone[zi] ?? zoneOrder.get(zi)?.[0];
            const tabIndex = active === o.id ? 0 : -1;
            return (
              <OrcSprite
                key={o.id}
                orcId={o.id}
                agentType={o.agentType}
                status={o.status}
                statusConfidence={o.statusConfidence}
                tmuxTarget={o.tmuxTarget}
                currentWorkSummary={o.currentWorkSummary}
                summarySource={o.summarySource}
                summaryIsEstimated={o.summaryIsEstimated}
                target={t?.target ?? { x: 0, y: 0 }}
                controller={controller}
                mapSpriteScale={MAP_SPRITE_SCALE}
                scrollRootRef={containerRef}
                selected={o.id === selectedOrcId}
                tabIndex={tabIndex}
                onSelect={onSelect}
                onFocusOrc={onFocusOrc}
                onKeyNav={onKeyNav}
                registerButton={registerButton}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

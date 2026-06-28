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
import { useStore } from '../../store/store';
import { computeLayout, type OrcMapInput } from '../../scene/layout';
import { getTime } from '../../scene/clock';
import { RoamingController } from '../../scene/roaming';
import { parallaxTransform } from '../../scene/terrain';
import { BASE_SCALE, MAP_SPRITE_SCALE } from '../../scene/stations';
import type { Orc } from '../../types/domain';
import { OrcSprite } from '../sprite/OrcSprite';
import { StationLayer } from './StationLayer';
import { BackdropLayer } from './BackdropLayer';
import { TerrainLayer } from './TerrainLayer';
import { DecorLayer } from './DecorLayer';

const EMPTY: string[] = [];

const ARROW_NEXT = new Set(['ArrowRight', 'ArrowDown']);
const ARROW_PREV = new Set(['ArrowLeft', 'ArrowUp']);

function toInput(o: Orc): OrcMapInput {
  return { id: o.id, paneId: o.paneId, windowIndex: o.windowIndex, status: o.status };
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
  const backdropRef = useRef<HTMLDivElement | null>(null);

  // §2.8a — backdrop parallax: on scroll, translate the backdrop by scroll×parallax (slower
  // than the 1× terrain) for depth. TRANSFORM-only (no layout/scroll mutation → CLS 0, AC-16);
  // reduced-motion pins it (parallaxTransform returns translate(0,0), AC-19). Data refresh does
  // not touch scroll, so parallax state is stable across WS batches.
  const parallax = manifest?.scene?.backdrop?.parallax ?? 0.3;
  const hasBackdrop = Boolean(
    manifest?.scene?.backdrop?.background_ref &&
      manifest?.backgrounds?.[manifest.scene.backdrop.background_ref]?.file,
  );
  useEffect(() => {
    const vp = containerRef.current;
    const bd = backdropRef.current;
    if (!vp || !bd) return;
    const apply = (): void => {
      bd.style.transform = parallaxTransform(vp.scrollLeft, vp.scrollTop, parallax, reducedMotion);
    };
    apply();
    vp.addEventListener('scroll', apply, { passive: true });
    return () => vp.removeEventListener('scroll', apply);
  }, [parallax, reducedMotion, orcs.length, hasBackdrop]);

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
        {/* z-stack (§2.7 ①→⑫): backdrop → ground/terrain → decor → stations → sprites →
            dusk lighting. Depth layers stay below status overlay/label/raw target. */}
        <BackdropLayer ref={backdropRef} manifest={manifest} assetBase={assetBase} />
        <div
          className={`oc-map__ground${hasBackdrop ? ' oc-map__ground--glaze' : ''}`}
          aria-hidden="true"
        />
        <TerrainLayer
          zones={layout.zones}
          world={world}
          manifest={manifest}
          assetBase={assetBase}
        />
        <DecorLayer zones={layout.zones} manifest={manifest} assetBase={assetBase} />

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

        {/* §2.8d — single static dusk lighting/vignette overlay. Tokens-only, pointer-events
            none, above sprites but BELOW status overlay/label/raw target (§2.7 ⑧). No
            pulsing animation → reduced-motion safe (AC-19). */}
        <div className="oc-map__lighting" aria-hidden="true" data-testid="map-lighting" />
      </div>
    </div>
  );
}

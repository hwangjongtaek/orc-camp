/**
 * SPEC-301 — game-like camp MAP scene (replaces the static lane/slot CampScene).
 *
 * Layers (back→front, §2.7): full-cover background image → ground decor → zone headers +
 * station props → orc layer (absolute OrcSprite buttons). Everything lives in one fixed-aspect
 * logical coordinate layer scaled as a single unit (zero layout shift on resize, §3.2). Orc
 * positions are the deterministic computeLayout() targets; movement is driven by the shared
 * RoamingController on the single shared clock.
 *
 * Keyboard (AC-09): each zone is ONE roving-tabindex group (one tab stop). Tab moves
 * between zones, Arrow moves within the focused zone (row-major order), Enter/Space selects
 * (→ ?orc=). Placeholder parity (AC-10): a missing background image degrades to a CSS
 * gradient ground; missing props degrade to CSS station markers at identical coordinates.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAssets } from '../../assets/AssetContext';
import { useStore } from '../../store/store';
import { computeLayout, type OrcMapInput } from '../../scene/layout';
import { groundFromBackground, clampToRect } from '../../scene/ground';
import { getTime } from '../../scene/clock';
import { RoamingController } from '../../scene/roaming';
import { computeCells, type Cell } from '../../scene/spacing';
import { buildSpeechPool } from '../../scene/speech';
import { characterKeyMap, resolveCharacterKey } from '../../assets/spriteResolver';
import { thresholdsForCharacter, type OrcTierObservation } from '../../assets/prestige';
import {
  BASE_SCALE,
  GROUND_SPRITE_SCALE,
  MAP_SPRITE_SCALE,
  PATROL_MARGIN,
  type Rect,
  type Vec2,
} from '../../scene/stations';
import { DRAG_THRESHOLD } from '../../scene/panzoom';
import type { Orc } from '../../types/domain';
import { OrcSprite } from '../sprite/OrcSprite';
import { StationLayer } from './StationLayer';
import { BackdropLayer } from './BackdropLayer';
import { DecorLayer } from './DecorLayer';
import { MonsterSprite } from './MonsterSprite';
import { MonsterController, resolveMonsterVariant, monsterScaleFor } from '../../scene/monster';

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
  onDeselect,
}: {
  campId: string;
  selectedOrcId: string | null;
  onSelect: (orcId: string) => void;
  /** #51 — clear the selection when the user clicks empty map space. */
  onDeselect?: () => void;
}): JSX.Element {
  const orcIds = useStore((s) => s.server.orcIdsByCamp[campId] ?? EMPTY);
  const version = useStore((s) => s.server.snapshotVersion);
  const reducedMotion = useStore((s) => s.reducedMotion);
  // §3.1-11 — user drag-and-drop placements (logical world coords), keyed by orcId.
  const orcPositions = useStore((s) => s.ui.orcPositions);
  const setOrcPosition = useStore((s) => s.setOrcPosition);
  const { manifest, assetBase } = useAssets();

  // §3.1-9/§3.1-10 — ambient micro-wander AND the active patrol loop are ON in the live map: an
  // idle camp gently "breathes", active orcs patrol (roam ↔ active), and non-active orcs settle
  // at seeded rest spots near their station. All are deterministic, reduced-motion-disabled inside
  // the controller, and affect renderedPos only (target/slot/layout untouched → no AC changes).
  const controllerRef = useRef<RoamingController | null>(null);
  if (controllerRef.current === null)
    controllerRef.current = new RoamingController({ ambientWander: true, patrol: true });
  const controller = controllerRef.current;

  // Read the live orcs for this camp (re-derived per applied version).
  const orcs = useMemo(() => {
    const byId = useStore.getState().server.orcsById;
    return orcIds.map((id) => byId[id]).filter((o): o is Orc => o !== undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orcIds, version]);

  // The active background = user-selected override (detail-panel switcher) else the manifest scene
  // default. Switching it swaps both the image AND its ground (each background carries its own).
  const backgroundRef = useStore((s) => s.ui.backgroundRef);
  const activeBgRef = backgroundRef ?? manifest?.scene?.backdrop?.background_ref ?? null;
  const activeBg = activeBgRef ? manifest?.backgrounds?.[activeBgRef] ?? null : null;

  // §2.1 image-ground mode: if the active background declares a walkable polygon, the image IS the
  // world (native size, drag-pan) and orcs are placed inside the ground; otherwise the legacy
  // zone-grid world is used. Derived from the manifest, so it's stable across data refreshes.
  const ground = useMemo(() => groundFromBackground(activeBg), [activeBg]);
  const spriteScale = ground ? GROUND_SPRITE_SCALE : MAP_SPRITE_SCALE;

  // SPEC-303 (Phase 1) — the active background's epic monster NPC: an ambient, non-interactive
  // boss that continuously roams the ground polygon (roaming animation only; dwell/error are
  // Phase 2). Resolved from the manifest (status-gated); only rendered in image-ground mode.
  const monster = useMemo(() => resolveMonsterVariant(manifest, activeBgRef), [manifest, activeBgRef]);
  const monsterScale = monsterScaleFor(activeBgRef);
  const monsterControllerRef = useRef<MonsterController | null>(null);
  if (monsterControllerRef.current === null) monsterControllerRef.current = new MonsterController();
  const monsterController = monsterControllerRef.current;
  useEffect(() => {
    const frameEdge = monster?.def.frame_size?.[0] ?? 256;
    monsterController.sync(
      ground && monster ? monster.key : null,
      ground,
      frameEdge,
      monsterScale,
      getTime(),
      { reducedMotion },
    );
  }, [ground, monster, monsterScale, reducedMotion, monsterController]);

  const layout = useMemo(() => computeLayout(orcs.map(toInput), ground), [orcs, ground]);
  const { world } = layout.dims;

  // §2.4b (#51) — personal-space bubble: lay a non-overlapping grid over the walkable area and
  // give each orc one cell. In image-ground mode one grid spans the whole safe area; in zone-grid
  // mode each zone gets its own grid over its inner rect. The orc's home = its cell CENTER and its
  // patrol/rest clamp bound = its cell RECT, so motion is confined to the cell and adjacent orcs
  // never overlap — while cells distribute orcs across the WHOLE map (#50 spread).
  const cellByOrc = useMemo(() => {
    const m = new Map<string, Cell>();
    if (ground) {
      const cells = computeCells(ground.safeArea, orcs.length);
      orcs.forEach((o, i) => {
        const c = cells[i];
        if (c) m.set(o.id, c);
      });
    } else {
      const byZone = new Map<number, string[]>();
      for (const o of orcs) {
        const zi = layout.targets.get(o.id)?.zoneIndex ?? 0;
        const list = byZone.get(zi) ?? [];
        list.push(o.id);
        byZone.set(zi, list);
      }
      for (const [zi, ids] of byZone) {
        const inner = layout.zones[zi]?.inner;
        if (!inner) continue;
        const cells = computeCells(inner, ids.length);
        ids.forEach((id, i) => {
          const c = cells[i];
          if (c) m.set(id, c);
        });
      }
    }
    return m;
  }, [orcs, layout, ground]);

  // §3.1-11 — the walkable bound an orc patrols/rests within: the whole ground safe area
  // (image-ground) or the orc's zone inner rect (zone-grid). Used to keep a drag-dropped orc on the
  // walkable ground (a placed orc is no longer confined to its auto-assigned cell).
  const walkBoundFor = (orcId: string): Rect | undefined => {
    if (ground) return ground.safeArea;
    const zi = layout.targets.get(orcId)?.zoneIndex ?? 0;
    return layout.zones[zi]?.inner;
  };

  // The orc's home: a user drag-drop placement (clamped onto the walkable ground) wins over the
  // auto-assigned cell center (§3.1-11); else the cell center (§2.4b); else the layout target. A
  // placed orc is `pinned` → it rests EXACTLY at the drop (no patrol/rest offset, no cell-clamp).
  const homeFor = (
    orcId: string,
  ): { home: Vec2; bound: Rect | undefined; pinned: boolean } => {
    const cell = cellByOrc.get(orcId);
    const manual = orcPositions[orcId];
    if (manual) {
      const walk = walkBoundFor(orcId);
      return {
        home: walk ? clampToRect(manual, walk, PATROL_MARGIN) : manual,
        bound: undefined, // pinned → no bound-clamp
        pinned: true,
      };
    }
    return {
      home: cell?.center ?? layout.targets.get(orcId)?.target ?? { x: 0, y: 0 },
      bound: cell?.rect,
      pinned: false,
    };
  };

  // Drive the movement controller from the per-orc cells / placements (§2.4b / §3.1 / §3.1-11).
  useEffect(() => {
    const entries = orcs.map((o) => {
      const { home, bound, pinned } = homeFor(o.id);
      return {
        id: o.id,
        paneId: o.paneId, // §3.1-9 wander seed (authority paneId, reindex-stable)
        status: o.status,
        target: home,
        pinned, // §3.1-11 user-placed → rests exactly at the drop
        ...(bound !== undefined ? { bound } : {}), // §2.4b patrol/rest clamp (auto-placed only)
      };
    });
    controller.sync(entries, getTime(), { reducedMotion });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellByOrc, orcs, reducedMotion, controller, layout, orcPositions, ground]);

  // §3.1-11 — commit a drag-and-drop drop: clamp the drop onto the walkable ground, snap the orc
  // there immediately (no walk-back from its old home), and persist the placement so it resumes
  // its activity/waiting at the new spot and survives live data refreshes.
  const onMoveOrc = (orcId: string, pos: Vec2): void => {
    const walk = walkBoundFor(orcId);
    const clamped = walk ? clampToRect(pos, walk, PATROL_MARGIN) : pos;
    controller.place(orcId, clamped, getTime());
    setOrcPosition(orcId, clamped);
  };

  // SPEC-300 §2.3 — sequential character assignment: the camp's orcs cycle through the available
  // character pool in reading order (orcs are pre-sorted by windowIndex/paneIndex), so adjacent
  // orcs look different regardless of agent type. Stable across data refreshes (paneId order).
  const characterByOrc = useMemo(
    () => characterKeyMap(orcs.map((o) => o.id), manifest),
    [orcs, manifest],
  );

  // SPEC-302 §3.2 — reconcile the monotonic prestige-tier latch against the orcs currently on this
  // map. Each observation is keyed on the SAME resolved character the sprite renders (composite
  // (id, resolvedCharacterKey) parity) and gated on that character carrying a `prestige` block; an
  // id leaving `orcs` (or a pool reassignment changing its key) resets its latch (§3.2 reset i/ii).
  // The latch lives in the store (client display state); OrcSprite reads `displayedTierById`.
  const reconcilePrestige = useStore((s) => s.reconcilePrestige);
  const displayedTierById = useStore((s) => s.prestige.displayedTierById);
  const prestigeObservations = useMemo<OrcTierObservation[]>(
    () =>
      orcs.map((o) => {
        const resolvedKey = resolveCharacterKey(manifest, characterByOrc.get(o.id), o.agentType);
        const def = resolvedKey ? manifest?.characters[resolvedKey] : undefined;
        return {
          id: o.id,
          characterKey: resolvedKey,
          hasPrestige: !!def?.prestige,
          usage: o.usage,
          thresholds: thresholdsForCharacter(def),
        };
      }),
    [orcs, characterByOrc, manifest],
  );
  useEffect(() => {
    reconcilePrestige(prestigeObservations);
  }, [prestigeObservations, reconcilePrestige]);

  // §2.6b (#50) — per-orc word pool for intermittent ambient speech: built from the orc's
  // preview/summary text (the "preview words" the bubbles randomly combine), plus command/cwd as
  // supplementary tokens. Re-derived per applied snapshot version.
  const speechByOrc = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const o of orcs) {
      m.set(
        o.id,
        buildSpeechPool(o.currentWorkSummary, o.preview?.text?.join(' '), o.command, o.cwd),
      );
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orcs, version]);

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

  // §2.6b/§2.8a — the background image covers the whole world (background-size: cover) and is
  // pinned to it (no parallax: a transformed full-cover image would reveal uncovered edges on
  // scroll). When no background image is declared, a CSS gradient ground is the fallback ground
  // (placeholder parity, §3.4 / AC-20). Resolution is asset-independent → zero layout shift.
  const hasBackdrop = Boolean(activeBg?.file);

  // §2.1 image-ground mode — the image world (2× the native background, fixed) is bigger than the
  // viewport, so center the viewport on the walkable ground (instead of the top-left sky). Runs
  // once per (camp, background): switching the background re-centers on the new ground; the user's
  // subsequent drag-pan within a background is preserved.
  const centeredKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const sc = containerRef.current;
    const key = `${campId}:${activeBgRef ?? ''}`;
    if (!sc || !ground || centeredKeyRef.current === key) return;
    const cx = ground.safeArea.x + ground.safeArea.w / 2;
    const cy = ground.safeArea.y + ground.safeArea.h / 2;
    sc.scrollLeft = Math.max(0, cx - sc.clientWidth / 2);
    sc.scrollTop = Math.max(0, cy - sc.clientHeight / 2);
    centeredKeyRef.current = key;
  }, [ground, campId, activeBgRef]);

  // §2.7 — NO zoom. The world is rendered at a fixed scale (BASE_SCALE); the background is shown
  // at its fixed 2× world size (orcs at original sprite size) and the user explores ONLY by
  // drag-pan. (Sprite/coord sizes are layout constants → zero layout shift.)

  // §2.7 (#42) — drag-to-pan. Mouse/pen drag on the map BACKGROUND pans scrollLeft/Top; a small
  // threshold means a stationary press is still a click (so orc selection survives). We never
  // start a pan on an interactive element (orcs/controls), so clicks are never hijacked. Touch
  // uses the scroller's native momentum scrolling (#45) — we don't engage there to avoid
  // double-scrolling.
  const panRef = useRef<
    { x: number; y: number; left: number; top: number; id: number; active: boolean } | null
  >(null);
  // #51 — a drag-pan ends with a synthetic click; suppress the next click's deselect so panning
  // never clears the selection. Reset at the start of every fresh gesture.
  const suppressClickRef = useRef(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    suppressClickRef.current = false;
    if ((e.target as HTMLElement).closest('button, a, input, [role="dialog"]')) return;
    const sc = containerRef.current;
    if (!sc) return;
    panRef.current = {
      x: e.clientX,
      y: e.clientY,
      left: sc.scrollLeft,
      top: sc.scrollTop,
      id: e.pointerId,
      active: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const p = panRef.current;
    const sc = containerRef.current;
    if (!p || !sc) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return; // below threshold → keep it a click
      p.active = true;
      suppressClickRef.current = true; // a real drag → don't let the trailing click deselect
      sc.setPointerCapture?.(p.id);
      sc.classList.add('oc-map__scroll--panning');
    }
    sc.scrollLeft = p.left - dx;
    sc.scrollTop = p.top - dy;
    e.preventDefault();
  };

  const endPan = (): void => {
    const p = panRef.current;
    const sc = containerRef.current;
    if (p && sc) {
      sc.releasePointerCapture?.(p.id);
      sc.classList.remove('oc-map__scroll--panning');
    }
    panRef.current = null;
  };

  // #51 — click on empty map space clears the selection. Clicks on an orc/control (or the trailing
  // click after a drag-pan) are ignored, so selecting/panning is unaffected.
  const onBackgroundClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if ((e.target as HTMLElement).closest('button, a, input, [role="dialog"]')) return;
    onDeselect?.();
  };

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
    <div className="oc-map">
      {/* §2.7 — the .oc-map__scroll element IS the fixed on-screen viewport; it scrolls/pans
          over the large world. It is also the IntersectionObserver root (§3.3-3) and the
          drag-to-pan surface (#42). No zoom: the world renders at a fixed scale and the user
          explores only by drag-pan. */}
      <div
        className="oc-map__scroll"
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onClick={onBackgroundClick}
      >
        <div
          className="oc-map__world"
          role="group"
          aria-label="Camp map"
          style={{
            width: `${world.w * BASE_SCALE}px`,
            height: `${world.h * BASE_SCALE}px`,
          }}
        >
          {/* z-stack (§2.7 ①→⑫): full-cover background image → decor → stations → sprites →
              dusk lighting. Depth layers stay below status overlay/label/raw target. The
              background image IS the ground; the CSS gradient ground is only a fallback when no
              background image is declared (placeholder parity, §3.4 / AC-20). In image-ground
              mode the image carries its own scenery, so the CSS decor/station layers are skipped. */}
          <BackdropLayer manifest={manifest} assetBase={assetBase} backgroundRef={activeBgRef} />
        {!hasBackdrop && <div className="oc-map__ground" aria-hidden="true" />}
        {!ground && <DecorLayer zones={layout.zones} manifest={manifest} assetBase={assetBase} />}

        {!ground && <StationLayer zones={layout.zones} manifest={manifest} assetBase={assetBase} />}

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
                characterKey={characterByOrc.get(o.id)}
                displayedTier={displayedTierById[o.id] ?? 0}
                status={o.status}
                statusConfidence={o.statusConfidence}
                tmuxTarget={o.tmuxTarget}
                currentWorkSummary={o.currentWorkSummary}
                summarySource={o.summarySource}
                summaryIsEstimated={o.summaryIsEstimated}
                speechWords={speechByOrc.get(o.id)}
                target={homeFor(o.id).home}
                controller={controller}
                mapSpriteScale={spriteScale}
                scrollRootRef={containerRef}
                selected={o.id === selectedOrcId}
                tabIndex={tabIndex}
                onSelect={onSelect}
                onFocusOrc={onFocusOrc}
                onKeyNav={onKeyNav}
                registerButton={registerButton}
                onMoveOrc={onMoveOrc}
              />
            );
          })}
        </div>

        {/* SPEC-303 — the epic monster renders ABOVE the orc sprites (user request: orcs are
            smaller, so showing them beneath the larger monster reads fine). Same z-plane as orcs
            (--oc-z-map-orc) but later in DOM ⇒ painted on top; still non-interactive
            (pointer-events:none) and below the dusk lighting vignette. */}
        {ground && monster && (
          <MonsterSprite
            def={monster.def}
            controller={monsterController}
            orcController={controller}
            orcIds={orcs.map((o) => o.id)}
            assetBase={assetBase}
            scale={monsterScale}
            reducedMotion={reducedMotion}
          />
        )}

          {/* §2.8d — single static dusk lighting/vignette overlay. Tokens-only, pointer-events
              none, above sprites but BELOW status overlay/label/raw target (§2.7 ⑧). No
              pulsing animation → reduced-motion safe (AC-19). */}
          <div className="oc-map__lighting" aria-hidden="true" data-testid="map-lighting" />
        </div>
      </div>
    </div>
  );
}

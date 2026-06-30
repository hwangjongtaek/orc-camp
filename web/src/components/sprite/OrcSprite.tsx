/**
 * SPEC-300 + SPEC-301 — one roaming orc actor on the camp map.
 *
 * Each orc is a <button> absolutely positioned in the map's logical coordinate system.
 * Per-frame work (position transform + animation frame src) is written DIRECTLY via refs
 * on the SINGLE shared clock tick (scene/clock.ts) — never per-frame React state — so 100
 * sprites cost 2 ref writes/frame each and zero re-renders (perf §3.3, AC-13a). React only
 * re-renders on a discrete transition (roaming↔arrived, direction retarget, status change),
 * which re-resolves the sprite structure (placeholder/animated/static).
 *
 * Always-on (A7/AC-06): status label (text + glyph) + raw tmuxTarget. On-demand: the
 * ActivityBubble (hover/focus/select). reduced-motion: controller snaps, resolver freezes.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useAssets } from '../../assets/AssetContext';
import { resolveSprite, type OrcRenderInput } from '../../assets/spriteResolver';
import { useStore } from '../../store/store';
import { frameAt, getTime, subscribe } from '../../scene/clock';
import type { MovementState, RoamingController } from '../../scene/roaming';
import type { Vec2 } from '../../scene/stations';
import { speechAt } from '../../scene/speech';
import { AGENT_LABEL, STATUS_META } from '../status/statusMeta';
import { ActivityBubble } from '../scene/ActivityBubble';
import { SpeechBubble } from '../scene/SpeechBubble';
import type { AgentType, OrcStatus, SummarySource } from '../../types/domain';

const EMPTY_WORDS: string[] = [];

interface DisplayState {
  movement: MovementState;
  direction: string;
}

export interface OrcSpriteProps {
  orcId: string;
  agentType: AgentType;
  /** SPEC-300 §2.3 — sequential character key (chosen by the orc's order on the map). */
  characterKey?: string;
  status: OrcStatus;
  statusConfidence: number;
  tmuxTarget: string;
  currentWorkSummary: string | null;
  summarySource: SummarySource;
  summaryIsEstimated: boolean;
  /** SPEC-301 §2.6b — preview/summary word pool for intermittent ambient speech (empty ⇒ silent). */
  speechWords?: string[];
  target: Vec2; // layout target (initial / fallback position)
  controller: RoamingController;
  mapSpriteScale: number;
  /** §3.3-3 — the scroll viewport element used as the IntersectionObserver root (optional;
   *  falls back to the browser viewport when absent, e.g. standalone tests). */
  scrollRootRef?: RefObject<HTMLElement | null>;
  selected: boolean;
  tabIndex: number;
  onSelect: (orcId: string) => void;
  onFocusOrc: (orcId: string) => void;
  onKeyNav: (orcId: string, key: string) => boolean;
  registerButton: (orcId: string, el: HTMLButtonElement | null) => void;
  /** SPEC-301 §3.1-11 — commit a drag-and-drop drop at logical world `pos` (omitted ⇒ drag disabled). */
  onMoveOrc?: (orcId: string, pos: Vec2) => void;
}

/** §3.1-11 — pixels the pointer must travel before a press becomes a drag (so taps still select). */
const DRAG_START_PX = 4;

export function OrcSprite(props: OrcSpriteProps): JSX.Element {
  const {
    orcId,
    agentType,
    characterKey,
    status,
    statusConfidence,
    tmuxTarget,
    currentWorkSummary,
    summarySource,
    summaryIsEstimated,
    speechWords,
    target,
    controller,
    mapSpriteScale,
    scrollRootRef,
    selected,
    tabIndex,
    onSelect,
    onFocusOrc,
    onKeyNav,
    registerButton,
    onMoveOrc,
  } = props;

  const { manifest, assetBase } = useAssets();
  const reducedMotion = useStore((s) => s.reducedMotion);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgError, setImgError] = useState(false);
  const [bubbleActive, setBubbleActive] = useState(false);

  // §2.6b — intermittent ambient speech (scene/speech.ts). Pool is gated OFF (empty) under
  // reduced-motion and for terminated orcs (no autoplay), so they never auto-chatter.
  const speechPool = useMemo(
    () => (reducedMotion || status === 'terminated' ? EMPTY_WORDS : speechWords ?? EMPTY_WORDS),
    [reducedMotion, status, speechWords],
  );
  const [speech, setSpeech] = useState<string | null>(null);
  const speechRef = useRef<string | null>(null);
  speechRef.current = speech;

  // Movement/direction come from the controller (source of truth); status from the store.
  const [display, setDisplay] = useState<DisplayState>(() => {
    const snap = controller.snapshot(orcId, getTime());
    return snap
      ? { movement: snap.movementState, direction: snap.direction }
      : { movement: 'arrived', direction: 'south' };
  });
  const displayRef = useRef<DisplayState>(display);
  displayRef.current = display;

  // §3.1-11 — drag-and-drop. `dragState` (re-render) freezes the IDLE animation in the drag-start
  // direction while moving; `dragRef` (per-frame, no re-render) tracks the live pointer-driven
  // logical position so the shared-clock tick writes the transform without involving the controller.
  const dragEnabled = onMoveOrc != null;
  const [dragState, setDragState] = useState<{ direction: string } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number; // pointer screen origin
    startY: number;
    origin: Vec2; // orc logical position at drag start
    pos: Vec2; // current dragged logical position
    direction: string; // drag-start facing (frozen)
    tEnter: number; // shared-clock time the drag (idle anim) started
    active: boolean; // crossed the drag threshold
  } | null>(null);
  // A completed drag ends with a synthetic click; suppress that click so a drop never selects.
  const justDraggedRef = useRef(false);

  const input: OrcRenderInput = useMemo(
    () => ({
      id: orcId,
      agentType,
      characterKey,
      status,
      statusConfidence,
      tmuxTarget,
      // §3.1-11 — while dragging, freeze facing to the drag-start direction and force the idle anim.
      direction: dragState ? dragState.direction : display.direction,
      movementState: dragState ? 'arrived' : display.movement,
      dragging: dragState != null,
    }),
    [
      orcId,
      agentType,
      characterKey,
      status,
      statusConfidence,
      tmuxTarget,
      dragState,
      display.direction,
      display.movement,
    ],
  );

  const sprite = useMemo(
    () =>
      resolveSprite(input, {
        manifest,
        assetBasePath: assetBase,
        prefersReducedMotion: reducedMotion,
        mapSpriteScale,
      }),
    [input, manifest, assetBase, reducedMotion, mapSpriteScale],
  );
  const spriteRef = useRef(sprite);
  spriteRef.current = sprite;

  // Reset image error state whenever the resolved sprite changes.
  useEffect(() => {
    setImgError(false);
  }, [sprite]);

  // §3.3-3 — visibility gate: off-screen sprites are excluded from per-tick ref writes.
  const onScreenRef = useRef(true);

  // Per-frame work (position transform + animation frame src) written DIRECTLY via refs.
  // Held in a ref so BOTH the shared-clock tick and the IntersectionObserver "re-entered
  // view" catch-up run the SAME logic. Off-screen → early return (no ref writes / no
  // animation work, §3.3-3); the sprite freezes on its last (static) frame. The single
  // shared clock still owns time — there are no per-sprite timers (AC-13a).
  const applyTick = (t: number): void => {
    if (!onScreenRef.current) return; // §3.3-3 — off-screen: static frame, skip writes
    const sp = spriteRef.current;
    const [ax, ay] = sp.scaledAnchor;
    const btn = buttonRef.current;

    // §3.1-11 — while dragging, the pointer (not the controller) owns position; play the idle loop.
    const drag = dragRef.current;
    if (drag?.active) {
      if (btn) btn.style.transform = `translate(${drag.pos.x - ax}px, ${drag.pos.y - ay}px)`;
      if (sp.mode === 'animated' && sp.framePaths && sp.fps && imgRef.current) {
        const idx = frameAt(t, drag.tEnter, sp.fps, sp.frames);
        const src = sp.framePaths[idx] ?? sp.framePaths[0];
        if (src && imgRef.current.getAttribute('src') !== src) imgRef.current.setAttribute('src', src);
      }
      return;
    }

    const snap = controller.snapshot(orcId, t);
    const pos = snap ? snap.renderedPos : target;
    if (btn) btn.style.transform = `translate(${pos.x - ax}px, ${pos.y - ay}px)`;
    if (!snap) return;
    const d = displayRef.current;
    if (snap.movementState !== d.movement || snap.direction !== d.direction) {
      const next = { movement: snap.movementState, direction: snap.direction };
      displayRef.current = next;
      setDisplay(next);
    }
    if (sp.mode === 'animated' && sp.framePaths && sp.fps && imgRef.current) {
      const idx = frameAt(t, snap.tEnter, sp.fps, sp.frames);
      const src = sp.framePaths[idx] ?? sp.framePaths[0];
      if (src && imgRef.current.getAttribute('src') !== src) {
        imgRef.current.setAttribute('src', src);
      }
    }
    // §2.6b — intermittent ambient speech, driven by the SAME shared-clock tick. Pure schedule
    // (scene/speech.ts); re-renders only when the utterance appears/changes/clears (~once / 10s).
    // ACTIVE orcs "talk while they work" → a longer (~2–3 line) utterance.
    const line = speechAt(orcId, t, speechPool, status === 'active');
    if (line !== speechRef.current) {
      speechRef.current = line;
      setSpeech(line);
    }
  };
  const applyTickRef = useRef(applyTick);
  applyTickRef.current = applyTick;

  // Single shared clock subscription — ref-only writes, no per-frame re-render.
  useEffect(() => {
    const unsub = subscribe((t) => applyTickRef.current(t));
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orcId, controller]);

  // §3.3-3 — only animate ON-SCREEN sprites (perf at 100 panes). The IntersectionObserver
  // feeds the shared-clock loop: off-screen → onScreenRef=false → ticks skip this sprite;
  // on re-entering view we immediately catch up to the correct position/frame at the current
  // shared-clock time. Because the frame index is frameAt(t, tEnter, …), the resumed phase is
  // correct (AC-13b not broken). Selection/keyboard/a11y/layout are untouched (transform-only,
  // no DOM-structure change). When IntersectionObserver is unavailable (e.g. jsdom) the sprite
  // stays on-screen, preserving prior behavior.
  useEffect(() => {
    const btn = buttonRef.current;
    if (!btn || typeof IntersectionObserver === 'undefined') return;
    // Root = the scroll viewport (§2.7) so sprites scrolled out of the WORLD (not just the
    // browser window) are gated; null root falls back to the browser viewport.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const becameVisible = e.isIntersecting && !onScreenRef.current;
          onScreenRef.current = e.isIntersecting;
          if (becameVisible) applyTickRef.current(getTime());
        }
      },
      { root: scrollRootRef?.current ?? null },
    );
    io.observe(btn);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orcId]);

  const [bw, bh] = sprite.scaledFrameSize;
  const [ax, ay] = sprite.scaledAnchor;
  const initial = controller.snapshot(orcId, getTime())?.renderedPos ?? target;
  const usePlaceholder = sprite.mode === 'placeholder' || imgError;
  const meta = STATUS_META[status];

  // §2.6e/§2.8e — per-sprite CSS ground shadow at the scaled ground ANCHOR (= the sprite's feet;
  // the manifest anchor is the real feet contact, so the shadow hugs the boots instead of
  // floating below them). Sized from the footprint (frame_size × mapSpriteScale × footprint_ratio),
  // a flat ellipse; a pure absolute decoration so it never changes the sprite box/layout (zero
  // layout shift). Asset & placeholder sprites get the SAME shadow (parity, AC-18). Tokens-only
  // color; opacity from the manifest.
  const shadowCss = manifest?.scene?.shadow?.css;
  const shadowRatio = shadowCss?.footprint_ratio ?? 0.46;
  const shadowOpacity = shadowCss?.opacity ?? 0.35;
  const shadowW = bw * shadowRatio;
  const shadowH = shadowW * 0.3;

  // §2.6c (#51) — game-style selection marker: a pixel-art ground ring (pixellab `selected-orc`)
  // placed under the orc's feet (the ground anchor), sized to the footprint. Falls back to a CSS
  // corner-bracket reticle when the asset is missing/placeholder (parity, never the plain border).
  const selectMarkers = manifest?.ui?.selection_markers;
  const selectFile = selectMarkers?.items?.['selected-orc']?.file;
  const selectMarkerSrc =
    selected && selectMarkers && selectFile
      ? `${stripSlash(assetBase)}/${selectMarkers.root}/${selectFile}`
      : null;
  const [selectMarkerError, setSelectMarkerError] = useState(false);
  useEffect(() => setSelectMarkerError(false), [selectMarkerSrc]);
  const markerW = bw * 0.78; // ground ring ≈ footprint width
  const markerH = markerW; // square pixel asset

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      onSelect(orcId);
      return;
    }
    if (onKeyNav(orcId, e.key)) e.preventDefault();
  };

  // --- §3.1-11 drag-and-drop (pointer) ---
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (!dragEnabled || e.button !== 0) return;
    const snap = controller.snapshot(orcId, getTime());
    const origin = snap?.renderedPos ?? target;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin,
      pos: origin,
      direction: snap?.direction ?? display.direction, // §3.1-11 freeze drag-start facing
      tEnter: getTime(),
      active: false,
    };
    // Don't let the map's background drag-pan see this gesture (it ignores buttons anyway).
    e.stopPropagation();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      if (Math.hypot(dx, dy) < DRAG_START_PX) return; // below threshold → still a tap/click
      d.active = true;
      justDraggedRef.current = true; // a real drag → suppress the trailing click (no select)
      buttonRef.current?.setPointerCapture?.(e.pointerId);
      setDragState({ direction: d.direction }); // re-render → idle anim in the frozen direction
      setBubbleActive(false);
    }
    // BASE_SCALE = 1 → screen px delta == logical world delta.
    d.pos = { x: d.origin.x + dx, y: d.origin.y + dy };
    const [ax, ay] = spriteRef.current.scaledAnchor;
    if (buttonRef.current) {
      buttonRef.current.style.transform = `translate(${d.pos.x - ax}px, ${d.pos.y - ay}px)`;
    }
    e.preventDefault();
  };

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    buttonRef.current?.releasePointerCapture?.(e.pointerId);
    if (d.active) {
      onMoveOrc?.(orcId, d.pos); // commit the drop → re-anchor + resume active/waiting there
      setDragState(null);
    }
    dragRef.current = null;
  };

  return (
    <button
      type="button"
      ref={(el) => {
        buttonRef.current = el;
        registerButton(orcId, el);
      }}
      className={`oc-orc${selected ? ' oc-orc--selected' : ''}${dragState ? ' oc-orc--dragging' : ''}`}
      style={{
        transform: `translate(${initial.x - ax}px, ${initial.y - ay}px)`,
        width: `${bw}px`,
        height: `${bh}px`,
      }}
      tabIndex={tabIndex}
      aria-pressed={selected}
      aria-label={`${AGENT_LABEL[agentType]} — ${meta.label} — ${tmuxTarget}`}
      data-orc-id={orcId}
      data-movement={display.movement}
      data-direction={display.direction}
      data-dragging={dragState ? 'true' : undefined}
      onClick={() => {
        if (justDraggedRef.current) {
          justDraggedRef.current = false; // a drop, not a click → don't select
          return;
        }
        onSelect(orcId);
      }}
      onFocus={() => {
        onFocusOrc(orcId);
        setBubbleActive(true);
      }}
      onBlur={() => setBubbleActive(false)}
      onMouseEnter={() => setBubbleActive(true)}
      onMouseLeave={() => setBubbleActive(false)}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      // §3.1-11 — kill the browser's native HTML5 drag (the sprite <img> is draggable by default):
      // its ghost-image drag would steal pointer events so our pointer-drag would barely move. This
      // bubbles, so it cancels native drags started on the child images too.
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
    >
      <span
        className="oc-orc__shadow"
        aria-hidden="true"
        data-testid="orc-shadow"
        style={{
          left: `${ax - shadowW / 2}px`,
          top: `${ay - shadowH / 2}px`,
          width: `${shadowW}px`,
          height: `${shadowH}px`,
          opacity: shadowOpacity,
        }}
      />
      {/* §2.6c (#51) selection marker — pixel-art ground ring under the feet (asset) or a CSS
          corner-bracket reticle fallback. A ground decoration: never changes the sprite box. */}
      {selected &&
        (selectMarkerSrc && !selectMarkerError ? (
          <img
            className="oc-orc__select-marker"
            data-testid="orc-select-marker"
            src={selectMarkerSrc}
            alt=""
            aria-hidden="true"
            draggable={false}
            style={{
              left: `${ax - markerW / 2}px`,
              top: `${ay - markerH / 2}px`,
              width: `${markerW}px`,
              height: `${markerH}px`,
            }}
            onError={() => setSelectMarkerError(true)}
          />
        ) : (
          <span
            className="oc-orc__select-marker oc-orc__select-marker--css"
            data-testid="orc-select-marker"
            aria-hidden="true"
          >
            <span className="oc-orc__select-corner oc-orc__select-corner--tl" />
            <span className="oc-orc__select-corner oc-orc__select-corner--tr" />
            <span className="oc-orc__select-corner oc-orc__select-corner--bl" />
            <span className="oc-orc__select-corner oc-orc__select-corner--br" />
          </span>
        ))}
      <span className="oc-orc__sprite" aria-hidden="true">
        {usePlaceholder ? (
          <span className="oc-orc__placeholder">
            <span aria-hidden="true">{meta.glyph}</span>
            <span>{shortAgent(agentType)}</span>
          </span>
        ) : sprite.mode === 'animated' && sprite.framePaths ? (
          <img
            ref={imgRef}
            className="oc-orc__img"
            src={sprite.framePaths[0]}
            alt=""
            draggable={false}
            onError={() => setImgError(true)}
          />
        ) : sprite.staticFramePath ? (
          <img
            className="oc-orc__img"
            src={sprite.staticFramePath}
            alt=""
            draggable={false}
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="oc-orc__placeholder">
            <span aria-hidden="true">{meta.glyph}</span>
            <span>{shortAgent(agentType)}</span>
          </span>
        )}
      </span>

      {/* Always-on status encoding (SPEC-301 §2.6, SPEC-202 A7). */}
      <span className={`oc-orc__label ${meta.className}`}>
        <span className="oc-orc__label-glyph" aria-hidden="true">
          {meta.glyph}
        </span>
        {meta.label}
      </span>
      <span className="oc-orc__target" data-testid="orc-target">
        {tmuxTarget}
      </span>

      {bubbleActive || selected ? (
        <ActivityBubble
          currentWorkSummary={currentWorkSummary}
          summarySource={summarySource}
          summaryIsEstimated={summaryIsEstimated}
        />
      ) : (
        speech && <SpeechBubble text={speech} multiline={status === 'active'} />
      )}
    </button>
  );
}

function stripSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function shortAgent(agentType: AgentType): string {
  if (agentType === 'claude-code') return 'Claude';
  if (agentType === 'codex') return 'Codex';
  return '??';
}

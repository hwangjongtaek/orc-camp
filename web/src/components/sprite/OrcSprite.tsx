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
 * Always-on (A7/AC-06): status label + overlay icon + raw tmuxTarget. On-demand: the
 * ActivityBubble (hover/focus/select). reduced-motion: controller snaps, resolver freezes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssets } from '../../assets/AssetContext';
import { resolveSprite, type OrcRenderInput } from '../../assets/spriteResolver';
import { useStore } from '../../store/store';
import { frameAt, getTime, subscribe } from '../../scene/clock';
import type { MovementState, RoamingController } from '../../scene/roaming';
import type { Vec2 } from '../../scene/stations';
import { AGENT_LABEL, STATUS_META } from '../status/statusMeta';
import { ActivityBubble } from '../scene/ActivityBubble';
import type { AgentType, OrcStatus, SummarySource } from '../../types/domain';

interface DisplayState {
  movement: MovementState;
  direction: string;
}

export interface OrcSpriteProps {
  orcId: string;
  agentType: AgentType;
  status: OrcStatus;
  statusConfidence: number;
  tmuxTarget: string;
  currentWorkSummary: string | null;
  summarySource: SummarySource;
  summaryIsEstimated: boolean;
  target: Vec2; // layout target (initial / fallback position)
  controller: RoamingController;
  mapSpriteScale: number;
  selected: boolean;
  tabIndex: number;
  onSelect: (orcId: string) => void;
  onFocusOrc: (orcId: string) => void;
  onKeyNav: (orcId: string, key: string) => boolean;
  registerButton: (orcId: string, el: HTMLButtonElement | null) => void;
}

export function OrcSprite(props: OrcSpriteProps): JSX.Element {
  const {
    orcId,
    agentType,
    status,
    statusConfidence,
    tmuxTarget,
    currentWorkSummary,
    summarySource,
    summaryIsEstimated,
    target,
    controller,
    mapSpriteScale,
    selected,
    tabIndex,
    onSelect,
    onFocusOrc,
    onKeyNav,
    registerButton,
  } = props;

  const { manifest, assetBase } = useAssets();
  const reducedMotion = useStore((s) => s.reducedMotion);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgError, setImgError] = useState(false);
  const [overlayError, setOverlayError] = useState(false);
  const [bubbleActive, setBubbleActive] = useState(false);

  // Movement/direction come from the controller (source of truth); status from the store.
  const [display, setDisplay] = useState<DisplayState>(() => {
    const snap = controller.snapshot(orcId, getTime());
    return snap
      ? { movement: snap.movementState, direction: snap.direction }
      : { movement: 'arrived', direction: 'south' };
  });
  const displayRef = useRef<DisplayState>(display);
  displayRef.current = display;

  const input: OrcRenderInput = useMemo(
    () => ({
      id: orcId,
      agentType,
      status,
      statusConfidence,
      tmuxTarget,
      direction: display.direction,
      movementState: display.movement,
    }),
    [orcId, agentType, status, statusConfidence, tmuxTarget, display.direction, display.movement],
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
    setOverlayError(false);
  }, [sprite]);

  // Single shared clock subscription — ref-only writes, no per-frame re-render.
  useEffect(() => {
    const tick = (t: number): void => {
      const snap = controller.snapshot(orcId, t);
      const sp = spriteRef.current;
      const [ax, ay] = sp.scaledAnchor;
      const pos = snap ? snap.renderedPos : target;
      const btn = buttonRef.current;
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
    };
    const unsub = subscribe(tick);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orcId, controller]);

  const [bw, bh] = sprite.scaledFrameSize;
  const [ax, ay] = sprite.scaledAnchor;
  const initial = controller.snapshot(orcId, getTime())?.renderedPos ?? target;
  const usePlaceholder = sprite.mode === 'placeholder' || imgError;
  const meta = STATUS_META[status];

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      onSelect(orcId);
      return;
    }
    if (onKeyNav(orcId, e.key)) e.preventDefault();
  };

  return (
    <button
      type="button"
      ref={(el) => {
        buttonRef.current = el;
        registerButton(orcId, el);
      }}
      className={`oc-orc${selected ? ' oc-orc--selected' : ''}`}
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
      onClick={() => onSelect(orcId)}
      onFocus={() => {
        onFocusOrc(orcId);
        setBubbleActive(true);
      }}
      onBlur={() => setBubbleActive(false)}
      onMouseEnter={() => setBubbleActive(true)}
      onMouseLeave={() => setBubbleActive(false)}
      onKeyDown={onKeyDown}
    >
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
            onError={() => setImgError(true)}
          />
        ) : sprite.staticFramePath ? (
          <img
            className="oc-orc__img"
            src={sprite.staticFramePath}
            alt=""
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="oc-orc__placeholder">
            <span aria-hidden="true">{meta.glyph}</span>
            <span>{shortAgent(agentType)}</span>
          </span>
        )}
        {sprite.overlayPath && !overlayError ? (
          <img
            className="oc-orc__overlay"
            src={sprite.overlayPath}
            alt=""
            onError={() => setOverlayError(true)}
          />
        ) : (
          <span className="oc-orc__overlay oc-orc__overlay--glyph" aria-hidden="true">
            {meta.glyph}
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

      {(bubbleActive || selected) && (
        <ActivityBubble
          currentWorkSummary={currentWorkSummary}
          summarySource={summarySource}
          summaryIsEstimated={summaryIsEstimated}
        />
      )}
    </button>
  );
}

function shortAgent(agentType: AgentType): string {
  if (agentType === 'claude-code') return 'Claude';
  if (agentType === 'codex') return 'Codex';
  return '??';
}

/**
 * SPEC-300 — render one orc from the resolved SpriteRenderState.
 *
 * - animated: cycles framePaths at manifest fps on a RAF clock (phase preserved across
 *   same-state re-renders; reset to frame 0 on state transition via memo identity).
 * - static (terminated / reduced-motion): single frame, no advance.
 * - placeholder: CSS pixel box fixed to the resolved frame_size (no layout shift, R-UI-006).
 * - if a frame/overlay image fails to load, degrade to the placeholder box (R-UI-006).
 */
import { useEffect, useMemo, useState } from 'react';
import { useAssets } from '../../assets/AssetContext';
import {
  resolveSprite,
  type OrcRenderInput,
  type SpriteRenderState,
} from '../../assets/spriteResolver';
import { useStore } from '../../store/store';
import { AGENT_LABEL, STATUS_META } from '../status/statusMeta';
import type { AgentType, OrcStatus } from '../../types/domain';

const DISPLAY_HEIGHT = 88; // px; width derived from frame aspect (same for asset+placeholder)

function useAnimatedIndex(sprite: SpriteRenderState): number {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
    if (sprite.mode !== 'animated' || !sprite.framePaths || !sprite.fps) return;
    const frames = sprite.framePaths.length;
    if (frames <= 1) return;
    const dur = 1000 / sprite.fps;
    let raf = 0;
    let start: number | null = null;
    let last = -1;
    const tick = (t: number): void => {
      if (start === null) start = t;
      const i = Math.floor((t - start) / dur) % frames;
      if (i !== last) {
        last = i;
        setIdx(i);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // sprite identity is stable across same-state re-renders (memoized by caller),
    // so this resets to frame 0 only on an actual state transition (SPEC-300 §3.3-2).
  }, [sprite]);
  return idx;
}

export function OrcSprite({
  orcId,
  agentType,
  status,
  statusConfidence,
  tmuxTarget,
}: {
  orcId: string;
  agentType: AgentType;
  status: OrcStatus;
  statusConfidence: number;
  tmuxTarget: string;
}): JSX.Element {
  const { manifest, assetBase } = useAssets();
  const reducedMotion = useStore((s) => s.reducedMotion);
  const [imgError, setImgError] = useState(false);
  const [overlayError, setOverlayError] = useState(false);

  const input: OrcRenderInput = useMemo(
    () => ({ id: orcId, agentType, status, statusConfidence, tmuxTarget }),
    [orcId, agentType, status, statusConfidence, tmuxTarget],
  );

  const sprite = useMemo(
    () => resolveSprite(input, { manifest, assetBasePath: assetBase, prefersReducedMotion: reducedMotion }),
    [input, manifest, assetBase, reducedMotion],
  );

  // Reset error state when the resolved sprite changes.
  useEffect(() => {
    setImgError(false);
    setOverlayError(false);
  }, [sprite]);

  const frameIdx = useAnimatedIndex(sprite);

  const [fw, fh] = sprite.frameSize;
  const width = Math.round((fw / fh) * DISPLAY_HEIGHT);
  const boxStyle = { width: `${width}px`, height: `${DISPLAY_HEIGHT}px` } as const;

  const usePlaceholder = sprite.mode === 'placeholder' || imgError;
  const overlay =
    sprite.overlayPath && !overlayError ? (
      <img
        className="oc-sprite__overlay"
        src={sprite.overlayPath}
        alt=""
        aria-hidden="true"
        onError={() => setOverlayError(true)}
      />
    ) : null;

  const altText = `${AGENT_LABEL[agentType]} — ${STATUS_META[status].label}`;

  return (
    <div className="oc-sprite" style={boxStyle} role="img" aria-label={altText}>
      {usePlaceholder ? (
        <div className="oc-sprite__placeholder">
          <span aria-hidden="true">{STATUS_META[status].glyph}</span>
          <span>{shortAgent(agentType)}</span>
        </div>
      ) : sprite.mode === 'animated' && sprite.framePaths ? (
        <img
          className="oc-sprite__img"
          src={sprite.framePaths[frameIdx] ?? sprite.framePaths[0]}
          alt=""
          aria-hidden="true"
          onError={() => setImgError(true)}
        />
      ) : sprite.staticFramePath ? (
        <img
          className="oc-sprite__img"
          src={sprite.staticFramePath}
          alt=""
          aria-hidden="true"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="oc-sprite__placeholder">
          <span aria-hidden="true">{STATUS_META[status].glyph}</span>
          <span>{shortAgent(agentType)}</span>
        </div>
      )}
      {overlay}
    </div>
  );
}

function shortAgent(agentType: AgentType): string {
  if (agentType === 'claude-code') return 'Claude';
  if (agentType === 'codex') return 'Codex';
  return '??';
}

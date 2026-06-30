/**
 * SPEC-303 §3.8–§3.10 (Phase 1) — the epic monster NPC sprite on the camp map.
 *
 * A NON-interactive `<div>` (pointer-events:none, aria-hidden, no tab stop, no selection/label):
 * it carries no data, so it never participates in orc placement, keyboard nav, or selection. Per-
 * frame work (position transform + walk-cycle frame src) is written DIRECTLY via refs on the SINGLE
 * shared clock tick (scene/clock.ts) — never per-frame React state — exactly like OrcSprite. Phase 1
 * shows ONLY the `roaming` animation (continuous roam); dwell/error are Phase 2 (SPEC-303 §3 적용 단계).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { frameAt, getTime, subscribe } from '../../scene/clock';
import { useAssets } from '../../assets/AssetContext';
import type { MonsterController } from '../../scene/monster';
import type { RoamingController } from '../../scene/roaming';
import type { Vec2 } from '../../scene/stations';
import type { MonsterDef } from '../../assets/manifest';
import { formatFrame } from '../../assets/spriteResolver';

const MVP_DIRECTION = 'south';

interface ResolvedMonsterSprite {
  framePaths: string[];
  frames: number;
  fps: number;
  isStatic: boolean;
}

function stripSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

/** Phase 1 resolver: roaming walk-cycle for `direction` (south fallback), or a static frame under
 *  reduced-motion / when the roaming animation is unavailable. */
function resolveMonster(
  def: MonsterDef,
  root: string,
  direction: string,
  reducedMotion: boolean,
): ResolvedMonsterSprite {
  const staticFrame = (): ResolvedMonsterSprite => {
    const f = def.reduced_motion?.fallback_frame ?? def.rotations?.south ?? 'rotations/south.png';
    return { framePaths: [`${root}/${f}`], frames: 1, fps: 0, isStatic: true };
  };
  if (reducedMotion) return staticFrame();
  const anim = def.animations?.roaming;
  const folders = anim?.folders ?? {};
  const dir = folders[direction] ? direction : folders[MVP_DIRECTION] ? MVP_DIRECTION : Object.keys(folders)[0];
  const folder = dir ? folders[dir] : undefined;
  if (!anim || !folder) return staticFrame();
  const frames = anim.frames ?? 9;
  const fps = anim.fps ?? 8;
  const pattern = anim.frame_pattern ?? 'frame_%03d.png';
  const framePaths: string[] = [];
  for (let i = 0; i < frames; i += 1) framePaths.push(`${root}/${folder}/${formatFrame(pattern, i)}`);
  return { framePaths, frames, fps, isStatic: false };
}

export function MonsterSprite({
  def,
  controller,
  orcController,
  orcIds,
  assetBase,
  scale,
  reducedMotion,
}: {
  def: MonsterDef;
  controller: MonsterController;
  /** Orc movement controller + ids — read each frame so the monster steers around orcs. */
  orcController: RoamingController;
  orcIds: readonly string[];
  assetBase: string;
  scale: number;
  reducedMotion: boolean;
}): JSX.Element {
  const { manifest } = useAssets();
  const elRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Re-render only on a discrete direction change (re-resolves the walk-cycle folder).
  const [direction, setDirection] = useState<string>(
    () => controller.snapshot(getTime())?.direction ?? MVP_DIRECTION,
  );
  const dirRef = useRef(direction);
  dirRef.current = direction;

  const root = `${stripSlash(assetBase)}/${def.root}`;
  const [fw, fh] = def.frame_size;
  const [ax, ay] = def.anchor;
  const sw = fw * scale;
  const sh = fh * scale;
  const sax = ax * scale;
  const say = ay * scale;

  const sprite = useMemo(
    () => resolveMonster(def, root, direction, reducedMotion),
    [def, root, direction, reducedMotion],
  );
  const spriteRef = useRef(sprite);
  spriteRef.current = sprite;

  // Per-frame: write transform + frame src via refs (no re-render), driven by the shared clock.
  const applyTick = (t: number): void => {
    // Current orc centres (deterministic, from the orc controller) → the monster steers around them.
    const orcCenters: Vec2[] = [];
    for (const id of orcIds) {
      const os = orcController.snapshot(id, t);
      if (os) orcCenters.push(os.renderedPos);
    }
    const snap = controller.snapshot(t, orcCenters);
    if (!snap) return;
    const el = elRef.current;
    if (el) {
      el.style.transform = `translate(${snap.renderedPos.x - sax}px, ${snap.renderedPos.y - say}px)`;
    }
    if (snap.direction !== dirRef.current) {
      dirRef.current = snap.direction;
      setDirection(snap.direction);
    }
    const sp = spriteRef.current;
    if (!sp.isStatic && sp.fps && imgRef.current) {
      const idx = frameAt(t, snap.tEnter, sp.fps, sp.frames);
      const src = sp.framePaths[idx] ?? sp.framePaths[0];
      if (src && imgRef.current.getAttribute('src') !== src) imgRef.current.setAttribute('src', src);
    }
  };
  const applyTickRef = useRef(applyTick);
  applyTickRef.current = applyTick;

  useEffect(() => {
    const unsub = subscribe((t) => applyTickRef.current(t));
    return unsub;
  }, []);

  const initial = controller.snapshot(getTime())?.renderedPos ?? { x: 0, y: 0 };

  // §2.6e — CSS ground shadow at the scaled feet anchor (same token/treatment as orcs), sized from
  // the scaled footprint. A pure absolute decoration behind the (transparent-bg) sprite.
  const shadowCss = manifest?.scene?.shadow?.css;
  const shadowRatio = shadowCss?.footprint_ratio ?? 0.46;
  const shadowOpacity = shadowCss?.opacity ?? 0.35;
  const shadowW = sw * shadowRatio;
  const shadowH = shadowW * 0.3;

  return (
    <div
      className="oc-monster"
      data-testid="epic-monster"
      data-monster-key={def.pixellab_character_id ?? def.display_name ?? ''}
      aria-hidden="true"
      ref={elRef}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: `${sw}px`,
        height: `${sh}px`,
        transform: `translate(${initial.x - sax}px, ${initial.y - say}px)`,
        pointerEvents: 'none', // INV-NI: clicks/drag pass through to orcs / empty map
        willChange: 'transform',
      }}
    >
      <span
        className="oc-monster__shadow"
        data-testid="monster-shadow"
        aria-hidden="true"
        style={{
          left: `${sax - shadowW / 2}px`,
          top: `${say - shadowH / 2}px`,
          width: `${shadowW}px`,
          height: `${shadowH}px`,
          opacity: shadowOpacity,
        }}
      />
      <img
        ref={imgRef}
        src={sprite.framePaths[0]}
        alt=""
        draggable={false}
        style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }}
      />
    </div>
  );
}

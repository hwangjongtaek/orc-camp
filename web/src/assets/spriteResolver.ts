/**
 * SPEC-300 §2.3/§2.4/§3 — deterministic sprite resolver.
 *
 * Pure function: (OrcRenderInput + RenderEnvironment) → SpriteRenderState. Resolves
 * character key (agentType→character, mascot fallback), animation state (status→state,
 * direction/state fallback), effect overlay, terminated static lifecycle, reduced-motion
 * freeze, and placeholder degradation. Same input ⇒ same output (testable).
 */
import type { AgentType, OrcStatus } from '../types/domain';
import type { AssetManifest, CharacterDef } from './manifest';

export interface OrcRenderInput {
  id: string;
  agentType: AgentType;
  status: OrcStatus;
  statusConfidence: number;
  tmuxTarget: string;
}

export interface RenderEnvironment {
  manifest: AssetManifest | null;
  assetBasePath: string;
  prefersReducedMotion: boolean;
}

export type RenderMode = 'animated' | 'static' | 'placeholder';

export interface SpriteRenderState {
  orcId: string;
  characterKey: string;
  frameSize: [number, number];
  anchor: [number, number];
  mode: RenderMode;
  animationState: string | null;
  direction: string;
  framePaths: string[] | null;
  fps: number | null;
  staticFramePath: string | null;
  overlayPath: string | null;
  loop: boolean;
}

const DEFAULT_FRAME_SIZE: [number, number] = [232, 232];
const DEFAULT_ANCHOR: [number, number] = [116, 208];
const MASCOT_KEY = 'orc-high-warchief-mascot';
const MVP_DIRECTION = 'south';

const AGENT_TO_CHARACTER: Record<AgentType, string> = {
  'claude-code': 'orc-claude-storm-shaman',
  codex: 'orc-codex-field-engineer',
  unknown: 'orc-unknown',
};

const STATUS_TO_STATE: Record<OrcStatus, string> = {
  active: 'active',
  waiting: 'waiting',
  idle: 'idle',
  error: 'error',
  stale: 'stale',
  unknown: 'idle', // no dedicated 'unknown' animation; overlay distinguishes it
  terminated: 'idle', // static; uses reduced_motion fallback frame
};

const STATUS_TO_OVERLAY: Record<OrcStatus, string> = {
  active: 'active-spark',
  waiting: 'waiting-bubble',
  idle: 'idle-glow',
  error: 'error-burst',
  stale: 'stale-clock',
  unknown: 'unknown-charm',
  terminated: 'terminated-ghost',
};

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

/** Expand a `frame_%03d.png`-style pattern for index i. */
export function formatFrame(pattern: string, i: number): string {
  return pattern.replace(/%0?(\d+)d/, (_m, widthStr: string) =>
    String(i).padStart(Number(widthStr) || 0, '0'),
  );
}

function overlayPathFor(
  status: OrcStatus,
  packRoot: string,
  manifest: AssetManifest | null,
): string | null {
  const statusUi = manifest?.objects?.['status-ui'];
  if (!statusUi) return null;
  const key = STATUS_TO_OVERLAY[status];
  const item = statusUi.items[key];
  if (!item) return null;
  return `${packRoot}/${statusUi.root}/${item.file}`;
}

function placeholderState(
  input: OrcRenderInput,
  frameSize: [number, number],
  anchor: [number, number],
  overlayPath: string | null,
): SpriteRenderState {
  return {
    orcId: input.id,
    characterKey: AGENT_TO_CHARACTER[input.agentType],
    frameSize,
    anchor,
    mode: 'placeholder',
    animationState: null,
    direction: MVP_DIRECTION,
    framePaths: null,
    fps: null,
    staticFramePath: null,
    overlayPath,
    loop: false,
  };
}

/** Resolve the character entry (agentType → character, mascot fallback). */
function resolveCharacter(
  manifest: AssetManifest,
  agentType: AgentType,
): { key: string; def: CharacterDef } | null {
  const primary = AGENT_TO_CHARACTER[agentType];
  if (manifest.characters[primary]) return { key: primary, def: manifest.characters[primary]! };
  if (manifest.characters[MASCOT_KEY]) {
    return { key: MASCOT_KEY, def: manifest.characters[MASCOT_KEY]! };
  }
  return null;
}

export function resolveSprite(
  input: OrcRenderInput,
  env: RenderEnvironment,
): SpriteRenderState {
  const packRoot = stripTrailingSlash(env.assetBasePath);

  // L2: no manifest → placeholder at default frame size (overlay unavailable).
  if (env.manifest === null) {
    return placeholderState(input, DEFAULT_FRAME_SIZE, DEFAULT_ANCHOR, null);
  }
  const manifest = env.manifest;

  const resolved = resolveCharacter(manifest, input.agentType);
  if (!resolved) {
    // Character (and mascot) unresolvable → placeholder.
    return placeholderState(
      input,
      DEFAULT_FRAME_SIZE,
      DEFAULT_ANCHOR,
      overlayPathFor(input.status, packRoot, manifest),
    );
  }

  const { key: characterKey, def: character } = resolved;
  const frameSize = character.frame_size;
  const anchor = character.anchor;
  const characterRoot = `${packRoot}/${character.root}`;
  const overlayPath = overlayPathFor(input.status, packRoot, manifest);

  const reducedFrame = `${characterRoot}/${character.reduced_motion.fallback_frame}`;

  // Terminated → static fallback frame + ghost overlay; NO death/fall animation.
  if (input.status === 'terminated') {
    return {
      orcId: input.id,
      characterKey,
      frameSize,
      anchor,
      mode: 'static',
      animationState: null,
      direction: character.reduced_motion.fallback_direction,
      framePaths: null,
      fps: null,
      staticFramePath: reducedFrame,
      overlayPath,
      loop: false,
    };
  }

  // Reduced motion → freeze on the per-character fallback frame.
  if (env.prefersReducedMotion) {
    return {
      orcId: input.id,
      characterKey,
      frameSize,
      anchor,
      mode: 'static',
      animationState: character.reduced_motion.fallback_state,
      direction: character.reduced_motion.fallback_direction,
      framePaths: null,
      fps: null,
      staticFramePath: reducedFrame,
      overlayPath,
      loop: false,
    };
  }

  // Animated: status → state (with state/direction fallback).
  let state = STATUS_TO_STATE[input.status];
  let anim = character.animations[state];
  if (!anim || !anim.folders) {
    state = 'idle';
    anim = character.animations.idle;
  }
  if (!anim || !anim.folders) {
    // No usable animation at all → placeholder at this character's frame size.
    return placeholderState(input, frameSize, anchor, overlayPath);
  }

  let direction = MVP_DIRECTION;
  let folder = anim.folders[direction];
  if (!folder) {
    direction = MVP_DIRECTION; // already south; fall through to first available
    const firstDir = Object.keys(anim.folders)[0];
    if (anim.folders[MVP_DIRECTION]) {
      folder = anim.folders[MVP_DIRECTION];
    } else if (firstDir) {
      direction = firstDir;
      folder = anim.folders[firstDir];
    }
  }
  if (!folder) {
    return placeholderState(input, frameSize, anchor, overlayPath);
  }

  const frames = anim.frames ?? 7;
  const fps = anim.fps ?? 4;
  const pattern = anim.frame_pattern ?? 'frame_%03d.png';
  const framePaths: string[] = [];
  for (let i = 0; i < frames; i++) {
    framePaths.push(`${characterRoot}/${folder}/${formatFrame(pattern, i)}`);
  }

  return {
    orcId: input.id,
    characterKey,
    frameSize,
    anchor,
    mode: 'animated',
    animationState: state,
    direction,
    framePaths,
    fps,
    staticFramePath: framePaths[0] ?? null,
    overlayPath,
    loop: true,
  };
}

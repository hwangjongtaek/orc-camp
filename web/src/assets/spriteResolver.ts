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
  /** SPEC-301 — requested 8-direction facing; undefined ⇒ MVP south. */
  direction?: string;
  /** SPEC-301 — 'roaming' selects the walk-cycle animation; undefined/'arrived' ⇒ status. */
  movementState?: 'roaming' | 'arrived';
  /**
   * SPEC-301 §3.1-11 — while being drag-and-dropped, the orc shows its IDLE animation facing the
   * drag-start `direction` (not the walk-cycle and not the status animation), regardless of status.
   */
  dragging?: boolean;
  /**
   * SPEC-300 §2.3 — explicit character key (sequential per-orc assignment). When set and present
   * in the manifest it WINS over the agentType→character map, so the visible orc is chosen by the
   * orc's order on the map, not its agent type. Undefined ⇒ legacy agentType mapping.
   */
  characterKey?: string;
}

export interface RenderEnvironment {
  manifest: AssetManifest | null;
  assetBasePath: string;
  prefersReducedMotion: boolean;
  /** SPEC-301 §2.1 — map sprite scale, applied EQUALLY to asset + placeholder. Default 1. */
  mapSpriteScale?: number;
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
  frames: number;
  fps: number | null;
  staticFramePath: string | null;
  overlayPath: string | null;
  loop: boolean;
  // SPEC-301 §2.1 — uniform map scale echoed + applied to box/anchor (asset==placeholder).
  mapSpriteScale: number;
  scaledFrameSize: [number, number];
  scaledAnchor: [number, number];
}

const DEFAULT_FRAME_SIZE: [number, number] = [232, 232];
const DEFAULT_ANCHOR: [number, number] = [116, 208];
/** Mascot fallback character key (SPEC-300 §2.3 / SPEC-304 §2.2). */
export const MASCOT_KEY = 'orc-high-warchief-mascot';
const MVP_DIRECTION = 'south';

/** agentType → character key (SPEC-300 §2.3 precedence step 2; shared by SPEC-304 portraits). */
export const AGENT_TO_CHARACTER: Record<AgentType, string> = {
  'claude-code': 'orc-claude-storm-shaman',
  codex: 'orc-codex-field-engineer',
  unknown: 'orc-unknown',
};

/**
 * SPEC-300 §2.3 — ordered character pool for SEQUENTIAL per-orc assignment (the camp's orcs cycle
 * through it in reading order, so adjacent orcs look different regardless of agent type). Keep the
 * curated order stable; `availableCharacterPool` filters it to what the active manifest actually
 * ships (and degrades to whatever characters exist if none of these are present).
 */
export const CHARACTER_POOL = [
  'orc-claude-storm-shaman',
  'orc-codex-field-engineer',
  'orc-iron-commander',
  'orc-high-warchief-mascot',
  'orc-unknown',
] as const;

/** The CHARACTER_POOL entries present in `manifest`, in pool order (empty when no manifest). */
export function availableCharacterPool(manifest: AssetManifest | null): string[] {
  if (!manifest) return [];
  const present = CHARACTER_POOL.filter((k) => manifest.characters[k]);
  return present.length > 0 ? present : Object.keys(manifest.characters);
}

/** Character key for the orc at sequential index `i`, cycling the pool (undefined ⇒ empty pool). */
export function characterKeyForIndex(i: number, pool: readonly string[]): string | undefined {
  if (pool.length === 0) return undefined;
  return pool[((i % pool.length) + pool.length) % pool.length];
}

/**
 * SPEC-300 §2.3 / SPEC-304 §2.2 — the SHARED sequential characterKey assignment that CampMap (map
 * sprites) and OrcInspector (portrait) must agree on. `orderedOrcIds` MUST be the camp's orcs in
 * reading order (windowIndex, paneIndex) filtered to existing orcs, so a given orc's portrait
 * matches its on-map sprite. Returns orcId → characterKey (undefined entries ⇒ empty pool).
 */
export function characterKeyMap(
  orderedOrcIds: string[],
  manifest: AssetManifest | null,
): Map<string, string | undefined> {
  const pool = availableCharacterPool(manifest);
  const m = new Map<string, string | undefined>();
  orderedOrcIds.forEach((id, i) => m.set(id, characterKeyForIndex(i, pool)));
  return m;
}

const STATUS_TO_STATE: Record<OrcStatus, string> = {
  active: 'active',
  waiting: 'waiting',
  idle: 'idle',
  error: 'error',
  stale: 'stale',
  unknown: 'idle', // no dedicated 'unknown' animation; overlay distinguishes it
  terminated: 'idle', // #52 — animate the idle loop (was static); ghost overlay still marks it
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
): CoreSpriteState {
  return {
    orcId: input.id,
    characterKey: input.characterKey ?? AGENT_TO_CHARACTER[input.agentType],
    frameSize,
    anchor,
    mode: 'placeholder',
    animationState: null,
    direction: MVP_DIRECTION,
    framePaths: null,
    frames: 1,
    fps: null,
    staticFramePath: null,
    overlayPath,
    loop: false,
  };
}

/**
 * Resolve the character entry. Precedence (SPEC-300 §2.3): explicit `characterKey` (sequential
 * assignment) → agentType→character map → mascot fallback. Each step only wins if the key exists
 * in the manifest, so a missing sequential/agent character degrades gracefully to the mascot.
 */
function resolveCharacter(
  manifest: AssetManifest,
  input: OrcRenderInput,
): { key: string; def: CharacterDef } | null {
  const requested = input.characterKey;
  if (requested && manifest.characters[requested]) {
    return { key: requested, def: manifest.characters[requested]! };
  }
  const primary = AGENT_TO_CHARACTER[input.agentType];
  if (manifest.characters[primary]) return { key: primary, def: manifest.characters[primary]! };
  if (manifest.characters[MASCOT_KEY]) {
    return { key: MASCOT_KEY, def: manifest.characters[MASCOT_KEY]! };
  }
  return null;
}

/** SpriteRenderState before the uniform map scale is applied (§2.1). */
type CoreSpriteState = Omit<
  SpriteRenderState,
  'mapSpriteScale' | 'scaledFrameSize' | 'scaledAnchor'
>;

function resolveCore(input: OrcRenderInput, env: RenderEnvironment): CoreSpriteState {
  const packRoot = stripTrailingSlash(env.assetBasePath);

  // L2: no manifest → placeholder at default frame size (overlay unavailable).
  if (env.manifest === null) {
    return placeholderState(input, DEFAULT_FRAME_SIZE, DEFAULT_ANCHOR, null);
  }
  const manifest = env.manifest;

  const resolved = resolveCharacter(manifest, input);
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

  // Terminated → animate the IDLE loop (not a frozen frame), keeping the `terminated-ghost`
  // overlay to mark it. Falls through to the normal animation path below where
  // STATUS_TO_STATE['terminated'] resolves to the 'idle' state. (Reduced-motion still freezes
  // it via the check just below; movement stays snapped/static in the controller, §3.1-5.)

  // Reduced motion → freeze on the per-character fallback frame (covers terminated too).
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
      frames: 1,
      fps: null,
      staticFramePath: reducedFrame,
      overlayPath,
      loop: false,
    };
  }

  // SPEC-301 — roaming selects the walk-cycle; otherwise status → state (MVP path). §3.1-11 — a
  // dragged orc forces the IDLE animation (in its drag-start direction) over status/walk.
  const roaming = input.movementState === 'roaming';
  let state = input.dragging ? 'idle' : roaming ? 'roaming' : STATUS_TO_STATE[input.status];
  let anim = character.animations[state];
  if (!anim || !anim.folders) {
    state = 'idle';
    anim = character.animations.idle;
  }
  if (!anim || !anim.folders) {
    // No usable animation at all → placeholder at this character's frame size.
    return placeholderState(input, frameSize, anchor, overlayPath);
  }

  // Direction: honor the requested 8-dir for BOTH a roaming leg AND an arrived dwell (SPEC-301
  // §3.1-10 #50 — active orcs dwell facing a random direction), falling back to south when none is
  // requested or the folder is missing (SPEC-300 §3.2-4 fallback delegation). With no requested
  // direction (the MVP/idle path) this stays south, unchanged.
  const requestedDir = input.direction ?? MVP_DIRECTION;
  let direction = requestedDir;
  let folder = anim.folders[direction];
  if (!folder) {
    const firstDir = Object.keys(anim.folders)[0];
    if (anim.folders[MVP_DIRECTION]) {
      direction = MVP_DIRECTION;
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
    frames,
    fps,
    staticFramePath: framePaths[0] ?? null,
    overlayPath,
    loop: true,
  };
}

/**
 * Resolve the sprite render state, then apply the uniform map scale (§2.1) to the box +
 * anchor for BOTH asset and placeholder modes (so toggling assets never shifts layout —
 * AC-08 / AC-14c). `mapSpriteScale` defaults to 1 (the SPEC-300 MVP behavior is unchanged).
 */
export function resolveSprite(
  input: OrcRenderInput,
  env: RenderEnvironment,
): SpriteRenderState {
  const scale = env.mapSpriteScale ?? 1;
  const core = resolveCore(input, env);
  return {
    ...core,
    mapSpriteScale: scale,
    scaledFrameSize: [core.frameSize[0] * scale, core.frameSize[1] * scale],
    scaledAnchor: [core.anchor[0] * scale, core.anchor[1] * scale],
  };
}

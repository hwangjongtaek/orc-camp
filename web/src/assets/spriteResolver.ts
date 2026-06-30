/**
 * SPEC-300 §2.3/§2.4/§3 — deterministic sprite resolver.
 *
 * Pure function: (OrcRenderInput + RenderEnvironment) → SpriteRenderState. Resolves
 * character key (agentType→character, mascot fallback), animation state (status→state,
 * direction/state fallback), effect overlay, terminated static lifecycle, reduced-motion
 * freeze, and placeholder degradation. Same input ⇒ same output (testable).
 */
import type { AgentType, OrcStatus } from '../types/domain';
import type { AnimationDef, AssetManifest, CharacterDef, ReducedMotionDef } from './manifest';
import {
  resolveTierVariant,
  variantAppearanceKey,
  type DisplayedTier,
} from './prestige';

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
  /**
   * SPEC-302 §3.2 — the orc's latched displayed prestige tier (0 = base). Computed by the scene
   * store's latch (keyed by (id, resolvedCharacterKey)) and threaded in here. Undefined/0 ⇒ base
   * rendering, unchanged. A tier > 0 only matters when the resolved character has a `prestige`
   * block (the data-driven gate); otherwise it is ignored (§3.2 gate).
   */
  displayedTier?: DisplayedTier;
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
  // SPEC-302 §3.3/§3.4 — resolved prestige tier composition. `prestigeTier` is the latched display
  // tier (0 = base); `appearanceKey` is the rendered variant key (== characterKey at tier 0);
  // `tierMotion='static_tier'` marks the §3.4 step4 second branch (tier variant shown as its STATIC
  // rotation because it lacks the requested animation — `mode` is then 'static').
  prestigeTier: DisplayedTier;
  appearanceKey: string;
  tierMotion: 'animated' | 'static_tier';
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
  // §3.5 — the placeholder need not visualize tier; layout/anchor parity is what matters. The
  // characterKey echoes the would-be identity; tier fields stay base (0 / animated).
  const key = input.characterKey ?? AGENT_TO_CHARACTER[input.agentType];
  return {
    orcId: input.id,
    characterKey: key,
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
    prestigeTier: 0,
    appearanceKey: key,
    tierMotion: 'animated',
  };
}

/**
 * SPEC-300 §2.3 character-key precedence: explicit `characterKey` (sequential assignment) →
 * agentType→character map → mascot fallback. Each step only wins if the key exists in the manifest.
 * Returns null when nothing (not even the mascot) resolves. Exported so the SPEC-302 latch can key
 * its observations on the SAME resolved character the sprite will render (composite-key parity).
 */
export function resolveCharacterKey(
  manifest: AssetManifest | null,
  characterKey: string | undefined,
  agentType: AgentType,
): string | null {
  if (!manifest) return null;
  if (characterKey && manifest.characters[characterKey]) return characterKey;
  const primary = AGENT_TO_CHARACTER[agentType];
  if (manifest.characters[primary]) return primary;
  if (manifest.characters[MASCOT_KEY]) return MASCOT_KEY;
  return null;
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
  const key = resolveCharacterKey(manifest, input.characterKey, input.agentType);
  if (!key) return null;
  return { key, def: manifest.characters[key]! };
}

/**
 * SPEC-302 §3.4 step2 — the EFFECTIVE appearance the sprite renders against: the §3.3-selected tier
 * variant REPLACES the base character as the source of root/animations/rotations/reduced_motion
 * (and frame geometry). At tier 0 / no available variant this is the base character, so base
 * rendering is byte-for-byte unchanged.
 */
interface Appearance {
  appearanceKey: string;
  displayedTier: DisplayedTier;
  isTierVariant: boolean;
  root: string; // relative to packRoot
  frameSize: [number, number];
  anchor: [number, number];
  scale: number; // SPEC-301 §2.1 — per-character (or tier-variant) size multiplier; default 1
  animations: Record<string, AnimationDef>;
  rotations: Record<string, string> | undefined; // §3.4 static_tier source (tier variant)
  reducedMotion: ReducedMotionDef;
}

function appearanceFor(
  characterKey: string,
  character: CharacterDef,
  displayedTier: DisplayedTier,
): Appearance {
  const variant = resolveTierVariant(character, displayedTier);
  if (!variant) {
    return {
      appearanceKey: characterKey,
      displayedTier,
      isTierVariant: false,
      root: character.root,
      frameSize: character.frame_size,
      anchor: character.anchor,
      scale: character.scale ?? 1,
      animations: character.animations,
      rotations: character.rotations,
      reducedMotion: character.reduced_motion,
    };
  }
  const e = variant.entry;
  return {
    appearanceKey: variantAppearanceKey(characterKey, e),
    displayedTier,
    isTierVariant: true,
    root: e.root as string,
    frameSize: e.frame_size ?? character.frame_size,
    anchor: e.anchor ?? character.anchor,
    scale: e.scale ?? character.scale ?? 1,
    animations: e.animations ?? {},
    rotations: e.rotations,
    reducedMotion: e.reduced_motion ?? character.reduced_motion,
  };
}

function directionFallback(
  available: Record<string, string> | Record<string, unknown>,
  requested: string,
): string | null {
  if (available[requested]) return requested;
  if (available[MVP_DIRECTION]) return MVP_DIRECTION;
  const first = Object.keys(available)[0];
  return first ?? null;
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

  // SPEC-302 §3.2 gate + §3.3/§3.4 — the latched display tier selects an EFFECTIVE appearance: the
  // base character at tier 0 / no available variant (rendering unchanged), or a tier variant whose
  // root/animations/rotations/reduced_motion replace the base. The gate is implicit — `appearanceFor`
  // returns base when `character.prestige` is absent or no available tier ≤ displayedTier exists.
  const displayedTier = (input.displayedTier ?? 0) as DisplayedTier;
  const appearance = appearanceFor(characterKey, character, displayedTier);
  // SPEC-301 §2.1 — per-character size differentiation: the manifest `scale` (character, or the tier
  // variant's override) grows the sprite around its FEET anchor. Folded into frame/anchor here so the
  // map scale and the ground shadow follow it (anchor stays planted; a bigger orc just stands taller).
  const cScale = appearance.scale;
  const frameSize: [number, number] = [appearance.frameSize[0] * cScale, appearance.frameSize[1] * cScale];
  const anchor: [number, number] = [appearance.anchor[0] * cScale, appearance.anchor[1] * cScale];
  const characterRoot = `${packRoot}/${appearance.root}`;
  const overlayPath = overlayPathFor(input.status, packRoot, manifest);
  const tierFields = { prestigeTier: displayedTier, appearanceKey: appearance.appearanceKey };

  const reducedFrame = `${characterRoot}/${appearance.reducedMotion.fallback_frame}`;

  // Reduced motion → freeze on the (variant's) fallback frame (§3.5; covers terminated too). The
  // tier is still reflected (variant root + its reduced_motion frame).
  if (env.prefersReducedMotion) {
    return {
      orcId: input.id,
      characterKey,
      frameSize,
      anchor,
      mode: 'static',
      animationState: appearance.reducedMotion.fallback_state,
      direction: appearance.reducedMotion.fallback_direction,
      framePaths: null,
      frames: 1,
      fps: null,
      staticFramePath: reducedFrame,
      overlayPath,
      loop: false,
      ...tierFields,
      tierMotion: 'animated',
    };
  }

  // SPEC-301 — roaming selects the walk-cycle; otherwise status → state (MVP path). §3.1-11 — a
  // dragged orc forces the IDLE animation (in its drag-start direction) over status/walk.
  const roaming = input.movementState === 'roaming';
  const requestedState = input.dragging ? 'idle' : roaming ? 'roaming' : STATUS_TO_STATE[input.status];
  // Direction: honor the requested 8-dir for BOTH a roaming leg AND an arrived dwell (SPEC-301
  // §3.1-10 #50), falling back to south/first when missing (SPEC-300 §3.2-4 fallback delegation).
  const requestedDir = input.direction ?? MVP_DIRECTION;

  // SPEC-302 §3.4 step4 — a tier variant composes ON TOP of the base and NEVER falls back to the
  // base animation: if it lacks the requested state's animation it shows its OWN static rotation
  // (so the richer tier silhouette stays visible in normal motion — self-defeating otherwise), and
  // only degrades to placeholder if it has neither. tier ≥ 1 variants auto-promote to `animated`
  // the moment their animation folders land (forward-compatible).
  if (appearance.isTierVariant) {
    const anim = appearance.animations[requestedState];
    if (anim?.folders && Object.keys(anim.folders).length > 0) {
      const dir = directionFallback(anim.folders, requestedDir);
      const folder = dir ? anim.folders[dir] : undefined;
      if (dir && folder) {
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
          animationState: requestedState,
          direction: dir,
          framePaths,
          frames,
          fps,
          staticFramePath: framePaths[0] ?? null,
          overlayPath,
          loop: true,
          ...tierFields,
          tierMotion: 'animated',
        };
      }
    }
    // static_tier — the variant's static rotation for the requested direction (else south/first).
    const rotations = appearance.rotations ?? {};
    const rotDir = directionFallback(rotations, requestedDir);
    const rel = rotDir ? rotations[rotDir] : undefined;
    if (rotDir && rel) {
      return {
        orcId: input.id,
        characterKey,
        frameSize,
        anchor,
        mode: 'static',
        animationState: requestedState,
        direction: rotDir,
        framePaths: null,
        frames: 1,
        fps: null,
        staticFramePath: `${characterRoot}/${rel}`,
        overlayPath,
        loop: false,
        ...tierFields,
        tierMotion: 'static_tier',
      };
    }
    // Variant has neither animation nor rotation → placeholder (should not happen for delivered art).
    return placeholderState(input, frameSize, anchor, overlayPath);
  }

  // --- base path (tier 0 / no available variant): legacy behavior, unchanged ---
  let state = requestedState;
  let anim = appearance.animations[state];
  if (!anim || !anim.folders) {
    state = 'idle';
    anim = appearance.animations.idle;
  }
  if (!anim || !anim.folders) {
    // No usable animation at all → placeholder at this character's frame size.
    return placeholderState(input, frameSize, anchor, overlayPath);
  }

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
    ...tierFields,
    tierMotion: 'animated',
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

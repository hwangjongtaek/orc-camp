/**
 * SPEC-302 §3.4/§3.5 — tier ⊕ status composition through resolveSprite (the SPEC-300 seam). The
 * resolved characterKey + displayedTier are injected directly (no live scan). Proves: the tier
 * variant REPLACES the base for the rendered roots, `static_tier` shows the variant's static
 * rotation (never the base animation), the effect overlay is tier-independent, reduced-motion
 * freezes on the variant frame, and base rendering is unchanged at tier 0.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveSprite,
  type OrcRenderInput,
  type RenderEnvironment,
} from '../src/assets/spriteResolver';
import type { AssetManifest, CharacterDef, PrestigeTierDef } from '../src/assets/manifest';

const DIR8 = ['south', 'east', 'north', 'west', 'south-east', 'north-east', 'north-west', 'south-west'];
function rot8(): Record<string, string> {
  return Object.fromEntries(DIR8.map((d) => [d, `rotations/${d}.png`]));
}
function anim8(folder: string) {
  return {
    frames: 8,
    fps: 8,
    frame_pattern: 'frame_%03d.png',
    folders: Object.fromEntries(DIR8.map((d) => [d, `animations/${folder}/${d}`])),
  };
}
function tierDef(
  tier: 1 | 2 | 3,
  status: PrestigeTierDef['status'],
  suffix: string,
  root: string,
  animations: Record<string, ReturnType<typeof anim8>> = {},
): PrestigeTierDef {
  return {
    tier,
    suffix,
    status,
    pixellab_character_id: status === 'planned' ? null : `pid-${tier}`,
    root,
    rotations: rot8(),
    animations,
    reduced_motion: { fallback_state: 'idle', fallback_direction: 'south', fallback_frame: 'rotations/south.png' },
  };
}
function tieredCharacter(root: string, tiers: PrestigeTierDef[]): CharacterDef {
  return {
    root,
    frame_size: [232, 232],
    scale: 1,
    anchor: [116, 200],
    directions: DIR8,
    rotations: rot8(),
    animations: { idle: anim8('idle'), active: anim8('active') },
    reduced_motion: { fallback_state: 'idle', fallback_direction: 'south', fallback_frame: 'animations/idle/south/frame_000.png' },
    prestige: { axis: 'cumulative_tokens', tiers },
  };
}

function manifest(): AssetManifest {
  const statusKeys = ['active-spark', 'waiting-bubble', 'idle-glow', 'error-burst', 'stale-clock', 'unknown-charm', 'terminated-ghost'];
  return {
    characters: {
      'orc-high-warchief-mascot': tieredCharacter('sprites/orc-high-warchief-mascot/M', [
        tierDef(1, 'available', '-veteran', 'sprites/orc-high-warchief-mascot/tiers/veteran/V', { idle: anim8('idle'), active: anim8('active') }),
        tierDef(2, 'available', '-champion', 'sprites/orc-high-warchief-mascot/tiers/champion/C'), // animations empty → static_tier
        tierDef(3, 'staged', '-warlord', 'sprites/orc-high-warchief-mascot/tiers/warlord/W'),
      ]),
      'orc-claude-storm-shaman': tieredCharacter('sprites/orc-claude-storm-shaman/S', [
        tierDef(1, 'available', '-adept', 'sprites/orc-claude-storm-shaman/tiers/adept/A', { idle: anim8('idle'), active: anim8('active') }),
        tierDef(2, 'available', '-tempest', 'sprites/orc-claude-storm-shaman/tiers/tempest/T'), // animations empty → static_tier
        tierDef(3, 'staged', '-archon', 'sprites/orc-claude-storm-shaman/tiers/archon/X'),
      ]),
    },
    objects: {
      'status-ui': {
        root: 'objects/status-ui',
        items: Object.fromEntries(statusKeys.map((k) => [k, { file: `${k}.png` }])),
      },
    },
  };
}

function input(over: Partial<OrcRenderInput>): OrcRenderInput {
  return {
    id: 'pane:%1',
    agentType: 'claude-code',
    status: 'idle',
    statusConfidence: 0.7,
    tmuxTarget: 'work:0.0',
    ...over,
  };
}
function env(over: Partial<RenderEnvironment>): RenderEnvironment {
  return { manifest: manifest(), assetBasePath: '/pack', prefersReducedMotion: false, ...over };
}

describe('SPEC-302 §3.4 composition (resolveSprite)', () => {
  it('AC-06: tier2 (animation-missing) + active → static_tier rotation, NOT the base active; overlay tier-independent', () => {
    const s = resolveSprite(
      input({ characterKey: 'orc-high-warchief-mascot', status: 'active', displayedTier: 2 }),
      env({}),
    );
    expect(s.characterKey).toBe('orc-high-warchief-mascot');
    expect(s.prestigeTier).toBe(2);
    expect(s.appearanceKey).toBe('orc-high-warchief-mascot-champion');
    expect(s.animationState).toBe('active'); // status→state is unchanged
    expect(s.tierMotion).toBe('static_tier');
    expect(s.mode).toBe('static');
    expect(s.framePaths).toBeNull();
    // the tier-2 static rotation (champion root), NOT the base /M active animation
    expect(s.staticFramePath).toBe('/pack/sprites/orc-high-warchief-mascot/tiers/champion/C/rotations/south.png');
    expect(s.staticFramePath).not.toContain('/M/animations/active');
    expect(s.overlayPath).toContain('active-spark.png'); // overlay is tier-independent
  });

  it('AC-06 forward: when the tier-2 variant gains the active animation it auto-promotes to animated', () => {
    const m = manifest();
    m.characters['orc-high-warchief-mascot']!.prestige!.tiers[1]!.animations = { active: anim8('active') };
    const s = resolveSprite(
      input({ characterKey: 'orc-high-warchief-mascot', status: 'active', displayedTier: 2 }),
      env({ manifest: m }),
    );
    expect(s.tierMotion).toBe('animated');
    expect(s.mode).toBe('animated');
    expect(s.framePaths?.[0]).toBe(
      '/pack/sprites/orc-high-warchief-mascot/tiers/champion/C/animations/active/south/frame_000.png',
    );
  });

  it('AC-09: a non-mascot tiered character composes the same way (storm-shaman static_tier)', () => {
    const s = resolveSprite(
      input({ characterKey: 'orc-claude-storm-shaman', status: 'active', displayedTier: 2, direction: 'east' }),
      env({}),
    );
    expect(s.characterKey).toBe('orc-claude-storm-shaman');
    expect(s.appearanceKey).toBe('orc-claude-storm-shaman-tempest');
    expect(s.tierMotion).toBe('static_tier');
    expect(s.mode).toBe('static');
    // honors the requested direction in the variant's rotations
    expect(s.staticFramePath).toBe('/pack/sprites/orc-claude-storm-shaman/tiers/tempest/T/rotations/east.png');
  });

  it('AC-04 (render): displayedTier=3 with only T1 available renders the T1 variant (not placeholder)', () => {
    const m = manifest();
    const mascot = m.characters['orc-high-warchief-mascot']!;
    mascot.prestige!.tiers[1]!.status = 'planned'; // T2 not available
    mascot.prestige!.tiers[2]!.status = 'planned'; // T3 not available
    const s = resolveSprite(
      input({ characterKey: 'orc-high-warchief-mascot', status: 'active', displayedTier: 3 }),
      env({ manifest: m }),
    );
    expect(s.appearanceKey).toBe('orc-high-warchief-mascot-veteran');
    expect(s.mode).not.toBe('placeholder');
    // T1 HAS the active animation → animated from the veteran root
    expect(s.framePaths?.[0]).toContain('tiers/veteran/V/animations/active/south');
  });
});

describe('SPEC-302 §3.5 reduced-motion / placeholder parity', () => {
  it('AC-07: reduced motion freezes on the tier-variant fallback frame', () => {
    const s = resolveSprite(
      input({ characterKey: 'orc-high-warchief-mascot', status: 'active', displayedTier: 2 }),
      env({ prefersReducedMotion: true }),
    );
    expect(s.mode).toBe('static');
    expect(s.framePaths).toBeNull();
    expect(s.fps).toBeNull();
    expect(s.prestigeTier).toBe(2);
    // the tier-2 variant's reduced_motion frame (champion root), not the base frame
    expect(s.staticFramePath).toBe('/pack/sprites/orc-high-warchief-mascot/tiers/champion/C/rotations/south.png');
  });

  it('AC-07: no manifest → placeholder parity at the default frame size (tier ignored)', () => {
    const s = resolveSprite(
      input({ characterKey: 'orc-high-warchief-mascot', status: 'active', displayedTier: 2 }),
      env({ manifest: null }),
    );
    expect(s.mode).toBe('placeholder');
    expect(s.frameSize).toEqual([232, 232]);
  });
});

describe('SPEC-302 base rendering is unchanged at tier 0 / null usage', () => {
  it('displayedTier 0 → base character, base animation (no regression)', () => {
    const s = resolveSprite(
      input({ characterKey: 'orc-high-warchief-mascot', status: 'active', displayedTier: 0 }),
      env({}),
    );
    expect(s.prestigeTier).toBe(0);
    expect(s.appearanceKey).toBe('orc-high-warchief-mascot');
    expect(s.tierMotion).toBe('animated');
    expect(s.mode).toBe('animated');
    expect(s.framePaths?.[0]).toBe('/pack/sprites/orc-high-warchief-mascot/M/animations/active/south/frame_000.png');
  });

  it('undefined displayedTier (usage never collected) behaves exactly like tier 0', () => {
    const withTier = resolveSprite(input({ characterKey: 'orc-claude-storm-shaman', status: 'active', displayedTier: 0 }), env({}));
    const without = resolveSprite(input({ characterKey: 'orc-claude-storm-shaman', status: 'active' }), env({}));
    expect(without.appearanceKey).toBe(withTier.appearanceKey);
    expect(without.framePaths?.[0]).toBe(withTier.framePaths?.[0]);
  });
});

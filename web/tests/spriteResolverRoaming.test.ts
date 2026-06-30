/**
 * SPEC-301 — resolveSprite extensions: roaming animation + 8-direction + uniform map
 * scale (AC-08/AC-14c). The MVP south/no-roam path must stay byte-identical (the original
 * 10 resolver tests still cover it; here we assert the new fields don't perturb it).
 */
import { describe, it, expect } from 'vitest';
import {
  resolveSprite,
  type OrcRenderInput,
  type RenderEnvironment,
} from '../src/assets/spriteResolver';
import type { AssetManifest, CharacterDef } from '../src/assets/manifest';

const dirs = ['south', 'east', 'north', 'west', 'south-east', 'north-east', 'north-west', 'south-west'];
const dir8 = (folder: string): Record<string, string> =>
  Object.fromEntries(dirs.map((d) => [d, `${folder}/${d}`]));

function character(over: Partial<CharacterDef> = {}): CharacterDef {
  return {
    root: over.root ?? 'sprites/c/C',
    frame_size: over.frame_size ?? [232, 232],
    scale: 1,
    anchor: over.anchor ?? [116, 208],
    directions: dirs,
    animations: over.animations ?? {
      idle: { frames: 7, fps: 4, frame_pattern: 'frame_%03d.png', folders: dir8('animations/idle') },
      active: { frames: 7, fps: 8, frame_pattern: 'frame_%03d.png', folders: dir8('animations/active') },
      roaming: { frames: 9, fps: 8, frame_pattern: 'frame_%03d.png', folders: dir8('animations/roaming') },
    },
    reduced_motion: {
      fallback_state: 'idle',
      fallback_direction: 'south',
      fallback_frame: 'animations/idle/south/frame_000.png',
    },
  };
}

function manifest(claudeOver?: Partial<CharacterDef>): AssetManifest {
  return {
    characters: {
      'orc-claude-storm-shaman': character({ root: 'sprites/claude/C', ...claudeOver }),
      'orc-unknown': character({ root: 'sprites/unknown/U', frame_size: [228, 228], anchor: [114, 204] }),
    },
    objects: { 'status-ui': { root: 'objects/status-ui', items: { 'active-spark': { file: 'active-spark.png' } } } },
  };
}

function input(over: Partial<OrcRenderInput> = {}): OrcRenderInput {
  return { id: 'pane:%1', agentType: 'claude-code', status: 'idle', statusConfidence: 0.7, tmuxTarget: 'w:0.0', ...over };
}

function env(over: Partial<RenderEnvironment> = {}): RenderEnvironment {
  return { manifest: manifest(), assetBasePath: '/pack', prefersReducedMotion: false, ...over };
}

describe('SPEC-301 resolveSprite roaming + direction', () => {
  it('roaming + 8-direction selects the roaming walk-cycle folder for that direction', () => {
    const s = resolveSprite(input({ status: 'active', movementState: 'roaming', direction: 'east' }), env());
    expect(s.animationState).toBe('roaming');
    expect(s.direction).toBe('east');
    expect(s.fps).toBe(8);
    expect(s.frames).toBe(9);
    expect(s.framePaths?.[0]).toBe('/pack/sprites/claude/C/animations/roaming/east/frame_000.png');
  });

  it('AC-05 fallback: a missing roaming direction folder degrades to south', () => {
    const m = manifest({
      animations: {
        idle: { frames: 7, fps: 4, frame_pattern: 'frame_%03d.png', folders: dir8('animations/idle') },
        roaming: { frames: 9, fps: 8, frame_pattern: 'frame_%03d.png', folders: { south: 'animations/roaming/south' } },
      },
    });
    const s = resolveSprite(
      input({ movementState: 'roaming', direction: 'north' }),
      env({ manifest: m }),
    );
    expect(s.animationState).toBe('roaming');
    expect(s.direction).toBe('south');
    expect(s.framePaths?.[0]).toContain('animations/roaming/south/frame_000.png');
  });

  it('MVP path unchanged: no movementState ⇒ status animation facing south', () => {
    const s = resolveSprite(input({ status: 'active' }), env());
    expect(s.animationState).toBe('active');
    expect(s.direction).toBe('south');
    expect(s.framePaths?.[0]).toBe('/pack/sprites/claude/C/animations/active/south/frame_000.png');
  });

  it('#50: an ARRIVED active orc honors the requested (random) dwell direction', () => {
    // movementState 'arrived' + a direction ⇒ active anim faces that direction (not forced south).
    const s = resolveSprite(input({ status: 'active', movementState: 'arrived', direction: 'north-east' }), env());
    expect(s.animationState).toBe('active');
    expect(s.direction).toBe('north-east');
    expect(s.framePaths?.[0]).toBe('/pack/sprites/claude/C/animations/active/north-east/frame_000.png');
  });

  it('#50: an arrived dwell with a missing direction folder still degrades to south', () => {
    const m = manifest({
      animations: {
        idle: { frames: 7, fps: 4, frame_pattern: 'frame_%03d.png', folders: dir8('animations/idle') },
        active: { frames: 7, fps: 8, frame_pattern: 'frame_%03d.png', folders: { south: 'animations/active/south' } },
        roaming: { frames: 9, fps: 8, frame_pattern: 'frame_%03d.png', folders: dir8('animations/roaming') },
      },
    });
    const s = resolveSprite(
      input({ status: 'active', movementState: 'arrived', direction: 'north-east' }),
      env({ manifest: m }),
    );
    expect(s.direction).toBe('south');
  });
});

describe('SPEC-301-AC-08/AC-14c uniform map scale parity', () => {
  it('AC-14c: mapSpriteScale is applied to box + anchor (default 1 keeps MVP behavior)', () => {
    const unscaled = resolveSprite(input({ status: 'active' }), env());
    expect(unscaled.mapSpriteScale).toBe(1);
    expect(unscaled.scaledFrameSize).toEqual([232, 232]);
    expect(unscaled.scaledAnchor).toEqual([116, 208]);

    const scaled = resolveSprite(input({ status: 'active' }), env({ mapSpriteScale: 0.2 }));
    expect(scaled.scaledFrameSize).toEqual([232 * 0.2, 232 * 0.2]);
    expect(scaled.scaledAnchor).toEqual([116 * 0.2, 208 * 0.2]);
  });

  it('AC-08: the SAME scale applies to asset (animated) and placeholder boxes', () => {
    // animated (asset present)
    const animated = resolveSprite(input({ status: 'active' }), env({ mapSpriteScale: 0.2 }));
    expect(animated.mode).toBe('animated');
    // placeholder (no manifest) — default frame size, same scale factor
    const placeholder = resolveSprite(input({ status: 'active' }), env({ manifest: null, mapSpriteScale: 0.2 }));
    expect(placeholder.mode).toBe('placeholder');
    expect(placeholder.mapSpriteScale).toBe(0.2);
    expect(placeholder.scaledFrameSize).toEqual([232 * 0.2, 232 * 0.2]);
    // identical map scale factor on both → asset toggle cannot shift the box
    expect(placeholder.mapSpriteScale).toBe(animated.mapSpriteScale);
  });

  it('AC-08: image-load failure keeps the resolved character box (no layout shift)', () => {
    // unknown character resolves to a 228 box; placeholder-on-error keeps that box scaled.
    const u = resolveSprite(input({ agentType: 'unknown', status: 'active' }), env({ mapSpriteScale: 0.2 }));
    expect(u.frameSize).toEqual([228, 228]);
    expect(u.scaledFrameSize).toEqual([228 * 0.2, 228 * 0.2]);
  });
});

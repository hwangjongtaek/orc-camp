import { describe, it, expect } from 'vitest';
import {
  availableCharacterPool,
  characterKeyForIndex,
  CHARACTER_POOL,
  formatFrame,
  resolveSprite,
  type OrcRenderInput,
  type RenderEnvironment,
} from '../src/assets/spriteResolver';
import type { AssetManifest, CharacterDef } from '../src/assets/manifest';

function character(over: Partial<CharacterDef>): CharacterDef {
  const dir8 = (folder: string) =>
    Object.fromEntries(
      ['south', 'east', 'north', 'west', 'south-east', 'north-east', 'north-west', 'south-west'].map(
        (d) => [d, `${folder}/${d}`],
      ),
    );
  return {
    root: over.root ?? 'sprites/x/X',
    frame_size: over.frame_size ?? [232, 232],
    scale: 1,
    anchor: over.anchor ?? [116, 208],
    directions: ['south'],
    animations: over.animations ?? {
      idle: { frames: 7, fps: 4, frame_pattern: 'frame_%03d.png', folders: dir8('animations/idle') },
      active: { frames: 7, fps: 8, frame_pattern: 'frame_%03d.png', folders: dir8('animations/active') },
      waiting: { frames: 7, fps: 4, frame_pattern: 'frame_%03d.png', folders: dir8('animations/waiting') },
      stale: { frames: 7, fps: 3, frame_pattern: 'frame_%03d.png', folders: dir8('animations/stale') },
      error: { frames: 7, fps: 6, frame_pattern: 'frame_%03d.png', folders: dir8('animations/error') },
      terminated: { coverage: 'none', runtime_behavior: 'static fallback plus status effect only' },
    },
    reduced_motion: over.reduced_motion ?? {
      fallback_state: 'idle',
      fallback_direction: 'south',
      fallback_frame: 'animations/idle/south/frame_000.png',
    },
  };
}

function manifest(): AssetManifest {
  const statusKeys = [
    'active-spark',
    'waiting-bubble',
    'idle-glow',
    'error-burst',
    'stale-clock',
    'unknown-charm',
    'terminated-ghost',
  ];
  return {
    characters: {
      'orc-claude-storm-shaman': character({ root: 'sprites/orc-claude-storm-shaman/C', frame_size: [232, 232], anchor: [116, 208] }),
      'orc-codex-field-engineer': character({ root: 'sprites/orc-codex-field-engineer/E', frame_size: [232, 232], anchor: [116, 208] }),
      'orc-unknown': character({ root: 'sprites/orc-unknown/U', frame_size: [228, 228], anchor: [114, 204] }),
      'orc-high-warchief-mascot': character({
        root: 'sprites/orc-high-warchief-mascot/M',
        animations: {
          idle: { frames: 7, fps: 4, frame_pattern: 'frame_%03d.png', folders: { south: 'animations/idle/south' } },
          error: { frames: 7, fps: 6, frame_pattern: 'frame_%03d.png', coverage: 'south-only', folders: { south: 'animations/error/south' } },
        },
      }),
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

describe('formatFrame', () => {
  it('zero-pads %03d', () => {
    expect(formatFrame('frame_%03d.png', 0)).toBe('frame_000.png');
    expect(formatFrame('frame_%03d.png', 6)).toBe('frame_006.png');
  });
});

describe('resolveSprite (SPEC-300)', () => {
  it('AC-01: agentType → character + frame_size/anchor', () => {
    const claude = resolveSprite(input({ agentType: 'claude-code' }), env({}));
    expect(claude.characterKey).toBe('orc-claude-storm-shaman');
    expect(claude.frameSize).toEqual([232, 232]);
    const unknown = resolveSprite(input({ agentType: 'unknown' }), env({}));
    expect(unknown.characterKey).toBe('orc-unknown');
    expect(unknown.frameSize).toEqual([228, 228]);
    expect(unknown.anchor).toEqual([114, 204]);
  });

  it('§3.1-11: dragging forces the IDLE animation in the drag-start direction (over status/roaming)', () => {
    // an ACTIVE orc being dragged WEST shows the idle (not active/roaming) loop facing west.
    const s = resolveSprite(
      input({ status: 'active', movementState: 'roaming', dragging: true, direction: 'west' }),
      env({}),
    );
    expect(s.mode).toBe('animated');
    expect(s.animationState).toBe('idle');
    expect(s.direction).toBe('west');
    expect(s.framePaths?.[0]).toBe('/pack/sprites/orc-claude-storm-shaman/C/animations/idle/west/frame_000.png');
  });

  it('AC-02: status=active → animated, fps/frames/path from manifest', () => {
    const s = resolveSprite(input({ status: 'active' }), env({}));
    expect(s.mode).toBe('animated');
    expect(s.animationState).toBe('active');
    expect(s.fps).toBe(8);
    expect(s.framePaths?.length).toBe(7);
    expect(s.framePaths?.[0]).toBe('/pack/sprites/orc-claude-storm-shaman/C/animations/active/south/frame_000.png');
    expect(s.loop).toBe(true);
  });

  it('AC-03: status → overlay key', () => {
    expect(resolveSprite(input({ status: 'active' }), env({})).overlayPath).toContain('active-spark.png');
    expect(resolveSprite(input({ status: 'stale' }), env({})).overlayPath).toContain('stale-clock.png');
  });

  it('AC-04: unknown status → idle animation + unknown-charm overlay', () => {
    const s = resolveSprite(input({ status: 'unknown' }), env({}));
    expect(s.animationState).toBe('idle');
    expect(s.overlayPath).toContain('unknown-charm.png');
  });

  it('AC-05 (#52): terminated → animated IDLE loop + ghost overlay (no longer frozen)', () => {
    const s = resolveSprite(input({ status: 'terminated' }), env({}));
    expect(s.mode).toBe('animated');
    expect(s.animationState).toBe('idle');
    expect(s.framePaths?.length).toBe(7);
    expect(s.framePaths?.[0]).toContain('animations/idle/south/frame_000.png');
    expect(s.loop).toBe(true);
    expect(s.overlayPath).toContain('terminated-ghost.png');
  });

  it('AC-05/#52: terminated under reduced-motion still freezes (static)', () => {
    const s = resolveSprite(input({ status: 'terminated' }), env({ prefersReducedMotion: true }));
    expect(s.mode).toBe('static');
    expect(s.framePaths).toBeNull();
    expect(s.overlayPath).toContain('terminated-ghost.png');
  });

  it('AC-06: reduced motion → frozen static frame', () => {
    const s = resolveSprite(input({ status: 'active' }), env({ prefersReducedMotion: true }));
    expect(s.mode).toBe('static');
    expect(s.framePaths).toBeNull();
    expect(s.fps).toBeNull();
    expect(s.staticFramePath).toContain('frame_000.png');
    expect(s.overlayPath).toContain('active-spark.png');
  });

  it('AC-07: mascot error is south-only → direction stays south', () => {
    const m = manifest();
    // force fallback to mascot by mapping an agentType whose character is absent
    delete m.characters['orc-unknown'];
    const s = resolveSprite(input({ agentType: 'unknown', status: 'error' }), env({ manifest: m }));
    expect(s.characterKey).toBe('orc-high-warchief-mascot');
    expect(s.direction).toBe('south');
    expect(s.framePaths?.[0]).toContain('animations/error/south/frame_000.png');
  });

  it('AC-08: unknown character key → mascot fallback (not placeholder)', () => {
    const m = manifest();
    delete m.characters['orc-codex-field-engineer'];
    const s = resolveSprite(input({ agentType: 'codex' }), env({ manifest: m }));
    expect(s.characterKey).toBe('orc-high-warchief-mascot');
    expect(s.mode).not.toBe('placeholder');
  });

  it('AC-09: no manifest → placeholder at default frame size', () => {
    const s = resolveSprite(input({}), env({ manifest: null }));
    expect(s.mode).toBe('placeholder');
    expect(s.frameSize).toEqual([232, 232]);
  });
});

describe('SPEC-300 §2.3 sequential character assignment', () => {
  it('explicit characterKey WINS over agentType (orc chosen by order, not agent type)', () => {
    // agentType is claude-code (→ storm-shaman) but the sequential key picks the codex character.
    const s = resolveSprite(
      input({ agentType: 'claude-code', characterKey: 'orc-codex-field-engineer' }),
      env({}),
    );
    expect(s.characterKey).toBe('orc-codex-field-engineer');
  });

  it('two same-agent orcs with different keys resolve to different characters', () => {
    const a = resolveSprite(input({ agentType: 'claude-code', characterKey: 'orc-claude-storm-shaman' }), env({}));
    const b = resolveSprite(input({ agentType: 'claude-code', characterKey: 'orc-codex-field-engineer' }), env({}));
    expect(a.characterKey).not.toBe(b.characterKey);
  });

  it('a characterKey absent from the manifest falls back to the agentType mapping', () => {
    const s = resolveSprite(
      input({ agentType: 'codex', characterKey: 'orc-not-in-manifest' }),
      env({}),
    );
    expect(s.characterKey).toBe('orc-codex-field-engineer');
  });

  it('availableCharacterPool keeps pool order, filtered to manifest presence', () => {
    const m = manifest(); // ships storm-shaman, field-engineer, unknown, mascot (no iron-commander)
    const pool = availableCharacterPool(m);
    expect(pool).toEqual(
      CHARACTER_POOL.filter((k) => m.characters[k]),
    );
    expect(pool).toContain('orc-claude-storm-shaman');
    expect(pool).not.toContain('orc-iron-commander'); // not in this test manifest
    expect(availableCharacterPool(null)).toEqual([]);
  });

  it('characterKeyForIndex cycles the pool (sequential, wraps around)', () => {
    const pool = ['a', 'b', 'c'];
    expect(characterKeyForIndex(0, pool)).toBe('a');
    expect(characterKeyForIndex(1, pool)).toBe('b');
    expect(characterKeyForIndex(2, pool)).toBe('c');
    expect(characterKeyForIndex(3, pool)).toBe('a'); // wrap
    expect(characterKeyForIndex(0, [])).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import {
  resolvePortrait,
  PORTRAIT_TIER_SUFFIXES,
  PORTRAIT_CAPTION,
  type PortraitEnv,
} from '../src/assets/portraitResolver';
import type { AssetManifest, CharacterDef, PortraitsDef } from '../src/assets/manifest';

const ALL5 = [
  'orc-high-warchief-mascot',
  'orc-claude-storm-shaman',
  'orc-codex-field-engineer',
  'orc-unknown',
  'orc-iron-commander',
];

function charDef(): CharacterDef {
  return {
    root: 'sprites/x/X',
    frame_size: [232, 232],
    scale: 1,
    anchor: [116, 208],
    directions: ['south'],
    animations: {},
    reduced_motion: { fallback_state: 'idle', fallback_direction: 'south', fallback_frame: 'f.png' },
  };
}

function manifest(opts: { characters?: string[]; portraits?: PortraitsDef }): AssetManifest {
  const characters: Record<string, CharacterDef> = {};
  for (const k of opts.characters ?? []) characters[k] = charDef();
  const m: AssetManifest = { characters };
  if (opts.portraits) m.portraits = opts.portraits;
  return m;
}

const env = (m: AssetManifest | null): PortraitEnv => ({ manifest: m, assetBasePath: '/assets/' });

describe('SPEC-304 portrait resolver', () => {
  it('AC-02 — explicit characterKey wins over agentType mapping', () => {
    const m = manifest({
      characters: ALL5,
      portraits: {
        root: 'portraits',
        items: {
          'orc-iron-commander': { file: 'orc-iron-commander.webp' },
          'orc-codex-field-engineer': { file: 'orc-codex-field-engineer.webp' },
        },
      },
    });
    const s = resolvePortrait(
      { characterKey: 'orc-iron-commander', agentType: 'codex', displayedTier: 0 },
      env(m),
    );
    expect(s.characterKey).toBe('orc-iron-commander');
    expect(s.mode).toBe('asset');
    expect(s.src).toBe('/assets/portraits/orc-iron-commander.webp');
  });

  it('AC-03 — agentType→character base portrait when no explicit key', () => {
    const m = manifest({
      characters: ALL5,
      portraits: {
        root: 'portraits',
        items: { 'orc-codex-field-engineer': { file: 'orc-codex-field-engineer.webp' } },
      },
    });
    const s = resolvePortrait({ agentType: 'codex', displayedTier: 0 }, env(m));
    expect(s.characterKey).toBe('orc-codex-field-engineer');
    expect(s.src).toContain('orc-codex-field-engineer.webp');
  });

  it('AC-04 / AC-16 — identity stays sprite-matching but file falls back to mascot (partial coverage)', () => {
    const m = manifest({
      characters: ALL5,
      portraits: {
        root: 'portraits',
        items: { 'orc-high-warchief-mascot': { file: 'orc-high-warchief-mascot.webp' } },
      },
    });
    const s = resolvePortrait({ agentType: 'codex', displayedTier: 0 }, env(m));
    expect(s.characterKey).toBe('orc-codex-field-engineer'); // identity mirrors sprite
    expect(s.src).toContain('orc-high-warchief-mascot.webp'); // file degraded to mascot
    expect(s.tier).toBeNull();
    expect(s.mode).toBe('asset');
  });

  it('AC-05 — displayedTier=2 selects the champion (2nd) tier for the mascot', () => {
    const m = manifest({
      characters: ALL5,
      portraits: {
        root: 'portraits',
        source_size: [512, 768],
        items: {
          'orc-high-warchief-mascot': {
            file: 'm.webp',
            tiers: { champion: { file: 'tiers/champion/m-champion.webp' } },
          },
        },
      },
    });
    const s = resolvePortrait(
      { characterKey: 'orc-high-warchief-mascot', agentType: 'unknown', displayedTier: 2 },
      env(m),
    );
    expect(s.tier).toBe('champion');
    expect(s.src).toBe('/assets/portraits/tiers/champion/m-champion.webp');
  });

  it('AC-06 — missing tier file falls back to base (tier=null), not placeholder', () => {
    const m = manifest({
      characters: ALL5,
      portraits: { root: 'portraits', items: { 'orc-high-warchief-mascot': { file: 'm.webp' } } },
    });
    const s = resolvePortrait(
      { characterKey: 'orc-high-warchief-mascot', agentType: 'unknown', displayedTier: 2 },
      env(m),
    );
    expect(s.mode).toBe('asset');
    expect(s.tier).toBeNull();
    expect(s.src).toContain('m.webp');
  });

  it('AC-07 — placeholder when no manifest / no portraits block / no resolvable item', () => {
    const noManifest = resolvePortrait({ agentType: 'unknown', displayedTier: 0 }, env(null));
    expect(noManifest.mode).toBe('placeholder');
    expect(noManifest.src).toBeNull();

    const noBlock = resolvePortrait(
      { agentType: 'unknown', displayedTier: 0 },
      env(manifest({ characters: ALL5 })),
    );
    expect(noBlock.mode).toBe('placeholder');

    const emptyItems = resolvePortrait(
      { agentType: 'unknown', displayedTier: 0 },
      env(manifest({ characters: ALL5, portraits: { root: 'portraits', items: {} } })),
    );
    expect(emptyItems.mode).toBe('placeholder');
    expect(emptyItems.src).toBeNull();
  });

  it('AC-01 — sourceSize uses item override, else block default', () => {
    const m = manifest({
      characters: ALL5,
      portraits: {
        root: 'portraits',
        source_size: [512, 768],
        items: {
          'orc-unknown': { file: 'u.webp', source_size: [600, 900] },
          'orc-high-warchief-mascot': { file: 'm.webp' },
        },
      },
    });
    expect(
      resolvePortrait({ characterKey: 'orc-unknown', agentType: 'unknown', displayedTier: 0 }, env(m))
        .sourceSize,
    ).toEqual([600, 900]);
    expect(
      resolvePortrait(
        { characterKey: 'orc-high-warchief-mascot', agentType: 'unknown', displayedTier: 0 },
        env(m),
      ).sourceSize,
    ).toEqual([512, 768]);
  });

  it('AC-10 — caption matches the resolved identity character', () => {
    const m = manifest({
      characters: ALL5,
      portraits: { root: 'portraits', items: { 'orc-iron-commander': { file: 'i.webp' } } },
    });
    const s = resolvePortrait(
      { characterKey: 'orc-iron-commander', agentType: 'codex', displayedTier: 0 },
      env(m),
    );
    expect(s.caption).toEqual(PORTRAIT_CAPTION['orc-iron-commander']);
  });

  it('AC-11 — frameAspect is always 2:3 (even in placeholder)', () => {
    expect(resolvePortrait({ agentType: 'unknown', displayedTier: 0 }, env(null)).frameAspect).toBe(
      '2:3',
    );
  });

  it('AC-12 — deterministic: same input ⇒ same PortraitState', () => {
    const m = manifest({
      characters: ALL5,
      portraits: {
        root: 'portraits',
        items: {
          'orc-high-warchief-mascot': {
            file: 'm.webp',
            tiers: { veteran: { file: 'tiers/veteran/m-veteran.webp' } },
          },
        },
      },
    });
    const input = {
      characterKey: 'orc-high-warchief-mascot',
      agentType: 'codex',
      displayedTier: 1,
    } as const;
    expect(resolvePortrait(input, env(m))).toEqual(resolvePortrait(input, env(m)));
  });

  it('numeric displayedTier → suffix mapping covers T1/T2/T3 per character', () => {
    expect(Object.keys(PORTRAIT_TIER_SUFFIXES).sort()).toEqual([...ALL5].sort());
    for (const suffixes of Object.values(PORTRAIT_TIER_SUFFIXES)) {
      expect(suffixes).toHaveLength(3);
    }
    // mascot: T1=veteran, T2=champion, T3=warlord
    const m = manifest({
      characters: ALL5,
      portraits: {
        root: 'portraits',
        items: {
          'orc-high-warchief-mascot': {
            file: 'm.webp',
            tiers: {
              veteran: { file: 't/veteran.webp' },
              champion: { file: 't/champion.webp' },
              warlord: { file: 't/warlord.webp' },
            },
          },
        },
      },
    });
    const tierOf = (n: 1 | 2 | 3) =>
      resolvePortrait(
        { characterKey: 'orc-high-warchief-mascot', agentType: 'unknown', displayedTier: n },
        env(m),
      ).tier;
    expect([tierOf(1), tierOf(2), tierOf(3)]).toEqual(['veteran', 'champion', 'warlord']);
  });
});

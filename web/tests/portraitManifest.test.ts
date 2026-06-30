/**
 * SPEC-304 end-to-end (data layer): the resolver against the REAL shipped asset pack manifest.
 * Proves the `portraits` block wired into asset-packs/orc-camp-default/manifest.json resolves to
 * the actual 5 base portrait files (not the synthetic fixtures used elsewhere).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolvePortrait, PORTRAIT_CAPTION, PORTRAIT_TIER_SUFFIXES } from '../src/assets/portraitResolver';
import type { AssetManifest } from '../src/assets/manifest';

// Vitest runs with cwd = web/; the asset pack is a sibling of web/.
const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), '../asset-packs/orc-camp-default/manifest.json'), 'utf8'),
) as AssetManifest;

const KEYS = [
  'orc-high-warchief-mascot',
  'orc-claude-storm-shaman',
  'orc-codex-field-engineer',
  'orc-unknown',
  'orc-iron-commander',
];

describe('SPEC-304 portraits — real asset pack manifest', () => {
  it('ships a portraits block whose keys match characters (2:3)', () => {
    expect(manifest.portraits).toBeTruthy();
    expect(manifest.portraits!.frame_aspect).toBe('2:3');
    expect(Object.keys(manifest.portraits!.items).sort()).toEqual([...KEYS].sort());
  });

  it('resolves each character to its real base portrait asset', () => {
    for (const key of KEYS) {
      const s = resolvePortrait(
        { characterKey: key, agentType: 'unknown', displayedTier: 0 },
        { manifest, assetBasePath: '/pack' },
      );
      expect(s.mode).toBe('asset');
      expect(s.src).toBe(`/pack/portraits/${key}.webp`);
      expect(s.tier).toBeNull();
      expect(s.caption).toEqual(PORTRAIT_CAPTION[key]);
    }
  });

  it('tier portraits are wired: displayedTier N → that character’s tier portrait', () => {
    for (const key of KEYS) {
      const suffixes = PORTRAIT_TIER_SUFFIXES[key]!;
      ([1, 2, 3] as const).forEach((t) => {
        const suffix = suffixes[t - 1];
        const s = resolvePortrait(
          { characterKey: key, agentType: 'unknown', displayedTier: t },
          { manifest, assetBasePath: '/pack' },
        );
        expect(s.mode).toBe('asset');
        expect(s.tier).toBe(suffix);
        expect(s.src).toBe(`/pack/portraits/tiers/${suffix}/${key}-${suffix}.webp`);
      });
    }
  });
});

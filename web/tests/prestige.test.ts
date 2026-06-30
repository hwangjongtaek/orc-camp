/**
 * SPEC-302 — prestige tier: pure judgment (§3.1/§3.2), composite-key monotonic latch (§3.2),
 * and variant resolution + downward fallback (§3.3). The render-level composition (§3.4/§3.5) is
 * exercised through resolveSprite in prestigeSprite.test.ts. Per the ACs, the resolved characterKey
 * and usage are injected directly (no dependency on live scan).
 */
import { describe, it, expect } from 'vitest';
import {
  rawTierForUsage,
  reconcilePrestigeLatch,
  resolveCharacterTier,
  resolveTierVariant,
  thresholdsForCharacter,
  latchKey,
  DEFAULT_TIER_THRESHOLDS,
  type OrcTierObservation,
} from '../src/assets/prestige';
import type { OrcUsage } from '../src/types/domain';
import type { CharacterDef, PrestigeTierDef } from '../src/assets/manifest';

// --- fixtures ---
const DIR8 = ['south', 'east', 'north', 'west', 'south-east', 'north-east', 'north-west', 'south-west'];

function usage(p: Partial<OrcUsage>): OrcUsage {
  return { cumulativeTokens: null, cumulativeCostUsd: null, source: 'transcript', measuredAt: null, ...p };
}
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

interface TierOpts {
  suffix?: string;
  root?: string;
  animations?: Record<string, ReturnType<typeof anim8>>;
}
function tierDef(tier: 1 | 2 | 3, status: PrestigeTierDef['status'], o: TierOpts = {}): PrestigeTierDef {
  return {
    tier,
    suffix: o.suffix ?? `-t${tier}`,
    status,
    pixellab_character_id: status === 'planned' ? null : `pid-${tier}`,
    root: o.root ?? `tiers/t${tier}/T${tier}`,
    rotations: rot8(),
    animations: o.animations ?? {},
    reduced_motion: { fallback_state: 'idle', fallback_direction: 'south', fallback_frame: 'rotations/south.png' },
  };
}
function tieredCharacter(
  root: string,
  tiers: PrestigeTierDef[],
  thresholds?: CharacterDef['prestige'] extends infer P ? (P extends { thresholds?: infer T } ? T : never) : never,
): CharacterDef {
  return {
    root,
    frame_size: [232, 232],
    scale: 1,
    anchor: [116, 200],
    directions: DIR8,
    rotations: rot8(),
    animations: { idle: anim8('idle'), active: anim8('active') },
    reduced_motion: { fallback_state: 'idle', fallback_direction: 'south', fallback_frame: 'animations/idle/south/frame_000.png' },
    prestige: { axis: 'cumulative_tokens', ...(thresholds ? { thresholds } : {}), tiers },
  };
}
function plainCharacter(root: string): CharacterDef {
  return {
    root,
    frame_size: [232, 232],
    scale: 1,
    anchor: [116, 200],
    directions: DIR8,
    animations: { idle: anim8('idle') },
    reduced_motion: { fallback_state: 'idle', fallback_direction: 'south', fallback_frame: 'animations/idle/south/frame_000.png' },
  };
}

describe('SPEC-302 §3.1/§3.2 rawTierForUsage', () => {
  it('AC-01: token thresholds, boundaries inclusive (≥)', () => {
    expect(rawTierForUsage(usage({ cumulativeTokens: 0 }))).toBe(0);
    expect(rawTierForUsage(usage({ cumulativeTokens: 1_200_000 }))).toBe(1);
    expect(rawTierForUsage(usage({ cumulativeTokens: 6_000_000 }))).toBe(2);
    expect(rawTierForUsage(usage({ cumulativeTokens: 25_000_000 }))).toBe(3);
    // exact boundaries round UP into the tier
    expect(rawTierForUsage(usage({ cumulativeTokens: 1_000_000 }))).toBe(1);
    expect(rawTierForUsage(usage({ cumulativeTokens: 5_000_000 }))).toBe(2);
    expect(rawTierForUsage(usage({ cumulativeTokens: 20_000_000 }))).toBe(3);
    expect(rawTierForUsage(usage({ cumulativeTokens: 999_999 }))).toBe(0);
  });

  it('AC-02: cost axis used only when tokens null (inclusive); both/usage null → 0', () => {
    expect(rawTierForUsage(usage({ cumulativeTokens: null, cumulativeCostUsd: 4.99 }))).toBe(0);
    expect(rawTierForUsage(usage({ cumulativeTokens: null, cumulativeCostUsd: 5 }))).toBe(1);
    expect(rawTierForUsage(usage({ cumulativeTokens: null, cumulativeCostUsd: 30 }))).toBe(2);
    expect(rawTierForUsage(usage({ cumulativeTokens: null, cumulativeCostUsd: 100 }))).toBe(3);
    expect(rawTierForUsage(null)).toBe(0);
    expect(rawTierForUsage(usage({ cumulativeTokens: null, cumulativeCostUsd: null }))).toBe(0);
    // tokens present → cost axis is NOT consulted (even if cost would score higher)
    expect(rawTierForUsage(usage({ cumulativeTokens: 0, cumulativeCostUsd: 1000 }))).toBe(0);
  });

  it('thresholdsForCharacter: manifest override beats the default seed per-field', () => {
    const c = tieredCharacter('r', [tierDef(1, 'available')], { tier1: { min_tokens: 500_000 } });
    const th = thresholdsForCharacter(c);
    expect(th.tier1.minTokens).toBe(500_000);
    expect(th.tier2.minTokens).toBe(DEFAULT_TIER_THRESHOLDS.tier2.minTokens);
    expect(rawTierForUsage(usage({ cumulativeTokens: 500_000 }), th)).toBe(1);
    expect(thresholdsForCharacter(plainCharacter('r'))).toBe(DEFAULT_TIER_THRESHOLDS);
    expect(thresholdsForCharacter(undefined)).toBe(DEFAULT_TIER_THRESHOLDS);
  });
});

describe('SPEC-302 §3.2 monotonic composite-key latch', () => {
  const tiered = (id: string, characterKey: string, tokens: number | null): OrcTierObservation => ({
    id,
    characterKey,
    hasPrestige: true,
    usage: tokens === null ? null : usage({ cumulativeTokens: tokens }),
  });

  it('AC-03: latch is non-decreasing; ids are independent', () => {
    const r1 = reconcilePrestigeLatch({}, [tiered('a', 'orc-x', 6_000_000), tiered('b', 'orc-x', 1_200_000)]);
    expect(r1.displayedTierById.a).toBe(2);
    expect(r1.displayedTierById.b).toBe(1);
    // a drops to tier-1-equiv usage, b drops to null → both HELD at their peak
    const r2 = reconcilePrestigeLatch(r1.next, [tiered('a', 'orc-x', 1_200_000), tiered('b', 'orc-x', null)]);
    expect(r2.displayedTierById.a).toBe(2);
    expect(r2.displayedTierById.b).toBe(1);
  });

  it('AC-05: non-target (no prestige block / unresolved key) → tier 0 at 25M, NO latch stored', () => {
    const r = reconcilePrestigeLatch({}, [
      { id: 'a', characterKey: 'orc-plain', hasPrestige: false, usage: usage({ cumulativeTokens: 25_000_000 }) },
      { id: 'b', characterKey: null, hasPrestige: false, usage: usage({ cumulativeTokens: 25_000_000 }) },
    ]);
    expect(r.displayedTierById.a).toBe(0);
    expect(r.displayedTierById.b).toBe(0);
    expect(Object.keys(r.next)).toHaveLength(0); // gate: rawTierForUsage not consulted, no latch
  });

  it('AC-08: latch resets when an id disappears, then recomputes from raw on re-entry', () => {
    const r1 = reconcilePrestigeLatch({}, [tiered('pane:%7', 'orc-x', 6_000_000), tiered('pane:%8', 'orc-x', 6_000_000)]);
    expect(r1.displayedTierById['pane:%7']).toBe(2);
    // %7 leaves the snapshot; %8 stays (and is unaffected)
    const r2 = reconcilePrestigeLatch(r1.next, [tiered('pane:%8', 'orc-x', 1_200_000)]);
    expect(r2.next[latchKey('pane:%7', 'orc-x')]).toBeUndefined();
    expect(r2.displayedTierById['pane:%8']).toBe(2);
    // %7 re-enters at tier-0 usage → starts from 0 (no carry-over)
    const r3 = reconcilePrestigeLatch(r2.next, [tiered('pane:%8', 'orc-x', 1_200_000), tiered('pane:%7', 'orc-x', 0)]);
    expect(r3.displayedTierById['pane:%7']).toBe(0);
  });

  it('AC-10: composite key resets the latch on pool reassignment (characterKey change)', () => {
    const r1 = reconcilePrestigeLatch({}, [tiered('pane:%5', 'orc-claude-storm-shaman', 25_000_000)]);
    expect(r1.displayedTierById['pane:%5']).toBe(3);
    // %5 reassigned to a DIFFERENT tiered character with low usage → no tier-3 carry-over
    const r2 = reconcilePrestigeLatch(r1.next, [tiered('pane:%5', 'orc-codex-field-engineer', 0)]);
    expect(r2.displayedTierById['pane:%5']).toBe(0);
    expect(r2.next[latchKey('pane:%5', 'orc-claude-storm-shaman')]).toBeUndefined();
    // %5 reassigned to a NON-prestige character → gate → 0, no latch
    const r3 = reconcilePrestigeLatch(r1.next, [
      { id: 'pane:%5', characterKey: 'orc-plain', hasPrestige: false, usage: usage({ cumulativeTokens: 25_000_000 }) },
    ]);
    expect(r3.displayedTierById['pane:%5']).toBe(0);
    expect(Object.keys(r3.next)).toHaveLength(0);
  });
});

describe('SPEC-302 §3.3 variant resolution + downward fallback', () => {
  it('AC-04: T3 requested but only T1 available → T1; none available → base (never placeholder)', () => {
    const onlyT1 = tieredCharacter('sprites/x/Base', [
      tierDef(1, 'available', { suffix: '-veteran', root: 'tiers/veteran/V' }),
      tierDef(2, 'planned'),
      tierDef(3, 'planned'),
    ]);
    const r = resolveCharacterTier('orc-x', onlyT1, 3, 'active');
    expect(r.displayedTier).toBe(3);
    expect(r.appearanceKey).toBe('orc-x-veteran');
    expect(r.appearanceRoot).toBe('tiers/veteran/V');

    const none = tieredCharacter('sprites/x/Base', [tierDef(1, 'planned'), tierDef(2, 'planned'), tierDef(3, 'planned')]);
    const r2 = resolveCharacterTier('orc-x', none, 3, 'active');
    expect(r2.appearanceKey).toBe('orc-x'); // base character key (NOT placeholder)
    expect(r2.appearanceRoot).toBe('sprites/x/Base');
    expect(resolveTierVariant(none, 3)).toBeNull();
  });

  it('AC-05: a non-prestige character stays base even at a forced tier 3', () => {
    const c = plainCharacter('sprites/plain/P');
    const r = resolveCharacterTier('orc-plain', c, 3, 'active');
    expect(r.displayedTier).toBe(3);
    expect(r.appearanceKey).toBe('orc-plain');
    expect(r.appearanceRoot).toBe('sprites/plain/P');
    expect(r.tierMotion).toBe('animated');
    expect(resolveTierVariant(c, 3)).toBeNull();
  });

  it('AC-09: tier resolution + static_tier generalizes across all tiered characters', () => {
    for (const key of ['orc-claude-storm-shaman', 'orc-codex-field-engineer', 'orc-unknown', 'orc-iron-commander']) {
      const c = tieredCharacter(`sprites/${key}/Base`, [
        tierDef(1, 'available', { root: `tiers/t1/${key}`, animations: { idle: anim8('idle') } }),
        tierDef(2, 'available', { suffix: '-t2', root: `tiers/t2/${key}` }), // animations empty → static_tier
        tierDef(3, 'staged'),
      ]);
      const displayedTier = rawTierForUsage(usage({ cumulativeTokens: 6_000_000 }));
      expect(displayedTier).toBe(2);
      const r = resolveCharacterTier(key, c, displayedTier, 'active');
      expect(r.characterKey).toBe(key);
      expect(r.displayedTier).toBe(2);
      expect(r.appearanceKey).toBe(`${key}-t2`);
      expect(r.appearanceRoot).toBe(`tiers/t2/${key}`);
      expect(r.frameRoot).toBe(`tiers/t2/${key}`);
      expect(r.tierMotion).toBe('static_tier'); // tier-2 variant lacks the active animation
    }
  });

  it('AC-06 forward: a tier variant that HAS the requested animation resolves to animated', () => {
    const c = tieredCharacter('sprites/m/Base', [
      tierDef(1, 'available', { root: 'tiers/v/V' }),
      tierDef(2, 'available', { suffix: '-champion', root: 'tiers/c/C', animations: { active: anim8('active') } }),
      tierDef(3, 'staged'),
    ]);
    const r = resolveCharacterTier('orc-m', c, 2, 'active');
    expect(r.tierMotion).toBe('animated');
    expect(r.appearanceKey).toBe('orc-m-champion');
    expect(r.frameRoot).toBe('tiers/c/C');
  });

  it('AC-11: staged tiers fall back to the highest available; promotion flips appearance up', () => {
    const staged = tieredCharacter('sprites/m/Base', [
      tierDef(1, 'available', { suffix: '-veteran', root: 'tiers/veteran/V' }),
      tierDef(2, 'staged', { suffix: '-champion', root: 'tiers/champion/C' }),
      tierDef(3, 'staged', { suffix: '-warlord', root: 'tiers/warlord/W' }),
    ]);
    const r = resolveCharacterTier('orc-m', staged, 3, 'active');
    expect(r.appearanceKey).toBe('orc-m-veteran'); // staged excluded → highest available = T1
    expect(r.appearanceRoot).toBe('tiers/veteran/V');

    const allStaged = tieredCharacter('sprites/m/Base', [
      tierDef(1, 'staged', { root: 'tiers/v/V' }),
      tierDef(2, 'staged'),
      tierDef(3, 'staged'),
    ]);
    expect(resolveCharacterTier('orc-m', allStaged, 3, 'active').appearanceKey).toBe('orc-m'); // base, not placeholder

    // promote T2 → available: same displayedTier=3 now resolves UP to T2 (latch is unchanged)
    const promoted = tieredCharacter('sprites/m/Base', [
      tierDef(1, 'available', { suffix: '-veteran', root: 'tiers/veteran/V' }),
      tierDef(2, 'available', { suffix: '-champion', root: 'tiers/champion/C' }),
      tierDef(3, 'staged', { suffix: '-warlord', root: 'tiers/warlord/W' }),
    ]);
    const r2 = resolveCharacterTier('orc-m', promoted, 3, 'active');
    expect(r2.appearanceKey).toBe('orc-m-champion');
    expect(r2.appearanceRoot).toBe('tiers/champion/C');
  });

  it('deprecated tiers are excluded from resolution like staged/planned', () => {
    const c = tieredCharacter('sprites/m/Base', [
      tierDef(1, 'available', { suffix: '-veteran', root: 'tiers/veteran/V' }),
      tierDef(2, 'deprecated', { root: 'tiers/c/C' }),
      tierDef(3, 'staged'),
    ]);
    expect(resolveCharacterTier('orc-m', c, 3, 'active').appearanceKey).toBe('orc-m-veteran');
  });
});

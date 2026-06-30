import { describe, it, expect } from 'vitest';
import { displayedTierForOrc } from '../src/assets/prestige';
import { makeOrc } from './fixtures';

describe('SPEC-302 prestige tier seam', () => {
  it('returns base tier 0 until Orc.usage lands (forward)', () => {
    expect(displayedTierForOrc(makeOrc({ paneId: 'p1' }))).toBe(0);
    expect(displayedTierForOrc(makeOrc({ paneId: 'p2', agentType: 'codex' }))).toBe(0);
  });
});

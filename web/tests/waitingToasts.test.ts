/**
 * SPEC-203 §2.9 — waiting-transition detection core. Utterance requires a genuine active→waiting
 * edge on a NON-selected orc, gated by a per-orc reduced-noise cooldown; the baseline + cooldown
 * maps carry forward and prune gone orcs.
 */
import { describe, it, expect } from 'vitest';
import { scanWaitingTransitions } from '../src/terminal/waitingToasts';
import type { OrcStatus } from '../src/types/domain';

const COOLDOWN = 45_000;

function scan(
  statuses: Record<string, OrcStatus>,
  opts: {
    prev?: Record<string, OrcStatus>;
    selected?: string | null;
    lastToastAt?: Record<string, number>;
    now?: number;
  } = {},
) {
  const orderedIds = Object.keys(statuses);
  return scanWaitingTransitions({
    orderedIds,
    statusById: (id) => statuses[id],
    selectedOrcId: opts.selected ?? null,
    prev: new Map(Object.entries(opts.prev ?? {})),
    lastToastAt: new Map(Object.entries(opts.lastToastAt ?? {})),
    now: opts.now ?? 1_000_000,
    cooldownMs: COOLDOWN,
  });
}

describe('scanWaitingTransitions (AC-17)', () => {
  it('active→waiting edge on a non-selected orc announces + records cooldown', () => {
    const r = scan({ a: 'waiting' }, { prev: { a: 'active' }, now: 5_000 });
    expect(r.announce).toEqual(['a']);
    expect(r.nextLastToastAt.get('a')).toBe(5_000);
    expect(r.nextPrev.get('a')).toBe('waiting');
  });

  it('an orc already waiting on entry (no prior baseline) does NOT announce', () => {
    const r = scan({ a: 'waiting' }, { prev: {} });
    expect(r.announce).toEqual([]);
    expect(r.nextPrev.get('a')).toBe('waiting'); // baseline seeded for next scan
  });

  it('the currently-selected orc is excluded (you can already see it)', () => {
    const r = scan({ a: 'waiting' }, { prev: { a: 'active' }, selected: 'a' });
    expect(r.announce).toEqual([]);
  });

  it('only active→waiting counts — idle→waiting is not an edge', () => {
    const r = scan({ a: 'waiting' }, { prev: { a: 'idle' } });
    expect(r.announce).toEqual([]);
  });

  it('cooldown suppresses a re-announce inside the window, allows it after', () => {
    const within = scan(
      { a: 'waiting' },
      { prev: { a: 'active' }, lastToastAt: { a: 100_000 }, now: 100_000 + COOLDOWN - 1 },
    );
    expect(within.announce).toEqual([]);
    // cooldown timestamp is preserved (not refreshed) when suppressed
    expect(within.nextLastToastAt.get('a')).toBe(100_000);

    const after = scan(
      { a: 'waiting' },
      { prev: { a: 'active' }, lastToastAt: { a: 100_000 }, now: 100_000 + COOLDOWN },
    );
    expect(after.announce).toEqual(['a']);
    expect(after.nextLastToastAt.get('a')).toBe(100_000 + COOLDOWN);
  });

  it('announces multiple edges in rail order and prunes cooldowns for gone orcs', () => {
    const r = scan(
      { a: 'waiting', b: 'waiting' },
      { prev: { a: 'active', b: 'active', gone: 'active' }, lastToastAt: { gone: 1 } },
    );
    expect(r.announce).toEqual(['a', 'b']);
    expect(r.nextLastToastAt.has('gone')).toBe(false); // pruned — orc no longer present
    expect(r.nextPrev.has('gone')).toBe(false);
  });
});

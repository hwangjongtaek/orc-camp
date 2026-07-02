/**
 * SPEC-203 §2.3/§2.5 (AC-04/AC-12) — orc switching helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  digitJump,
  fuzzyFilter,
  nextOrc,
  prevOrc,
  railOrder,
  type SwitchableItem,
} from '../src/terminal/switching';

const ids = ['pane:%1', 'pane:%2', 'pane:%3'];

describe('prev/next (S2, wrap)', () => {
  it('nextOrc wraps; prevOrc wraps', () => {
    expect(nextOrc(ids, 'pane:%1')).toBe('pane:%2');
    expect(nextOrc(ids, 'pane:%3')).toBe('pane:%1');
    expect(prevOrc(ids, 'pane:%1')).toBe('pane:%3');
    expect(prevOrc(ids, null)).toBe('pane:%3');
    expect(nextOrc([], 'x')).toBeNull();
  });
});

describe('digitJump (S3)', () => {
  it('1-based, out-of-range → null', () => {
    expect(digitJump(ids, 1)).toBe('pane:%1');
    expect(digitJump(ids, 3)).toBe('pane:%3');
    expect(digitJump(ids, 4)).toBeNull();
    expect(digitJump(ids, 0)).toBeNull();
  });
});

describe('railOrder (waiting pinned, AC-12)', () => {
  it('promotes waiting orcs to the top group, preserving order within groups', () => {
    const waiting = new Set(['pane:%2']);
    expect(railOrder(ids, (id) => waiting.has(id))).toEqual(['pane:%2', 'pane:%1', 'pane:%3']);
  });
});

describe('fuzzyFilter (S4)', () => {
  const items: SwitchableItem[] = [
    { orcId: 'pane:%1', tmuxTarget: 'work:0.0', summaryLine: 'building api', status: 'active' },
    { orcId: 'pane:%2', tmuxTarget: 'infra:1.2', summaryLine: 'waiting for input', status: 'waiting' },
    { orcId: 'pane:%3', tmuxTarget: 'work:2.1', summaryLine: 'idle', status: 'idle' },
  ];

  it('empty query → all in order', () => {
    expect(fuzzyFilter(items, '').map((i) => i.orcId)).toEqual(['pane:%1', 'pane:%2', 'pane:%3']);
  });

  it('matches by target, status, and summary (subsequence)', () => {
    expect(fuzzyFilter(items, 'infra').map((i) => i.orcId)).toEqual(['pane:%2']);
    expect(fuzzyFilter(items, 'waiting').map((i) => i.orcId)).toEqual(['pane:%2']);
    const work = fuzzyFilter(items, 'work').map((i) => i.orcId);
    expect(work).toContain('pane:%1');
    expect(work).toContain('pane:%3');
    expect(work).not.toContain('pane:%2');
  });

  it('non-matches are excluded', () => {
    expect(fuzzyFilter(items, 'zzzz')).toHaveLength(0);
  });
});

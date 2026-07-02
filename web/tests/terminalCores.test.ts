/**
 * SPEC-203 §2.5/§2.6 — LRU cache + auto-disarm idle helper.
 */
import { describe, it, expect } from 'vitest';
import { LruCache } from '../src/terminal/lru';
import { idleStatus } from '../src/terminal/controlMode';

describe('LruCache', () => {
  it('evicts the least-recently-used past the cap; get promotes', () => {
    const c = new LruCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // promote a → b is now LRU
    c.set('c', 3); // evicts b
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
    expect(c.has('c')).toBe(true);
    expect(c.size).toBe(2);
  });
  it('clear() purges everything (exposure-off purge)', () => {
    const c = new LruCache<string, number>(4);
    c.set('a', 1);
    c.set('b', 2);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.has('a')).toBe(false);
  });
});

describe('idleStatus (auto-disarm countdown, uses server idleTimeoutMs)', () => {
  const base = { idleTimeoutMs: 240_000, lastKeystrokeAt: 1000, warnMs: 30_000 };
  it('remaining decreases with time; not expired mid-window', () => {
    const s = idleStatus(base, 1000 + 100_000);
    expect(s.remainingMs).toBe(140_000);
    expect(s.expired).toBe(false);
    expect(s.warn).toBe(false);
  });
  it('warns near the threshold', () => {
    const s = idleStatus(base, 1000 + 220_000); // 20s remaining
    expect(s.warn).toBe(true);
    expect(s.expired).toBe(false);
  });
  it('expires at/after the idle window', () => {
    const s = idleStatus(base, 1000 + 240_000);
    expect(s.expired).toBe(true);
    expect(s.remainingMs).toBe(0);
  });
});

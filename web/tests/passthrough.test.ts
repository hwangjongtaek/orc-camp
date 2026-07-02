/**
 * SPEC-401 §2.4/§2.7 + SPEC-203 §2.5/§2.6 (AC-04/AC-05/AC-06/AC-07) — key routing + batcher.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createLiteralBatcher,
  INTERACTIVE_KEY_ALLOWLIST,
  PASSTHROUGH_FORBIDDEN_CHORDS,
  routeKey,
  type KeyEventLike,
} from '../src/terminal/passthrough';

function ev(over: Partial<KeyEventLike>): KeyEventLike {
  return { key: '', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...over };
}

describe('routeKey — always-on shortcuts', () => {
  it('Ctrl+Alt+. → disarm (highest priority, works armed or not)', () => {
    expect(routeKey(ev({ key: '.', ctrlKey: true, altKey: true }), { armed: true })).toEqual({ kind: 'disarm' });
    expect(routeKey(ev({ key: '.', ctrlKey: true, altKey: true }), { armed: false })).toEqual({ kind: 'disarm' });
  });
  it('⌘/Ctrl+K → quick-switch (wins over readline C-k even when armed)', () => {
    expect(routeKey(ev({ key: 'k', metaKey: true }), { armed: true })).toEqual({ kind: 'quick-switch' });
    expect(routeKey(ev({ key: 'k', ctrlKey: true }), { armed: true })).toEqual({ kind: 'quick-switch' });
  });
  it('Alt+1..9 → digit-jump (not Cmd/Ctrl+digit, which the browser reserves)', () => {
    expect(routeKey(ev({ key: '3', altKey: true }), { armed: false })).toEqual({ kind: 'digit-jump', n: 3 });
    expect(routeKey(ev({ key: '3', metaKey: true }), { armed: false })).not.toEqual({ kind: 'digit-jump', n: 3 });
  });
});

describe('routeKey — Observe (no egress, AC-06)', () => {
  it('plain [ and ] navigate the rail', () => {
    expect(routeKey(ev({ key: '[' }), { armed: false })).toEqual({ kind: 'prev' });
    expect(routeKey(ev({ key: ']' }), { armed: false })).toEqual({ kind: 'next' });
  });
  it('printable keys do NOT egress in observe (ignored)', () => {
    expect(routeKey(ev({ key: 'a' }), { armed: false })).toEqual({ kind: 'ignore' });
    expect(routeKey(ev({ key: 'Enter' }), { armed: false })).toEqual({ kind: 'ignore' });
  });
});

describe('routeKey — Control (armed egress, AC-05/AC-07)', () => {
  it('C-c → interrupt confirm route (never raw passthrough)', () => {
    expect(routeKey(ev({ key: 'c', ctrlKey: true }), { armed: true })).toEqual({ kind: 'interrupt' });
  });
  it('destructive chords are BLOCKED (no egress)', () => {
    for (const k of ['d', 'z']) {
      const r = routeKey(ev({ key: k, ctrlKey: true }), { armed: true });
      expect(r.kind).toBe('blocked');
    }
    expect(routeKey(ev({ key: '\\', ctrlKey: true }), { armed: true })).toEqual({ kind: 'blocked', chord: 'C-\\' });
    // every forbidden chord is excluded from the allowlist
    for (const chord of PASSTHROUGH_FORBIDDEN_CHORDS) {
      expect(INTERACTIVE_KEY_ALLOWLIST.has(chord)).toBe(false);
    }
  });
  it('named allowlist keys → /key egress', () => {
    expect(routeKey(ev({ key: 'Enter' }), { armed: true })).toEqual({ kind: 'key', key: 'Enter' });
    expect(routeKey(ev({ key: 'ArrowUp' }), { armed: true })).toEqual({ kind: 'key', key: 'Up' });
    expect(routeKey(ev({ key: 'Tab', shiftKey: true }), { armed: true })).toEqual({ kind: 'key', key: 'BTab' });
    expect(routeKey(ev({ key: 'a', ctrlKey: true }), { armed: true })).toEqual({ kind: 'key', key: 'C-a' });
  });
  it('printable characters → literal egress; [ ] are literal when armed', () => {
    expect(routeKey(ev({ key: 'a' }), { armed: true })).toEqual({ kind: 'literal', text: 'a' });
    expect(routeKey(ev({ key: '[' }), { armed: true })).toEqual({ kind: 'literal', text: '[' });
  });
});

describe('createLiteralBatcher', () => {
  it('coalesces then flushes on the byte cap', () => {
    const send = vi.fn();
    const b = createLiteralBatcher(send, { maxBytes: 3, flushMs: 9999 });
    b.push('a');
    b.push('b');
    expect(send).not.toHaveBeenCalled();
    b.push('c'); // 3 bytes → flush
    expect(send).toHaveBeenCalledWith('abc');
  });
  it('explicit flush drains the buffer (ordering vs named keys)', () => {
    const send = vi.fn();
    const b = createLiteralBatcher(send, { maxBytes: 256, flushMs: 9999 });
    b.push('hi');
    b.flush();
    expect(send).toHaveBeenCalledWith('hi');
    b.flush(); // empty → no extra call
    expect(send).toHaveBeenCalledTimes(1);
  });
});

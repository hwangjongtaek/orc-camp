/**
 * SPEC-103 §2.3/§2.4 + SPEC-203 §2.4 (AC-12/AC-15) — pane-view reconcile core.
 */
import { describe, it, expect } from 'vitest';
import { applyView, fromSeed, renderPane } from '../src/realtime/paneView';
import type { PaneViewPayload, PaneViewSeedPayload } from '../src/types/ws';

function seed(over: Partial<PaneViewSeedPayload> = {}): PaneViewSeedPayload {
  return {
    orcId: 'pane:%1',
    cols: 80,
    rows: 3,
    cursor: { x: 2, y: 1 },
    lines: ['old1', 'old2', 'w1', 'w2', 'w3'], // 2 scrollback + 3 visible (rows=3)
    capturedAt: '2026-07-02T00:00:00.000Z',
    redacted: false,
    byteClamped: false,
    viewSeq: 0,
    ...over,
  };
}
function view(over: Partial<PaneViewPayload> = {}): PaneViewPayload {
  return {
    orcId: 'pane:%1',
    cols: 80,
    rows: 3,
    cursor: { x: 0, y: 0 },
    lines: ['a', 'b', 'c'],
    capturedAt: '2026-07-02T00:00:01.000Z',
    redacted: false,
    byteClamped: false,
    viewSeq: 1,
    ...over,
  };
}

describe('fromSeed (SPEC-103 §2.3)', () => {
  it('splits the seed into scrollback + visible window by rows', () => {
    const s = fromSeed(seed());
    expect(s.scrollback).toEqual(['old1', 'old2']);
    expect(s.window).toEqual(['w1', 'w2', 'w3']);
    expect(s.viewSeq).toBe(0);
  });

  it('renderPane computes the absolute cursor row = scrollback.length + cursor.y (AC-15)', () => {
    const r = renderPane(fromSeed(seed()));
    expect(r.lines).toEqual(['old1', 'old2', 'w1', 'w2', 'w3']);
    expect(r.cursorRow).toBe(3); // 2 scrollback + y=1
    expect(r.cursorCol).toBe(2);
    expect(r.seededScrollback).toBe(true);
  });

  it('null cursor → renderPane omits the cursor (AC-15)', () => {
    const r = renderPane(fromSeed(seed({ cursor: null })));
    expect(r.cursorRow).toBeNull();
    expect(r.cursorCol).toBeNull();
  });
});

describe('applyView ordering (SPEC-103 §2.4)', () => {
  it('applies viewSeq === prev+1 and replaces the visible window (scrollback kept)', () => {
    const s0 = fromSeed(seed());
    const out = applyView(s0, view({ viewSeq: 1, lines: ['a', 'b', 'c'] }));
    expect(out.kind).toBe('applied');
    if (out.kind !== 'applied') return;
    expect(out.next.window).toEqual(['a', 'b', 'c']);
    expect(out.next.scrollback).toEqual(['old1', 'old2']); // capture-based: scrollback unchanged
    expect(renderPane(out.next).lines).toEqual(['old1', 'old2', 'a', 'b', 'c']);
  });

  it('drops duplicate/stale viewSeq (≤ current)', () => {
    const s0 = fromSeed(seed());
    expect(applyView(s0, view({ viewSeq: 0 })).kind).toBe('dropped');
  });

  it('flags a forward gap (viewSeq > prev+1) → caller re-attaches (AC-12/AC-13)', () => {
    const s0 = fromSeed(seed());
    expect(applyView(s0, view({ viewSeq: 3 })).kind).toBe('gap');
  });
});

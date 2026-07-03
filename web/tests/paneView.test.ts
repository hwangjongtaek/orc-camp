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

describe('styled overlay carriage (SPEC-103 §2.3.1)', () => {
  const sp = (start: number, end: number, sgr = '31'): { start: number; end: number; sgr: string } => ({
    start,
    end,
    sgr,
  });

  it('seed spans split at the same index as lines (scrollback vs window)', () => {
    const s = fromSeed(seed({ spans: [[sp(0, 1)], [], [sp(0, 2)], [], [sp(1, 2)]] }));
    expect(s.scrollbackSpans).toEqual([[sp(0, 1)], []]);
    expect(s.windowSpans).toEqual([[sp(0, 2)], [], [sp(1, 2)]]);
    expect(renderPane(s).spans).toEqual([[sp(0, 1)], [], [sp(0, 2)], [], [sp(1, 2)]]);
  });

  it('seed spans length mismatch → plain (fail-safe, invariant §2.3.1-5)', () => {
    const s = fromSeed(seed({ spans: [[sp(0, 1)]] })); // 1 ≠ 5 lines
    expect(s.scrollbackSpans).toBeNull();
    expect(s.windowSpans).toBeNull();
    expect(renderPane(s).spans).toBeNull();
  });

  it('absent spans (Phase 1 frame) → plain everywhere', () => {
    const s = fromSeed(seed());
    expect(renderPane(s).spans).toBeNull();
  });

  it('styled pane_view replaces the window overlay; plain scrollback padded with []', () => {
    const s0 = fromSeed(seed()); // plain seed
    const out = applyView(s0, view({ viewSeq: 1, lines: ['a', 'b', 'c'], spans: [[sp(0, 1)], [], []] }));
    expect(out.kind).toBe('applied');
    if (out.kind !== 'applied') return;
    // scrollback stays plain ([] padding), window carries its overlay
    expect(renderPane(out.next).spans).toEqual([[], [], [sp(0, 1)], [], []]);
  });

  it('a plain pane_view after a styled one resets the window to plain (server fallback)', () => {
    const s0 = fromSeed(seed({ spans: [[], [], [sp(0, 1)], [], []] }));
    const out = applyView(s0, view({ viewSeq: 1 })); // no spans on this frame
    expect(out.kind).toBe('applied');
    if (out.kind !== 'applied') return;
    expect(out.next.windowSpans).toBeNull();
    // seed scrollback overlay is retained; window portion renders as [] padding
    expect(renderPane(out.next).spans).toEqual([[], [], [], [], []]);
  });

  it('pane_view spans length mismatch → that window is plain', () => {
    const s0 = fromSeed(seed());
    const out = applyView(s0, view({ viewSeq: 1, spans: [[sp(0, 1)]] })); // 1 ≠ 3 lines
    expect(out.kind).toBe('applied');
    if (out.kind !== 'applied') return;
    expect(out.next.windowSpans).toBeNull();
  });
});

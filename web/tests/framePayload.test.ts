/**
 * SPEC-203 §2.4 — flicker-free atomic redraw payload (buildFramePayload, pure).
 *
 * The clear is folded into the write stream (single atomic write) instead of a sync reset() +
 * async write(); identical frames are skippable by comparing the payload string.
 */
import { describe, it, expect } from 'vitest';
import { buildFramePayload, CLEAR_PREFIX } from '../src/terminal/framePayload';
import type { RenderedPane } from '../src/realtime/paneView';

function pane(over: Partial<RenderedPane> = {}): RenderedPane {
  return {
    lines: ['hello', 'world'],
    spans: null,
    cursorRow: null,
    cursorCol: null,
    seededScrollback: false,
    ...over,
  };
}

describe('buildFramePayload (SPEC-203 §2.4 atomic redraw)', () => {
  it('folds the clear sequence into the write stream (in-stream clear, not reset())', () => {
    const p = buildFramePayload(pane(), 24);
    // scrollback + screen clear + home, all as a leading prefix of the SAME write payload
    expect(p.startsWith(CLEAR_PREFIX)).toBe(true);
    expect(p).toContain('\x1b[3J'); // clear scrollback
    expect(p).toContain('\x1b[2J'); // clear screen
    expect(p).toContain('\x1b[H'); // home
  });

  it('wraps the frame in a synchronized update (DEC 2026) begin/end pair', () => {
    const p = buildFramePayload(pane(), 24);
    expect(p.startsWith('\x1b[?2026h')).toBe(true); // begin
    expect(p.endsWith('\x1b[?2026l')).toBe(true); // end
  });

  it('passes styled/plain lines through CR/LF joined (invariant ②: text untouched)', () => {
    const p = buildFramePayload(pane({ lines: ['a', 'b', 'c'] }), 24);
    expect(p).toContain('a\r\nb\r\nc');
  });

  it('emits a cursor CUP (visible-screen relative) when the frame has a cursor', () => {
    // 3 lines, rows=2 ⇒ top line scrolls off; cursorRow=2 (last line) maps to visible row 2, col 4.
    const p = buildFramePayload(pane({ lines: ['x', 'y', 'z'], cursorRow: 2, cursorCol: 3 }), 2);
    expect(p).toContain('\x1b[2;4H');
  });

  it('omits the cursor CUP when there is no cursor', () => {
    const p = buildFramePayload(pane({ cursorRow: null, cursorCol: null }), 24);
    // no CUP terminator other than the leading home; ensure no "<row>;<col>H" sequence is present
    expect(/\x1b\[\d+;\d+H/.test(p)).toBe(false);
  });

  it('is stable for identical frames (enables same-frame skip)', () => {
    const a = buildFramePayload(pane(), 24);
    const b = buildFramePayload(pane(), 24);
    expect(a).toBe(b);
  });

  it('differs when the content changes (redraw is not skipped)', () => {
    const a = buildFramePayload(pane({ lines: ['one'] }), 24);
    const b = buildFramePayload(pane({ lines: ['two'] }), 24);
    expect(a).not.toBe(b);
  });
});

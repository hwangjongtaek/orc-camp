/**
 * SPEC-203 §2.4 — build the SINGLE atomic redraw payload for one captured frame (pure, xterm-free).
 *
 * The Terminal Viewport is capture-based: every frame rebuilds the whole screen (§2.4, D-045). The
 * naive way to do that is `term.reset(); term.write(data)` — but reset() clears the screen
 * SYNCHRONOUSLY while the following write() parses ASYNCHRONOUSLY into xterm's buffer, so between the
 * two a BLANK frame gets painted → visible per-frame flicker. Folding the clear INTO the write
 * stream makes clear + redraw parse as one unit (one write call), keeping reset()'s "rebuild every
 * frame" capture contract WITHOUT the intermediate blank paint.
 *
 * Payload layout:
 *   ESC[?2026h            begin synchronized update — coalesces the whole redraw into one visible
 *                         flip on supporting terminals; harmlessly ignored otherwise
 *   ESC[3J ESC[2J ESC[H   clear scrollback + clear screen + home cursor (== reset()'s full clear)
 *   <styled lines>        SGR-wrapped redacted runs, CR/LF joined — text passes through untouched
 *                         (invariant ②: frontend never masks/reconstructs; styleLines only wraps runs)
 *   ESC[<row>;<col>H      cursor CUP (visible-screen relative), omitted when the frame has no cursor
 *   ESC[?2026l            end synchronized update
 *
 * This function is intentionally free of any `@xterm/xterm` import so it is unit-testable in jsdom.
 */
import type { RenderedPane } from '../realtime/paneView';
import { styleLines } from './styledLine';

/** Prefix that every frame payload begins with (clear-in-stream). Exposed for assertions/skip. */
export const CLEAR_PREFIX = '\x1b[?2026h\x1b[3J\x1b[2J\x1b[H';
const SYNC_END = '\x1b[?2026l';

export function buildFramePayload(rendered: RenderedPane, rows: number): string {
  // §2.3.1 styled overlay: SGR-wrap validated runs (plain buffer passes through untouched). Each
  // styled run self-terminates with ESC[0m, so no style bleeds across lines.
  const body = styleLines(rendered.lines, rendered.spans).join('\r\n');
  let cursor = '';
  if (rendered.cursorRow != null && rendered.cursorCol != null) {
    // CUP addresses the VISIBLE screen; convert the buffer-absolute cursor row.
    const visRow = Math.max(0, rendered.cursorRow - Math.max(0, rendered.lines.length - rows));
    cursor = `\x1b[${Math.min(visRow, Math.max(0, rows - 1)) + 1};${rendered.cursorCol + 1}H`;
  }
  return `${CLEAR_PREFIX}${body}${cursor}${SYNC_END}`;
}

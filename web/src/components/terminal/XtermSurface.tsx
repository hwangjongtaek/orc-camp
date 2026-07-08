/**
 * SPEC-203 §2.4 — xterm.js rendering surface (D-046). This module is loaded LAZILY (React.lazy in
 * <TerminalViewport>), so xterm.js + its addon land in a separate chunk that is fetched only on the
 * first terminal-mode entry — never in the initial bundle (AC-02). It is DISPLAY-ONLY
 * (`disableStdin`): keystroke capture/passthrough is owned by the viewport container (SPEC-401),
 * and the redacted screen buffer is rendered as-is (invariant ②) with a best-effort cursor. If
 * xterm cannot initialize (e.g. no canvas/layout), it degrades silently — the viewport's DOM text
 * layer remains the accessible source of truth.
 */
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { RenderedPane } from '../../realtime/paneView';
import { buildFramePayload } from '../../terminal/framePayload';

export interface XtermSurfaceProps {
  rendered: RenderedPane;
  cols: number;
  rows: number;
}

export default function XtermSurface({ rendered, cols, rows }: XtermSurfaceProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const prevSizeRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });
  const prevPayloadRef = useRef<string | null>(null);

  // Init once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let term: Terminal | null = null;
    try {
      term = new Terminal({
        convertEol: true,
        disableStdin: true, // display-only; input goes through the passthrough path (SPEC-401)
        cursorBlink: false,
        screenReaderMode: true, // SPEC-203 §2.4 — expose output to assistive tech (AC-16)
        scrollback: 1000,
      });
      // SPEC-203 §2.6 / SPEC-401 — the container router owns ALL keyboard input. Without this,
      // xterm cancels (preventDefault+stopPropagation) keys it would handle itself (Enter, arrows,
      // Escape, …) on its focused textarea, so they never bubble to the container's onKeyDown and
      // armed named-key egress is silently lost (2026-07-02 integration smoke). Returning false
      // tells xterm to never process — and therefore never cancel — any keyboard event.
      term.attachCustomKeyEventHandler(() => false);
      term.open(host);
      termRef.current = term;
    } catch {
      termRef.current = null; // degrade to the viewport DOM text layer
    }
    return () => {
      try {
        term?.dispose();
      } catch {
        /* ignore */
      }
      termRef.current = null;
    };
  }, []);

  // Re-render buffer on change (capture-based full redraw). SPEC-203 §2.4 flicker-free rule: the
  // clear is folded INTO the write stream (buildFramePayload) so clear + redraw parse as one atomic
  // write — the old `term.reset()` (sync clear) followed by `term.write()` (async parse) painted a
  // blank frame in between → per-frame flicker. See framePayload.ts for the payload contract.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    try {
      // SPEC-203 §2.4 — the GRID is the pane's native cols×rows (never the buffer length; a
      // seed-sized grid made the surface hundreds of rows tall and pinned the visible area to the
      // top of the scrollback). Overflow beyond `rows` goes to xterm scrollback; physical fitting
      // is CSS-owned (fit/scale or scroll), so no FitAddon grid rewrite. Resize ONLY when the grid
      // actually changed (resizing every frame reflowed the buffer needlessly).
      let resized = false;
      if (cols > 0 && rows > 0 && (cols !== prevSizeRef.current.cols || rows !== prevSizeRef.current.rows)) {
        term.resize(cols, rows);
        prevSizeRef.current = { cols, rows };
        resized = true;
      }
      // Same-frame skip: an identical payload means nothing changed → don't redraw at all (a resize
      // still forces a redraw so the reflowed grid gets the fresh capture).
      const payload = buildFramePayload(rendered, rows);
      if (!resized && payload === prevPayloadRef.current) return;
      prevPayloadRef.current = payload;
      // Follow-tail policy: keep following only if the user was already at the bottom.
      const buf = term.buffer.active;
      const atBottom = buf.viewportY >= buf.baseY;
      // write() is buffered — scroll once the frame is actually parsed.
      term.write(payload, () => {
        if (atBottom) term.scrollToBottom();
      });
    } catch {
      /* ignore transient render errors */
    }
  }, [rendered, cols, rows]);

  return <div className="oc-term__xterm" ref={hostRef} aria-hidden="true" />;
}

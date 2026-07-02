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
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { RenderedPane } from '../../realtime/paneView';

export interface XtermSurfaceProps {
  rendered: RenderedPane;
  cols: number;
  rows: number;
}

export default function XtermSurface({ rendered, cols, rows }: XtermSurfaceProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

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
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      termRef.current = term;
      fitRef.current = fit;
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
      fitRef.current = null;
    };
  }, []);

  // Re-render buffer on change (capture-based: clear + rewrite the current buffer).
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    try {
      if (cols > 0 && rows > 0) term.resize(cols, Math.max(rows, rendered.lines.length || rows));
      term.clear();
      term.write(rendered.lines.join('\r\n'));
      if (rendered.cursorRow != null && rendered.cursorCol != null) {
        // Position the (hidden) cursor best-effort: 1-based CUP.
        term.write(`\x1b[${rendered.cursorRow + 1};${rendered.cursorCol + 1}H`);
      }
      fitRef.current?.fit();
    } catch {
      /* ignore transient render errors */
    }
  }, [rendered, cols, rows]);

  return <div className="oc-term__xterm" ref={hostRef} aria-hidden="true" />;
}

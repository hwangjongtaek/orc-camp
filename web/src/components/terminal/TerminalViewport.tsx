/**
 * SPEC-203 §2.4/§2.6/§2.8 — Terminal Viewport. Renders the SPEC-103 pane frames (redacted `lines`
 * + cursor) with honest capture-based reproduction limits, per-component standard states, the
 * exposure gate, and the color-INDEPENDENT Observe/Control chrome (border-style + label + icon).
 *
 * Text layer: an accessible `role="log"` <pre> of the redacted lines is ALWAYS in the DOM (screen
 * readers + copy + tests read it); xterm.js is layered on top only as a visual enhancement, loaded
 * lazily (AC-02). The frontend never masks/reconstructs text (invariant ②). Key capture (trap)
 * happens ONLY in Control mode via this container (Observe never traps — Tab escapes, AC-06); the
 * routing decision is delegated to `routeKey` and surfaced through `onKey`.
 */
import { Suspense, lazy, useRef } from 'react';
import type { PaneScreen } from '../../realtime/paneView';
import { renderPane } from '../../realtime/paneView';
import { routeKey, type KeyRoute } from '../../terminal/passthrough';
import type { PaneViewEndReason } from '../../types/ws';
import type { ControlMode } from './useControlMode';

const XtermSurface = lazy(() => import('./XtermSurface'));

export interface TerminalViewportProps {
  orcId: string | null;
  screen: PaneScreen | null;
  endReason: PaneViewEndReason | null;
  exposureEnabled: boolean;
  connected: boolean;
  stale: boolean;
  controlMode: ControlMode;
  armWarn?: boolean;
  /** Control-mode key routing (the container traps keys ONLY when armed). */
  onKey?: (route: KeyRoute, e: React.KeyboardEvent) => void;
  /** Mount the lazy xterm enhancement layer (default true; tests pass false). */
  enhanced?: boolean;
}

export function TerminalViewport(props: TerminalViewportProps): JSX.Element {
  const { screen, exposureEnabled, connected, stale, controlMode } = props;
  const enhanced = props.enhanced ?? true;
  const containerRef = useRef<HTMLDivElement>(null);

  const armed = controlMode === 'control';
  const modeLabel = armed ? 'CONTROL — armed' : 'Observing';
  const modeIcon = armed ? '⌨' : '👁';

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!armed || !props.onKey) return;
    const route = routeKey(e, { armed: true });
    if (route.kind !== 'ignore') {
      e.preventDefault();
      e.stopPropagation();
    }
    props.onKey(route, e);
  };

  return (
    <div
      ref={containerRef}
      className={
        'oc-term' +
        (armed ? ' oc-term--control' : ' oc-term--observe') +
        (props.armWarn ? ' oc-term--warn' : '')
      }
      data-mode={controlMode}
      data-testid="terminal-viewport"
      // Focusable + key trap ONLY in Control mode (Observe never traps — AC-06).
      tabIndex={armed ? 0 : -1}
      onKeyDown={onKeyDown}
      aria-label={`Terminal — ${modeLabel}`}
    >
      <div className="oc-term__chrome" aria-hidden="true">
        <span className="oc-term__mode" data-mode={controlMode}>
          <span className="oc-term__mode-icon">{modeIcon}</span> {modeLabel}
        </span>
      </div>
      <div className="oc-term__body">{renderBody(props, armed)}</div>
      {/* layer B overlays — do NOT revert to loading (SPEC-201 §2.7) */}
      {!connected && screen && (
        <div className="oc-term__overlay oc-term__overlay--disconnected" role="status">
          Disconnected — showing last screen (may lag).
        </div>
      )}
      {connected && stale && screen && (
        <span className="oc-tag oc-term__stale" role="status">
          stale · not live
        </span>
      )}
      {enhanced && screen && exposureEnabled && !isGated(props) && (
        <Suspense fallback={null}>
          <XtermSurface rendered={renderPane(screen)} cols={screen.cols} rows={screen.rows} />
        </Suspense>
      )}
    </div>
  );
}

function isGated(p: TerminalViewportProps): boolean {
  return !p.exposureEnabled || p.endReason === 'exposure_off';
}

function renderBody(p: TerminalViewportProps, armed: boolean): JSX.Element {
  const { orcId, screen, endReason, exposureEnabled } = p;

  // 1) exposure gate ALWAYS wins — no raw text, no cached screen (AC-10, invariant ②/③).
  if (!exposureEnabled || endReason === 'exposure_off') {
    return (
      <div className="oc-term__state" role="status">
        <p>Terminal hidden — enable preview exposure in settings.</p>
      </div>
    );
  }
  // 2) no selection
  if (!orcId) {
    return (
      <div className="oc-term__state" role="status">
        <p>Select an orc to open its terminal.</p>
      </div>
    );
  }
  // 3) stream ended (pane/error/superseded)
  if (endReason === 'pane_gone') {
    return <div className="oc-term__state" role="status"><p>Pane closed — this orc has terminated.</p></div>;
  }
  if (endReason === 'error') {
    return (
      <div className="oc-term__state" role="alert">
        <p>Live view error. Re-select the orc to retry.</p>
      </div>
    );
  }
  if (endReason === 'superseded') {
    return <div className="oc-term__state" role="status"><p>Replaced by another view.</p></div>;
  }
  // 4) loading (awaiting seed / xterm chunk)
  if (!screen) {
    return (
      <div className="oc-term__state" role="status">
        <div className="oc-spinner" aria-hidden="true" />
        <p>Attaching to pane…</p>
      </div>
    );
  }
  const rendered = renderPane(screen);
  // 5) no output
  if (rendered.lines.length === 0 || rendered.lines.every((l) => l.length === 0)) {
    return <div className="oc-term__state" role="status"><p>No output yet.</p></div>;
  }
  // 6) content — accessible redacted text layer (xterm overlays this visually when enhanced).
  return (
    <>
      <div className="oc-term__badges" aria-hidden="false">
        {screen.redacted && (
          <span className="oc-tag oc-tag--redacted" title="Sensitive text was redacted before transport">
            redacted
          </span>
        )}
        <span className="oc-tag" title="Near-real-time capture — not a full terminal emulation">
          capture · near-real-time
        </span>
        {screen.byteClamped && <span className="oc-tag" title="Output was tail-clamped to a byte cap">clamped</span>}
      </div>
      <pre
        className={'oc-term__text' + (p.enhanced ?? true ? ' oc-sr-only' : '')}
        role="log"
        aria-label="Terminal output (redacted)"
        aria-live={armed ? 'off' : 'polite'}
      >
        {rendered.lines.join('\n')}
      </pre>
      {rendered.seededScrollback && (
        <p className="oc-term__seednote oc-muted" aria-hidden="true">
          — scrollback begins at the capture window; older history is not available —
        </p>
      )}
    </>
  );
}

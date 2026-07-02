/**
 * SPEC-203 §2.4/§2.6/§2.8 — Terminal Viewport states, color-independent mode chrome, exposure
 * gate, redaction/capture-limit badges, and Control-only key trap. xterm enhancement is disabled
 * (enhanced=false) so the accessible DOM text layer is asserted directly.
 * Covers AC-06, AC-09, AC-10, AC-11, AC-13, AC-15.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TerminalViewport } from '../src/components/terminal/TerminalViewport';
import { fromSeed, type PaneScreen } from '../src/realtime/paneView';
import type { PaneViewSeedPayload } from '../src/types/ws';

function screenWith(lines: string[], over: Partial<PaneViewSeedPayload> = {}): PaneScreen {
  return fromSeed({
    orcId: 'pane:%1',
    cols: 80,
    rows: lines.length || 1,
    cursor: null,
    lines,
    capturedAt: '2026-07-02T00:00:00.000Z',
    redacted: false,
    byteClamped: false,
    viewSeq: 0,
    ...over,
  });
}

const BASE = {
  orcId: 'pane:%1' as string | null,
  screen: null as PaneScreen | null,
  endReason: null,
  exposureEnabled: true,
  connected: true,
  stale: false,
  controlMode: 'observe' as const,
  enhanced: false,
};

describe('TerminalViewport standard states (AC-11)', () => {
  it('no selection → select-an-orc', () => {
    render(<TerminalViewport {...BASE} orcId={null} />);
    expect(screen.getByText(/select an orc/i)).toBeTruthy();
  });
  it('orc selected, no screen yet → loading (attaching)', () => {
    render(<TerminalViewport {...BASE} screen={null} />);
    expect(screen.getByText(/attaching to pane/i)).toBeTruthy();
  });
  it('orc selected but attach gated (hidden tab / disconnected) → paused, NOT attaching', () => {
    render(<TerminalViewport {...BASE} screen={null} attached={false} />);
    expect(screen.getByText(/live view paused/i)).toBeTruthy();
    expect(screen.queryByText(/attaching to pane/i)).toBeNull();
  });
  it('attach outstanding (attached) → still the attaching state', () => {
    render(<TerminalViewport {...BASE} screen={null} attached={true} />);
    expect(screen.getByText(/attaching to pane/i)).toBeTruthy();
  });
  it('empty output → no output', () => {
    render(<TerminalViewport {...BASE} screen={screenWith([''])} />);
    expect(screen.getByText(/no output/i)).toBeTruthy();
  });
});

describe('exposure gate wins (AC-10)', () => {
  it('exposure off → gated placeholder, raw lines NOT rendered', () => {
    render(<TerminalViewport {...BASE} exposureEnabled={false} screen={screenWith(['secret-output'])} />);
    expect(screen.getByText(/terminal hidden/i)).toBeTruthy();
    expect(screen.queryByText(/secret-output/)).toBeNull();
  });
  it('pane_view_end reason=exposure_off → gated too', () => {
    render(<TerminalViewport {...BASE} endReason="exposure_off" screen={screenWith(['x'])} />);
    expect(screen.getByText(/terminal hidden/i)).toBeTruthy();
  });
});

describe('content + redaction/capture limits (AC-13/AC-15)', () => {
  it('renders redacted lines as-is with redacted + capture-based badges', () => {
    const scr = screenWith(['line one', '[REDACTED:github-token] tail'], { redacted: true });
    render(<TerminalViewport {...BASE} screen={scr} />);
    expect(screen.getByText(/\[REDACTED:github-token\] tail/)).toBeTruthy(); // rendered verbatim
    expect(screen.getByText('redacted')).toBeTruthy();
    expect(screen.getByText(/capture · near-real-time/)).toBeTruthy();
  });
});

describe('color-independent Observe/Control chrome (AC-09)', () => {
  it('observe: solid border class + "Observing" label + not focusable/trapping', () => {
    render(<TerminalViewport {...BASE} controlMode="observe" screen={screenWith(['x', 'y'])} />);
    const vp = screen.getByTestId('terminal-viewport');
    expect(vp.className).toContain('oc-term--observe');
    expect(vp.getAttribute('tabindex')).toBe('-1'); // Observe never traps (AC-06)
    expect(screen.getAllByText(/Observing/).length).toBeGreaterThan(0);
  });
  it('control: heavy border class + "CONTROL — armed" label + focusable trap', () => {
    render(<TerminalViewport {...BASE} controlMode="control" screen={screenWith(['x', 'y'])} />);
    const vp = screen.getByTestId('terminal-viewport');
    expect(vp.className).toContain('oc-term--control');
    expect(vp.getAttribute('tabindex')).toBe('0');
    expect(screen.getAllByText(/CONTROL — armed/).length).toBeGreaterThan(0);
  });
});

describe('key trap only in Control (AC-06)', () => {
  it('Control: printable key routes to onKey (literal) and is trapped', () => {
    const onKey = vi.fn();
    render(<TerminalViewport {...BASE} controlMode="control" screen={screenWith(['x'])} onKey={onKey} />);
    fireEvent.keyDown(screen.getByTestId('terminal-viewport'), { key: 'a' });
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(onKey.mock.calls[0]![0]).toEqual({ kind: 'literal', text: 'a' });
  });
  it('Observe: viewport does not route/trap keys', () => {
    const onKey = vi.fn();
    render(<TerminalViewport {...BASE} controlMode="observe" screen={screenWith(['x'])} onKey={onKey} />);
    fireEvent.keyDown(screen.getByTestId('terminal-viewport'), { key: 'a' });
    expect(onKey).not.toHaveBeenCalled();
  });
});

describe('disconnected/stale overlays (AC-11)', () => {
  it('disconnected keeps last screen + shows overlay (no loading revert)', () => {
    render(<TerminalViewport {...BASE} connected={false} screen={screenWith(['keep me'])} />);
    expect(screen.getByText(/keep me/)).toBeTruthy();
    expect(screen.getByText(/disconnected/i)).toBeTruthy();
    expect(screen.queryByText(/attaching to pane/i)).toBeNull();
  });
  it('stale (connected) shows a stale badge', () => {
    render(<TerminalViewport {...BASE} stale screen={screenWith(['x'])} />);
    expect(screen.getByText(/stale · not live/i)).toBeTruthy();
  });
});

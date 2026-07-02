/**
 * SPEC-203 §2.7 — terminal status bar. Always surfaces the raw tmuxTarget + paneId (R-UI-007),
 * cwd (redaction-passed), the Observe/Control mode (color-independent: label + icon), and a
 * near-real-time latency marker (banded, a freshness honesty signal — not an SLA, §6 Q5). All
 * indicators carry non-empty accessible names (role="status"/aria-label, AC-16).
 */
import { TERMINAL_LATENCY_FRESH_MS, TERMINAL_LATENCY_STALE_MS } from '../../config/constants';
import type { Orc } from '../../types/domain';
import type { ControlMode } from './useControlMode';

export interface TerminalStatusBarProps {
  orc: Orc | undefined;
  controlMode: ControlMode;
  connected: boolean;
  /** epoch ms of the last live frame; null = no live frame yet. */
  lastFrameAt: number | null;
  now: number; // passed in so the parent's clock drives re-render (testable)
}

type Freshness = 'live' | 'lagging' | 'stale' | 'none';

function freshness(lastFrameAt: number | null, now: number, connected: boolean): Freshness {
  if (lastFrameAt == null) return 'none';
  const age = now - lastFrameAt;
  if (!connected) return 'stale';
  if (age <= TERMINAL_LATENCY_FRESH_MS) return 'live';
  if (age <= TERMINAL_LATENCY_STALE_MS) return 'lagging';
  return 'stale';
}

const FRESH_LABEL: Record<Freshness, string> = {
  live: '● live',
  lagging: '◐ lagging',
  stale: '○ stale',
  none: '○ —',
};

export function TerminalStatusBar({
  orc,
  controlMode,
  connected,
  lastFrameAt,
  now,
}: TerminalStatusBarProps): JSX.Element {
  const armed = controlMode === 'control';
  const f = freshness(lastFrameAt, now, connected);
  return (
    <div className="oc-termbar" data-testid="terminal-statusbar">
      <span className="oc-termbar__item" aria-label={`target ${orc?.tmuxTarget ?? 'none'}`}>
        <span className="oc-field__label">target</span>
        <span className="oc-field__value--mono">{orc?.tmuxTarget ?? '—'}</span>
      </span>
      <span className="oc-termbar__item" aria-label={`pane ${orc?.paneId ?? 'none'}`}>
        <span className="oc-field__label">pane</span>
        <span className="oc-field__value--mono">{orc?.paneId ?? '—'}</span>
      </span>
      <span className="oc-termbar__item" aria-label={`working directory ${orc?.cwd ?? 'unknown'}`}>
        <span className="oc-field__label">cwd</span>
        <span className="oc-field__value--mono">{orc?.cwd ?? '—'}</span>
      </span>
      <span
        className={'oc-termbar__mode' + (armed ? ' oc-termbar__mode--control' : '')}
        role="status"
        aria-label={`mode ${armed ? 'control (armed)' : 'observe'}`}
      >
        {armed ? '⌨ Control' : '👁 Observe'}
      </span>
      <span
        className={`oc-termbar__latency oc-termbar__latency--${f}`}
        role="status"
        aria-label={`stream freshness ${f}`}
        title="Near-real-time capture (SPEC-103 polling)"
      >
        {FRESH_LABEL[f]}
      </span>
    </div>
  );
}

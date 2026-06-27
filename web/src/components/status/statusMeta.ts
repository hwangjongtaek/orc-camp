/**
 * SPEC-202 §2.2 — non-color status encoding metadata.
 * Each status carries a plain-text label + a grayscale-distinct glyph fallback + a
 * chip border-style (applied via CSS class). Color is only a secondary channel.
 */
import type { AgentType, OrcStatus } from '../../types/domain';

export interface StatusMeta {
  label: string; // plain-text (SPEC-202 R2)
  glyph: string; // CSS glyph fallback (SPEC-202 R1), grayscale-distinct
  overlayKey: string; // manifest objects/status-ui key
  className: string; // border-style + accent class
}

export const STATUS_META: Record<OrcStatus, StatusMeta> = {
  active: { label: 'Active', glyph: '●', overlayKey: 'active-spark', className: 'oc-status--active' },
  waiting: { label: 'Waiting', glyph: '◔', overlayKey: 'waiting-bubble', className: 'oc-status--waiting' },
  idle: { label: 'Idle', glyph: '○', overlayKey: 'idle-glow', className: 'oc-status--idle' },
  stale: { label: 'Stale', glyph: '◷', overlayKey: 'stale-clock', className: 'oc-status--stale' },
  error: { label: 'Error', glyph: '▲', overlayKey: 'error-burst', className: 'oc-status--error' },
  unknown: { label: 'Unknown', glyph: '?', overlayKey: 'unknown-charm', className: 'oc-status--unknown' },
  terminated: { label: 'Terminated', glyph: '⊗', overlayKey: 'terminated-ghost', className: 'oc-status--terminated' },
};

export const AGENT_LABEL: Record<AgentType, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  unknown: 'Unknown agent',
};

/** A confidence as a short, color-independent affix, e.g. "~0.55". */
export function confidenceAffix(value: number): string {
  return `~${value.toFixed(2)}`;
}

/**
 * SPEC-200 §2.7 + SPEC-201 §2.6/§2.7 — view-status derivation (store side).
 *
 * Splits into three layers (SPEC-201 §2.7):
 *   A. content (mutually exclusive, full-screen): loading | tmux_not_installed |
 *      tmux_not_running | no_session | no_agent | populated  (+ `unauthorized` gate)
 *   B. overlays (orthogonal): disconnected (transport) and stale (server flag) — both
 *      may show at once and never send content back to `loading` after first snapshot.
 *   C. tmux_error is scope-local (rendered per camp/orc), not a full-screen state.
 */
import type { Diagnostics, StatusSummary, TmuxAvailability } from '../types/domain';

export type ContentStatus =
  | 'tmux_not_installed'
  | 'tmux_not_running' // installed, server not running (no_session: server-not-running variant)
  | 'no_session' // installed, server running, no sessions (running-no-session variant)
  | 'no_agent' // sessions exist but every camp orcCount === 0
  | 'populated';

export type ViewPhase = 'unauthorized' | 'loading' | 'content';

export interface ViewState {
  phase: ViewPhase;
  content: ContentStatus | null; // present iff phase === 'content'
  disconnected: boolean; // layer B overlay
  stale: boolean; // layer B overlay
}

export interface ViewStatusInput {
  unauthorized: boolean;
  hasBootstrapped: boolean; // first snapshot has been applied
  tmux: TmuxAvailability;
  campCount: number;
  totalOrcCount: number;
  stale: boolean;
  wsDisconnected: boolean;
}

function deriveContent(input: ViewStatusInput): ContentStatus {
  const { tmux, campCount, totalOrcCount } = input;
  if (!tmux.installed) return 'tmux_not_installed';
  if (campCount === 0) return tmux.serverRunning ? 'no_session' : 'tmux_not_running';
  if (totalOrcCount === 0) return 'no_agent';
  return 'populated';
}

export function deriveViewState(input: ViewStatusInput): ViewState {
  if (input.unauthorized) {
    return { phase: 'unauthorized', content: null, disconnected: false, stale: false };
  }
  if (!input.hasBootstrapped) {
    return {
      phase: 'loading',
      content: null,
      disconnected: input.wsDisconnected,
      stale: input.stale,
    };
  }
  return {
    phase: 'content',
    content: deriveContent(input),
    disconnected: input.wsDisconnected,
    stale: input.stale,
  };
}

/** Layer C — does the snapshot carry any tmux errors worth surfacing? */
export function hasTmuxErrors(diagnostics: Diagnostics): boolean {
  return diagnostics.tmuxErrors.length > 0;
}

export function totalOrcCount(statusSummary: StatusSummary): number {
  return (
    statusSummary.active +
    statusSummary.waiting +
    statusSummary.idle +
    statusSummary.stale +
    statusSummary.error +
    statusSummary.unknown +
    statusSummary.terminated
  );
}

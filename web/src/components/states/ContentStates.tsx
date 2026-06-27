/**
 * SPEC-201 §2.6 / §3.7 — full-screen content states (layer A) + loading/unauthorized.
 * Each empty state renders distinct copy so the four are user-distinguishable (AC-05/06).
 */
import type { ContentStatus } from '../../store/viewStatus';

export function LoadingState(): JSX.Element {
  return (
    <div className="oc-state" role="status" aria-live="polite">
      <div className="oc-spinner" aria-hidden="true" />
      <div className="oc-state__title">Loading camps…</div>
      <div className="oc-muted">Waiting for the first snapshot from the local server.</div>
    </div>
  );
}

export function UnauthorizedState(): JSX.Element {
  return (
    <div className="oc-state" role="alert">
      <h1 className="oc-state__title">Token required</h1>
      <p className="oc-muted">
        This dashboard needs the one-time access token from the boot URL. Re-open the link
        printed by <span className="oc-mono">orc-camp serve</span> (it looks like{' '}
        <span className="oc-mono">http://127.0.0.1:&lt;port&gt;/?token=…</span>).
      </p>
      <p className="oc-muted">
        The token is kept in memory only and is dropped on reload, so re-opening the boot URL
        is expected.
      </p>
    </div>
  );
}

const EMPTY_COPY: Record<ContentStatus, { title: string; body: string }> = {
  tmux_not_installed: {
    title: 'tmux is not installed',
    body: 'Orc Camp observes tmux sessions. Install tmux, then start a session to see camps here.',
  },
  tmux_not_running: {
    title: 'tmux server is not running',
    body: 'tmux is installed but no server is running. Start a tmux session to spin up a camp.',
  },
  no_session: {
    title: 'No tmux sessions yet',
    body: 'The tmux server is running but has no sessions. Create one (e.g. `tmux new -s work`).',
  },
  no_agent: {
    title: 'No agents detected',
    body: 'Sessions exist but no coding agents were detected in their panes yet.',
  },
  populated: { title: '', body: '' },
};

export function EmptyContentState({ status }: { status: ContentStatus }): JSX.Element {
  const copy = EMPTY_COPY[status];
  return (
    <div className="oc-state">
      <h1 className="oc-state__title">{copy.title}</h1>
      <p className="oc-muted">{copy.body}</p>
    </div>
  );
}

/**
 * SPEC-201 §2.7 layer B + R-UI-005 — overlay banners that never replace content.
 * disconnected (transport) and stale (server flag) are rendered distinctly and may
 * co-exist. A global-scope ApiError surfaces here; scoped errors render near entities.
 */
import { useServices } from '../../app/services';
import { selectViewState, useStore } from '../../store/store';

function formatTime(iso: string | null): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

export function Banners(): JSX.Element | null {
  const view = useStore(selectViewState);
  const wsStatus = useStore((s) => s.connection.wsStatus);
  const lastGoodAt = useStore((s) => s.server.lastGoodAt);
  const lastError = useStore((s) => s.connection.lastError);
  const refreshState = useStore((s) => s.connection.refreshState);
  const { engine } = useServices();

  const showDisconnected = view.disconnected;
  const showStale = view.stale;
  const showError = lastError !== null && lastError.scope === 'global';

  if (!showDisconnected && !showStale && !showError) return null;

  return (
    <div>
      {showDisconnected && (
        <div className="oc-banner oc-banner--disconnected" role="status">
          <span className="oc-banner__label">Disconnected</span>
          <span className="oc-muted">
            Live updates paused ({wsStatus}). Showing the last known state — values may be delayed.
          </span>
          <span className="oc-banner__spacer" />
          <button
            className="oc-btn"
            onClick={() => void engine.refresh()}
            disabled={refreshState === 'refreshing'}
          >
            Retry now
          </button>
        </div>
      )}
      {showStale && (
        <div className="oc-banner oc-banner--stale" role="status">
          <span className="oc-banner__label">Stale snapshot</span>
          <span className="oc-muted">
            Server reported degraded data. Last good collection: {formatTime(lastGoodAt)}.
          </span>
          <span className="oc-banner__spacer" />
          <button
            className="oc-btn"
            onClick={() => void engine.refresh()}
            disabled={refreshState === 'refreshing'}
          >
            Refresh
          </button>
        </div>
      )}
      {showError && lastError && (
        <div className="oc-banner oc-banner--error" role="alert">
          <span className="oc-banner__label">Problem</span>
          <span>{lastError.message}</span>
        </div>
      )}
    </div>
  );
}

/**
 * App shell: header (brand + refresh + settings + connection indicator), layered banners,
 * and routes. Phase gating (SPEC-200 §2.7 / SPEC-201 §2.7): unauthorized and pre-bootstrap
 * loading replace the main content; otherwise routes render with overlay banners on top.
 */
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { useServices } from './app/services';
import { selectViewState, useStore } from './store/store';
import { Banners } from './components/banners/Banners';
import { Toasts } from './components/toast/Toasts';
import { LoadingState, UnauthorizedState } from './components/states/ContentStates';
import { CampListView } from './screens/CampListView';
import { CampDetailView } from './screens/CampDetailView';
import { SettingsView } from './screens/SettingsView';

export function App(): JSX.Element {
  const view = useStore(selectViewState);

  return (
    <div className="oc-app">
      <Header />
      <main className="oc-main">
        {view.phase === 'unauthorized' ? (
          <UnauthorizedState />
        ) : (
          <>
            <Banners />
            {view.phase === 'loading' ? (
              <LoadingState />
            ) : (
              <Routes>
                <Route path="/" element={<CampListView />} />
                <Route path="/camps/:campId" element={<CampDetailView />} />
                <Route path="/settings" element={<SettingsView />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            )}
          </>
        )}
      </main>
      <Toasts />
    </div>
  );
}

function Header(): JSX.Element {
  const { engine } = useServices();
  const wsStatus = useStore((s) => s.connection.wsStatus);
  const refreshState = useStore((s) => s.connection.refreshState);
  const unauthorized = useStore((s) => s.connection.unauthorized);

  return (
    <header className="oc-header">
      <Link className="oc-header__brand" to="/">
        <span aria-hidden="true">🏕️</span> Orc Camp
      </Link>
      <span className="oc-header__spacer" />
      <nav className="oc-header__nav">
        <ConnectionIndicator status={wsStatus} />
        <button
          className="oc-btn"
          onClick={() => void engine.refresh()}
          disabled={unauthorized || refreshState === 'refreshing'}
          aria-label="Refresh now"
        >
          {refreshState === 'refreshing' ? 'Refreshing…' : refreshState === 'throttled' ? 'Throttled' : 'Refresh'}
        </button>
        <Link className="oc-btn" to="/settings" aria-label="Open settings">
          Settings
        </Link>
      </nav>
    </header>
  );
}

function ConnectionIndicator({ status }: { status: string }): JSX.Element {
  const live = status === 'open';
  return (
    <span className="oc-muted oc-status__conf" title="WebSocket transport status">
      {live ? '● live' : `○ ${status}`}
    </span>
  );
}

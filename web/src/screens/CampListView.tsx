/** SPEC-201 §2.2 — Camp List (first screen, R-UI-001/002). */
import { useEffect } from 'react';
import { selectViewState, useStore } from '../store/store';
import { bulkTmuxErrors } from '../store/diagnostics';
import { StatusSummaryBar } from '../components/StatusSummaryBar';
import { CampCard } from '../components/CampCard';
import { EmptyContentState } from '../components/states/ContentStates';

export function CampListView(): JSX.Element {
  const view = useStore(selectViewState);
  const campIds = useStore((s) => s.server.campIds);
  // SPEC-201 AC-12 — only BULK tmux errors (target === null) are global; per-orc errors
  // (target === paneId) render locally in the scene/inspector, never blanking the dashboard.
  const bulkErrorCount = useStore((s) => bulkTmuxErrors(s.server.diagnostics.tmuxErrors).length);
  const setSelectedCamp = useStore((s) => s.setSelectedCamp);

  // Clear any stale camp selection when returning to the list.
  useEffect(() => {
    setSelectedCamp(null);
  }, [setSelectedCamp]);

  if (view.phase === 'content' && view.content && view.content !== 'populated') {
    return <EmptyContentState status={view.content} />;
  }

  return (
    <div>
      <StatusSummaryBar />
      {bulkErrorCount > 0 && (
        <div className="oc-banner oc-banner--error" role="status">
          <span className="oc-banner__label">tmux errors</span>
          <span className="oc-muted">
            {bulkErrorCount} bulk tmux error(s) this scan. Per-pane errors are marked on their
            orc; other data is unaffected.
          </span>
        </div>
      )}
      <div className="oc-camp-grid">
        {campIds.map((id) => (
          <CampCard key={id} campId={id} />
        ))}
      </div>
    </div>
  );
}

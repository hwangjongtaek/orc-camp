/** SPEC-201 §2.2 — Camp List (first screen, R-UI-001/002). */
import { useEffect } from 'react';
import { selectViewState, useStore } from '../store/store';
import { hasTmuxErrors } from '../store/viewStatus';
import { StatusSummaryBar } from '../components/StatusSummaryBar';
import { CampCard } from '../components/CampCard';
import { EmptyContentState } from '../components/states/ContentStates';

export function CampListView(): JSX.Element {
  const view = useStore(selectViewState);
  const campIds = useStore((s) => s.server.campIds);
  const tmuxErrorCount = useStore((s) => s.server.diagnostics.tmuxErrors.length);
  const hasErrors = useStore((s) => hasTmuxErrors(s.server.diagnostics));
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
      {hasErrors && (
        <div className="oc-banner oc-banner--error" role="status">
          <span className="oc-banner__label">tmux errors</span>
          <span className="oc-muted">
            {tmuxErrorCount} tmux error(s) reported this scan. Affected camps/orcs are marked;
            other data is unaffected.
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

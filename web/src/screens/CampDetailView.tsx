/**
 * SPEC-201 §2.3 — Camp Detail. Resolves :campId (stable id), mirrors the selected orc to
 * `?orc=<orcId>` (SPEC-200 §2.2), and composes the scene above a single tabbed dock
 * (<CampDock>: Details / Preview / Activity). The dock spans the full width below the map so
 * the map gets the whole row (no right column). A missing campId after bootstrap renders a
 * not-found state (SPEC-201 §3.7); before bootstrap, the app shows loading.
 */
import { useCallback, useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../store/store';
import { STATUS_KEYS } from '../types/domain';
import { relativeTime } from '../util/time';
import { CampMap } from '../components/scene/CampMap';
import { BackgroundSwitcher } from '../components/scene/BackgroundSwitcher';
import { LayoutModeSwitcher } from '../components/inspector/LayoutModeSwitcher';
import { CampDock } from '../components/inspector/CampDock';
import { StatusCountChip } from '../components/status/StatusBadge';

export function CampDetailView(): JSX.Element {
  const params = useParams();
  const campId = params.campId ?? '';
  const [search, setSearch] = useSearchParams();
  const selectedOrcId = search.get('orc');

  const camp = useStore((s) => s.server.campsById[campId]);
  const hasBootstrapped = useStore(
    (s) => s.connection.bootstrapPhase === 'live' || s.server.snapshotVersion > 0,
  );
  const setSelectedCamp = useStore((s) => s.setSelectedCamp);
  const setSelectedOrc = useStore((s) => s.setSelectedOrc);
  const layoutMode = useStore((s) => s.ui.layoutMode);

  // Mirror URL → ui slice (URL is the source of truth for selection).
  useEffect(() => {
    setSelectedCamp(campId);
  }, [campId, setSelectedCamp]);
  useEffect(() => {
    setSelectedOrc(selectedOrcId);
  }, [selectedOrcId, setSelectedOrc]);

  const onSelect = useCallback(
    (orcId: string) => {
      const next = new URLSearchParams(search);
      next.set('orc', orcId);
      setSearch(next, { replace: false });
    },
    [search, setSearch],
  );

  // Deselect (clear ?orc=) when the user clicks empty map space (SPEC-201 §2.3 #51).
  const onDeselect = useCallback(() => {
    if (!search.has('orc')) return;
    const next = new URLSearchParams(search);
    next.delete('orc');
    setSearch(next, { replace: false });
  }, [search, setSearch]);

  if (!camp) {
    if (!hasBootstrapped) {
      return (
        <div className="oc-state" role="status">
          <div className="oc-spinner" aria-hidden="true" />
          <div>Loading camp…</div>
        </div>
      );
    }
    return (
      <div className="oc-state" role="alert">
        <h1 className="oc-state__title">Camp not found</h1>
        <p className="oc-muted">
          This session is no longer in the current snapshot (it may have ended).
        </p>
        <Link className="oc-btn" to="/">
          Back to camps
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="oc-detail__header">
        <Link className="oc-btn" to="/" aria-label="Back to camp list">
          ← Camps
        </Link>
        <h1>{camp.tmuxSessionName}</h1>
        <span className="oc-detail__id">{camp.sessionId}</span>
        <span className="oc-muted">
          {camp.orcCount} orc · {camp.windowCount} win · {camp.paneCount} pane · last{' '}
          {relativeTime(camp.lastActivityAt)}
        </span>
      </div>

      <div className="oc-card__statuses" style={{ marginBottom: 'var(--oc-space-3)' }}>
        {STATUS_KEYS.map((status) => (
          <StatusCountChip key={status} status={status} count={camp.statusSummary[status]} />
        ))}
      </div>

      <div className="oc-detail" data-layout={layoutMode}>
        <div className="oc-detail__toolbar">
          <LayoutModeSwitcher />
          <BackgroundSwitcher />
        </div>
        <CampMap
          campId={campId}
          selectedOrcId={selectedOrcId}
          onSelect={onSelect}
          onDeselect={onDeselect}
        />
        <CampDock orcId={selectedOrcId} />
      </div>
    </div>
  );
}

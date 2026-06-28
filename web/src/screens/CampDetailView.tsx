/**
 * SPEC-201 §2.3 — Camp Detail. Resolves :campId (stable id), mirrors the selected orc to
 * `?orc=<orcId>` (SPEC-200 §2.2), and composes scene + inspector + activity rail. A missing
 * campId after bootstrap renders a not-found state (SPEC-201 §3.7); before bootstrap, the
 * app shows loading.
 */
import { useCallback, useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../store/store';
import { STATUS_KEYS } from '../types/domain';
import { relativeTime, clockTime } from '../util/time';
import { CampMap } from '../components/scene/CampMap';
import { OrcInspector } from '../components/inspector/OrcInspector';
import { BottomSheet } from '../components/inspector/BottomSheet';
import { StatusCountChip } from '../components/status/StatusBadge';
import { useMediaQuery, MOBILE_QUERY } from '../util/useMediaQuery';

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

  // SPEC-201 §3.8 (#45) — clearing selection (e.g. dismissing the mobile bottom sheet) drops
  // the ?orc param so the sheet closes and the URL stays the source of truth.
  const clearSelection = useCallback(() => {
    const next = new URLSearchParams(search);
    next.delete('orc');
    setSearch(next, { replace: false });
  }, [search, setSearch]);

  // SPEC-201 §3.8 — at the mobile breakpoint the inspector degrades to a bottom sheet that
  // only mounts when an orc is selected (the desktop 3-pane otherwise shows it inline).
  const isMobile = useMediaQuery(MOBILE_QUERY);

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

      <div className="oc-detail">
        <div>
          <CampMap campId={campId} selectedOrcId={selectedOrcId} onSelect={onSelect} />
          <ActivityRail />
        </div>
        {/* Desktop: inline inspector pane. Mobile: replaced by the bottom sheet below. */}
        {!isMobile && <OrcInspector orcId={selectedOrcId} />}
      </div>

      {isMobile && selectedOrcId && (
        <BottomSheet title="Orc inspector" onClose={clearSelection}>
          <OrcInspector orcId={selectedOrcId} />
        </BottomSheet>
      )}
    </div>
  );
}

function ActivityRail(): JSX.Element | null {
  const activity = useStore((s) => s.activity);
  if (activity.length === 0) return null;
  const recent = activity.slice(-12).reverse();
  return (
    <div className="oc-activity" aria-label="Recent activity">
      <h3>Recent activity</h3>
      {recent.map((ev) => (
        <div key={ev.id} className="oc-activity__item">
          <span className="oc-activity__time">{clockTime(ev.at)}</span>
          <span>{ev.message}</span>
        </div>
      ))}
    </div>
  );
}

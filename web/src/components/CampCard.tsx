/** SPEC-201 §2.2 — CampCard content mapping (all fields direct from SPEC-005 Camp). */
import { Link } from 'react-router-dom';
import { STATUS_KEYS } from '../types/domain';
import { useStore } from '../store/store';
import { relativeTime } from '../util/time';
import { StatusCountChip } from './status/StatusBadge';

// The 4 status counts SPEC-201 marks as required on every card.
const REQUIRED_STATUSES = ['active', 'waiting', 'error', 'stale'] as const;

export function CampCard({ campId }: { campId: string }): JSX.Element | null {
  const camp = useStore((s) => s.server.campsById[campId]);
  if (!camp) return null;

  const required = STATUS_KEYS.filter((s) => REQUIRED_STATUSES.includes(s as never));
  const extra = STATUS_KEYS.filter((s) => !REQUIRED_STATUSES.includes(s as never));

  return (
    <Link className="oc-card" to={`/camps/${encodeURIComponent(campId)}`}>
      <div className="oc-card__title">
        <h3>{camp.tmuxSessionName}</h3>
        <span className="oc-card__id">{camp.sessionId}</span>
      </div>
      <div className="oc-card__meta">
        <span>{camp.windowCount} win</span>
        <span>{camp.paneCount} pane</span>
        <span>{camp.orcCount} orc</span>
        <span title="last activity">{relativeTime(camp.lastActivityAt)}</span>
      </div>
      <div className="oc-card__statuses">
        {required.map((status) => (
          <StatusCountChip key={status} status={status} count={camp.statusSummary[status]} />
        ))}
        {extra.map((status) => (
          <StatusCountChip key={status} status={status} count={camp.statusSummary[status]} />
        ))}
      </div>
    </Link>
  );
}

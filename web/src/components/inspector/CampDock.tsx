/**
 * SPEC-201 §2.3/§2.4 — Camp dock. The single bottom panel that replaces the old right-hand
 * inspector column AND the standalone activity rail, freeing horizontal space for a larger map.
 * Its constituents are switchable tabs (WAI-ARIA tabs, see <Tabs>):
 *   - Details  → <OrcInspector> (selected orc metadata + control dock)
 *   - Preview  → <PanePreview> (exposure-gated pane terminal tail; TODO: live SSH control)
 *   - Activity → recent camp activity feed
 * Each tab works for all viewport widths (the map sits above the dock in one column).
 */
import { useStore } from '../../store/store';
import { clockTime } from '../../util/time';
import { Tabs, type TabDef } from '../ui/Tabs';
import { OrcInspector } from './OrcInspector';
import { PanePreview } from '../preview/PanePreview';

export function CampDock({ orcId }: { orcId: string | null }): JSX.Element {
  const orc = useStore((s) => (orcId ? s.server.orcsById[orcId] : undefined));
  const activityCount = useStore((s) => s.activity.length);

  const tabs: TabDef[] = [
    { id: 'details', label: 'Details', render: () => <OrcInspector orcId={orcId} /> },
    { id: 'preview', label: 'Preview', render: () => <PanePreview orc={orc} /> },
    {
      id: 'activity',
      label: 'Activity',
      badge: activityCount > 0 ? activityCount : undefined,
      render: () => <ActivityList />,
    },
  ];

  return (
    <div className="oc-dock" data-testid="camp-dock">
      <Tabs tabs={tabs} ariaLabel="Camp panel" />
    </div>
  );
}

function ActivityList(): JSX.Element {
  const activity = useStore((s) => s.activity);
  if (activity.length === 0) {
    return <p className="oc-muted">No recent activity yet.</p>;
  }
  const recent = activity.slice(-12).reverse();
  return (
    <div className="oc-activity" aria-label="Recent activity">
      {recent.map((ev) => (
        <div key={ev.id} className="oc-activity__item">
          <span className="oc-activity__time">{clockTime(ev.at)}</span>
          <span>{ev.message}</span>
        </div>
      ))}
    </div>
  );
}

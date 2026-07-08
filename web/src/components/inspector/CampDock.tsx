/**
 * SPEC-201 §2.3/§2.4 — Camp dock. The single bottom panel that replaces the old right-hand
 * inspector column AND the standalone activity rail, freeing horizontal space for a larger map.
 * Its constituents are switchable tabs (WAI-ARIA tabs, see <Tabs>):
 *   - Details  → <OrcInspector> (selected orc metadata, read-only)
 *   - Activity → recent camp activity feed
 * The old map-mode "Preview" tab (read-only pane tail + control dock) was removed — live
 * observation AND control now live in terminal mode (SPEC-203 Terminal Workspace: xterm viewport
 * + ComposedInput). Each tab works for all viewport widths (the map sits above the dock).
 */
import { useStore } from '../../store/store';
import { clockTime } from '../../util/time';
import { Tabs, type TabDef } from '../ui/Tabs';
import { OrcInspector } from './OrcInspector';

export function CampDock({ orcId }: { orcId: string | null }): JSX.Element {
  const activityCount = useStore((s) => s.activity.length);

  const tabs: TabDef[] = [
    { id: 'details', label: 'Details', render: () => <OrcInspector orcId={orcId} /> },
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

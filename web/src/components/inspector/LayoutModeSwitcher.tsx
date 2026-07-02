/**
 * Camp-detail switcher. Two segmented controls (SPEC-203 §2.1 extends the original):
 *   1. Workspace mode: Map ↔ Terminal (`ui.workspaceMode`, session-local). Map = the spatial camp
 *      scene; Terminal = the xterm workspace. Switching preserves `?orc=` selection + campId.
 *   2. Map layout (shown only in Map mode): Full / 50-50 / 30-70 — how the map and dock share the
 *      screen (`ui.layoutMode`, persisted). Reflected onto `.oc-detail[data-layout]`.
 *
 * Each is a `role="group"` of `aria-pressed` buttons (color-independent active state).
 */
import { useStore } from '../../store/store';
import type { LayoutMode, WorkspaceMode } from '../../store/store';

const LAYOUTS: { id: LayoutMode; label: string; title: string }[] = [
  { id: 'full', label: 'Full', title: 'Map full width (panel below)' },
  { id: 'split', label: '50 / 50', title: 'Map and panel side by side, 50 / 50 width' },
  { id: 'dock', label: '30 / 70', title: 'Map 30% / panel 70% width, side by side' },
];

const WORKSPACES: { id: WorkspaceMode; label: string; title: string }[] = [
  { id: 'map', label: 'Map', title: 'Spatial camp map' },
  { id: 'terminal', label: 'Terminal', title: 'Terminal workspace (xterm)' },
];

export function LayoutModeSwitcher(): JSX.Element {
  const layoutMode = useStore((s) => s.ui.layoutMode);
  const setLayoutMode = useStore((s) => s.setLayoutMode);
  const workspaceMode = useStore((s) => s.ui.workspaceMode);
  const setWorkspaceMode = useStore((s) => s.setWorkspaceMode);

  return (
    <div className="oc-switchers">
      <div className="oc-layoutswitch" role="group" aria-label="Workspace mode" data-testid="workspace-switcher">
        <span className="oc-layoutswitch__label">Mode</span>
        {WORKSPACES.map((m) => (
          <button
            key={m.id}
            type="button"
            className="oc-layoutswitch__btn"
            aria-pressed={workspaceMode === m.id}
            title={m.title}
            onClick={() => setWorkspaceMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {workspaceMode === 'map' && (
        <div className="oc-layoutswitch" role="group" aria-label="Camp layout" data-testid="layout-switcher">
          <span className="oc-layoutswitch__label">Layout</span>
          {LAYOUTS.map((m) => (
            <button
              key={m.id}
              type="button"
              className="oc-layoutswitch__btn"
              aria-pressed={layoutMode === m.id}
              title={m.title}
              onClick={() => setLayoutMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

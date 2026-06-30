/**
 * Camp-detail layout switcher — toggles how the camp MAP and the tabbed dock share the screen
 * (see {@link LayoutMode}). 'Full' stacks them (map full width, dock below); the other two place
 * them side by side and divide the WIDTH:
 *   - Full   : map full width, dock below it (the original layout).
 *   - 50 / 50: map | dock side by side, equal width.
 *   - 30 / 70: map 30 % | dock 70 % width (dock-dominant).
 *
 * A segmented control: a single `role="group"` of three buttons, each `aria-pressed` to expose the
 * active mode to assistive tech. The choice lives in the UI store (`ui.layoutMode`, persisted);
 * <CampDetailView> reflects it onto `.oc-detail[data-layout]` and the CSS does the rest.
 */
import { useStore } from '../../store/store';
import type { LayoutMode } from '../../store/store';

const MODES: { id: LayoutMode; label: string; title: string }[] = [
  { id: 'full', label: 'Full', title: 'Map full width (panel below)' },
  { id: 'split', label: '50 / 50', title: 'Map and panel side by side, 50 / 50 width' },
  { id: 'dock', label: '30 / 70', title: 'Map 30% / panel 70% width, side by side' },
];

export function LayoutModeSwitcher(): JSX.Element {
  const layoutMode = useStore((s) => s.ui.layoutMode);
  const setLayoutMode = useStore((s) => s.setLayoutMode);

  return (
    <div className="oc-layoutswitch" role="group" aria-label="Camp layout" data-testid="layout-switcher">
      <span className="oc-layoutswitch__label">Layout</span>
      {MODES.map((m) => (
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
  );
}

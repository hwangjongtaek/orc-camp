/**
 * SPEC-201 §2.3 / SPEC-301 §2.1a — camp background switcher (detail panel).
 *
 * Lists the manifest's image-ground backgrounds (those declaring `logical_size` + a `ground`
 * polygon) and lets the user switch which one the camp map renders. The choice is held in the UI
 * store (`ui.backgroundRef`); CampMap reads it to swap both the image AND its ground. Renders
 * nothing when fewer than two switchable backgrounds exist. Phase 1 = global override; per-camp
 * persistence is a follow-up.
 */
import { useAssets } from '../../assets/AssetContext';
import { useStore } from '../../store/store';

export function BackgroundSwitcher(): JSX.Element | null {
  const { manifest } = useAssets();
  const backgroundRef = useStore((s) => s.ui.backgroundRef);
  const setBackgroundRef = useStore((s) => s.setBackgroundRef);

  const backgrounds = manifest?.backgrounds ?? {};
  const options = Object.entries(backgrounds)
    .filter(([, bg]) => bg.logical_size && bg.ground?.polygon)
    .map(([key, bg]) => ({ key, label: bg.display_name ?? key }));

  if (options.length < 2) return null;

  const current =
    backgroundRef ?? manifest?.scene?.backdrop?.background_ref ?? options[0]?.key ?? '';

  return (
    <label className="oc-bgswitch" data-testid="bg-switcher">
      <span className="oc-bgswitch__label">Background</span>
      <select
        className="oc-bgswitch__select"
        value={current}
        aria-label="Camp background"
        onChange={(e) => setBackgroundRef(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

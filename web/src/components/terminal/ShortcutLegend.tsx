/**
 * SPEC-203 §2.5 — in-UI shortcut legend. Switching/mode/disarm shortcuts are NOT discoverable by
 * trial alone, so they are surfaced as an always-visible hint strip (keyboard/new-user discovery).
 */
import { DISARM_KEY_LABEL } from '../../terminal/passthrough';

export function ShortcutLegend(): JSX.Element {
  return (
    <div className="oc-legend" aria-label="Keyboard shortcuts">
      <Hint keys="⌘/Ctrl K" label="switch orc" />
      <Hint keys="[ ]" label="prev/next" />
      <Hint keys="Alt 1–9" label="jump" />
      <Hint keys={DISARM_KEY_LABEL} label="release control" />
    </div>
  );
}

function Hint({ keys, label }: { keys: string; label: string }): JSX.Element {
  return (
    <span className="oc-legend__item">
      <kbd className="oc-legend__keys">{keys}</kbd>
      <span className="oc-legend__label">{label}</span>
    </span>
  );
}

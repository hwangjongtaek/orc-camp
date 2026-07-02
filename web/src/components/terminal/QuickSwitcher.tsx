/**
 * SPEC-203 §2.5 (S4) — ⌘/Ctrl+K quick switcher: fuzzy search orcs by name/target/status and jump.
 * It is the PRIMARY jump affordance (rail digit-jump is a convenience). A focus-trapped overlay
 * (K5): Escape closes and returns focus to the trigger; Arrow moves the highlight; Enter selects.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { fuzzyFilter, type SwitchableItem } from '../../terminal/switching';

export interface QuickSwitcherProps {
  items: SwitchableItem[];
  onSelect: (orcId: string) => void;
  onClose: () => void;
}

export function QuickSwitcher({ items, onSelect, onClose }: QuickSwitcherProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => fuzzyFilter(items, query), [items, query]);

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => trigger?.focus?.();
  }, []);

  useEffect(() => setActive(0), [query]);

  const commit = (orcId: string | undefined): void => {
    if (!orcId) return;
    onSelect(orcId);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(filtered[active]?.orcId);
    } else if (e.key === 'Tab') {
      // trap: only the input is focusable → keep focus here
      e.preventDefault();
    }
  };

  return (
    <div className="oc-modal__backdrop" onMouseDown={onClose}>
      <div
        className="oc-modal oc-quickswitch"
        role="dialog"
        aria-modal="true"
        aria-label="Switch orc"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="oc-quickswitch__input"
          type="text"
          value={query}
          placeholder="Switch orc — name, target, or status…"
          aria-label="Search orcs"
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="oc-quickswitch__list" role="listbox" aria-label="Matching orcs">
          {filtered.length === 0 && <li className="oc-muted oc-quickswitch__empty">No matches.</li>}
          {filtered.map((it, i) => (
            <li key={it.orcId} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={'oc-quickswitch__item' + (i === active ? ' is-active' : '')}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(it.orcId)}
              >
                <span className="oc-field__value--mono">{it.tmuxTarget}</span>
                <span className="oc-quickswitch__status">{it.status}</span>
                <span className="oc-quickswitch__summary oc-muted">{it.summaryLine}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

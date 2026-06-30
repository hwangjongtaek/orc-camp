/**
 * SPEC-201 §2.4 — accessible Tabs primitive (WAI-ARIA tabs pattern).
 *
 * One tab stop for the whole tablist (roving tabindex): the active tab is tabIndex 0, the rest
 * −1. ArrowLeft/Right (and Home/End) move focus AND activate (automatic activation). Each tab
 * has role=tab + aria-selected + aria-controls; the visible panel has role=tabpanel +
 * aria-labelledby. Only the active panel is mounted (lazy: a tab's `render` runs when selected),
 * which keeps the exposure-gated terminal preview from fetching until its tab is opened.
 */
import { useId, useRef, useState, type ReactNode } from 'react';

export interface TabDef {
  id: string;
  label: string;
  badge?: ReactNode;
  render: () => ReactNode;
}

export function Tabs({
  tabs,
  ariaLabel,
  initialId,
}: {
  tabs: TabDef[];
  ariaLabel: string;
  initialId?: string;
}): JSX.Element {
  const baseId = useId();
  const [activeId, setActiveId] = useState(initialId ?? tabs[0]?.id ?? '');
  const refs = useRef(new Map<string, HTMLButtonElement>());

  // The active tab may disappear (tabs are data-driven); fall back to the first tab.
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  if (!active) return <div className="oc-tabs" role="tablist" aria-label={ariaLabel} />;

  const tabId = (id: string): string => `${baseId}-tab-${id}`;
  const panelId = (id: string): string => `${baseId}-panel-${id}`;

  const focusTab = (id: string): void => {
    setActiveId(id);
    refs.current.get(id)?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number): void => {
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const nid = tabs[next]?.id;
    if (nid) focusTab(nid);
  };

  return (
    <>
      <div className="oc-tabs" role="tablist" aria-label={ariaLabel}>
        {tabs.map((t, i) => {
          const selected = t.id === active.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={tabId(t.id)}
              className="oc-tab"
              aria-selected={selected}
              aria-controls={panelId(t.id)}
              tabIndex={selected ? 0 : -1}
              ref={(el) => {
                if (el) refs.current.set(t.id, el);
                else refs.current.delete(t.id);
              }}
              onClick={() => setActiveId(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {t.label}
              {t.badge != null && t.badge !== '' && (
                <span className="oc-tab__badge">{t.badge}</span>
              )}
            </button>
          );
        })}
      </div>
      <div
        className="oc-tabpanel"
        role="tabpanel"
        id={panelId(active.id)}
        aria-labelledby={tabId(active.id)}
        tabIndex={0}
      >
        {active.render()}
      </div>
    </>
  );
}

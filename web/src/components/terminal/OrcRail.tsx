/**
 * SPEC-203 §2.3 — Orc Rail. A vertical switching/orchestration surface: each item shows a portrait
 * thumbnail + StatusBadge (icon+label+confidence, never asserting status as fact) + a one-line
 * summary (with an "estimated" marker when applicable) + the raw tmuxTarget (R-UI-007, always
 * visible). `waiting` orcs carry a SEPARATE, color-independent emphasis channel ON TOP of the
 * StatusBadge (a leading "needs input" pip + a heavier container border + top-group pinning done by
 * the caller) so grayscale still distinguishes them (invariant ④, AC-12). The rail is one
 * roving-tabindex group (SPEC-202 §2.4): Arrow moves focus, Enter/Space selects.
 */
import { useRef } from 'react';
import { useAssets } from '../../assets/AssetContext';
import { resolvePortrait } from '../../assets/portraitResolver';
import { StatusBadge } from '../status/StatusBadge';
import { useStore } from '../../store/store';
import type { Orc } from '../../types/domain';

export interface OrcRailProps {
  /** Orc ids in RAIL order (waiting-pinned) — the SSOT for prev/next/digit switching. */
  orderedIds: string[];
  orcsById: Record<string, Orc>;
  /** Portrait identity key per orc (from the stable CAMP order, so it matches the map sprite). */
  charKeyById: Map<string, string | undefined>;
  selectedOrcId: string | null;
  onSelect: (orcId: string) => void;
}

const ARROW_NEXT = new Set(['ArrowDown', 'ArrowRight']);
const ARROW_PREV = new Set(['ArrowUp', 'ArrowLeft']);

export function OrcRail({
  orderedIds,
  orcsById,
  charKeyById,
  selectedOrcId,
  onSelect,
}: OrcRailProps): JSX.Element {
  const { manifest, assetBase } = useAssets();
  const displayedTierById = useStore((s) => s.prestige.displayedTierById);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const activeId = selectedOrcId && orcsById[selectedOrcId] ? selectedOrcId : orderedIds[0] ?? null;

  const focusAt = (id: string | null): void => {
    if (id) itemRefs.current[id]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, idx: number): void => {
    if (ARROW_NEXT.has(e.key)) {
      e.preventDefault();
      focusAt(orderedIds[(idx + 1) % orderedIds.length] ?? null);
    } else if (ARROW_PREV.has(e.key)) {
      e.preventDefault();
      focusAt(orderedIds[(idx - 1 + orderedIds.length) % orderedIds.length] ?? null);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusAt(orderedIds[0] ?? null);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusAt(orderedIds[orderedIds.length - 1] ?? null);
    }
  };

  if (orderedIds.length === 0) {
    return (
      <nav className="oc-rail" aria-label="Orcs in this camp">
        <p className="oc-muted oc-rail__empty">No agents detected.</p>
      </nav>
    );
  }

  return (
    <nav className="oc-rail" aria-label="Orcs in this camp">
      <ul className="oc-rail__list" role="listbox" aria-label="Select an orc">
        {orderedIds.map((id, idx) => {
          const orc = orcsById[id];
          if (!orc) return null;
          const selected = id === selectedOrcId;
          const emphasized = orc.status === 'waiting';
          const portrait = resolvePortrait(
            { characterKey: charKeyById.get(id), agentType: orc.agentType, displayedTier: displayedTierById[id] ?? 0 },
            { manifest, assetBasePath: assetBase },
          );
          const summary = orc.currentWorkSummary ?? 'No summary';
          return (
            <li key={id} role="presentation">
              <button
                type="button"
                ref={(el) => (itemRefs.current[id] = el)}
                role="option"
                aria-selected={selected}
                tabIndex={id === activeId ? 0 : -1}
                className={
                  'oc-rail__item' +
                  (selected ? ' oc-rail__item--selected' : '') +
                  (emphasized ? ' oc-rail__item--waiting' : '')
                }
                data-testid={`rail-item-${id}`}
                data-waiting={emphasized ? 'true' : undefined}
                onClick={() => onSelect(id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(id);
                  } else {
                    onKeyDown(e, idx);
                  }
                }}
              >
                {emphasized && (
                  <span className="oc-rail__pip" title="needs input">
                    <span aria-hidden="true">▸</span>
                    <span className="oc-sr-only">needs input</span>
                  </span>
                )}
                <span className="oc-rail__portrait" aria-hidden="true">
                  {portrait.mode === 'asset' && portrait.src ? (
                    <img className="oc-rail__portrait-img" src={portrait.src} alt="" />
                  ) : (
                    <span className="oc-rail__portrait-ph" />
                  )}
                </span>
                <span className="oc-rail__body">
                  <span className="oc-rail__badges">
                    <StatusBadge status={orc.status} confidence={orc.statusConfidence} />
                  </span>
                  <span className="oc-rail__summary" title={summary}>
                    {summary}
                    {orc.summaryIsEstimated && orc.currentWorkSummary && (
                      <span className="oc-rail__estimated" title="estimated summary">
                        {' '}
                        ~est
                      </span>
                    )}
                  </span>
                  <span className="oc-rail__target oc-field__value--mono">{orc.tmuxTarget}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

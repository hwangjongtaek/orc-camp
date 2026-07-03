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

export interface OrcRailBroadcastResult {
  ok: boolean;
  errorCode: string | null;
}

export interface OrcRailProps {
  /** Orc ids in RAIL order (waiting-pinned) — the SSOT for prev/next/digit switching. */
  orderedIds: string[];
  orcsById: Record<string, Orc>;
  /** Portrait identity key per orc (from the stable CAMP order, so it matches the map sprite). */
  charKeyById: Map<string, string | undefined>;
  selectedOrcId: string | null;
  onSelect: (orcId: string) => void;
  /** SPEC-203 §2.10 broadcast selection mode — show a per-item target checkbox (separate hit target). */
  broadcastMode?: boolean;
  /** Orc ids currently in the broadcast target set (orthogonal to `selectedOrcId`, AC-18 (i)). */
  broadcastTargeted?: ReadonlySet<string>;
  onToggleTarget?: (orcId: string) => void;
  /** Per-orc broadcast result hint (color-independent ✓/✗ + code), shown after a broadcast. */
  resultById?: ReadonlyMap<string, OrcRailBroadcastResult>;
}

const ARROW_NEXT = new Set(['ArrowDown', 'ArrowRight']);
const ARROW_PREV = new Set(['ArrowUp', 'ArrowLeft']);

export function OrcRail({
  orderedIds,
  orcsById,
  charKeyById,
  selectedOrcId,
  onSelect,
  broadcastMode = false,
  broadcastTargeted,
  onToggleTarget,
  resultById,
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
          const targeted = broadcastTargeted?.has(id) ?? false;
          const result = resultById?.get(id);
          const emphasized = orc.status === 'waiting';
          const portrait = resolvePortrait(
            { characterKey: charKeyById.get(id), agentType: orc.agentType, displayedTier: displayedTierById[id] ?? 0 },
            { manifest, assetBasePath: assetBase },
          );
          const summary = orc.currentWorkSummary ?? 'No summary';
          return (
            <li key={id} role="presentation" className="oc-rail__row">
              {broadcastMode && (
                // Separate hit target: toggling membership must NOT move switch focus (?orc=), AC-18 (i).
                <input
                  type="checkbox"
                  className="oc-rail__check"
                  tabIndex={-1}
                  checked={targeted}
                  aria-label={`Broadcast target: ${orc.tmuxTarget}`}
                  onChange={() => onToggleTarget?.(id)}
                  data-testid={`rail-check-${id}`}
                />
              )}
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
                data-broadcast-target={targeted ? 'true' : undefined}
                onClick={() => onSelect(id)}
                onKeyDown={(e) => {
                  if (broadcastMode && e.key === ' ') {
                    // In selection mode Space toggles the target (Enter still switches), AC-18 (vi).
                    e.preventDefault();
                    onToggleTarget?.(id);
                  } else if (e.key === 'Enter' || e.key === ' ') {
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
                  {result && (
                    <span
                      className={'oc-rail__result' + (result.ok ? ' oc-rail__result--ok' : ' oc-rail__result--fail')}
                      role="status"
                      title={result.ok ? 'Broadcast delivered' : `Broadcast failed: ${result.errorCode ?? 'error'}`}
                    >
                      <span aria-hidden="true">{result.ok ? '✓' : '✗'}</span>{' '}
                      {result.ok ? 'sent' : `failed · ${result.errorCode ?? 'error'}`}
                    </span>
                  )}
                </span>
                {broadcastMode && targeted && <span className="oc-sr-only">, in broadcast selection</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

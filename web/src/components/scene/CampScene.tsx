/**
 * SPEC-201 §2.3 — CampScene: orcs grouped by windowIndex into lanes, ordered by
 * paneIndex within a lane. Each slot subscribes to ITS orc only (per-id selector) so a
 * single orc_status_changed re-renders just that slot (SPEC-200 §3.5). Non-orc panes are
 * not rendered as orcs; the count gap is reflected in camp meta only.
 */
import { useMemo } from 'react';
import { useStore } from '../../store/store';
import { OrcSprite } from '../sprite/OrcSprite';
import { StatusBadge } from '../status/StatusBadge';

const EMPTY: string[] = [];

interface Lane {
  windowIndex: number;
  orcIds: string[];
}

function buildLanes(orcIds: string[]): Lane[] {
  const orcsById = useStore.getState().server.orcsById;
  const byWindow = new Map<number, string[]>();
  for (const id of orcIds) {
    const orc = orcsById[id];
    if (!orc) continue;
    const list = byWindow.get(orc.windowIndex) ?? [];
    list.push(id);
    byWindow.set(orc.windowIndex, list);
  }
  return [...byWindow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([windowIndex, ids]) => ({ windowIndex, orcIds: ids }));
}

export function CampScene({
  campId,
  selectedOrcId,
  onSelect,
}: {
  campId: string;
  selectedOrcId: string | null;
  onSelect: (orcId: string) => void;
}): JSX.Element {
  const orcIds = useStore((s) => s.server.orcIdsByCamp[campId] ?? EMPTY);
  const lanes = useMemo(() => buildLanes(orcIds), [orcIds]);

  if (orcIds.length === 0) {
    return (
      <div className="oc-scene">
        <div className="oc-state" style={{ minHeight: '160px' }}>
          <div className="oc-state__title">No agents detected</div>
          <div className="oc-muted">This camp has sessions/panes but no detected agents.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="oc-scene" role="group" aria-label="Camp scene">
      {lanes.map((lane) => (
        <div key={lane.windowIndex} className="oc-lane">
          <div className="oc-lane__header">window {lane.windowIndex}</div>
          <div className="oc-slots">
            {lane.orcIds.map((orcId) => (
              <OrcSlot
                key={orcId}
                orcId={orcId}
                selected={orcId === selectedOrcId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function OrcSlot({
  orcId,
  selected,
  onSelect,
}: {
  orcId: string;
  selected: boolean;
  onSelect: (orcId: string) => void;
}): JSX.Element | null {
  const orc = useStore((s) => s.server.orcsById[orcId]);
  if (!orc) return null;
  return (
    <button
      type="button"
      className={`oc-slot${selected ? ' oc-slot--selected' : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect(orcId)}
    >
      <OrcSprite
        orcId={orc.id}
        agentType={orc.agentType}
        status={orc.status}
        statusConfidence={orc.statusConfidence}
        tmuxTarget={orc.tmuxTarget}
      />
      <StatusBadge status={orc.status} confidence={orc.statusConfidence} />
      <span className="oc-slot__target">{orc.tmuxTarget}</span>
    </button>
  );
}

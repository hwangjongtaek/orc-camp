/**
 * SPEC-203 §2.3 (AC-12/AC-13) — Orc Rail: portrait + StatusBadge + summary + raw target;
 * color-independent waiting emphasis; click selects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { AssetProvider } from '../src/assets/AssetContext';
import { OrcRail } from '../src/components/terminal/OrcRail';
import { useStore } from '../src/store/store';
import { makeOrc } from './fixtures';
import type { Orc } from '../src/types/domain';

function renderRail(orcs: Orc[], onSelect = vi.fn(), selected: string | null = null) {
  const orcsById: Record<string, Orc> = {};
  for (const o of orcs) orcsById[o.id] = o;
  const orderedIds = orcs.map((o) => o.id);
  const charKeyById = new Map(orderedIds.map((id) => [id, undefined]));
  render(
    <AssetProvider assetBase="/pack">
      <OrcRail
        orderedIds={orderedIds}
        orcsById={orcsById}
        charKeyById={charKeyById}
        selectedOrcId={selected}
        onSelect={onSelect}
      />
    </AssetProvider>,
  );
  return { onSelect };
}

beforeEach(() => useStore.getState().resetServer());

describe('OrcRail', () => {
  it('renders StatusBadge + one-line summary + raw tmuxTarget per item (R-UI-007)', () => {
    renderRail([
      makeOrc({ paneId: '%1', tmuxTarget: 'work:0.0', status: 'active', currentWorkSummary: 'building api' }),
    ]);
    const item = screen.getByTestId('rail-item-pane:%1');
    expect(within(item).getByText('Active')).toBeTruthy(); // StatusBadge label
    expect(within(item).getByText('building api')).toBeTruthy();
    expect(within(item).getByText('work:0.0')).toBeTruthy(); // raw target always visible
  });

  it('waiting orc carries a color-independent emphasis channel on top of the badge (AC-12)', () => {
    renderRail([
      makeOrc({ paneId: '%1', status: 'active' }),
      makeOrc({ paneId: '%2', status: 'waiting', currentWorkSummary: 'needs a decision' }),
    ]);
    const waiting = screen.getByTestId('rail-item-pane:%2');
    expect(waiting.getAttribute('data-waiting')).toBe('true'); // structural, not color
    expect(within(waiting).getByText('needs input')).toBeTruthy(); // leading pip (SR text)
    expect(within(waiting).getByText('Waiting')).toBeTruthy(); // StatusBadge NOT replaced
    // a non-waiting item has neither
    const active = screen.getByTestId('rail-item-pane:%1');
    expect(active.getAttribute('data-waiting')).toBeNull();
  });

  it('clicking an item selects it (→ ?orc=, invariant ①)', () => {
    const { onSelect } = renderRail([makeOrc({ paneId: '%1' }), makeOrc({ paneId: '%2' })]);
    fireEvent.click(screen.getByTestId('rail-item-pane:%2'));
    expect(onSelect).toHaveBeenCalledWith('pane:%2');
  });

  it('empty camp renders the "No agents detected" state', () => {
    renderRail([]);
    expect(screen.getByText(/no agents detected/i)).toBeTruthy();
  });
});

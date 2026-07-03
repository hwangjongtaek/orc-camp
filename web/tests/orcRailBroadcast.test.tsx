/**
 * SPEC-203 §2.10 / AC-18 (i)(vi) — Orc Rail broadcast selection mode. The target checkbox is a
 * SEPARATE hit target from the switch button (toggling membership never changes ?orc=); `selected`
 * and `broadcastTargeted` are independent, color-independent channels; Space toggles / Enter switches;
 * per-orc result hints render color-independently after a broadcast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { AssetProvider } from '../src/assets/AssetContext';
import { OrcRail } from '../src/components/terminal/OrcRail';
import { useStore } from '../src/store/store';
import { makeOrc } from './fixtures';
import type { Orc } from '../src/types/domain';

function renderRail(props: Partial<React.ComponentProps<typeof OrcRail>> = {}) {
  const orcs: Orc[] = [
    makeOrc({ paneId: '%1', tmuxTarget: 'work:0.0', status: 'active' }),
    makeOrc({ paneId: '%2', tmuxTarget: 'infra:1.2', status: 'waiting' }),
  ];
  const orcsById: Record<string, Orc> = {};
  for (const o of orcs) orcsById[o.id] = o;
  const orderedIds = orcs.map((o) => o.id);
  const onSelect = vi.fn();
  const onToggleTarget = vi.fn();
  render(
    <AssetProvider assetBase="/pack">
      <OrcRail
        orderedIds={orderedIds}
        orcsById={orcsById}
        charKeyById={new Map(orderedIds.map((id) => [id, undefined]))}
        selectedOrcId={null}
        onSelect={onSelect}
        onToggleTarget={onToggleTarget}
        {...props}
      />
    </AssetProvider>,
  );
  return { onSelect, onToggleTarget };
}

beforeEach(() => useStore.getState().resetServer());

describe('OrcRail broadcast mode', () => {
  it('no checkboxes outside broadcast mode', () => {
    renderRail({ broadcastMode: false });
    expect(screen.queryByTestId('rail-check-pane:%1')).toBeNull();
  });

  it('checkbox is a separate hit target: toggling does NOT select (?orc= unchanged), AC-18 (i)', () => {
    const { onSelect, onToggleTarget } = renderRail({ broadcastMode: true, broadcastTargeted: new Set() });
    fireEvent.click(screen.getByTestId('rail-check-pane:%2'));
    expect(onToggleTarget).toHaveBeenCalledWith('pane:%2');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('clicking the item body still switches (onSelect), not toggle', () => {
    const { onSelect, onToggleTarget } = renderRail({ broadcastMode: true, broadcastTargeted: new Set() });
    fireEvent.click(screen.getByTestId('rail-item-pane:%1'));
    expect(onSelect).toHaveBeenCalledWith('pane:%1');
    expect(onToggleTarget).not.toHaveBeenCalled();
  });

  it('Space toggles the target, Enter switches (keyboard-complete, AC-18 vi)', () => {
    const { onSelect, onToggleTarget } = renderRail({ broadcastMode: true, broadcastTargeted: new Set() });
    const item = screen.getByTestId('rail-item-pane:%1');
    fireEvent.keyDown(item, { key: ' ' });
    expect(onToggleTarget).toHaveBeenCalledWith('pane:%1');
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(item, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('pane:%1');
  });

  it('selected and broadcastTargeted are independent, color-independent channels (AC-18 i)', () => {
    renderRail({ broadcastMode: true, selectedOrcId: 'pane:%1', broadcastTargeted: new Set(['pane:%1']) });
    const item = screen.getByTestId('rail-item-pane:%1');
    expect(item.getAttribute('aria-selected')).toBe('true'); // focus channel
    expect(item.getAttribute('data-broadcast-target')).toBe('true'); // membership channel (structural)
    expect((screen.getByTestId('rail-check-pane:%1') as HTMLInputElement).checked).toBe(true);
    expect(within(item).getByText(/in broadcast selection/i)).toBeTruthy(); // SR text
  });

  it('per-orc result hint renders color-independently (glyph + text + code)', () => {
    renderRail({
      broadcastMode: true,
      broadcastTargeted: new Set(['pane:%1', 'pane:%2']),
      resultById: new Map([
        ['pane:%1', { ok: true, errorCode: null }],
        ['pane:%2', { ok: false, errorCode: 'target_gone' }],
      ]),
    });
    expect(within(screen.getByTestId('rail-item-pane:%1')).getByText(/sent/)).toBeTruthy();
    expect(within(screen.getByTestId('rail-item-pane:%2')).getByText(/failed · target_gone/)).toBeTruthy();
  });
});

/**
 * SPEC-301 §3.1-11 — drag-and-drop to move an orc.
 *  - dragging past the threshold engages the drag visual (idle anim in the drag-start direction)
 *  - dropping commits a manual placement (store) and suppresses the trailing click (no select)
 *  - a tap (no movement) still selects
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { AssetProvider } from '../src/assets/AssetContext';
import { CampMap } from '../src/components/scene/CampMap';
import { useStore } from '../src/store/store';
import { __setClockDriverForTest } from '../src/scene/clock';
import { makeCamp, makeOrc, makeScan } from './fixtures';
import type { Orc } from '../src/types/domain';

let pump: ((t: number) => void) | null = null;
function setupClock(): void {
  pump = null;
  __setClockDriverForTest({ raf: (cb) => ((pump = cb), 1), caf: () => {} });
}

function seed(orcs: Orc[]): string {
  const camp = makeCamp({ sessionId: 's1', orcs });
  useStore.getState().applySnapshot({
    data: makeScan({ camps: [camp] }),
    snapshotVersion: 1,
    runtimeEpoch: 'e1',
    emittedAt: '2026-06-28T00:00:00.000Z',
    recentActivity: [],
  });
  return camp.id;
}

function renderMap(campId: string, onSelect: (id: string) => void): HTMLElement {
  return render(
    <AssetProvider assetBase="/pack">
      <CampMap campId={campId} selectedOrcId={null} onSelect={onSelect} onDeselect={() => {}} />
    </AssetProvider>,
  ).container;
}

const transformX = (el: HTMLElement): number => {
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform);
  return m ? Number(m[1]) : NaN;
};

beforeEach(() => {
  useStore.getState().resetServer();
  useStore.getState().setReducedMotion(false);
  useStore.setState((s) => ({ ui: { ...s.ui, orcPositions: {} } }));
});
afterEach(() => vi.unstubAllGlobals());

describe('§3.1-11 drag-and-drop move', () => {
  it('dragging an orc engages the drag visual, moves it, commits a placement, and does not select', () => {
    const onSelect = vi.fn();
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'w:0.0' })]);
    const c = renderMap(campId, onSelect);
    const orc = c.querySelector('button.oc-orc') as HTMLElement;
    const x0 = transformX(orc);

    fireEvent.pointerDown(orc, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(orc, { pointerId: 1, clientX: 240, clientY: 180 }); // +140,+80 (≫ threshold)

    // drag visual engaged (idle anim in the drag-start direction is driven by this state)
    expect(orc.classList.contains('oc-orc--dragging')).toBe(true);
    expect(orc.getAttribute('data-dragging')).toBe('true');
    // the orc follows the pointer (logical px == screen px at BASE_SCALE 1)
    expect(transformX(orc)).toBeCloseTo(x0 + 140, 0);

    fireEvent.pointerUp(orc, { pointerId: 1, clientX: 240, clientY: 180 });

    // drop committed a manual placement; drag visual cleared
    const placed = useStore.getState().ui.orcPositions['pane:%1'];
    expect(placed).toBeDefined();
    expect(orc.classList.contains('oc-orc--dragging')).toBe(false);

    // the trailing click after a drag must NOT select
    fireEvent.click(orc);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a tap (no movement past threshold) still selects and places nothing', () => {
    const onSelect = vi.fn();
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.0' })]);
    const c = renderMap(campId, onSelect);
    const orc = c.querySelector('button.oc-orc') as HTMLElement;

    fireEvent.pointerDown(orc, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(orc, { pointerId: 1, clientX: 102, clientY: 101 }); // < threshold → not a drag
    fireEvent.pointerUp(orc, { pointerId: 1, clientX: 102, clientY: 101 });
    fireEvent.click(orc);

    expect(orc.classList.contains('oc-orc--dragging')).toBe(false);
    expect(onSelect).toHaveBeenCalledWith('pane:%1');
    expect(useStore.getState().ui.orcPositions['pane:%1']).toBeUndefined();
  });

  it('a committed placement persists across a live snapshot refresh (orc stays where dropped)', () => {
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'w:0.0' })]);
    const c = renderMap(campId, () => {});
    const orc = c.querySelector('button.oc-orc') as HTMLElement;

    fireEvent.pointerDown(orc, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(orc, { pointerId: 1, clientX: 220, clientY: 220 });
    fireEvent.pointerUp(orc, { pointerId: 1, clientX: 220, clientY: 220 });
    const placed = useStore.getState().ui.orcPositions['pane:%1'];
    expect(placed).toBeDefined();

    // a new snapshot for the SAME orc must not wipe the placement (client UI state survives refresh)
    seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'waiting', tmuxTarget: 'w:0.0' })]);
    expect(useStore.getState().ui.orcPositions['pane:%1']).toEqual(placed);
  });

  it('holds its dropped position across clock ticks — no revert to pre-drag, no patrol/rest drift', () => {
    setupClock();
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'w:0.0' })]);
    const c = renderMap(campId, () => {});
    act(() => pump!(0));
    const orc = c.querySelector('button.oc-orc') as HTMLElement;

    fireEvent.pointerDown(orc, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(orc, { pointerId: 1, clientX: 300, clientY: 260 }); // drag far (+200,+160)
    fireEvent.pointerUp(orc, { pointerId: 1, clientX: 300, clientY: 260 });

    act(() => pump!(50)); // first post-drop tick settles the transform (pinned → exact drop)
    const settled = orc.style.transform;
    // advance the shared clock well past any patrol leg / rest period
    for (let t = 500; t <= 30000; t += 500) act(() => pump!(t));
    expect(orc.style.transform).toBe(settled); // identical every frame → no drift, no revert
  });

  it('prunes a placement when its orc disappears from the snapshot', () => {
    seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'w:0.0' })]);
    useStore.getState().setOrcPosition('pane:%1', { x: 500, y: 500 });
    expect(useStore.getState().ui.orcPositions['pane:%1']).toBeDefined();
    // a snapshot WITHOUT that orc → placement pruned
    seed([makeOrc({ paneId: '%2', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.1' })]);
    expect(useStore.getState().ui.orcPositions['pane:%1']).toBeUndefined();
  });
});

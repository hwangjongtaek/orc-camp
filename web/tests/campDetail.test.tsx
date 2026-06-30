/**
 * SPEC-201 §2.3/§2.4 — CampDetailView tabbed dock.
 *
 * The right-hand inspector column and the standalone activity rail are merged into ONE bottom
 * dock whose constituents are switchable tabs (Details / Preview / Activity). The map spans the
 * full row above the dock at every viewport width (no right column, no mobile bottom-sheet). The
 * full inspector content (raw tmuxTarget + control dock) is reachable in Details; the terminal
 * preview is reachable in Preview.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AssetProvider } from '../src/assets/AssetContext';
import { ServicesProvider, type AppServices } from '../src/app/services';
import { CampDetailView } from '../src/screens/CampDetailView';
import { useStore } from '../src/store/store';
import { setToken } from '../src/api/token';
import { __setClockDriverForTest } from '../src/scene/clock';
import { makeCamp, makeOrc, makeScan } from './fixtures';
import type { Orc } from '../src/types/domain';

const services: AppServices = {
  api: {} as never,
  engine: { refresh: vi.fn() } as never,
};

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

function renderDetail(campId: string, query = ''): HTMLElement {
  const { container } = render(
    <AssetProvider assetBase="/pack">
      <ServicesProvider services={services}>
        <MemoryRouter initialEntries={[`/camps/${campId}${query}`]}>
          <Routes>
            <Route path="/camps/:campId" element={<CampDetailView />} />
          </Routes>
        </MemoryRouter>
      </ServicesProvider>
    </AssetProvider>,
  );
  return container;
}

beforeEach(() => {
  useStore.getState().resetServer();
  useStore.getState().setReducedMotion(false);
  setToken('tok');
  // keep the shared clock quiet (no background rAF loop during the render-only test)
  __setClockDriverForTest({ raf: () => 1, caf: () => {} });
});
afterEach(() => vi.restoreAllMocks());

const orc = (): Orc =>
  makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'work:1.2', command: 'node' });

const tab = (container: HTMLElement, name: string): HTMLElement =>
  within(container).getByRole('tab', { name: new RegExp(name, 'i') });

describe('SPEC-201 §2.3 CampDetailView tabbed dock', () => {
  it('renders a single dock with Details / Preview / Activity tabs (no right column, no sheet)', () => {
    const campId = seed([orc()]);
    const container = renderDetail(campId, '?orc=pane:%1');

    const dock = container.querySelector('[data-testid="camp-dock"]') as HTMLElement;
    expect(dock).not.toBeNull();
    expect(within(dock).getByRole('tab', { name: /details/i })).toBeTruthy();
    expect(within(dock).getByRole('tab', { name: /preview/i })).toBeTruthy();
    expect(within(dock).getByRole('tab', { name: /activity/i })).toBeTruthy();
    // the old mobile bottom-sheet dialog is gone
    expect(container.querySelector('[data-testid="inspector-sheet"]')).toBeNull();
  });

  it('Details tab (default) shows the orc inspector (raw tmuxTarget); NO control dock here', () => {
    const campId = seed([orc()]);
    const container = renderDetail(campId, '?orc=pane:%1');

    const inspector = container.querySelector('.oc-inspector') as HTMLElement;
    expect(inspector).not.toBeNull();
    expect(within(inspector).getAllByText('work:1.2').length).toBeGreaterThan(0);
    // the control dock moved to the Preview tab → not in Details
    expect(within(inspector).queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('Preview tab exposes the terminal preview AND the control dock (both moved out of Details)', () => {
    const campId = seed([orc()]);
    const container = renderDetail(campId, '?orc=pane:%1');

    // neither preview nor control dock in Details
    expect(within(container).queryByText('Terminal preview')).toBeNull();
    expect(within(container).queryByRole('button', { name: 'Send' })).toBeNull();
    fireEvent.click(tab(container, 'preview'));
    // both reachable in the Preview tabpanel
    expect(within(container).getByText('Terminal preview')).toBeTruthy();
    expect(within(container).getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('Activity tab shows the recent-activity feed', () => {
    const campId = seed([orc()]);
    useStore.setState({
      activity: [{ id: 'a1', at: '2026-06-28T00:00:00.000Z', type: 'spawn', message: 'orc started' }],
    });
    const container = renderDetail(campId, '?orc=pane:%1');

    fireEvent.click(tab(container, 'activity'));
    expect(within(container).getByText('orc started')).toBeTruthy();
  });

  it('no selection → dock still present; Details shows an empty state', () => {
    const campId = seed([orc()]);
    const container = renderDetail(campId);
    expect(container.querySelector('[data-testid="camp-dock"]')).not.toBeNull();
    expect(within(container).getByText(/select an orc/i)).toBeTruthy();
  });
});

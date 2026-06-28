/**
 * SPEC-201 §3.8 (#45) — CampDetailView responsive inspector.
 *
 * Mobile (≤880px): a selected orc opens the inspector as a bottom-sheet dialog with the full
 * inspector content reachable (raw tmuxTarget + status + terminal preview + control dock).
 * Desktop: the inspector renders inline (no dialog). Dismissing the sheet clears ?orc.
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

function setViewport(isMobile: boolean): void {
  window.matchMedia = ((q: string) => ({
    matches: isMobile && q.includes('max-width'),
    media: q,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

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
afterEach(() => setViewport(false));

const orc = (): Orc =>
  makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'work:1.2', command: 'node' });

describe('SPEC-201 §3.8 #45 CampDetailView responsive inspector', () => {
  it('mobile + selected orc → bottom-sheet dialog with the full inspector reachable', () => {
    setViewport(true);
    const campId = seed([orc()]);
    const container = renderDetail(campId, '?orc=pane:%1');

    const sheet = container.querySelector('[data-testid="inspector-sheet"]') as HTMLElement;
    expect(sheet).not.toBeNull();
    expect(sheet.getAttribute('role')).toBe('dialog');
    const inSheet = within(sheet);
    // raw tmuxTarget + control dock + terminal preview are all reachable in the sheet
    expect(inSheet.getAllByText('work:1.2').length).toBeGreaterThan(0);
    expect(inSheet.getByText('Terminal preview')).toBeTruthy();
    expect(inSheet.getByRole('button', { name: 'Send' })).toBeTruthy();
    // the inspector lives inside the sheet (not inline)
    expect(sheet.querySelector('.oc-inspector')).not.toBeNull();
  });

  it('mobile + no selection → no sheet', () => {
    setViewport(true);
    const campId = seed([orc()]);
    const container = renderDetail(campId);
    expect(container.querySelector('[data-testid="inspector-sheet"]')).toBeNull();
  });

  it('mobile: closing the sheet clears the ?orc selection', () => {
    setViewport(true);
    const campId = seed([orc()]);
    const container = renderDetail(campId, '?orc=pane:%1');
    expect(container.querySelector('[data-testid="inspector-sheet"]')).not.toBeNull();
    fireEvent.click(container.querySelector('[aria-label="Close inspector"]')!);
    expect(container.querySelector('[data-testid="inspector-sheet"]')).toBeNull();
  });

  it('desktop → inline inspector, no dialog', () => {
    setViewport(false);
    const campId = seed([orc()]);
    const container = renderDetail(campId, '?orc=pane:%1');
    expect(container.querySelector('[data-testid="inspector-sheet"]')).toBeNull();
    const inspector = container.querySelector('.oc-inspector') as HTMLElement;
    expect(inspector).not.toBeNull();
    expect(within(inspector).getAllByText('work:1.2').length).toBeGreaterThan(0);
  });
});

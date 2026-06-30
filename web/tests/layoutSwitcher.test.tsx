/**
 * Camp-detail layout switcher — Full / 50:50 / 30:70.
 *
 * The switcher toggles `ui.layoutMode`, which <CampDetailView> reflects onto
 * `.oc-detail[data-layout]` (CSS turns 'split'/'dock' into a side-by-side map|dock grid). The
 * choice is persisted to localStorage. Default is 'full' (the original stacked layout).
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

const detail = (c: HTMLElement): HTMLElement => c.querySelector('.oc-detail') as HTMLElement;
const modeBtn = (c: HTMLElement, name: string): HTMLElement =>
  within(c.querySelector('[data-testid="layout-switcher"]') as HTMLElement).getByRole('button', {
    name: new RegExp(name, 'i'),
  });

beforeEach(() => {
  useStore.getState().resetServer();
  useStore.getState().setReducedMotion(false);
  useStore.getState().setLayoutMode('full');
  try {
    localStorage.clear();
  } catch {
    /* noop */
  }
  setToken('tok');
  __setClockDriverForTest({ raf: () => 1, caf: () => {} });
});
afterEach(() => vi.restoreAllMocks());

const orc = (): Orc =>
  makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'work:1.2', command: 'node' });

describe('Camp-detail layout switcher', () => {
  it('renders a 3-way segmented control (Full / 50:50 / 30:70)', () => {
    const container = renderDetail(seed([orc()]));
    const sw = container.querySelector('[data-testid="layout-switcher"]') as HTMLElement;
    expect(sw).not.toBeNull();
    expect(within(sw).getByRole('button', { name: /full/i })).toBeTruthy();
    expect(within(sw).getByRole('button', { name: /50 . 50/i })).toBeTruthy();
    expect(within(sw).getByRole('button', { name: /30 . 70/i })).toBeTruthy();
  });

  it('defaults to full mode (data-layout="full"; Full pressed)', () => {
    const container = renderDetail(seed([orc()]));
    expect(detail(container).getAttribute('data-layout')).toBe('full');
    expect(modeBtn(container, 'full').getAttribute('aria-pressed')).toBe('true');
    expect(modeBtn(container, '50 . 50').getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking 50/50 → data-layout="split", that button pressed, persisted', () => {
    const container = renderDetail(seed([orc()]));
    fireEvent.click(modeBtn(container, '50 . 50'));
    expect(detail(container).getAttribute('data-layout')).toBe('split');
    expect(modeBtn(container, '50 . 50').getAttribute('aria-pressed')).toBe('true');
    expect(modeBtn(container, 'full').getAttribute('aria-pressed')).toBe('false');
    expect(useStore.getState().ui.layoutMode).toBe('split');
    expect(localStorage.getItem('oc.layoutMode')).toBe('split');
  });

  it('clicking 30/70 → data-layout="dock"', () => {
    const container = renderDetail(seed([orc()]));
    fireEvent.click(modeBtn(container, '30 . 70'));
    expect(detail(container).getAttribute('data-layout')).toBe('dock');
    expect(modeBtn(container, '30 . 70').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('oc.layoutMode')).toBe('dock');
  });
});

/**
 * SPEC-203 §2.1 (AC-01/AC-03) — map ↔ terminal mode toggle in CampDetail. The LayoutModeSwitcher
 * gains a Map/Terminal control; switching to Terminal renders the workspace while preserving the
 * ?orc= selection and campId, and switching back returns to the map dock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AssetProvider } from '../src/assets/AssetContext';
import { ServicesProvider, type AppServices } from '../src/app/services';
import { CampDetailView } from '../src/screens/CampDetailView';
import { LiveViewController } from '../src/realtime/liveView';
import { useStore } from '../src/store/store';
import { setToken } from '../src/api/token';
import { __setClockDriverForTest } from '../src/scene/clock';
import { makeCamp, makeOrc, makeScan } from './fixtures';
import type { SettingsResponse } from '../src/types/api';

function settings(): SettingsResponse {
  return {
    configVersion: 1,
    scanInterval: 3000,
    preview: { exposureEnabled: true, lineCount: 12 },
    redactionEnabled: true,
    browserAutoOpen: false,
    bounds: { scanInterval: { min: 1000, max: 10000 }, previewLineCount: { min: 1, max: 12 } },
  };
}

const services: AppServices = {
  api: {} as never,
  engine: { liveView: new LiveViewController(() => {}), refresh: vi.fn() } as never,
};

function seed(): string {
  const camp = makeCamp({
    sessionId: 's1',
    orcs: [makeOrc({ paneId: '%1', tmuxTarget: 'work:1.2', status: 'active' })],
  });
  useStore.getState().applySnapshot({
    data: makeScan({ camps: [camp] }),
    snapshotVersion: 1,
    runtimeEpoch: 'e1',
    emittedAt: '2026-07-02T00:00:00.000Z',
    recentActivity: [],
  });
  useStore.getState().setSettings(settings());
  useStore.getState().setWsStatus('open');
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
  useStore.getState().setWorkspaceMode('map');
  setToken('tok');
  __setClockDriverForTest({ raf: () => 1, caf: () => {} });
});
afterEach(() => vi.restoreAllMocks());

describe('CampDetail map ↔ terminal (AC-01/AC-03)', () => {
  it('defaults to map mode (workspace switcher present, terminal workspace absent)', () => {
    const container = renderDetail(seed(), '?orc=pane:%1');
    const sw = container.querySelector('[data-testid="workspace-switcher"]') as HTMLElement;
    expect(within(sw).getByRole('button', { name: /map/i }).getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="terminal-workspace"]')).toBeNull();
    expect(container.querySelector('[data-testid="camp-dock"]')).not.toBeNull();
  });

  it('switching to Terminal renders the workspace and preserves ?orc= selection', () => {
    const container = renderDetail(seed(), '?orc=pane:%1');
    const sw = container.querySelector('[data-testid="workspace-switcher"]') as HTMLElement;
    fireEvent.click(within(sw).getByRole('button', { name: /terminal/i }));

    expect(container.querySelector('[data-testid="terminal-workspace"]')).not.toBeNull();
    // selection preserved: the rail item for the selected orc is rendered
    expect(screen.getByTestId('rail-item-pane:%1')).toBeTruthy();
    // map dock gone in terminal mode
    expect(container.querySelector('[data-testid="camp-dock"]')).toBeNull();
    expect(useStore.getState().ui.workspaceMode).toBe('terminal');
  });

  it('switching back to Map restores the map dock', () => {
    const container = renderDetail(seed(), '?orc=pane:%1');
    const sw = () => container.querySelector('[data-testid="workspace-switcher"]') as HTMLElement;
    fireEvent.click(within(sw()).getByRole('button', { name: /terminal/i }));
    fireEvent.click(within(sw()).getByRole('button', { name: /map/i }));
    expect(container.querySelector('[data-testid="terminal-workspace"]')).toBeNull();
    expect(container.querySelector('[data-testid="camp-dock"]')).not.toBeNull();
  });
});

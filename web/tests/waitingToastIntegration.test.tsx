/**
 * SPEC-203 §2.9 (AC-17) — waiting-transition toast, end to end through the store + Terminal
 * Workspace: a non-selected orc flipping active→waiting raises a clickable "View" toast that
 * selects it (→ ?orc=); the currently-viewed orc is excluded; no spurious toast on entry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { AssetProvider } from '../src/assets/AssetContext';
import { ServicesProvider, type AppServices } from '../src/app/services';
import { TerminalWorkspace } from '../src/components/terminal/TerminalWorkspace';
import { Toasts } from '../src/components/toast/Toasts';
import { LiveViewController } from '../src/realtime/liveView';
import { useStore } from '../src/store/store';
import { setToken } from '../src/api/token';
import { makeCamp, makeOrc, makeScan } from './fixtures';
import type { OrcStatus } from '../src/types/domain';
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

function snapshot(version: number, statuses: { p1: OrcStatus; p2: OrcStatus }): void {
  const camp = makeCamp({
    sessionId: 's1',
    orcs: [
      makeOrc({ paneId: '%1', tmuxTarget: 'work:0.0', status: statuses.p1 }),
      makeOrc({ paneId: '%2', tmuxTarget: 'infra:1.2', status: statuses.p2 }),
    ],
  });
  useStore.getState().applySnapshot({
    data: makeScan({ camps: [camp] }),
    snapshotVersion: version,
    runtimeEpoch: 'e1',
    emittedAt: '2026-07-03T00:00:00.000Z',
    recentActivity: [],
  });
}

function makeServices(): AppServices {
  const engine = { liveView: new LiveViewController(() => {}), refresh: vi.fn() };
  return { api: {} as never, engine: engine as never };
}

function renderWorkspace(selectedOrcId: string, onSelectOrc = vi.fn()) {
  render(
    <AssetProvider assetBase="/pack">
      <ServicesProvider services={makeServices()}>
        <TerminalWorkspace campId="session:s1" selectedOrcId={selectedOrcId} onSelectOrc={onSelectOrc} />
        <Toasts />
      </ServicesProvider>
    </AssetProvider>,
  );
  return { onSelectOrc };
}

beforeEach(() => {
  useStore.getState().resetServer();
  useStore.getState().setReducedMotion(false);
  useStore.setState({ toasts: [] });
  setToken('tok');
  useStore.getState().setSettings(settings());
  useStore.getState().setWsStatus('open');
});

describe('waiting-transition toast (AC-17)', () => {
  it('non-selected orc active→waiting raises a "View" toast that selects it', () => {
    snapshot(1, { p1: 'active', p2: 'active' });
    const { onSelectOrc } = renderWorkspace('pane:%1');
    // no toast just from mounting on an all-active camp
    expect(screen.queryByText(/waiting for input/i)).toBeNull();

    act(() => snapshot(2, { p1: 'active', p2: 'waiting' }));
    expect(screen.getByText('infra:1.2 is waiting for input')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(onSelectOrc).toHaveBeenCalledWith('pane:%2');
    // toast auto-dismisses after the action
    expect(screen.queryByText(/waiting for input/i)).toBeNull();
  });

  it('the currently-viewed orc flipping to waiting does NOT toast', () => {
    snapshot(1, { p1: 'active', p2: 'active' });
    renderWorkspace('pane:%2'); // viewing %2
    act(() => snapshot(2, { p1: 'active', p2: 'waiting' }));
    expect(screen.queryByText(/waiting for input/i)).toBeNull();
  });

  it('an orc already waiting on entry does not retroactively toast', () => {
    snapshot(1, { p1: 'active', p2: 'waiting' });
    renderWorkspace('pane:%1');
    expect(screen.queryByText(/waiting for input/i)).toBeNull();
  });
});

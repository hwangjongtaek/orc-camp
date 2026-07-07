/**
 * SPEC-203 (AC-01/AC-04/AC-07/AC-10) + SPEC-401 client — Terminal Workspace integration:
 * 5-region layout, orc switching (rail/quick-switch/digit/[ ]), arm→Control, armed named-key
 * egress carries the passthrough marker, C-c routes to the interrupt confirm (not raw passthrough),
 * exposure-off gates the viewport and blocks arm.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { AssetProvider } from '../src/assets/AssetContext';
import { ServicesProvider, type AppServices } from '../src/app/services';
import { TerminalWorkspace } from '../src/components/terminal/TerminalWorkspace';
import { LiveViewController } from '../src/realtime/liveView';
import { useStore } from '../src/store/store';
import { setToken } from '../src/api/token';
import { makeCamp, makeOrc, makeScan } from './fixtures';
import type { SettingsResponse } from '../src/types/api';

function settings(exposureEnabled = true): SettingsResponse {
  return {
    configVersion: 1,
    scanInterval: 3000,
    preview: { exposureEnabled, lineCount: 12 },
    redactionEnabled: true,
    browserAutoOpen: false,
    liveViewBridge: false,
    bounds: { scanInterval: { min: 1000, max: 10000 }, previewLineCount: { min: 1, max: 12 } },
  };
}

function seedStore(exposure = true): void {
  const camp = makeCamp({
    sessionId: 's1',
    orcs: [
      makeOrc({ paneId: '%1', tmuxTarget: 'work:0.0', status: 'active', currentWorkSummary: 'building api' }),
      makeOrc({ paneId: '%2', tmuxTarget: 'infra:1.2', status: 'waiting', currentWorkSummary: 'needs input' }),
    ],
  });
  useStore.getState().applySnapshot({
    data: makeScan({ camps: [camp] }),
    snapshotVersion: 1,
    runtimeEpoch: 'e1',
    emittedAt: '2026-07-02T00:00:00.000Z',
    recentActivity: [],
  });
  useStore.getState().setSettings(settings(exposure));
  useStore.getState().setWsStatus('open');
}

interface FakeApi {
  armPassthrough: ReturnType<typeof vi.fn>;
  disarmPassthrough: ReturnType<typeof vi.fn>;
  sendInput: ReturnType<typeof vi.fn>;
  sendKey: ReturnType<typeof vi.fn>;
  sendInterrupt: ReturnType<typeof vi.fn>;
}

function makeServices(): { services: AppServices; api: FakeApi } {
  const api: FakeApi = {
    armPassthrough: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      etag: null,
      data: { ok: true, armSessionId: 'as1', armedAt: 't', idleTimeoutMs: 240000 },
    }),
    disarmPassthrough: vi.fn().mockResolvedValue({ ok: true, status: 200, etag: null, data: { ok: true, auditEventId: 'a1' } }),
    sendInput: vi.fn().mockResolvedValue({ ok: true, status: 200, etag: null, data: {} }),
    sendKey: vi.fn().mockResolvedValue({ ok: true, status: 200, etag: null, data: {} }),
    sendInterrupt: vi.fn().mockResolvedValue({ ok: true, status: 200, etag: null, data: { action: 'interrupt', outcome: 'success' } }),
  };
  const engine = { liveView: new LiveViewController(() => {}), refresh: vi.fn() };
  return { services: { api: api as never, engine: engine as never }, api };
}

function renderWs(selectedOrcId: string | null, onSelectOrc = vi.fn()) {
  const { services, api } = makeServices();
  render(
    <AssetProvider assetBase="/pack">
      <ServicesProvider services={services}>
        <TerminalWorkspace campId="session:s1" selectedOrcId={selectedOrcId} onSelectOrc={onSelectOrc} />
      </ServicesProvider>
    </AssetProvider>,
  );
  return { api, onSelectOrc };
}

beforeEach(() => {
  useStore.getState().resetServer();
  useStore.getState().setReducedMotion(false);
  setToken('tok');
  useStore.setState({ toasts: [] });
  seedStore(true);
});

describe('layout + switching (AC-01/AC-04)', () => {
  it('renders the 5 regions (rail, viewport, status bar, composed input, legend)', () => {
    renderWs('pane:%1');
    expect(screen.getByTestId('terminal-workspace')).toBeTruthy();
    expect(screen.getByTestId('rail-item-pane:%1')).toBeTruthy();
    expect(screen.getByTestId('terminal-viewport')).toBeTruthy();
    expect(screen.getByTestId('terminal-statusbar')).toBeTruthy();
    expect(screen.getByTestId('composed-input')).toBeTruthy();
    expect(screen.getByLabelText('Keyboard shortcuts')).toBeTruthy();
  });

  it('S1: rail click → onSelectOrc(id)', () => {
    const { onSelectOrc } = renderWs('pane:%1');
    fireEvent.click(screen.getByTestId('rail-item-pane:%1'));
    expect(onSelectOrc).toHaveBeenCalledWith('pane:%1');
  });

  it('S3: Alt+1 jumps to the first RAIL item (waiting pinned first)', () => {
    const { onSelectOrc } = renderWs('pane:%1');
    fireEvent.keyDown(document.body, { key: '1', altKey: true });
    // rail order pins waiting %2 first → Alt+1 = pane:%2
    expect(onSelectOrc).toHaveBeenCalledWith('pane:%2');
  });

  it('S2: "]" selects the next orc in rail order (observe)', () => {
    const { onSelectOrc } = renderWs('pane:%2'); // rail order: [%2, %1]
    fireEvent.keyDown(document.body, { key: ']' });
    expect(onSelectOrc).toHaveBeenCalledWith('pane:%1');
  });

  it('S4: ⌘/Ctrl+K opens the quick switcher and filters by target', async () => {
    const { onSelectOrc } = renderWs('pane:%1');
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: /switch orc/i });
    fireEvent.change(within(dialog).getByLabelText('Search orcs'), { target: { value: 'infra' } });
    const opt = within(dialog).getByRole('option');
    fireEvent.click(opt);
    expect(onSelectOrc).toHaveBeenCalledWith('pane:%2');
  });
});

describe('Observe/Control arm + armed egress (SPEC-401)', () => {
  it('Take control → arm call → Control mode; armed named key egresses with passthrough marker', async () => {
    const { api } = renderWs('pane:%1');
    fireEvent.click(screen.getByTestId('arm-btn'));
    await waitFor(() => expect(api.armPassthrough).toHaveBeenCalledWith('pane:%1', expect.any(Object)));
    // now in Control — release button present
    await screen.findByTestId('disarm-btn');
    fireEvent.keyDown(screen.getByTestId('terminal-viewport'), { key: 'Enter' });
    await waitFor(() =>
      expect(api.sendKey).toHaveBeenCalledWith(
        'pane:%1',
        expect.objectContaining({ key: 'Enter', passthrough: { armSessionId: 'as1' } }),
      ),
    );
  });

  it('armed C-c → interrupt confirm modal → /interrupt {confirmed:true} (NOT raw passthrough, AC-07)', async () => {
    const { api } = renderWs('pane:%1');
    fireEvent.click(screen.getByTestId('arm-btn'));
    await screen.findByTestId('disarm-btn');
    fireEvent.keyDown(screen.getByTestId('terminal-viewport'), { key: 'c', ctrlKey: true });
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Interrupt' }));
    await waitFor(() =>
      expect(api.sendInterrupt).toHaveBeenCalledWith('pane:%1', expect.objectContaining({ confirmed: true })),
    );
    // interrupt is NOT sent through the passthrough egress
    expect(api.sendInterrupt.mock.calls[0]![1]).not.toHaveProperty('passthrough');
    expect(api.sendKey).not.toHaveBeenCalled();
  });
});

describe('exposure gate (AC-10/AC-14)', () => {
  it('exposure off → viewport gated + arm disabled with reason', () => {
    useStore.getState().setSettings(settings(false));
    renderWs('pane:%1');
    expect(screen.getByText(/terminal hidden/i)).toBeTruthy();
    expect((screen.getByTestId('arm-btn') as HTMLButtonElement).disabled).toBe(true);
  });
});

/**
 * SPEC-203 §2.10 / AC-18 (ii–iv) + SPEC-402 client (AC-01/02/05/08) — broadcast end to end through
 * the Terminal Workspace: enter selection mode → pick targets → single confirm listing every target
 * → one POST /api/camps/:campId/broadcast with confirmed:true + targets[{orcId,expected}] → per-orc
 * results aggregated onto the rail + severity-matched summary toast. Covers: no request before
 * confirm, partial-failure transparency + retry, and the waiting-toast "broadcast to all waiting".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, act, waitFor } from '@testing-library/react';
import { AssetProvider } from '../src/assets/AssetContext';
import { ServicesProvider, type AppServices } from '../src/app/services';
import { TerminalWorkspace } from '../src/components/terminal/TerminalWorkspace';
import { Toasts } from '../src/components/toast/Toasts';
import { LiveViewController } from '../src/realtime/liveView';
import { useStore } from '../src/store/store';
import { setToken } from '../src/api/token';
import { makeCamp, makeOrc, makeScan } from './fixtures';
import type { OrcStatus } from '../src/types/domain';
import type { BroadcastResult, SettingsResponse } from '../src/types/api';

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
      makeOrc({ paneId: '%1', tmuxTarget: 'work:0.0', command: 'claude', status: statuses.p1 }),
      makeOrc({ paneId: '%2', tmuxTarget: 'infra:1.2', command: 'codex', status: statuses.p2 }),
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

function okResult(over: Partial<BroadcastResult> = {}): BroadcastResult {
  return {
    ok: true,
    campId: 'session:s1',
    targetCount: 2,
    successCount: 2,
    failureCount: 0,
    results: [
      { orcId: 'pane:%1', paneId: '%1', ok: true, outcome: 'success', errorCode: null, auditEventId: 'a1' },
      { orcId: 'pane:%2', paneId: '%2', ok: true, outcome: 'success', errorCode: null, auditEventId: 'a2' },
    ],
    batchAuditEventId: 'b1',
    requestId: null,
    ...over,
  };
}

function makeServices(broadcastImpl?: ReturnType<typeof vi.fn>) {
  const broadcastCamp = broadcastImpl ?? vi.fn().mockResolvedValue({ ok: true, status: 200, etag: null, data: okResult() });
  const api = { broadcastCamp } as unknown as AppServices['api'];
  const engine = { liveView: new LiveViewController(() => {}), refresh: vi.fn() } as unknown as AppServices['engine'];
  return { services: { api, engine }, broadcastCamp };
}

function renderWs(services: AppServices, selectedOrcId: string | null = 'pane:%1', onSelectOrc = vi.fn()) {
  render(
    <AssetProvider assetBase="/pack">
      <ServicesProvider services={services}>
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
  snapshot(1, { p1: 'active', p2: 'waiting' });
});

describe('broadcast flow (AC-18 ii/iii, SPEC-402 AC-01/02/08)', () => {
  it('select 2 → single confirm lists all targets → one broadcast POST with confirmed:true', async () => {
    const { services, broadcastCamp } = makeServices();
    renderWs(services);

    fireEvent.click(screen.getByTestId('broadcast-enter'));
    fireEvent.click(screen.getByTestId('rail-check-pane:%1'));
    fireEvent.click(screen.getByTestId('rail-check-pane:%2'));
    expect(screen.getByTestId('broadcast-count').textContent).toMatch(/2 selected/);

    fireEvent.click(screen.getByTestId('broadcast-open'));
    const dialog = await screen.findByRole('dialog');
    // every target listed with tmuxTarget + paneId + running-cmd
    expect(within(dialog).getByTestId('broadcast-row-pane:%1')).toBeTruthy();
    expect(within(dialog).getByTestId('broadcast-row-pane:%2')).toBeTruthy();
    expect(within(dialog).getByText('work:0.0')).toBeTruthy();
    expect(within(dialog).getByText('infra:1.2')).toBeTruthy();
    // no request yet — nothing goes out before confirm
    expect(broadcastCamp).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByTestId('broadcast-input'), { target: { value: 'ship it' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Broadcast to 2$/ }));

    await waitFor(() => expect(broadcastCamp).toHaveBeenCalledTimes(1));
    const [campId, body] = broadcastCamp.mock.calls[0]!;
    expect(campId).toBe('session:s1');
    expect(body.confirmed).toBe(true);
    expect(body.input).toEqual({ text: 'ship it', submit: true });
    // order is rail order (waiting-pinned); assert membership + each target's re-validation tuple
    const targetsById = new Map(body.targets.map((t: { orcId: string; expected: unknown }) => [t.orcId, t.expected]));
    expect([...targetsById.keys()].sort()).toEqual(['pane:%1', 'pane:%2']);
    expect(targetsById.get('pane:%1')).toMatchObject({ paneId: '%1', tmuxTarget: 'work:0.0', command: 'claude' });
    expect(targetsById.get('pane:%2')).toMatchObject({ paneId: '%2', tmuxTarget: 'infra:1.2', command: 'codex' });
  });

  it('confirm initial focus is Cancel (destructive fan-out safety, AC-18 ii)', async () => {
    renderWs(makeServices().services);
    fireEvent.click(screen.getByTestId('broadcast-enter'));
    fireEvent.click(screen.getByTestId('rail-check-pane:%1'));
    fireEvent.click(screen.getByTestId('rail-check-pane:%2'));
    fireEvent.click(screen.getByTestId('broadcast-open'));
    const dialog = await screen.findByRole('dialog');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
  });

  it('partial failure is transparent: per-orc rail hints + warn toast + retry', async () => {
    const impl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      etag: null,
      data: okResult({
        successCount: 1,
        failureCount: 1,
        results: [
          { orcId: 'pane:%1', paneId: '%1', ok: true, outcome: 'success', errorCode: null, auditEventId: 'a1' },
          { orcId: 'pane:%2', paneId: '%2', ok: false, outcome: null, errorCode: 'target_gone', auditEventId: 'a2' },
        ],
      }),
    });
    const { services } = makeServices(impl);
    renderWs(services);

    fireEvent.click(screen.getByTestId('broadcast-enter'));
    fireEvent.click(screen.getByTestId('rail-check-pane:%1'));
    fireEvent.click(screen.getByTestId('rail-check-pane:%2'));
    fireEvent.click(screen.getByTestId('broadcast-open'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByTestId('broadcast-input'), { target: { value: 'go' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Broadcast to 2$/ }));

    await waitFor(() => expect(impl).toHaveBeenCalled());
    // per-orc rail result hints (success + failure both shown transparently)
    expect(within(screen.getByTestId('rail-item-pane:%1')).getByText(/sent/)).toBeTruthy();
    expect(within(screen.getByTestId('rail-item-pane:%2')).getByText(/failed · target_gone/)).toBeTruthy();
    // warn summary toast (some failed) + a Retry affordance
    expect(screen.getByText(/1 sent, 1 failed/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry 1 failed/i })).toBeTruthy();
  });
});

describe('waiting-toast "Broadcast to all waiting" (AC-18 iv)', () => {
  it('≥2 waiting → secondary action opens the broadcast confirm pre-selected, ?orc= unchanged', async () => {
    const { onSelectOrc } = renderWs(makeServices().services, 'pane:%1');
    act(() => snapshot(2, { p1: 'active', p2: 'active' })); // reset baseline to all-active
    // both flip to waiting → %2's active→waiting edge fires (non-selected); waiting set = {%1,%2}
    act(() => snapshot(3, { p1: 'waiting', p2: 'waiting' }));

    const broadcastAction = await screen.findByRole('button', { name: /Broadcast to 2 waiting/i });
    fireEvent.click(broadcastAction);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('broadcast-row-pane:%1')).toBeTruthy();
    expect(within(dialog).getByTestId('broadcast-row-pane:%2')).toBeTruthy();
    // pre-select seeds the target set only — it must NOT change the switch selection
    expect(onSelectOrc).not.toHaveBeenCalled();

    // AC-18 (v): the launching toast auto-dismissed, so focus returns deterministically to the
    // broadcast toolbar (never silently to <body>).
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('broadcast-toolbar').contains(document.activeElement)).toBe(true);
  });

  it('a single waiting orc gets NO broadcast affordance (mass action only)', async () => {
    renderWs(makeServices().services, 'pane:%1');
    act(() => snapshot(2, { p1: 'active', p2: 'active' })); // baseline all-active
    act(() => snapshot(3, { p1: 'active', p2: 'waiting' })); // only %2 edges → 1 waiting total
    // the primary "View" nudge still fires…
    expect(await screen.findByRole('button', { name: 'View' })).toBeTruthy();
    // …but no mass "broadcast to all waiting" affordance for a single waiting orc
    expect(screen.queryByRole('button', { name: /Broadcast to .* waiting/i })).toBeNull();
  });
});

/**
 * SPEC-104 §2.7 / SPEC-500 (consumer) — the SettingsView "Low-latency bridge" toggle.
 * It reflects `liveViewBridge` and PATCHes the key. Also asserts the read-only /
 * auto-fallback / next-attach copy is present (D-052 privacy + UX contract).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ServicesProvider, type AppServices } from '../src/app/services';
import { SettingsView } from '../src/screens/SettingsView';
import { useStore } from '../src/store/store';
import type { SettingsResponse } from '../src/types/api';

function makeSettings(over: Partial<SettingsResponse> = {}): SettingsResponse {
  return {
    configVersion: 1,
    scanInterval: 3,
    preview: { exposureEnabled: true, lineCount: 12 },
    redactionEnabled: true,
    browserAutoOpen: true,
    liveViewBridge: false,
    bounds: { scanInterval: { min: 1, max: 5 }, previewLineCount: { min: 1, max: 12 } },
    ...over,
  };
}

function renderView(patchSettings: AppServices['api']['patchSettings']): void {
  const services = { api: { patchSettings, getSettings: vi.fn() } as never, engine: {} as never };
  render(
    <ServicesProvider services={services}>
      <SettingsView />
    </ServicesProvider>,
  );
}

beforeEach(() => {
  useStore.getState().setSettings(makeSettings());
});

describe('SettingsView — Low-latency bridge toggle (SPEC-104 §2.7 / D-052)', () => {
  it('renders the toggle unchecked with read-only / fallback / next-attach copy', () => {
    renderView(vi.fn());
    const cb = screen.getByLabelText(/Low-latency bridge/i) as HTMLInputElement;
    expect(cb.checked).toBe(false);
    expect(screen.getByText(/Read-only observation only/i)).toBeTruthy();
    expect(screen.getByText(/falls back to polling/i)).toBeTruthy();
    expect(screen.getByText(/next live-view attach/i)).toBeTruthy();
  });

  it('checking it PATCHes { liveViewBridge: true } and syncs the returned state', async () => {
    const patchSettings = vi.fn().mockResolvedValue({ ok: true, status: 200, data: makeSettings({ liveViewBridge: true }), etag: null });
    renderView(patchSettings);
    fireEvent.click(screen.getByLabelText(/Low-latency bridge/i));
    expect(patchSettings).toHaveBeenCalledWith({ liveViewBridge: true });
    await waitFor(() => {
      const cb = screen.getByLabelText(/Low-latency bridge/i) as HTMLInputElement;
      expect(cb.checked).toBe(true);
    });
  });
});

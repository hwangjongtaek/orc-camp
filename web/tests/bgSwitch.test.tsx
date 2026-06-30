/**
 * SPEC-201 §2.3 / SPEC-301 §2.1a — detail-panel background switcher.
 *
 * When the manifest declares ≥2 image-ground backgrounds, the detail panel shows a switcher;
 * choosing one swaps BOTH the rendered backdrop image AND the world (each background carries its
 * own logical_size + ground). With <2 it renders nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, within, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AssetProvider } from '../src/assets/AssetContext';
import { ServicesProvider, type AppServices } from '../src/app/services';
import { CampDetailView } from '../src/screens/CampDetailView';
import { useStore } from '../src/store/store';
import { setToken } from '../src/api/token';
import { __setClockDriverForTest } from '../src/scene/clock';
import { makeCamp, makeOrc, makeScan } from './fixtures';
import type { AssetManifest } from '../src/assets/manifest';
import type { Orc } from '../src/types/domain';

const GROUND = { polygon: [[100, 100], [900, 100], [900, 500], [100, 500]] as [number, number][], area: 320000, ratio: 0.3 };

function twoGroundManifest(): AssetManifest {
  return {
    characters: {},
    backgrounds: {
      'camp-a': { display_name: 'Camp A', file: 'backgrounds/a.webp', logical_size: [1000, 600], safe_area: [200, 200, 600, 200], ground: GROUND },
      'camp-b': { display_name: 'Camp B', file: 'backgrounds/b.webp', logical_size: [1200, 700], safe_area: [250, 250, 700, 200], ground: GROUND },
    },
    scene: { backdrop: { background_ref: 'camp-a' } },
  };
}

const services: AppServices = { api: {} as never, engine: { refresh: vi.fn() } as never };

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
  useStore.getState().setBackgroundRef(null);
  setToken('tok');
  __setClockDriverForTest({ raf: () => 1, caf: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

const orc = (): Orc => makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'w:0.0' });

describe('SPEC-201 §2.3 background switcher', () => {
  it('lists ≥2 image-ground backgrounds and swaps the backdrop + world on change', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => twoGroundManifest() }) as unknown as Response));
    const campId = seed([orc()]);
    const container = renderDetail(campId, '?orc=pane:%1');

    const sw = (await waitFor(() => {
      const el = container.querySelector('[data-testid="bg-switcher"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    }));
    const select = within(sw).getByRole('combobox') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['camp-a', 'camp-b']);
    expect(select.value).toBe('camp-a'); // scene default

    const backdrop = () => container.querySelector('[data-testid="map-backdrop"]') as HTMLElement;
    const world = () => container.querySelector('.oc-map__world') as HTMLElement;
    expect(backdrop().style.backgroundImage).toContain('/pack/backgrounds/a.webp');
    expect(parseFloat(world().style.width)).toBeCloseTo(1000, 0); // camp-a logical_size.w

    // switch → camp-b: backdrop image + world both change
    fireEvent.change(select, { target: { value: 'camp-b' } });
    expect(useStore.getState().ui.backgroundRef).toBe('camp-b');
    expect(backdrop().style.backgroundImage).toContain('/pack/backgrounds/b.webp');
    expect(parseFloat(world().style.width)).toBeCloseTo(1200, 0); // camp-b logical_size.w
  });

  it('renders no switcher when fewer than two image-ground backgrounds exist', async () => {
    const oneBg: AssetManifest = {
      characters: {},
      backgrounds: { 'camp-a': { display_name: 'Camp A', file: 'backgrounds/a.webp', logical_size: [1000, 600], ground: GROUND } },
      scene: { backdrop: { background_ref: 'camp-a' } },
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => oneBg }) as unknown as Response));
    const campId = seed([orc()]);
    const container = renderDetail(campId, '?orc=pane:%1');
    // backdrop appears (manifest loaded) but no switcher (only 1 ground)
    await waitFor(() => expect(container.querySelector('[data-testid="map-backdrop"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="bg-switcher"]')).toBeNull();
  });
});

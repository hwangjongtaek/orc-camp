/**
 * SPEC-301 §2.6c (#51) — game-style selection marker + click-empty-space-to-deselect.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { AssetProvider } from '../src/assets/AssetContext';
import { CampMap } from '../src/components/scene/CampMap';
import { useStore } from '../src/store/store';
import type { AssetManifest } from '../src/assets/manifest';
import { makeCamp, makeOrc, makeScan } from './fixtures';
import type { Orc } from '../src/types/domain';

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

function renderMap(
  campId: string,
  selectedOrcId: string | null,
  onSelect: (id: string) => void,
  onDeselect: () => void,
): HTMLElement {
  return render(
    <AssetProvider assetBase="/pack">
      <CampMap
        campId={campId}
        selectedOrcId={selectedOrcId}
        onSelect={onSelect}
        onDeselect={onDeselect}
      />
    </AssetProvider>,
  ).container;
}

beforeEach(() => {
  useStore.getState().resetServer();
  useStore.getState().setReducedMotion(false);
});
afterEach(() => vi.unstubAllGlobals());

describe('#51 selection marker', () => {
  it('shows a marker on the selected orc (CSS reticle fallback without assets) and none otherwise', () => {
    const orcs = [
      makeOrc({ paneId: '%1', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.0' }),
      makeOrc({ paneId: '%2', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.1' }),
    ];
    const campId = seed(orcs);
    const c = renderMap(campId, 'pane:%1', () => {}, () => {});
    const selected = c.querySelector('button.oc-orc--selected') as HTMLElement;
    expect(selected).not.toBeNull();
    expect(selected.querySelector('[data-testid="orc-select-marker"]')).not.toBeNull();
    // the non-selected orc has no marker
    const others = [...c.querySelectorAll('button.oc-orc')].filter((b) => b !== selected);
    for (const o of others) expect(o.querySelector('[data-testid="orc-select-marker"]')).toBeNull();
  });

  it('uses the pixellab `selected-orc` image when the manifest ships it', async () => {
    const manifest: AssetManifest = {
      characters: {},
      ui: {
        selection_markers: {
          root: 'ui/selection-markers',
          size: [64, 64],
          items: { 'selected-orc': { file: 'selected-orc.png' } },
        },
      },
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => manifest }) as unknown as Response));
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.0' })]);
    const c = renderMap(campId, 'pane:%1', () => {}, () => {});
    await waitFor(() => {
      const marker = c.querySelector('[data-testid="orc-select-marker"]');
      expect(marker?.tagName).toBe('IMG');
      expect(marker?.getAttribute('src')).toBe('/pack/ui/selection-markers/selected-orc.png');
    });
  });
});

describe('#51 click-to-deselect', () => {
  it('clicking empty map space calls onDeselect', () => {
    const onDeselect = vi.fn();
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.0' })]);
    const c = renderMap(campId, 'pane:%1', () => {}, onDeselect);
    const scroll = c.querySelector('.oc-map__scroll') as HTMLElement;
    fireEvent.click(scroll); // target is the background, not an orc
    expect(onDeselect).toHaveBeenCalledTimes(1);
  });

  it('clicking an orc selects it and does NOT deselect', () => {
    const onSelect = vi.fn();
    const onDeselect = vi.fn();
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.0' })]);
    const c = renderMap(campId, null, onSelect, onDeselect);
    const orc = c.querySelector('button.oc-orc') as HTMLElement;
    fireEvent.click(orc);
    expect(onSelect).toHaveBeenCalledWith('pane:%1');
    expect(onDeselect).not.toHaveBeenCalled();
  });
});

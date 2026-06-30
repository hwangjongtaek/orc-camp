/**
 * SPEC-303 (Phase 1) — epic monster renders on the image-ground map as a NON-interactive layer,
 * status-gated (planned ⇒ not rendered) and never intercepting clicks/keyboard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AssetProvider } from '../src/assets/AssetContext';
import { ServicesProvider, type AppServices } from '../src/app/services';
import { CampDetailView } from '../src/screens/CampDetailView';
import { useStore } from '../src/store/store';
import { setToken } from '../src/api/token';
import { __setClockDriverForTest } from '../src/scene/clock';
import { makeCamp, makeOrc, makeScan } from './fixtures';
import type { AssetManifest, MonsterDef } from '../src/assets/manifest';
import type { Orc } from '../src/types/domain';

const GROUND = { polygon: [[100, 100], [900, 100], [900, 500], [100, 500]] as [number, number][], area: 320000, ratio: 0.3 };

function monsterDef(over: Partial<MonsterDef> = {}): MonsterDef {
  return {
    display_name: 'Test Behemoth',
    status: 'available',
    pixellab_character_id: 'cid-123',
    background: 'camp-a',
    root: 'sprites/monsters/test',
    frame_size: [256, 256],
    anchor: [128, 186],
    animations: { roaming: { frames: 9, fps: 8, frame_pattern: 'frame_%03d.png', folders: { south: 'animations/roaming/south' } } },
    reduced_motion: { fallback_state: 'idle', fallback_direction: 'south', fallback_frame: 'rotations/south.png' },
    ...over,
  };
}

function manifestWithMonster(monster: MonsterDef): AssetManifest {
  return {
    characters: {},
    monsters: { 'test-behemoth': monster },
    backgrounds: {
      'camp-a': { display_name: 'Camp A', file: 'backgrounds/a.webp', logical_size: [1000, 600], safe_area: [200, 200, 600, 200], ground: GROUND, epic_monster: 'test-behemoth' },
    },
    scene: { backdrop: { background_ref: 'camp-a' } },
  } as AssetManifest;
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

describe('SPEC-303 Phase 1 — epic monster render', () => {
  it('renders the monster as a non-interactive layer when status:"available"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => manifestWithMonster(monsterDef()) }) as unknown as Response));
    const campId = seed([orc()]);
    const container = renderDetail(campId, '?orc=pane:%1');

    const monster = await waitFor(() => {
      const el = container.querySelector('[data-testid="epic-monster"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    // INV-NI: a div (not a button/interactive), aria-hidden, pointer-events none, no tab stop.
    expect(monster.tagName).toBe('DIV');
    expect(monster.getAttribute('aria-hidden')).toBe('true');
    expect(monster.style.pointerEvents).toBe('none');
    expect(monster.getAttribute('tabindex')).toBeNull();
    // It paints a roaming frame from the resolved root.
    const img = monster.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('/pack/sprites/monsters/test/animations/roaming/south/frame_000.png');
    // It renders ABOVE the orc layer: later in DOM than .oc-map__orcs AND on the orc z-plane
    // (--oc-z-map-orc) so it paints on top (user request — orcs are smaller).
    const world = container.querySelector('.oc-map__world')!;
    const kids = [...world.children];
    const mi = kids.findIndex((k) => k.matches?.('[data-testid="epic-monster"]') || k.querySelector?.('[data-testid="epic-monster"]'));
    const oi = kids.findIndex((k) => k.classList?.contains('oc-map__orcs'));
    expect(mi).toBeGreaterThanOrEqual(0);
    expect(mi).toBeGreaterThan(oi);
    expect(monster.className).toContain('oc-monster'); // z-plane class (paints above orcs via DOM order)
  });

  it('does NOT render a planned (un-generated) monster (non-load-bearing)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => manifestWithMonster(monsterDef({ status: 'planned', pixellab_character_id: null })) }) as unknown as Response));
    const campId = seed([orc()]);
    const container = renderDetail(campId, '?orc=pane:%1');
    // backdrop loads (manifest applied) but no monster element.
    await waitFor(() => expect(container.querySelector('[data-testid="map-backdrop"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="epic-monster"]')).toBeNull();
  });
});

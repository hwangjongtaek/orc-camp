/**
 * SPEC-300 §2.6 / SPEC-301 §2.8 — rich-map depth LAYER rendering (component level).
 *
 * Wang terrain layer paints the sheet at the resolved bbox (SPEC-300-AC-14); flat fallback
 * tiles base + mandatory accent variety (SPEC-300-AC-15 / SPEC-301-AC-20); backdrop layer
 * resolves the background + is non-constraining (SPEC-301-AC-16); decor resolves + excludes
 * reserved props + drops missing sprites (SPEC-300-AC-17); per-sprite shadow + placeholder
 * parity (SPEC-300-AC-18); z-order / pointer-events / tokens-only (SPEC-301-AC-17 / AC-19).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, within, waitFor } from '@testing-library/react';
import { AssetProvider } from '../src/assets/AssetContext';
import { TerrainLayer } from '../src/components/scene/TerrainLayer';
import { DecorLayer } from '../src/components/scene/DecorLayer';
import { BackdropLayer } from '../src/components/scene/BackdropLayer';
import { CampMap } from '../src/components/scene/CampMap';
import type { AssetManifest } from '../src/assets/manifest';
import type { ZoneInfo } from '../src/scene/layout';
import { innerRect, zoneRect, mapDims } from '../src/scene/layout';
import {
  cornerMask,
  makeTerrainField,
  wangBBox,
  TERRAIN_TILE,
} from '../src/scene/terrain';
import { useStore } from '../src/store/store';
import { makeCamp, makeOrc, makeScan } from './fixtures';
import type { Orc } from '../src/types/domain';

const here = dirname(fileURLToPath(import.meta.url));

const WANG_TILES = {
  '0000': { x: 64, y: 32, w: 32, h: 32 },
  '0001': { x: 64, y: 64, w: 32, h: 32 },
  '0010': { x: 96, y: 32, w: 32, h: 32 },
  '0011': { x: 32, y: 64, w: 32, h: 32 },
  '0100': { x: 64, y: 0, w: 32, h: 32 },
  '0101': { x: 0, y: 32, w: 32, h: 32 },
  '0110': { x: 96, y: 64, w: 32, h: 32 },
  '0111': { x: 96, y: 96, w: 32, h: 32 },
  '1000': { x: 32, y: 32, w: 32, h: 32 },
  '1001': { x: 32, y: 0, w: 32, h: 32 },
  '1010': { x: 64, y: 96, w: 32, h: 32 },
  '1011': { x: 0, y: 64, w: 32, h: 32 },
  '1100': { x: 96, y: 0, w: 32, h: 32 },
  '1101': { x: 32, y: 96, w: 32, h: 32 },
  '1110': { x: 0, y: 0, w: 32, h: 32 },
  '1111': { x: 0, y: 96, w: 32, h: 32 },
};

function wangManifest(): AssetManifest {
  return {
    characters: {},
    backgrounds: {
      'warbase-sunset-dashboard': { file: 'backgrounds/warbase-sunset-dashboard.png' },
    },
    tilesets: {
      'orc-camp-terrain-wang-topdown': {
        type: 'wang_corner',
        root: 'tiles/orc-camp-terrain-wang-topdown',
        tile_size: [32, 32],
        tile_count: 16,
        image: 'orc-camp-terrain-wang-topdown.png',
        image_size: [128, 128],
        wang: {
          kind: 'corner',
          corner_count: 4,
          terrains: ['moss', 'dirt'],
          base_terrain: 'moss',
          corner_order: ['NW', 'NE', 'SE', 'SW'],
          base_tile_ids: { moss: '0000', dirt: '1111' },
          tiles: WANG_TILES,
        },
      },
    },
    scene: {
      backdrop: { background_ref: 'warbase-sunset-dashboard', fit: 'cover-width', repeat_x: true, parallax: 0.3 },
      decor: {
        items: [
          { ref: 'props/log-pile', weight: 3 },
          { ref: 'props/barrel', weight: 2 },
          { ref: 'wartable-warbase/ember-brazier', weight: 1 },
        ],
        reserved: ['campfire', 'workbench'],
      },
      shadow: { mode: 'css', css: { footprint_ratio: 0.6, opacity: 0.35 } },
    },
    objects: {
      props: {
        root: 'objects/props',
        items: {
          'log-pile': { file: 'log-pile.png' },
          barrel: { file: 'barrel.png' },
        },
      },
      'wartable-warbase': {
        root: 'objects/wartable-warbase',
        items: { 'ember-brazier': { file: 'ember-brazier.png' } },
      },
    },
  };
}

function flatManifest(): AssetManifest {
  return {
    characters: {},
    tilesets: {
      'orc-camp-terrain-square-topdown': {
        type: 'tiles_pro',
        root: 'tiles/orc-camp-terrain-square-topdown',
        tile_size: [32, 32],
        tiles: {
          'moss-ground': 'tile-00-moss-ground.png',
          'packed-dirt': 'tile-01-packed-dirt.png',
          'stone-path': 'tile-02-stone-path.png',
          'variation-08': 'tile-08-variation.png',
          'variation-12': 'tile-12-variation.png',
        },
      },
    },
  };
}

function zone(rect: ZoneInfo['rect'], windowIndex = 0, zoneIndex = 0): ZoneInfo {
  return { windowIndex, zoneIndex, rect, inner: innerRect(rect) };
}

const cells = (c: HTMLElement): HTMLElement[] =>
  [...c.querySelectorAll('.oc-terrain__cell')] as HTMLElement[];

describe('SPEC-300-AC-14 TerrainLayer paints Wang tiles at the resolved bbox', () => {
  it('AC-14: renders per-cell sheet tiles; positions match cornerMask→wangBBox', () => {
    const rect = { x: 0, y: 0, w: 256, h: 256 };
    const zones = [zone(rect)];
    const world = { w: 256, h: 256 };
    const { container } = render(
      <TerrainLayer zones={zones} world={world} manifest={wangManifest()} assetBase="/pack" />,
    );
    expect(container.querySelector('[data-testid="terrain-wang"]')).not.toBeNull();
    const list = cells(container);
    expect(list.length).toBeGreaterThan(0);

    // Recompute the expected selection with the SAME pure field and verify a concrete cell.
    const field = makeTerrainField({ world, zones: [rect] });
    const k = TERRAIN_TILE / 32;
    for (const el of list) {
      const mask = el.getAttribute('data-mask')!;
      const bb = wangBBox(wangManifest().tilesets!['orc-camp-terrain-wang-topdown']!.wang!, mask);
      expect(el.style.backgroundPosition).toBe(`${-bb.x * k}px ${-bb.y * k}px`);
      expect(el.style.backgroundImage).toContain(
        '/pack/tiles/orc-camp-terrain-wang-topdown/orc-camp-terrain-wang-topdown.png',
      );
    }
    // the top-left cell's mask equals the field-derived mask (deterministic wiring)
    const c0 = Math.floor(rect.x / TERRAIN_TILE);
    const r0 = Math.floor(rect.y / TERRAIN_TILE);
    expect(list[0]!.getAttribute('data-mask')).toBe(cornerMask(field, c0, r0));
  });

  it('AC-14: identical re-render produces identical masks (deterministic)', () => {
    const rect = { x: 0, y: 0, w: 256, h: 256 };
    const props = { zones: [zone(rect)], world: { w: 256, h: 256 }, manifest: wangManifest(), assetBase: '/pack' };
    const a = render(<TerrainLayer {...props} />);
    const masksA = cells(a.container).map((e) => e.getAttribute('data-mask'));
    const b = render(<TerrainLayer {...props} />);
    const masksB = cells(b.container).map((e) => e.getAttribute('data-mask'));
    expect(masksB).toEqual(masksA);
  });
});

describe('SPEC-300-AC-15 / SPEC-301-AC-20 TerrainLayer flat fallback (no single tile)', () => {
  it('AC-15: flat path tiles base moss + a MANDATORY varied accent scatter', () => {
    const rect = { x: 0, y: 0, w: 512, h: 512 };
    const { container } = render(
      <TerrainLayer zones={[zone(rect)]} world={{ w: 512, h: 512 }} manifest={flatManifest()} assetBase="/pack" />,
    );
    expect(container.querySelector('[data-testid="terrain-flat"]')).not.toBeNull();
    const tiled = container.querySelector('.oc-terrain__zone--tiled') as HTMLElement;
    expect(tiled.style.backgroundImage).toContain('tile-00-moss-ground.png');
    const accents = [...container.querySelectorAll('.oc-terrain__accent')] as HTMLElement[];
    const distinct = new Set(accents.map((a) => a.getAttribute('data-accent')));
    expect(accents.length).toBeGreaterThan(0);
    expect(distinct.size).toBeGreaterThanOrEqual(2); // never a single repeated tile
  });

  it('AC-20: no tileset → terrain layer renders nothing (CSS gradient ground shows)', () => {
    const rect = { x: 0, y: 0, w: 256, h: 256 };
    const { container } = render(
      <TerrainLayer zones={[zone(rect)]} world={{ w: 256, h: 256 }} manifest={null} assetBase="/pack" />,
    );
    expect(container.querySelector('.oc-terrain')).toBeNull();
  });
});

describe('SPEC-301-AC-16 BackdropLayer resolution (non-constraining)', () => {
  it('AC-16: resolves background_ref → image; repeat-x honored', () => {
    const { container } = render(<BackdropLayer manifest={wangManifest()} assetBase="/pack" />);
    const bd = container.querySelector('[data-testid="map-backdrop"]') as HTMLElement;
    expect(bd).not.toBeNull();
    expect(bd.style.backgroundImage).toContain('/pack/backgrounds/warbase-sunset-dashboard.png');
    expect(bd.style.backgroundRepeat).toBe('repeat-x');
  });

  it('AC-16: missing backdrop declaration → no backdrop element (terrain unaffected)', () => {
    const { container } = render(<BackdropLayer manifest={flatManifest()} assetBase="/pack" />);
    expect(container.querySelector('[data-testid="map-backdrop"]')).toBeNull();
  });
});

describe('SPEC-300-AC-17 DecorLayer resolution + reserved exclusion', () => {
  it('AC-17: decor resolves to objects[group].items[*]; never a reserved station prop', () => {
    const rect = zoneRect(0, [0], mapDims(1));
    const zones = [zone(rect)];
    const { container } = render(
      <DecorLayer zones={zones} manifest={wangManifest()} assetBase="/pack" />,
    );
    const items = [...container.querySelectorAll('.oc-decor__item')] as HTMLImageElement[];
    expect(items.length).toBeGreaterThan(0);
    const reserved = new Set(['campfire', 'workbench', 'bedroll', 'notice-board', 'stone-marker', 'utility-totem', 'locked-chest', 'command-tent', 'banner-pole']);
    for (const img of items) {
      const ref = img.getAttribute('data-decor-ref')!;
      const name = ref.slice(ref.indexOf('/') + 1);
      expect(reserved.has(name)).toBe(false);
      expect(img.getAttribute('src')).toContain('/pack/objects/');
    }
  });

  it('AC-17: a decor ref with no sprite is dropped (instance-only, non-load-bearing)', () => {
    // ember-brazier resolves, but if we remove its group the instance is simply skipped.
    const m = wangManifest();
    delete m.objects!['wartable-warbase'];
    const rect = zoneRect(0, [0], mapDims(1));
    const { container } = render(<DecorLayer zones={[zone(rect)]} manifest={m} assetBase="/pack" />);
    const refs = [...container.querySelectorAll('.oc-decor__item')].map((e) =>
      e.getAttribute('data-decor-ref'),
    );
    expect(refs.every((r) => !r!.startsWith('wartable-warbase/'))).toBe(true);
  });

  it('AC-17: no scene.decor → no decor layer', () => {
    const rect = zoneRect(0, [0], mapDims(1));
    const { container } = render(<DecorLayer zones={[zone(rect)]} manifest={flatManifest()} assetBase="/pack" />);
    expect(container.querySelector('[data-testid="decor-layer"]')).toBeNull();
  });
});

// --- CampMap integration: shadow parity, lighting, depth wiring ---

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

describe('SPEC-300-AC-18 per-sprite shadow + placeholder parity', () => {
  beforeEach(() => useStore.getState().resetServer());

  it('AC-18: a placeholder sprite (no manifest) still gets a CSS ground shadow', () => {
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'w:0.0' })]);
    const { container } = render(
      <AssetProvider assetBase="/pack">
        <CampMap campId={campId} selectedOrcId={null} onSelect={() => {}} />
      </AssetProvider>,
    );
    const btn = container.querySelector('button.oc-orc') as HTMLButtonElement;
    const shadow = within(btn).getByTestId('orc-shadow');
    expect(shadow).not.toBeNull();
    // shadow is a sized, absolutely-positioned decoration (does not change the 208.8 box).
    expect(parseFloat(shadow.style.width)).toBeGreaterThan(0);
    expect(parseFloat(btn.style.width)).toBeCloseTo(208.8, 1); // zero layout shift preserved
    // dusk lighting overlay is always present (CSS, asset-free).
    expect(container.querySelector('[data-testid="map-lighting"]')).not.toBeNull();
  });
});

describe('SPEC-301-AC-16/AC-17/AC-20 CampMap rich depth wiring (with manifest)', () => {
  beforeEach(() => useStore.getState().resetServer());
  afterEach(() => vi.unstubAllGlobals());

  it('renders backdrop + Wang terrain + decor + lighting; labels stay on top', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      ({ ok: true, json: async () => wangManifest() }) as unknown as Response,
    ));
    const campId = seed([
      makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'work:0.0' }),
    ]);
    const { container } = render(
      <AssetProvider assetBase="/pack">
        <CampMap campId={campId} selectedOrcId={null} onSelect={() => {}} />
      </AssetProvider>,
    );
    // manifest loads async → wait for the Wang terrain layer to mount.
    await waitFor(() =>
      expect(container.querySelector('[data-testid="terrain-wang"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="map-backdrop"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="decor-layer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="map-lighting"]')).not.toBeNull();
    // always-on status label + raw target still render (never occluded by depth, A7).
    const btn = container.querySelector('button.oc-orc') as HTMLButtonElement;
    expect(within(btn).getByText('Active')).toBeTruthy();
    expect(within(btn).getByText('work:0.0')).toBeTruthy();
  });
});

describe('SPEC-301-AC-17/AC-19 depth z-order, pointer-events, tokens-only (CSS gate)', () => {
  const css = readFileSync(resolve(here, '../src/styles/global.css'), 'utf8');
  const tokens = readFileSync(resolve(here, '../src/styles/tokens.css'), 'utf8');

  function zVal(name: string): number {
    const m = tokens.match(new RegExp(`--oc-z-map-${name}:\\s*(\\d+)`));
    expect(m, `token --oc-z-map-${name} missing`).not.toBeNull();
    return Number(m![1]);
  }

  it('AC-17: z-stack orders depth layers below sprites/overlay/label', () => {
    const backdrop = zVal('backdrop');
    const terrain = zVal('terrain');
    const decor = zVal('decor');
    const station = zVal('station');
    const shadow = zVal('shadow');
    const orc = zVal('orc');
    const lighting = zVal('lighting');
    const overlay = zVal('overlay');
    const label = zVal('label');
    expect(backdrop).toBeLessThanOrEqual(terrain);
    expect(terrain).toBeLessThan(decor);
    expect(decor).toBeLessThan(station);
    expect(station).toBeLessThan(shadow);
    expect(shadow).toBeLessThan(orc);
    expect(orc).toBeLessThan(lighting); // dusk light above sprites…
    expect(lighting).toBeLessThan(overlay); // …but below status overlay + label (A7)
    expect(overlay).toBeLessThan(label);
  });

  it('AC-17: decor / lighting / shadow / backdrop are pointer-events:none', () => {
    for (const sel of ['.oc-decor', '.oc-map__lighting', '.oc-orc__shadow', '.oc-map__backdrop']) {
      const block = css.slice(css.indexOf(sel + ' {'));
      const body = block.slice(0, block.indexOf('}'));
      expect(body, `${sel} must be pointer-events:none`).toMatch(/pointer-events:\s*none/);
    }
  });

  it('AC-01 (SPEC-202) tokens-only: no raw hex in global.css depth layers', () => {
    // all color comes from --oc-* tokens; raw hex literals live ONLY in tokens.css.
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

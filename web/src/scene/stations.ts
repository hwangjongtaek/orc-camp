/**
 * SPEC-301 §2.1/§2.2/§2.3/§2.4 — SSOT mirror of the camp-map layout constants.
 *
 * These values are the spec's hypothesis constants (Q1/Q2/Q3): tuning may shift them,
 * but the STRUCTURE (7 distinct station anchors, terminated edge, scaled-footprint ring
 * spacing, MIN_ZONE floor) is fixed. Everything here is a plain constant/table so the
 * pure layout functions in layout.ts stay deterministic (no Date.now / Math.random).
 */
import type { OrcStatus } from '../types/domain';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Map dimensions resolved from the background manifest (asset-independent, §2.1). */
export interface MapDims {
  logical: [number, number];
  playField: Rect;
}

// §2.1 — map sprite scale (applied EQUALLY to asset + placeholder boxes).
export const MAP_SPRITE_SCALE = 0.2;
// Layout reference footprint: the maximum native frame edge (232) scaled. Position math
// must NOT depend on per-character frame_size (INV-1: position is a function of
// windowIndex/status/paneId only), so ring/stack pitch use this constant footprint.
export const REF_FRAME_MAX = 232;
export const SCALED_FOOTPRINT = REF_FRAME_MAX * MAP_SPRITE_SCALE; // 46.4

// §2.2 — zone (window) partition constants.
export const ZONE_COLS_MAX = 4;
export const ZONE_GUTTER = 16;
export const ZONE_PAD = 24;
export const ZONE_HEADER_H = 40;
export const MIN_ZONE_W = 260;
export const MIN_ZONE_H = 200;

// §2.4 — slot (paneId) fan-out constants.
export const RING_BASE = 6;
export const RING_CLEARANCE = 1.15;
export const RING_STEP = RING_CLEARANCE * SCALED_FOOTPRINT; // ≈53.4
export const SLOT_SOFT_MAX = 12;
export const STACK_CLEARANCE = 1.05;
export const STACK_PITCH = STACK_CLEARANCE * SCALED_FOOTPRINT; // ≈48.7

// §3.1 — roaming interpolation constants (hypothesis; reduced-motion bypasses all).
export const ROAM_SPEED = 140; // logical px / s
export const ROAM_MIN_MS = 250;
export const ROAM_MAX_MS = 1500;
export const ARRIVE_EPSILON = 1; // px

export const MVP_DIRECTION = 'south';

/** §2.3 — station = status anchor table. anchor is normalized in the zone inner rect. */
export interface StationDef {
  prop: string; // manifest objects/props key
  anchor: [number, number]; // (nx, ny) ∈ [0,1] in inner rect
  edge: boolean; // terminated → 1-D edge stack (static)
}

export const STATIONS: Record<OrcStatus, StationDef> = {
  active: { prop: 'workbench', anchor: [0.3, 0.45], edge: false },
  waiting: { prop: 'campfire', anchor: [0.55, 0.4], edge: false },
  idle: { prop: 'bedroll', anchor: [0.78, 0.55], edge: false },
  error: { prop: 'notice-board', anchor: [0.5, 0.72], edge: false },
  stale: { prop: 'stone-marker', anchor: [0.22, 0.75], edge: false },
  unknown: { prop: 'utility-totem', anchor: [0.8, 0.25], edge: false },
  terminated: { prop: 'locked-chest', anchor: [0.95, 0.95], edge: true },
};

// §2.2 zone header props (ground layer).
export const ZONE_HEADER_PROPS = ['command-tent', 'banner-pole'] as const;

/** Default dims when the background manifest is absent (§2.1 / §3.4 placeholder parity). */
export const DEFAULT_MAP_DIMS: MapDims = {
  logical: [1672, 941],
  playField: { x: 390, y: 520, w: 890, h: 330 },
};

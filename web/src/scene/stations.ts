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

/**
 * §2.1/§2.2 — map dimensions. A camp is a large logical WORLD = grid of FIXED-size zones;
 * a fixed on-screen viewport scrolls/pans over it (§2.7). MapDims is derived PURELY from the
 * window COUNT + fixed zone size — never from the background image (F2 re-decision: sprite
 * size is decoupled from the background, so orcs render near original size).
 */
export interface MapDims {
  world: { w: number; h: number }; // total world logical size = zone-grid extent (§2.2)
  zone: { w: number; h: number }; // single FIXED zone logical size (hosts full-size sprites)
  cols: number; // zone-grid column count (= min(Z, ZONE_COLS_MAX))
}

// §2.1 — map sprite scale (applied EQUALLY to asset + placeholder boxes). Original-size
// first: the native frame (232/228px) renders near 1:1 → ≈209px footprint at 0.9
// (hypothesis range [0.7, 1.0]). This replaces the old 0.20 that shrank orcs to fit the
// background safe_area; placement is now decoupled from the background (F2).
export const MAP_SPRITE_SCALE = 0.9;
// Layout reference footprint: the maximum native frame edge (232) scaled. Position math
// must NOT depend on per-character frame_size (INV-1: position is a function of
// windowIndex/status/paneId only), so ring/stack pitch use this constant footprint.
export const REF_FRAME_MAX = 232;
export const SCALED_FOOTPRINT = REF_FRAME_MAX * MAP_SPRITE_SCALE; // 208.8

// §2.7 — base render scale of the world layer (1 logical px = 1 css px → sprites render
// large). The on-screen viewport scrolls the world at this scale.
export const BASE_SCALE = 1;

// §2.2 — zone (window) partition constants. Zones are ALWAYS exactly ZONE_W × ZONE_H
// (= MIN_ZONE). Many windows/orcs grow the WORLD (the viewport scrolls), never shrink the
// zone — so the inner rect is never degenerate. Sized (tuned up from the 1100×820
// hypothesis) so 7 stations + a fan-out ring of ≈209px sprites fit without overlap (AC-14).
export const ZONE_W = 1200;
export const ZONE_H = 900;
export const ZONE_GUTTER = 48;
export const ZONE_PAD = 48;
export const ZONE_HEADER_H = 64;
// §2.2 (#41) — VERTICAL-FIRST growth: cap the zone grid at 2 columns so many-window camps
// grow DOWN (mostly vertical scroll) instead of tiling into a wide horizontal strip. A
// single-window camp stays cols=1 (1200px zone fits the 1760px panel beside the inspector);
// horizontal scroll is bounded to two zones wide (2·ZONE_W + ZONE_GUTTER).
export const ZONE_COLS_MAX = 2;
/** Zones are always exactly this size (fixed floor AND ceiling, §2.2 F10). */
export const MIN_ZONE = { w: ZONE_W, h: ZONE_H } as const;

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

// §3.1-9 (#43) — idle ambient micro-wander (DEFAULT ON in CampMap, SUBTLE, non-load-bearing,
// reduced-motion off). Radius of the station-local jitter applied to renderedPos ONLY (never
// to the logical target/slot). The motion is a deterministic, paneId-seeded Lissajous path on
// the shared clock time `t` (no Math.random / Date.now), bounded inside WANDER_R (see
// wander.ts). Tuned subtle: a small radius + a slow base frequency so orcs "breathe"/drift
// gently in place rather than skating around (Q3 tuning; reduced-motion bypasses all).
export const WANDER_R = 10; // logical px (hypothesis range ≈8–14, subtle)
export const WANDER_FREQ = 0.00055; // base angular speed (rad/ms); slow, gentle drift

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

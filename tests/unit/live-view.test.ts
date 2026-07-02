/**
 * Unit tests for the SPEC-103 live-view FROZEN WIRE CONTRACT (src/server/live-view.ts).
 * These lock the inbound parser + constants so the contract stays 1:1 with SPEC-103.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_ATTACH_PER_CONNECTION,
  MAX_VIEW_CAPTURE_FAILURES,
  PANE_VIEW_FRAME_TYPES,
  PANE_VIEW_INTERVAL_MS,
  VIEW_CONTROL_FRAME_TYPES,
  isViewControlFrameType,
  parseViewControlFrame,
} from '../../src/server/live-view';

describe('live-view frame-type tokens (SPEC-103 §2.2/§2.3)', () => {
  it('registers exactly the spec frame types', () => {
    expect([...VIEW_CONTROL_FRAME_TYPES]).toEqual(['view.attach', 'view.detach']);
    expect([...PANE_VIEW_FRAME_TYPES]).toEqual(['pane_view_seed', 'pane_view', 'pane_view_end']);
  });

  it('isViewControlFrameType only matches the two client frames', () => {
    expect(isViewControlFrameType('view.attach')).toBe(true);
    expect(isViewControlFrameType('view.detach')).toBe(true);
    expect(isViewControlFrameType('pane_view')).toBe(false);
    expect(isViewControlFrameType('batch')).toBe(false);
    expect(isViewControlFrameType(undefined)).toBe(false);
  });
});

describe('load caps / polling constants (SPEC-103 §3.1, D-041)', () => {
  it('MVP concurrent attach cap is 1 (확정)', () => {
    expect(MAX_ATTACH_PER_CONNECTION).toBe(1);
  });
  it('interval is within the 250–500ms sub-second hypothesis band', () => {
    expect(PANE_VIEW_INTERVAL_MS).toBeGreaterThanOrEqual(250);
    expect(PANE_VIEW_INTERVAL_MS).toBeLessThanOrEqual(500);
  });
  it('capture-failure cap is a positive integer', () => {
    expect(Number.isInteger(MAX_VIEW_CAPTURE_FAILURES)).toBe(true);
    expect(MAX_VIEW_CAPTURE_FAILURES).toBeGreaterThan(0);
  });
});

describe('parseViewControlFrame (SPEC-103 §2.2)', () => {
  it('parses a well-formed view.attach', () => {
    expect(parseViewControlFrame({ type: 'view.attach', payload: { orcId: 'pane:%12' } })).toEqual({
      type: 'view.attach',
      orcId: 'pane:%12',
    });
  });

  it('parses a well-formed view.detach', () => {
    expect(parseViewControlFrame({ type: 'view.detach', payload: { orcId: 'pane:%3' } })).toEqual({
      type: 'view.detach',
      orcId: 'pane:%3',
    });
  });

  it('rejects non-live-view frames and malformed payloads (returns null)', () => {
    expect(parseViewControlFrame({ type: 'batch', payload: { orcId: 'pane:%1' } })).toBeNull();
    expect(parseViewControlFrame({ type: 'view.attach' })).toBeNull();
    expect(parseViewControlFrame({ type: 'view.attach', payload: {} })).toBeNull();
    expect(parseViewControlFrame({ type: 'view.attach', payload: { orcId: '' } })).toBeNull();
    expect(parseViewControlFrame({ type: 'view.attach', payload: { orcId: 42 } })).toBeNull();
    expect(parseViewControlFrame(null)).toBeNull();
    expect(parseViewControlFrame('view.attach')).toBeNull();
  });
});

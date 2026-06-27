/**
 * Unit tests for SPEC-500 pure settings logic: configDir resolution, strict PATCH
 * validation, and robust file repair.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_CONFIG, repairConfig, resolveConfigDir, validatePatch } from '../../src/server/settings';

describe('resolveConfigDir (SPEC-500 §2.1, AC-08)', () => {
  it('honors ORC_CAMP_CONFIG_DIR > XDG_CONFIG_HOME > ~/.config', () => {
    expect(resolveConfigDir({ ORC_CAMP_CONFIG_DIR: '/tmp/x' })).toBe('/tmp/x');
    expect(resolveConfigDir({ XDG_CONFIG_HOME: '/cfg' })).toBe(join('/cfg', 'orc-camp'));
    expect(resolveConfigDir({})).toBe(join(homedir(), '.config', 'orc-camp'));
  });
});

describe('validatePatch (SPEC-500 §2.4, strict)', () => {
  it('accepts valid in-range patches (merge)', () => {
    const r = validatePatch(DEFAULT_CONFIG, { scanInterval: 2, preview: { lineCount: 8 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.scanInterval).toBe(2);
      expect(r.value.preview.lineCount).toBe(8);
      expect(r.value.preview.exposureEnabled).toBe(DEFAULT_CONFIG.preview.exposureEnabled); // untouched
    }
  });
  it('rejects out-of-range, type mismatch, unknown key, redaction floor (AC-03/12/13)', () => {
    const oob = validatePatch(DEFAULT_CONFIG, { scanInterval: 10 });
    expect(oob.ok).toBe(false);
    if (!oob.ok) expect(oob.fieldErrors[0]).toMatchObject({ field: 'scanInterval', code: 'out_of_range', allowed: '1..5' });

    const big = validatePatch(DEFAULT_CONFIG, { preview: { lineCount: 20 } });
    expect(big.ok).toBe(false);

    const floor = validatePatch(DEFAULT_CONFIG, { redactionEnabled: false });
    expect(floor.ok).toBe(false);
    if (!floor.ok) expect(floor.fieldErrors[0]!.code).toBe('redaction_floor_locked');

    const unknown = validatePatch(DEFAULT_CONFIG, { nope: 1 });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.fieldErrors[0]!.code).toBe('unknown_field');

    const version = validatePatch(DEFAULT_CONFIG, { configVersion: 2 });
    expect(version.ok).toBe(false);
  });
});

describe('repairConfig (SPEC-500 §3.2, robust read, AC-09/13)', () => {
  it('clamps out-of-range, ignores unknown keys, forces redaction floor', () => {
    const c = repairConfig({ scanInterval: 99, preview: { lineCount: 999, exposureEnabled: false }, redactionEnabled: false, future: 'x' });
    expect(c.scanInterval).toBe(5); // clamped to max
    expect(c.preview.lineCount).toBe(12); // clamped to PREVIEW_LINES
    expect(c.preview.exposureEnabled).toBe(false); // preserved
    expect(c.redactionEnabled).toBe(true); // floor
    expect((c as any).future).toBeUndefined(); // unknown dropped
  });
  it('non-object → all defaults', () => {
    expect(repairConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(repairConfig('garbage')).toEqual(DEFAULT_CONFIG);
  });
});

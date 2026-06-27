/**
 * SPEC-500 — settings / local config (MVP: config.json + in-memory store).
 *
 * - configDir resolution: $ORC_CAMP_CONFIG_DIR > $XDG_CONFIG_HOME/orc-camp > ~/.config/orc-camp
 * - robust read (repair/clamp/ignore-unknown, never crash); lazy materialize.
 * - strict PATCH validation (422 fieldErrors, all-or-nothing); atomic write-through.
 * - redaction floor-lock (redactionEnabled:false → 422); scanInterval live-reload.
 * P1 SQLite (alias/mark/history) is forward — not implemented here.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PREVIEW_LINES } from '../types';
import type { ServerSettings } from './types';

export interface OrcCampConfig {
  configVersion: 1;
  scanInterval: number; // seconds, [1,5]
  preview: { exposureEnabled: boolean; lineCount: number }; // lineCount [1, PREVIEW_LINES]
  redactionEnabled: boolean; // floor-locked true
  browserAutoOpen: boolean;
}

export const DEFAULT_CONFIG: OrcCampConfig = {
  configVersion: 1,
  scanInterval: 3,
  preview: { exposureEnabled: true, lineCount: PREVIEW_LINES },
  redactionEnabled: true,
  browserAutoOpen: true,
};

export interface FieldError {
  field: string;
  code: string;
  message: string;
  allowed?: string;
}

export interface SettingsResponse extends OrcCampConfig {
  bounds: {
    scanInterval: { min: number; max: number };
    previewLineCount: { min: number; max: number };
  };
}

/** What the runtime reads (live). */
export interface SettingsProvider {
  effective(): ServerSettings;
}

export function resolveConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ORC_CAMP_CONFIG_DIR) return env.ORC_CAMP_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'orc-camp');
  return join(homedir(), '.config', 'orc-camp');
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Robust read: repair/clamp/ignore-unknown, never throw. Returns config + whether repaired. */
export function repairConfig(raw: unknown): OrcCampConfig {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const previewRaw = (typeof o.preview === 'object' && o.preview !== null ? o.preview : {}) as Record<string, unknown>;
  return {
    configVersion: 1,
    scanInterval: clampInt(o.scanInterval, 1, 5, DEFAULT_CONFIG.scanInterval),
    preview: {
      exposureEnabled: typeof previewRaw.exposureEnabled === 'boolean' ? previewRaw.exposureEnabled : DEFAULT_CONFIG.preview.exposureEnabled,
      lineCount: clampInt(previewRaw.lineCount, 1, PREVIEW_LINES, DEFAULT_CONFIG.preview.lineCount),
    },
    redactionEnabled: true, // floor-lock (always true regardless of file)
    browserAutoOpen: typeof o.browserAutoOpen === 'boolean' ? o.browserAutoOpen : DEFAULT_CONFIG.browserAutoOpen,
  };
}

const KNOWN_KEYS = new Set(['scanInterval', 'preview', 'redactionEnabled', 'browserAutoOpen']);
const KNOWN_PREVIEW_KEYS = new Set(['exposureEnabled', 'lineCount']);

/** Strict PATCH validation (all-or-nothing). */
export function validatePatch(
  current: OrcCampConfig,
  patch: unknown,
): { ok: true; value: OrcCampConfig } | { ok: false; fieldErrors: FieldError[] } {
  const errors: FieldError[] = [];
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return { ok: false, fieldErrors: [{ field: '(body)', code: 'type_mismatch', message: 'body must be an object' }] };
  }
  const p = patch as Record<string, unknown>;
  const next: OrcCampConfig = { ...current, preview: { ...current.preview } };

  for (const key of Object.keys(p)) {
    if (key === 'configVersion') {
      errors.push({ field: 'configVersion', code: 'unknown_field', message: 'configVersion is read-only' });
      continue;
    }
    if (!KNOWN_KEYS.has(key)) {
      errors.push({ field: key, code: 'unknown_field', message: `unknown field: ${key}` });
    }
  }

  if ('scanInterval' in p) {
    const v = p.scanInterval;
    if (typeof v !== 'number' || !Number.isFinite(v)) errors.push({ field: 'scanInterval', code: 'type_mismatch', message: 'scanInterval must be a number' });
    else if (v < 1 || v > 5) errors.push({ field: 'scanInterval', code: 'out_of_range', message: 'scanInterval out of range', allowed: '1..5' });
    else next.scanInterval = v;
  }
  if ('redactionEnabled' in p) {
    if (p.redactionEnabled !== true) errors.push({ field: 'redactionEnabled', code: 'redaction_floor_locked', message: 'redaction cannot be disabled' });
  }
  if ('browserAutoOpen' in p) {
    if (typeof p.browserAutoOpen !== 'boolean') errors.push({ field: 'browserAutoOpen', code: 'type_mismatch', message: 'browserAutoOpen must be a boolean' });
    else next.browserAutoOpen = p.browserAutoOpen;
  }
  if ('preview' in p) {
    const pv = p.preview;
    if (typeof pv !== 'object' || pv === null || Array.isArray(pv)) {
      errors.push({ field: 'preview', code: 'type_mismatch', message: 'preview must be an object' });
    } else {
      const pr = pv as Record<string, unknown>;
      for (const k of Object.keys(pr)) {
        if (!KNOWN_PREVIEW_KEYS.has(k)) errors.push({ field: `preview.${k}`, code: 'unknown_field', message: `unknown field: preview.${k}` });
      }
      if ('exposureEnabled' in pr) {
        if (typeof pr.exposureEnabled !== 'boolean') errors.push({ field: 'preview.exposureEnabled', code: 'type_mismatch', message: 'must be a boolean' });
        else next.preview.exposureEnabled = pr.exposureEnabled;
      }
      if ('lineCount' in pr) {
        const v = pr.lineCount;
        if (typeof v !== 'number' || !Number.isInteger(v)) errors.push({ field: 'preview.lineCount', code: 'type_mismatch', message: 'lineCount must be an integer' });
        else if (v < 1 || v > PREVIEW_LINES) errors.push({ field: 'preview.lineCount', code: 'out_of_range', message: 'lineCount out of range', allowed: `1..${PREVIEW_LINES}` });
        else next.preview.lineCount = v;
      }
    }
  }

  return errors.length > 0 ? { ok: false, fieldErrors: errors } : { ok: true, value: next };
}

function atomicWrite(configDir: string, config: OrcCampConfig): void {
  mkdirSync(configDir, { recursive: true });
  const target = join(configDir, 'config.json');
  const tmp = join(configDir, `config.json.tmp`);
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, JSON.stringify(config, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, target); // atomic replace
}

export class SettingsStore implements SettingsProvider {
  private constructor(
    private config: OrcCampConfig,
    private readonly configDir: string | null,
  ) {}

  static fromDir(configDir: string): SettingsStore {
    let config = DEFAULT_CONFIG;
    try {
      const text = readFileSync(join(configDir, 'config.json'), 'utf8');
      config = repairConfig(JSON.parse(text));
    } catch {
      // missing or unparseable → defaults (do not overwrite a corrupt file; lazy materialize)
      config = DEFAULT_CONFIG;
    }
    return new SettingsStore(config, configDir);
  }

  static inMemory(server?: ServerSettings): SettingsStore {
    const config: OrcCampConfig = server
      ? { ...DEFAULT_CONFIG, scanInterval: server.scanIntervalS, preview: { ...server.preview } }
      : DEFAULT_CONFIG;
    return new SettingsStore(repairConfig(config), null);
  }

  current(): OrcCampConfig {
    return { ...this.config, preview: { ...this.config.preview } };
  }

  effective(): ServerSettings {
    return { scanIntervalS: this.config.scanInterval, preview: { exposureEnabled: this.config.preview.exposureEnabled, lineCount: this.config.preview.lineCount } };
  }

  response(): SettingsResponse {
    return { ...this.current(), bounds: { scanInterval: { min: 1, max: 5 }, previewLineCount: { min: 1, max: PREVIEW_LINES } } };
  }

  /** Validate + apply + write-through. Disk failure rolls back memory (memory↔disk consistent). */
  patch(body: unknown): { ok: true } | { ok: false; fieldErrors: FieldError[]; status?: number } {
    const result = validatePatch(this.config, body);
    if (!result.ok) return { ok: false, fieldErrors: result.fieldErrors };
    if (this.configDir !== null) {
      try {
        atomicWrite(this.configDir, result.value);
      } catch {
        return { ok: false, fieldErrors: [{ field: '(disk)', code: 'config_write_failed', message: 'could not persist settings' }], status: 500 };
      }
    }
    this.config = result.value;
    return { ok: true };
  }
}

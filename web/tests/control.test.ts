import { describe, it, expect } from 'vitest';
import { byteLength, classifyControl, KEY_ALLOWLIST, MAX_INPUT_BYTES } from '../src/api/control';
import type { ApiResult } from '../src/api/client';
import type { ControlResultBody } from '../src/types/api';

function ok(over: Partial<ControlResultBody> = {}): ApiResult<ControlResultBody> {
  return {
    ok: true,
    status: 200,
    etag: null,
    data: {
      ok: true,
      action: 'input',
      orcId: 'pane:%12',
      paneId: '%12',
      tmuxTarget: 'work:0.0',
      outcome: 'success',
      executedAt: '2026-06-28T00:00:00.000Z',
      requestId: null,
      auditEventId: 'a1',
      ...over,
    },
  };
}

function err(code: string, status: number): ApiResult<ControlResultBody> {
  return {
    ok: false,
    status,
    retryAfterMs: null,
    error: { code, message: `msg:${code}`, requestId: '', scope: 'orc', status },
  };
}

describe('byteLength / limits', () => {
  it('counts UTF-8 bytes', () => {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('é')).toBe(2);
    expect(MAX_INPUT_BYTES).toBe(4096);
  });
  it('KEY_ALLOWLIST excludes destructive chords', () => {
    expect(KEY_ALLOWLIST).toContain('Enter');
    expect(KEY_ALLOWLIST).not.toContain('C-c');
    expect(KEY_ALLOWLIST).not.toContain('C-d');
  });
});

describe('classifyControl (SPEC-400 §2.11)', () => {
  it('success → info, no refresh', () => {
    const fb = classifyControl(ok({ action: 'interrupt' }));
    expect(fb.flow).toBe('success');
    expect(fb.severity).toBe('info');
    expect(fb.shouldRefresh).toBe(false);
    expect(fb.message).toMatch(/Interrupt sent/);
  });

  it('partial → warn', () => {
    const fb = classifyControl(ok({ outcome: 'partial' }));
    expect(fb.severity).toBe('warn');
  });

  it('target_mismatch → aborted, warn, refresh', () => {
    const fb = classifyControl(err('target_mismatch', 409));
    expect(fb.flow).toBe('aborted');
    expect(fb.severity).toBe('warn');
    expect(fb.shouldRefresh).toBe(true);
  });

  it('target_gone → refresh', () => {
    expect(classifyControl(err('target_gone', 410)).shouldRefresh).toBe(true);
  });

  it('key_not_allowed / tmux_exec_failed → failed error', () => {
    expect(classifyControl(err('key_not_allowed', 422)).severity).toBe('error');
    expect(classifyControl(err('tmux_exec_failed', 502)).flow).toBe('failed');
  });

  it('confirm_required / rate_limited → warn, no refresh', () => {
    expect(classifyControl(err('confirm_required', 422)).severity).toBe('warn');
    expect(classifyControl(err('rate_limited', 429)).shouldRefresh).toBe(false);
  });
});

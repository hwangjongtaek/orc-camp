/**
 * Unit tests for the pure server building blocks: token comparison, snapshot diff,
 * CORS/Host allowlists, and the doctor checks (injected tmuxExec).
 */
import { describe, expect, it } from 'vitest';
import { bearerFromAuthHeader, generateToken, tokensEqual } from '../../src/server/token';
import { snapshotChanged } from '../../src/server/diff';
import { corsHeadersFor, isAllowedHost, isAllowedOrigin, type SecurityConfig } from '../../src/server/security';
import { runChecks } from '../../src/server/doctor';
import { SCHEMA_VERSION, type ScanResult, type SpawnResult, type TmuxExecFn } from '../../src/types';

describe('token (SPEC-100 §2.6)', () => {
  it('constant-time compare: exact match true; wrong/empty/length-mismatch false', () => {
    const t = generateToken();
    expect(t.length).toBeGreaterThanOrEqual(40);
    expect(tokensEqual(t, t)).toBe(true);
    expect(tokensEqual(t, t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'))).toBe(false);
    expect(tokensEqual(t, 'short')).toBe(false);
    expect(tokensEqual(t, '')).toBe(false);
    expect(tokensEqual(t, null)).toBe(false);
  });
  it('bearerFromAuthHeader extracts the token', () => {
    expect(bearerFromAuthHeader('Bearer abc.def')).toBe('abc.def');
    expect(bearerFromAuthHeader('bearer xyz')).toBe('xyz');
    expect(bearerFromAuthHeader('Basic abc')).toBeNull();
    expect(bearerFromAuthHeader(undefined)).toBeNull();
  });
});

function scan(over: Partial<ScanResult> = {}): ScanResult {
  return {
    schemaVersion: SCHEMA_VERSION,
    scannedAt: '2026-06-27T10:00:00.000Z',
    stale: false,
    lastGoodAt: '2026-06-27T10:00:00.000Z',
    tmux: { installed: true, serverRunning: true, version: '3.6b' },
    statusSummary: { active: 1, waiting: 0, idle: 0, stale: 0, error: 0, unknown: 0, terminated: 0 },
    camps: [
      {
        id: 'session:$1', sessionId: '$1', tmuxSessionName: 'work', windowCount: 1, paneCount: 1, orcCount: 1,
        statusSummary: { active: 1, waiting: 0, idle: 0, stale: 0, error: 0, unknown: 0, terminated: 0 },
        lastActivityAt: '2026-06-27T10:00:00.000Z',
        orcs: [{
          id: 'pane:%10', paneId: '%10', tmuxTarget: 'work:1.0', sessionName: 'work', windowIndex: 1, paneIndex: 0,
          cwd: '/x', command: 'claude', agentType: 'claude-code', agentTypeConfidence: 0.95,
          agentSignals: [{ signal: 'command', tier: 'A', matchedType: 'claude-code', ruleId: 'r' }],
          status: 'active', statusConfidence: 0.85, statusSignals: [], currentWorkSummary: 'editing', summarySource: 'recent_output', summaryIsEstimated: true,
          lastActivityAt: '2026-06-27T10:00:00.000Z', preview: { lines: 2, truncated: false, redacted: false },
        }],
      },
    ],
    diagnostics: { tmuxErrors: [], scanDurationMs: 5 },
    ...over,
  };
}

describe('snapshot diff (SPEC-101 §2.3)', () => {
  it('first publish changes; identical content (newer scannedAt) does not; status change does', () => {
    const a = scan();
    expect(snapshotChanged(null, a)).toBe(true);
    const sameContent = scan({ scannedAt: '2026-06-27T10:00:05.000Z' }); // only time advanced
    expect(snapshotChanged(a, sameContent)).toBe(false);
    const statusChanged = scan();
    statusChanged.camps[0]!.orcs[0]!.status = 'waiting';
    expect(snapshotChanged(a, statusChanged)).toBe(true);
    const staleTransition = scan({ stale: true });
    expect(snapshotChanged(a, staleTransition)).toBe(true);
  });
});

describe('security allowlists (SPEC-100 §2.7)', () => {
  const cfg: SecurityConfig = { host: '127.0.0.1', port: 4123, allowExternal: false, devOrigins: ['http://localhost:5173'] };
  it('origin allowlist = own origins + dev origins', () => {
    expect(isAllowedOrigin('http://127.0.0.1:4123', cfg)).toBe(true);
    expect(isAllowedOrigin('http://localhost:4123', cfg)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', cfg)).toBe(true);
    expect(isAllowedOrigin('http://evil.example.com', cfg)).toBe(false);
    expect(isAllowedOrigin(undefined, cfg)).toBe(true); // non-browser
    expect(corsHeadersFor('http://evil.example.com', cfg)).toBeNull();
    expect(corsHeadersFor('http://localhost:5173', cfg)?.['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
  });
  it('host allowlist strict on loopback; relaxed when allowExternal', () => {
    expect(isAllowedHost('127.0.0.1:4123', cfg)).toBe(true);
    expect(isAllowedHost('localhost:4123', cfg)).toBe(true);
    expect(isAllowedHost('evil.example.com', cfg)).toBe(false);
    expect(isAllowedHost(undefined, cfg)).toBe(false);
    expect(isAllowedHost('anything', { ...cfg, allowExternal: true })).toBe(true);
  });
});

describe('doctor checks (SPEC-100 §2.3)', () => {
  function fakeExec(installed: boolean, serverOk: boolean): TmuxExecFn {
    const ok = (stdout: string): SpawnResult => ({ stdout, stderr: '', exitCode: 0, timedOut: false, spawnError: null, durationMs: 1 });
    return async (sub) => {
      if (sub === null) {
        if (!installed) {
          const e = new Error('ENOENT') as NodeJS.ErrnoException;
          e.code = 'ENOENT';
          return { stdout: '', stderr: '', exitCode: null, timedOut: false, spawnError: e, durationMs: 0 };
        }
        return ok('tmux 3.6b\n');
      }
      if (sub === 'list-sessions') return serverOk ? ok('$0\n') : { stdout: '', stderr: 'no server running', exitCode: 1, timedOut: false, spawnError: null, durationMs: 1 };
      return ok('');
    };
  }
  it('reports the 5 checks; tmux installed+reachable → no fail', async () => {
    const checks = await runChecks({ tmuxExec: fakeExec(true, true) });
    const ids = checks.map((c) => c.id);
    expect(ids).toEqual(['tmux.installed', 'tmux.serverReachable', 'port.available', 'config.dirAccess', 'log.path']);
    expect(checks.find((c) => c.id === 'tmux.installed')!.status).toBe('pass');
    expect(checks.find((c) => c.id === 'tmux.serverReachable')!.status).toBe('pass');
  });
  it('tmux missing → fail; server unreachable → warn (not fail)', async () => {
    const missing = await runChecks({ tmuxExec: fakeExec(false, false) });
    expect(missing.find((c) => c.id === 'tmux.installed')!.status).toBe('fail');
    const noServer = await runChecks({ tmuxExec: fakeExec(true, false) });
    expect(noServer.find((c) => c.id === 'tmux.serverReachable')!.status).toBe('warn');
  });
});

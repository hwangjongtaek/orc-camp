/**
 * Unit tests for SPEC-600 observability primitives: ActivityLog ring buffer + the
 * redaction-before-write / metadata-only / rotation debug log.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivityLog } from '../../src/server/activity';
import { DebugLog } from '../../src/server/debug-log';

const CLOCK = (): Date => new Date('2026-06-27T10:00:00.000Z');

describe('ActivityLog (SPEC-600 §2.3, AC-01/03)', () => {
  it('assigns monotonic seq/id and FIFO-evicts past capacity', () => {
    const log = new ActivityLog(CLOCK, 3);
    for (let i = 0; i < 5; i++) log.push({ type: 'orc.status_changed', severity: 'info', code: `status.${i}`, message: `e${i}` });
    expect(log.size()).toBe(3); // bounded
    const tail = log.tail(10);
    expect(tail.map((e) => e.code)).toEqual(['status.2', 'status.3', 'status.4']); // oldest evicted
    expect(tail.map((e) => e.seq)).toEqual([3, 4, 5]); // monotonic preserved
    expect(tail[0]!.id).toBe('act:3');
    expect(tail[0]!.source).toBe('server');
  });
});

describe('DebugLog (SPEC-600 §2.5–2.8)', () => {
  function dir(): string {
    const d = mkdtempSync(join(tmpdir(), 'orc-camp-log-'));
    return d;
  }

  it('AC-06/08: redaction-before-write — a planted secret never lands in the file', () => {
    const d = dir();
    try {
      const log = new DebugLog(d, { level: 'debug', now: CLOCK });
      log.write({ level: 'error', component: 'tmux', code: 'tmux.exit_nonzero', message: 'failed pushing ghp_FFFFFFFFFFFFFFFFFFFF3333 to remote' });
      const text = readFileSync(join(d, 'debug.log'), 'utf8');
      expect(text).not.toContain('ghp_FFFFFFFFFFFFFFFFFFFF3333');
      expect(text).toContain('[REDACTED:github-token]');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('AC-07: metadata-only — forbidden/unknown keys are dropped', () => {
    const d = dir();
    try {
      const log = new DebugLog(d, { level: 'debug', now: CLOCK });
      // a caller mistakenly passes capture text under a non-allowlisted key
      log.write({ level: 'info', component: 'scanner', code: 'scanner.tick', captureText: 'secret terminal output' } as any);
      const entry = JSON.parse(readFileSync(join(d, 'debug.log'), 'utf8').trim());
      expect(entry.captureText).toBeUndefined();
      expect(Object.keys(entry).sort()).toEqual(['code', 'component', 'level', 'ts']);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('level threshold: debug entry suppressed at info level', () => {
    const d = dir();
    try {
      const log = new DebugLog(d, { level: 'info', now: CLOCK });
      log.write({ level: 'debug', component: 'tmux', code: 'tmux.argv' });
      log.write({ level: 'warn', component: 'tmux', code: 'tmux.timeout' });
      const lines = readFileSync(join(d, 'debug.log'), 'utf8').trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!).code).toBe('tmux.timeout');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('AC-09: rotation bounds disk use', () => {
    const d = dir();
    try {
      const log = new DebugLog(d, { level: 'info', maxBytes: 200, keep: 2, now: CLOCK });
      for (let i = 0; i < 40; i++) log.write({ level: 'info', component: 'server', code: `evt.${i}`, message: `entry number ${i} padding padding` });
      const files = readdirSync(d).filter((f) => f.startsWith('debug.log'));
      expect(files.length).toBeLessThanOrEqual(3); // active + keep(2)
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

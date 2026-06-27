import { describe, it, expect } from 'vitest';
import { deriveViewState, totalOrcCount } from '../src/store/viewStatus';
import { summary } from './fixtures';

const baseTmux = { installed: true, serverRunning: true, version: '3.4' };

function input(over: Partial<Parameters<typeof deriveViewState>[0]>) {
  return deriveViewState({
    unauthorized: false,
    hasBootstrapped: true,
    tmux: baseTmux,
    campCount: 1,
    totalOrcCount: 1,
    stale: false,
    wsDisconnected: false,
    ...over,
  });
}

describe('deriveViewState (SPEC-200 §2.7 / AC-11)', () => {
  it('unauthorized takes precedence', () => {
    expect(input({ unauthorized: true }).phase).toBe('unauthorized');
  });

  it('loading before bootstrap', () => {
    expect(input({ hasBootstrapped: false }).phase).toBe('loading');
  });

  it('distinguishes the four empty content states', () => {
    expect(input({ tmux: { installed: false, serverRunning: false, version: null }, campCount: 0, totalOrcCount: 0 }).content).toBe('tmux_not_installed');
    expect(input({ tmux: { installed: true, serverRunning: false, version: '3.4' }, campCount: 0, totalOrcCount: 0 }).content).toBe('tmux_not_running');
    expect(input({ tmux: baseTmux, campCount: 0, totalOrcCount: 0 }).content).toBe('no_session');
    expect(input({ tmux: baseTmux, campCount: 2, totalOrcCount: 0 }).content).toBe('no_agent');
  });

  it('populated when camps + orcs present', () => {
    expect(input({}).content).toBe('populated');
  });

  it('disconnected and stale are orthogonal overlays, not content', () => {
    const v = input({ wsDisconnected: true, stale: true });
    expect(v.phase).toBe('content');
    expect(v.content).toBe('populated');
    expect(v.disconnected).toBe(true);
    expect(v.stale).toBe(true);
  });
});

describe('totalOrcCount', () => {
  it('sums all 7 status buckets', () => {
    expect(totalOrcCount(summary({ active: 2, waiting: 1, terminated: 3 }))).toBe(6);
  });
});

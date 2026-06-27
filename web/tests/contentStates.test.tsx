import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { EmptyContentState } from '../src/components/states/ContentStates';
import type { ContentStatus } from '../src/store/viewStatus';

describe('Empty content states (SPEC-201 AC-05/AC-06 distinct copy)', () => {
  it('renders distinct titles for all four content empties', () => {
    const cases: Array<[ContentStatus, RegExp]> = [
      ['tmux_not_installed', /not installed/i],
      ['tmux_not_running', /server is not running/i], // no-session: server-not-running variant
      ['no_session', /No tmux sessions/i], // no-session: running-no-session variant
      ['no_agent', /No agents detected/i],
    ];
    const seen = new Set<string>();
    for (const [status, re] of cases) {
      render(<EmptyContentState status={status} />);
      const node = screen.getByText(re);
      expect(node).toBeTruthy();
      seen.add(node.textContent ?? '');
      cleanup();
    }
    expect(seen.size).toBe(4); // all four copies are distinct
  });
});

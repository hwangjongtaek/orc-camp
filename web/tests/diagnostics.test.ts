import { describe, it, expect } from 'vitest';
import { bulkTmuxErrors, orcTmuxErrors } from '../src/store/diagnostics';
import type { TmuxError } from '../src/types/domain';

const errs: TmuxError[] = [
  { phase: 'capture', command: 'capture-pane', target: '%12', kind: 'timeout', exitCode: null, message: 'x' },
  { phase: 'inventory', command: 'list-panes', target: null, kind: 'exit_nonzero', exitCode: 1, message: 'y' },
  { phase: 'capture', command: 'capture-pane', target: '%99', kind: 'spawn_error', exitCode: null, message: 'z' },
];

describe('tmux error scoping (SPEC-201 AC-12)', () => {
  it('bulk = target null only', () => {
    expect(bulkTmuxErrors(errs)).toHaveLength(1);
    expect(bulkTmuxErrors(errs)[0]!.command).toBe('list-panes');
  });
  it('orc-scoped = target matches paneId', () => {
    expect(orcTmuxErrors(errs, '%12')).toHaveLength(1);
    expect(orcTmuxErrors(errs, '%99')).toHaveLength(1);
    expect(orcTmuxErrors(errs, '%1')).toHaveLength(0);
  });
});

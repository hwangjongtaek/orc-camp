/**
 * SPEC-201 AC-12 — tmux-error scoping helpers.
 * target === paneId → local to that orc; target === null → bulk (camp/global banner).
 * A scoped failure must never blank the whole dashboard.
 */
import type { TmuxError } from '../types/domain';

export function bulkTmuxErrors(errors: TmuxError[]): TmuxError[] {
  return errors.filter((e) => e.target === null);
}

export function orcTmuxErrors(errors: TmuxError[], paneId: string): TmuxError[] {
  return errors.filter((e) => e.target === paneId);
}

/** SPEC-201 §2.2 — global StatusSummaryBar (sum across all camps). */
import { STATUS_KEYS } from '../types/domain';
import { useStore } from '../store/store';
import { StatusCountChip } from './status/StatusBadge';

export function StatusSummaryBar(): JSX.Element {
  const summary = useStore((s) => s.server.statusSummary);
  return (
    <div className="oc-summarybar" aria-label="Status summary across all camps">
      {STATUS_KEYS.map((status) => (
        <StatusCountChip key={status} status={status} count={summary[status]} />
      ))}
    </div>
  );
}

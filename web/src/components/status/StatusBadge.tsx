/**
 * SPEC-202 §2.2/§2.3 — status badge: always icon(glyph) + plain-text label.
 * `StatusBadge` (orc): status + statusConfidence affix (never asserts status as fact).
 * `StatusCountChip` (camp card): status + count, color-independent.
 */
import type { OrcStatus } from '../../types/domain';
import { confidenceAffix, STATUS_META } from './statusMeta';

export function StatusBadge({
  status,
  confidence,
}: {
  status: OrcStatus;
  confidence?: number;
}): JSX.Element {
  const meta = STATUS_META[status];
  return (
    <span className={`oc-status ${meta.className}`}>
      <span className="oc-status__glyph" aria-hidden="true">
        {meta.glyph}
      </span>
      <span>{meta.label}</span>
      {confidence !== undefined && (
        <span className="oc-status__conf" title="status confidence">
          {confidenceAffix(confidence)}
        </span>
      )}
    </span>
  );
}

export function StatusCountChip({
  status,
  count,
}: {
  status: OrcStatus;
  count: number;
}): JSX.Element {
  const meta = STATUS_META[status];
  return (
    <span
      className={`oc-status ${meta.className}${count === 0 ? ' oc-status--zero' : ''}`}
      aria-label={`${meta.label}: ${count}`}
    >
      <span className="oc-status__glyph" aria-hidden="true">
        {meta.glyph}
      </span>
      <span>{meta.label}</span>
      <span className="oc-status__count">{count}</span>
    </span>
  );
}

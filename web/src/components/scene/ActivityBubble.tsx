/**
 * SPEC-301 §2.6 / AC-06 — on-demand activity speech bubble.
 *
 * Shown only on hover/focus/select (100-pane de-clutter). Renders currentWorkSummary +
 * summarySource, with an estimated marker when summaryIsEstimated (INV-4: never assert an
 * unmarked summary; null ⇒ "no summary", no synthesis). Positioned ABOVE the always-on
 * status label + raw tmuxTarget so it never occludes them (§2.6-2). Highest z-layer (§2.7).
 */
import type { SummarySource } from '../../types/domain';

export function ActivityBubble({
  currentWorkSummary,
  summarySource,
  summaryIsEstimated,
}: {
  currentWorkSummary: string | null;
  summarySource: SummarySource;
  summaryIsEstimated: boolean;
}): JSX.Element {
  const hasSummary = currentWorkSummary !== null && currentWorkSummary.trim() !== '';
  return (
    <div className="oc-bubble" role="status" data-testid="activity-bubble">
      <div className="oc-bubble__summary">
        {hasSummary ? currentWorkSummary : <span className="oc-muted">no summary</span>}
        {hasSummary && summaryIsEstimated && (
          <span className="oc-bubble__est" title="estimated (auto-derived)">
            ~est.
          </span>
        )}
      </div>
      <div className="oc-bubble__source">source: {summarySource}</div>
    </div>
  );
}

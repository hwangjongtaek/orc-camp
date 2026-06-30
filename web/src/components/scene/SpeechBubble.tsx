/**
 * SPEC-301 §2.6b (#50/#52) — intermittent ambient speech bubble.
 *
 * A lightweight, auto-shown chatter bubble (distinct from the on-demand ActivityBubble): it pops
 * up occasionally with an orcish-flavoured combo of the orc's preview/summary words (scheduled on
 * the shared clock by scene/speech.ts) and yields to the detailed ActivityBubble on
 * hover/focus/select. `multiline` (active orcs) widens it and allows ~2–3 wrapped lines; otherwise
 * it stays a terse 1–2 line bubble. Pure presentational; positioned ABOVE the always-on status
 * label/raw target (highest z, §2.7).
 */
export function SpeechBubble({
  text,
  multiline = false,
}: {
  text: string;
  multiline?: boolean;
}): JSX.Element {
  return (
    <div
      className={`oc-bubble oc-bubble--speech${multiline ? ' oc-bubble--speech-multiline' : ''}`}
      role="status"
      aria-hidden="true"
      data-testid="speech-bubble"
    >
      <span className="oc-bubble__speech-text">{text}</span>
    </div>
  );
}

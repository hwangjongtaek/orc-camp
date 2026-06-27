/**
 * SPEC-201 §2.5 — Terminal preview component contract.
 *
 * - meta === null (capture failed) → "preview unavailable" (≠ lines=0 "no output").
 * - exposure off → "Preview hidden", text not requested/shown (exposure-surface minimized).
 * - exposure on → render backend redacted tail only, min(lineCount, text.length) lines.
 *   The frontend never redacts/reconstructs text (invariant ③); it shows preview.text as-is.
 * - redacted/truncated/lines meta always surfaced; text is selectable/copyable.
 */
import { PREVIEW_LINE_MAX } from '../../config/constants';

export interface PreviewMeta {
  lines: number;
  truncated: boolean;
  redacted: boolean;
}

export interface TerminalPreviewProps {
  meta: PreviewMeta | null; // null = capture failed
  text: string[] | null; // present only when exposure on and fetched
  loading: boolean;
  exposureEnabled: boolean;
  lineCount: number;
  disabled?: boolean; // settings not loaded / no token
  onToggleExposure: (next: boolean) => void;
  onChangeLineCount: (next: number) => void;
}

export function TerminalPreview(props: TerminalPreviewProps): JSX.Element {
  const { meta, text, loading, exposureEnabled, lineCount, disabled } = props;

  return (
    <div className="oc-preview">
      <div className="oc-preview__bar">
        <label>
          <input
            type="checkbox"
            checked={exposureEnabled}
            disabled={disabled}
            onChange={(e) => props.onToggleExposure(e.target.checked)}
          />{' '}
          Show preview
        </label>
        <label title="Lines to display (capped at the backend redacted tail)">
          <span className="oc-sr-only">Preview line count</span>
          lines{' '}
          <input
            type="number"
            min={1}
            max={PREVIEW_LINE_MAX}
            value={lineCount}
            disabled={disabled || !exposureEnabled}
            style={{ width: '3.5em' }}
            onChange={(e) => props.onChangeLineCount(Number(e.target.value))}
          />
        </label>
        <div className="oc-preview__badges">
          {meta?.redacted && <span className="oc-tag oc-tag--redacted">redacted</span>}
          {meta?.truncated && <span className="oc-tag">truncated · {meta.lines}</span>}
        </div>
      </div>
      {renderBody(meta, text, loading, exposureEnabled, lineCount)}
    </div>
  );
}

function renderBody(
  meta: PreviewMeta | null,
  text: string[] | null,
  loading: boolean,
  exposureEnabled: boolean,
  lineCount: number,
): JSX.Element {
  if (meta === null) {
    return <div className="oc-preview__empty">Preview unavailable (capture failed).</div>;
  }
  if (!exposureEnabled) {
    return <div className="oc-preview__empty">Preview hidden. Enable “Show preview” to view the redacted tail.</div>;
  }
  if (meta.lines === 0) {
    return <div className="oc-preview__empty">No output.</div>;
  }
  if (loading) {
    return <div className="oc-preview__empty">Loading preview…</div>;
  }
  if (!text || text.length === 0) {
    return <div className="oc-preview__empty">No preview text available.</div>;
  }
  // Do not synthesize lines beyond the backend tail (frontend invents nothing).
  const shown = text.slice(0, Math.min(lineCount, text.length));
  return <pre className="oc-preview__text">{shown.join('\n')}</pre>;
}

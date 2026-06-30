/**
 * SPEC-201 §2.5 — Pane preview tab. Owns the lazy, exposure-gated fetch of a pane's redacted
 * terminal tail and renders it via <TerminalPreview>. Extracted from OrcInspector so the
 * preview is its own switchable tab in the camp dock (it only mounts — and only fetches — when
 * the Preview tab is opened).
 *
 * TODO(pane-preview → live control, goal): replace this read-only redacted tail with an
 * INTERACTIVE terminal that attaches to the pane (e.g. ssh + tmux control-mode / a PTY bridge)
 * so the user gets the same experience as SSHing into the box and driving the session directly
 * (scrollback, keystrokes, resize). Until then this stays a read-only, exposure-gated preview.
 */
import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { hasToken } from '../../api/token';
import { useStore } from '../../store/store';
import { PREVIEW_LINE_MAX } from '../../config/constants';
import { TerminalPreview, type PreviewMeta } from './TerminalPreview';
import { CommandDock } from '../control/CommandDock';
import type { Orc } from '../../types/domain';

interface PreviewState {
  meta: PreviewMeta | null;
  text: string[] | null;
  loading: boolean;
}

export function PanePreview({ orc }: { orc: Orc | undefined }): JSX.Element {
  const settings = useStore((s) => s.settings);
  const wsStatus = useStore((s) => s.connection.wsStatus);
  const { api } = useServices();

  const exposureEnabled = settings?.preview.exposureEnabled ?? false;
  const lineCount = settings?.preview.lineCount ?? PREVIEW_LINE_MAX;

  const [preview, setPreview] = useState<PreviewState>({ meta: null, text: null, loading: false });

  // Lazy preview fetch: metadata always from the snapshot orc; text only when exposure on.
  useEffect(() => {
    if (!orc) {
      setPreview({ meta: null, text: null, loading: false });
      return;
    }
    const meta: PreviewMeta | null = orc.preview
      ? { lines: orc.preview.lines, truncated: orc.preview.truncated, redacted: orc.preview.redacted }
      : null;
    if (!exposureEnabled || meta === null || meta.lines === 0) {
      setPreview({ meta, text: null, loading: false });
      return;
    }
    let cancelled = false;
    setPreview({ meta, text: null, loading: true });
    void api.getOrcPreview(orc.id).then((res) => {
      if (cancelled) return;
      if (res.ok && res.data.preview) {
        const p = res.data.preview;
        setPreview({
          meta: { lines: p.lines, truncated: p.truncated, redacted: p.redacted },
          text: p.text ?? null,
          loading: false,
        });
      } else {
        setPreview({ meta, text: null, loading: false });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [orc, exposureEnabled, lineCount, api]);

  const patchPreview = (patch: Record<string, unknown>): void => {
    void api.patchSettings({ preview: patch }).then((res) => {
      if (res.ok) useStore.getState().setSettings(res.data);
    });
  };

  if (!orc) {
    return <p className="oc-muted">Select an orc to preview its pane.</p>;
  }

  // SPEC-400 §2.11 entry-point enable predicate (moved here with the control dock).
  const disabledReason = !hasToken()
    ? 'no token'
    : wsStatus === 'disconnected' || wsStatus === 'reconnecting'
      ? 'disconnected'
      : orc.status === 'terminated'
        ? 'orc terminated'
        : orc.status === 'stale'
          ? 'orc stale'
          : null;
  const controlDisabled = disabledReason !== null;

  return (
    <div className="oc-preview-tab" aria-label="Pane preview">
      <div className="oc-field__label">Terminal preview</div>
      <TerminalPreview
        meta={preview.meta}
        text={preview.text}
        loading={preview.loading}
        exposureEnabled={exposureEnabled}
        lineCount={lineCount}
        disabled={settings === null}
        onToggleExposure={(next) => patchPreview({ exposureEnabled: next })}
        onChangeLineCount={(next) =>
          patchPreview({ lineCount: Math.max(1, Math.min(PREVIEW_LINE_MAX, Math.round(next))) })
        }
      />

      <CommandDock orc={orc} disabled={controlDisabled} disabledReason={disabledReason} />
    </div>
  );
}

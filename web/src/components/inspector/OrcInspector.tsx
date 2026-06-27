/**
 * SPEC-201 §2.4 — Orc Inspector. Renders the selected orc's metadata, status+confidence
 * (never asserts status as fact), estimated-summary marker, cwd/command/activity, raw
 * tmuxTarget+paneId (always), a lazily-fetched terminal preview (exposure-gated), and the
 * control entry points (disabled placeholders; flow is owned by SPEC-400).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useServices } from '../../app/services';
import { hasToken } from '../../api/token';
import { useStore } from '../../store/store';
import { PREVIEW_LINE_MAX } from '../../config/constants';
import { AGENT_BAND, STATUS_BAND, confidenceTier } from '../../types/domain';
import { AGENT_LABEL } from '../status/statusMeta';
import { StatusBadge } from '../status/StatusBadge';
import { TerminalPreview, type PreviewMeta } from '../preview/TerminalPreview';
import { clockTime, relativeTime } from '../../util/time';

interface PreviewState {
  meta: PreviewMeta | null;
  text: string[] | null;
  loading: boolean;
}

export function OrcInspector({ orcId }: { orcId: string | null }): JSX.Element {
  const orc = useStore((s) => (orcId ? s.server.orcsById[orcId] : undefined));
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
    return (
      <aside className="oc-inspector" aria-label="Orc inspector">
        <p className="oc-muted">Select an orc to inspect it.</p>
      </aside>
    );
  }

  const controlDisabled =
    !hasToken() ||
    wsStatus === 'disconnected' ||
    wsStatus === 'reconnecting' ||
    orc.status === 'terminated' ||
    orc.status === 'stale';

  return (
    <aside className="oc-inspector" aria-label="Orc inspector">
      <div className="oc-detail__header" style={{ marginBottom: 'var(--oc-space-2)' }}>
        <StatusBadge status={orc.status} confidence={orc.statusConfidence} />
        <span className="oc-muted oc-status__conf">
          ({confidenceTier(orc.statusConfidence, STATUS_BAND)})
        </span>
      </div>

      <Field label="Agent type">
        {AGENT_LABEL[orc.agentType]}{' '}
        <span className="oc-muted">
          {orc.agentTypeConfidence.toFixed(2)} ({confidenceTier(orc.agentTypeConfidence, AGENT_BAND)})
        </span>
      </Field>

      <Field label="tmux target" mono>
        {orc.tmuxTarget} <span className="oc-muted">({orc.paneId})</span>
      </Field>

      <Field label="Location">
        session {orc.sessionName} · win {orc.windowIndex} · pane {orc.paneIndex}
      </Field>

      <Field label="Working dir" mono>
        {orc.cwd}
      </Field>

      <Field label="Command" mono>
        {orc.command}
      </Field>

      <Field label="Current work summary">
        {orc.currentWorkSummary ?? <span className="oc-muted">no summary</span>}
        {orc.summaryIsEstimated && (
          <span className="oc-estimated" title={`source: ${orc.summarySource}`}>
            ~ estimated
          </span>
        )}
        {!orc.summaryIsEstimated && orc.currentWorkSummary && (
          <span className="oc-muted oc-status__conf"> ({orc.summarySource})</span>
        )}
      </Field>

      <Field label="Last activity">
        {relativeTime(orc.lastActivityAt)} <span className="oc-muted">({clockTime(orc.lastActivityAt)})</span>
      </Field>

      {orc.status === 'terminated' && (
        <p className="oc-muted">This pane ended. Showing the last known metadata.</p>
      )}
      {orc.status === 'stale' && (
        <p className="oc-muted">Data may be out of date. Refresh to re-check.</p>
      )}

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

      <div style={{ marginTop: 'var(--oc-space-3)' }}>
        <div className="oc-field__label">Controls</div>
        <div style={{ display: 'flex', gap: 'var(--oc-space-1)', flexWrap: 'wrap' }}>
          <button className="oc-btn" disabled={controlDisabled} aria-label="Send text to agent">
            Send…
          </button>
          <button className="oc-btn" disabled={controlDisabled} aria-label="Send key to agent">
            Key…
          </button>
          <button
            className="oc-btn oc-btn--danger"
            disabled={controlDisabled}
            aria-label="Interrupt agent"
          >
            Interrupt…
          </button>
        </div>
        <p className="oc-muted" style={{ fontSize: '11px', marginTop: 'var(--oc-space-1)' }}>
          Control actions are wired in a later slice (SPEC-400).
        </p>
      </div>
    </aside>
  );
}

function Field({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="oc-field">
      <div className="oc-field__label">{label}</div>
      <div className={`oc-field__value${mono ? ' oc-field__value--mono' : ''}`}>{children}</div>
    </div>
  );
}

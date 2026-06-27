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
import { CommandDock } from '../control/CommandDock';
import { orcTmuxErrors } from '../../store/diagnostics';
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
  const tmuxErrors = useStore((s) => s.server.diagnostics.tmuxErrors);
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

  // SPEC-400 §2.11 entry-point enable predicate.
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

  // SPEC-201 AC-12 — tmux errors scoped to THIS orc (target === paneId) render locally.
  const orcErrors = orcTmuxErrors(tmuxErrors, orc.paneId);

  return (
    <aside className="oc-inspector" aria-label="Orc inspector">
      <div className="oc-detail__header" style={{ marginBottom: 'var(--oc-space-2)' }}>
        <StatusBadge status={orc.status} confidence={orc.statusConfidence} />
        <span className="oc-muted oc-status__conf">
          ({confidenceTier(orc.statusConfidence, STATUS_BAND)})
        </span>
      </div>

      {orcErrors.length > 0 && (
        <div className="oc-banner oc-banner--error" role="status" style={{ marginBottom: 'var(--oc-space-2)' }}>
          <span className="oc-banner__label">tmux error</span>
          <span className="oc-muted">
            {orcErrors[0]!.command} {orcErrors[0]!.kind} — this pane's data may be incomplete.
          </span>
        </div>
      )}

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

      {(orc.agentSignals.length > 0 || orc.statusSignals.length > 0) && (
        <details className="oc-field">
          <summary className="oc-field__label" style={{ cursor: 'pointer' }}>
            Why (provenance)
          </summary>
          {orc.agentSignals.length > 0 && (
            <div className="oc-field__value" style={{ fontSize: '12px' }}>
              agent:{' '}
              <span className="oc-mono">
                {orc.agentSignals.map((s) => `${s.ruleId}(${s.tier})`).join(', ')}
              </span>
            </div>
          )}
          {orc.statusSignals.length > 0 && (
            <div className="oc-field__value" style={{ fontSize: '12px' }}>
              status:{' '}
              <span className="oc-mono">
                {orc.statusSignals.map((s) => `${s.ruleId}(${s.strength})`).join(', ')}
              </span>
            </div>
          )}
        </details>
      )}

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

      <CommandDock orc={orc} disabled={controlDisabled} disabledReason={disabledReason} />
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

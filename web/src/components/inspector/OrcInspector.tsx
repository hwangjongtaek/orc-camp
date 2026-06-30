/**
 * SPEC-201 §2.4 — Orc Inspector (camp dock "Details" tab). Renders the selected orc's metadata,
 * status+confidence (never asserts status as fact), estimated-summary marker, cwd/command/
 * activity, raw tmuxTarget+paneId (always). The terminal preview AND the control dock live in
 * the "Preview" dock tab (<PanePreview>), so Details is read-only metadata.
 *
 * SPEC-304 — a BG-style 2:3 bust portrait sits beside the metadata (2-col on a wide dock, stacked
 * on a narrow dock). The portrait's character mirrors the on-map sprite (shared sequential
 * `characterKey`); it is static, asserts no status, and degrades to a CSS placeholder when the
 * asset is absent (zero-layout-shift — the 2:3 box is always reserved).
 */
import { useMemo, type ReactNode } from 'react';
import { useStore } from '../../store/store';
import { AGENT_BAND, STATUS_BAND, confidenceTier } from '../../types/domain';
import { AGENT_LABEL } from '../status/statusMeta';
import { StatusBadge } from '../status/StatusBadge';
import { orcTmuxErrors } from '../../store/diagnostics';
import { clockTime, relativeTime } from '../../util/time';
import { useAssets } from '../../assets/AssetContext';
import { characterKeyMap } from '../../assets/spriteResolver';
import { campOrcIdsForOrc } from '../../store/serverData';
import { resolvePortrait, type PortraitState } from '../../assets/portraitResolver';
import { displayedTierForOrc } from '../../assets/prestige';

export function OrcInspector({ orcId }: { orcId: string | null }): JSX.Element {
  const orc = useStore((s) => (orcId ? s.server.orcsById[orcId] : undefined));
  const tmuxErrors = useStore((s) => s.server.diagnostics.tmuxErrors);
  const server = useStore((s) => s.server);
  const { manifest, assetBase } = useAssets();

  // SPEC-304 §2.2 — resolve the SAME sequential characterKey the map sprite uses, so the portrait
  // matches the on-map orc.
  const characterKey = useMemo(
    () => (orcId ? characterKeyMap(campOrcIdsForOrc(server, orcId), manifest).get(orcId) : undefined),
    [server, manifest, orcId],
  );
  // SPEC-302/SPEC-304 — the portrait follows the orc's prestige tier: when its tier rises, the
  // matching tier portrait is shown (tier resolution is the SPEC-302 seam in `prestige.ts`).
  const portrait = useMemo<PortraitState | null>(
    () =>
      orc
        ? resolvePortrait(
            { characterKey, agentType: orc.agentType, displayedTier: displayedTierForOrc(orc) },
            { manifest, assetBasePath: assetBase },
          )
        : null,
    [orc, characterKey, manifest, assetBase],
  );

  if (!orc) {
    return (
      <aside className="oc-inspector" aria-label="Orc inspector">
        <p className="oc-muted">Select an orc to inspect it.</p>
      </aside>
    );
  }

  // SPEC-201 AC-12 — tmux errors scoped to THIS orc (target === paneId) render locally.
  const orcErrors = orcTmuxErrors(tmuxErrors, orc.paneId);

  return (
    <aside className="oc-inspector" aria-label="Orc inspector">
      <div className="oc-inspector__grid">
        <div className="oc-inspector__meta">
          <div className="oc-detail__header" style={{ marginBottom: 'var(--oc-space-2)' }}>
            <StatusBadge status={orc.status} confidence={orc.statusConfidence} />
            <span className="oc-muted oc-status__conf">
              ({confidenceTier(orc.statusConfidence, STATUS_BAND)})
            </span>
          </div>

          {orcErrors.length > 0 && (
            <div
              className="oc-banner oc-banner--error"
              role="status"
              style={{ marginBottom: 'var(--oc-space-2)' }}
            >
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
            {relativeTime(orc.lastActivityAt)}{' '}
            <span className="oc-muted">({clockTime(orc.lastActivityAt)})</span>
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
        </div>

        {portrait && <OrcPortrait portrait={portrait} />}
      </div>
    </aside>
  );
}

/** SPEC-304 §2.3 — 2:3 bust portrait + name/role caption; CSS owns the decorative frame. */
function OrcPortrait({ portrait }: { portrait: PortraitState }): JSX.Element {
  return (
    <div className="oc-portrait" data-testid="orc-portrait">
      <div
        className={`oc-portrait__frame oc-portrait__frame--${portrait.mode}`}
        data-mode={portrait.mode}
      >
        {portrait.mode === 'asset' && portrait.src ? (
          <img className="oc-portrait__img" src={portrait.src} alt="" />
        ) : (
          <div className="oc-portrait__placeholder" aria-hidden="true">
            <span className="oc-portrait__placeholder-mark" />
          </div>
        )}
      </div>
      <div className="oc-portrait__caption">
        <span className="oc-portrait__name">{portrait.caption.name}</span>
        {portrait.caption.role && (
          <span className="oc-portrait__role oc-muted">{portrait.caption.role}</span>
        )}
      </div>
    </div>
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

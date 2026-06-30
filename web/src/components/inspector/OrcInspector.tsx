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
  // matching tier portrait is shown. The displayed tier is the SPEC-302 latch held in the store
  // (reconciled by CampMap for this camp's orcs); defaults to 0 (base) when not yet reconciled.
  const displayedTier = useStore((s) => (orcId ? s.prestige.displayedTierById[orcId] ?? 0 : 0));
  const portrait = useMemo<PortraitState | null>(
    () =>
      orc
        ? resolvePortrait(
            { characterKey, agentType: orc.agentType, displayedTier },
            { manifest, assetBasePath: assetBase },
          )
        : null,
    [orc, characterKey, manifest, assetBase, displayedTier],
  );
  // SPEC-302 — the orc's earned prestige tier grade + its character-specific label (from the
  // manifest `prestige` block). Tier 0 (base) / no prestige block ⇒ no label.
  const tierLabel = useMemo(
    () =>
      characterKey && displayedTier >= 1
        ? (manifest?.characters?.[characterKey]?.prestige?.tiers?.find(
            (t) => t.tier === displayedTier,
          )?.label ?? null)
        : null,
    [manifest, characterKey, displayedTier],
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

  // SPEC-302 §3.7 — the BASIS behind the tier grade: which signal drove it (precedence tokens →
  // cost → uptime → unmeasured, mirroring rawTierForUsage). Surfaced because the tier can now be a
  // mix of signals — e.g. an uptime-tiered orc reads "T1 … · 2.3h uptime".
  const u = orc.usage;
  const basisNote =
    u?.cumulativeTokens != null
      ? `${fmtTokens(u.cumulativeTokens)} tok`
      : u?.cumulativeCostUsd != null
        ? `$${u.cumulativeCostUsd.toFixed(2)}`
        : orc.uptimeSec != null
          ? `${fmtUptime(orc.uptimeSec)} uptime`
          : 'usage unmeasured';

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

          <Field label="Prestige tier">
            {displayedTier >= 1 ? (
              <span className="oc-tier" data-testid="orc-tier">
                <span className="oc-tier-badge" data-tier={displayedTier}>
                  T{displayedTier}
                </span>
                {tierLabel && <span className="oc-tier__label">{tierLabel}</span>}
              </span>
            ) : (
              <span className="oc-muted" data-testid="orc-tier">
                Base (tier 0)
              </span>
            )}
            <span className="oc-muted oc-status__conf"> · {basisNote}</span>
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

/** Compact token count for the tier basis note (e.g. 115734 → "116k", 2_300_000 → "2.3M"). */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** Compact uptime for the tier basis note (SPEC-302 §3.7): 8000 → "2.2h", 2700 → "45m", 30 → "30s". */
function fmtUptime(sec: number): string {
  if (sec >= 3600) return `${(sec / 3600).toFixed(1)}h`;
  if (sec >= 60) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec)}s`;
}

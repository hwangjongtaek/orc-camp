/**
 * SPEC-203 §2.10 / AC-18 (ii) — broadcast confirm (single confirm for N≥2, [[D-051]]). Reuses the
 * shared ConfirmModal host (same focus-trap, Escape, cancel-first footer) as its broadcast variant:
 * an editable "Broadcast input" (the shared prompt — labelled that, never "command", §2.10 P1-O), a
 * blast-radius count, and a scrollable N-row target list showing each target's paneId · tmuxTarget ·
 * agentType · running-cmd (D-051 (a): no cwd, +paneId; per-row truncation, full value on focus).
 * The server re-validates every target's `expected` — this modal is display + one explicit confirm.
 */
import { useState } from 'react';
import { ConfirmModal } from '../control/ConfirmModal';
import { byteLength, MAX_INPUT_BYTES } from '../../api/control';
import { AGENT_LABEL } from '../status/statusMeta';
import type { BroadcastRow } from '../../terminal/broadcast';

export interface BroadcastConfirmProps {
  rows: BroadcastRow[];
  /** Prefill for the shared prompt (empty for the waiting-toast entry path). */
  initialText?: string;
  onConfirm: (text: string) => void;
  onCancel: () => void;
}

export function BroadcastConfirm({ rows, initialText = '', onConfirm, onCancel }: BroadcastConfirmProps): JSX.Element {
  const [text, setText] = useState(initialText);
  const n = rows.length;
  const overLimit = byteLength(text) > MAX_INPUT_BYTES;
  const empty = text.trim().length === 0;

  return (
    <ConfirmModal
      title={`Broadcast to ${n} agent${n === 1 ? '' : 's'}?`}
      body={`The same input is sent to every listed target (blast radius: ${n}). Each target is re-validated before it receives anything.`}
      confirmLabel={`Broadcast to ${n}`}
      confirmDisabled={empty || overLimit || n === 0}
      className="oc-modal--broadcast"
      fallbackFocusSelector='[data-testid="broadcast-toolbar"] button'
      onConfirm={() => onConfirm(text)}
      onCancel={onCancel}
    >
      <div className="oc-bcast__input">
        <label htmlFor="oc-bcast-text" className="oc-field__label">
          Broadcast input
        </label>
        <textarea
          id="oc-bcast-text"
          className="oc-composed__text"
          rows={2}
          value={text}
          placeholder="Type the prompt to send to every target…"
          onChange={(e) => setText(e.target.value)}
          data-testid="broadcast-input"
        />
        {overLimit && (
          <p className="oc-banner--error oc-muted" style={{ fontSize: '11px' }} role="alert">
            Too long (max {MAX_INPUT_BYTES} bytes).
          </p>
        )}
      </div>

      <p className="oc-field__label" style={{ marginBottom: 'var(--oc-space-1)' }}>
        Targets ({n})
      </p>
      <ul className="oc-bcast__list" aria-label={`Broadcast targets (${n})`}>
        {rows.map((r) => (
          <li key={r.orcId} className="oc-bcast__row" data-testid={`broadcast-row-${r.orcId}`}>
            <span className="oc-bcast__cell oc-field__value--mono" title={r.tmuxTarget}>
              {r.tmuxTarget}
            </span>
            <span className="oc-bcast__cell oc-field__value--mono" title={r.paneId}>
              {r.paneId}
            </span>
            <span className="oc-bcast__cell" title={AGENT_LABEL[r.agentType]}>
              {AGENT_LABEL[r.agentType]}
            </span>
            <span className="oc-bcast__cell oc-bcast__running oc-field__value--mono" title={r.running}>
              {r.running}
            </span>
          </li>
        ))}
      </ul>
    </ConfirmModal>
  );
}

/**
 * SPEC-400 §2.11 + SPEC-201 §2.4 — control command dock.
 *
 * Renders the context header (agentType/tmuxTarget/cwd/command — R-CTRL-006), a text input
 * (→ POST /input), the KEY_ALLOWLIST key buttons (→ POST /key), and an Interrupt button
 * (→ confirm modal → POST /interrupt {confirmed:true}). Pessimistic flow: buttons disable
 * while submitting; NO optimistic status change — the real change arrives via WS. The 4
 * context fields become request.expected (paneId/tmuxTarget/command/agentType) so "what you
 * see = what's revalidated". Results surface as toasts; target drift forces a refresh.
 */
import { useState } from 'react';
import { useServices } from '../../app/services';
import { useStore } from '../../store/store';
import {
  byteLength,
  classifyControl,
  KEY_ALLOWLIST,
  MAX_INPUT_BYTES,
} from '../../api/control';
import type { ApiResult } from '../../api/client';
import type { ControlResultBody, ExpectedTarget } from '../../types/api';
import type { Orc } from '../../types/domain';
import { AGENT_LABEL } from '../status/statusMeta';
import { ConfirmModal } from './ConfirmModal';

export function CommandDock({
  orc,
  disabled,
  disabledReason,
}: {
  orc: Orc;
  disabled: boolean; // entry-point predicate (token/terminated/stale/disconnected)
  disabledReason: string | null;
}): JSX.Element {
  const { api, engine } = useServices();
  const addToast = useStore((s) => s.addToast);

  const [text, setText] = useState('');
  const [submit, setSubmit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const expected: ExpectedTarget = {
    paneId: orc.paneId,
    tmuxTarget: orc.tmuxTarget,
    command: orc.command,
    agentType: orc.agentType,
  };

  const overLimit = byteLength(text) > MAX_INPUT_BYTES;
  const blocked = disabled || busy;

  const run = async (p: Promise<ApiResult<ControlResultBody>>): Promise<ApiResult<ControlResultBody>> => {
    setBusy(true);
    const res = await p;
    setBusy(false);
    const fb = classifyControl(res);
    addToast(fb.severity, fb.message);
    if (fb.shouldRefresh) void engine.refresh();
    return res;
  };

  const onSend = async (): Promise<void> => {
    if (blocked || text.length === 0 || overLimit) return;
    const res = await run(api.sendInput(orc.id, { text, submit, expected }));
    if (res.ok) setText('');
  };

  const onKey = (key: string): void => {
    if (blocked) return;
    void run(api.sendKey(orc.id, { key, expected }));
  };

  const onInterruptConfirm = (): void => {
    setConfirmOpen(false);
    void run(api.sendInterrupt(orc.id, { confirmed: true, expected }));
  };

  return (
    <div className="oc-dock">
      <div className="oc-field__label">Command dock</div>

      <dl className="oc-dock__context" aria-label="Acting on">
        <ContextRow label="agent" value={AGENT_LABEL[orc.agentType]} />
        <ContextRow label="target" value={orc.tmuxTarget} mono />
        <ContextRow label="cwd" value={orc.cwd} mono />
        <ContextRow label="command" value={orc.command} mono />
      </dl>

      {disabled && disabledReason && (
        <p className="oc-muted" style={{ fontSize: '11px' }}>
          Controls disabled: {disabledReason}.
        </p>
      )}

      <div className="oc-dock__input">
        <label htmlFor="oc-dock-text" className="oc-sr-only">
          Text to send to the agent
        </label>
        <input
          id="oc-dock-text"
          type="text"
          value={text}
          placeholder="Type text to send…"
          disabled={blocked}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void onSend();
            }
          }}
        />
        <button
          className="oc-btn oc-btn--primary"
          disabled={blocked || text.length === 0 || overLimit}
          onClick={() => void onSend()}
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
      <label className="oc-dock__submit">
        <input
          type="checkbox"
          checked={submit}
          disabled={blocked}
          onChange={(e) => setSubmit(e.target.checked)}
        />{' '}
        press Enter after sending
      </label>
      {overLimit && (
        <p className="oc-banner--error oc-muted" style={{ fontSize: '11px' }}>
          Too long (max {MAX_INPUT_BYTES} bytes).
        </p>
      )}

      <div className="oc-field__label" style={{ marginTop: 'var(--oc-space-2)' }}>
        Keys
      </div>
      <div className="oc-dock__keys" role="group" aria-label="Send a key">
        {KEY_ALLOWLIST.map((key) => (
          <button
            key={key}
            className="oc-btn oc-dock__key"
            disabled={blocked}
            onClick={() => onKey(key)}
            aria-label={`Send key ${key}`}
          >
            {key}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 'var(--oc-space-2)' }}>
        <button
          className="oc-btn oc-btn--danger"
          disabled={blocked}
          onClick={() => setConfirmOpen(true)}
          aria-label="Interrupt agent"
        >
          Interrupt…
        </button>
      </div>

      {confirmOpen && (
        <ConfirmModal
          title="Interrupt this agent?"
          body="Sends Ctrl-C to the selected pane. This can stop the agent's current work."
          fields={[
            { label: 'agent', value: AGENT_LABEL[orc.agentType] },
            { label: 'target', value: orc.tmuxTarget },
            { label: 'cwd', value: orc.cwd },
            { label: 'command', value: orc.command },
          ]}
          confirmLabel="Interrupt"
          onConfirm={onInterruptConfirm}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

function ContextRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="oc-dock__ctxrow">
      <dt className="oc-field__label">{label}</dt>
      <dd className={`oc-field__value${mono ? ' oc-field__value--mono' : ''}`}>{value}</dd>
    </div>
  );
}

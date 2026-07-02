/**
 * SPEC-203 §2.7 — composed input (the improved CommandDock). A MULTILINE prompt with input HISTORY
 * for the form path (long prompts → POST /input; ⌘/Ctrl+Enter sends), plus the Observe/Control arm
 * toggle (auto-disarm countdown) and the destructive Interrupt button. Short interactive keys
 * (y/n, arrows, Enter) are the viewport's passthrough job (SPEC-401), not this form. Everything is
 * disabled with a reason when the entry predicate fails (token/terminated/stale/disconnected,
 * SPEC-400 §2.11); arm is additionally gated on exposure (no blind write, AC-14). Focus here is a
 * form draft and never leaks to passthrough (§2.7 exclusivity).
 */
import { useRef, useState } from 'react';
import { useServices } from '../../app/services';
import { useStore } from '../../store/store';
import { byteLength, classifyControl, MAX_INPUT_BYTES } from '../../api/control';
import type { ExpectedTarget } from '../../types/api';
import type { Orc } from '../../types/domain';
import type { ControlActions, ControlState } from './useControlMode';

export interface ComposedInputProps {
  orc: Orc;
  disabled: boolean;
  disabledReason: string | null;
  /** Arm is additionally blocked (e.g. exposure off) even when the form path is usable. */
  armBlockedReason: string | null;
  control: ControlState;
  actions: ControlActions;
  onRequestInterrupt: () => void;
}

export function ComposedInput({
  orc,
  disabled,
  disabledReason,
  armBlockedReason,
  control,
  actions,
  onRequestInterrupt,
}: ComposedInputProps): JSX.Element {
  const { api, engine } = useServices();
  const addToast = useStore((s) => s.addToast);
  const [text, setText] = useState('');
  const [submit, setSubmit] = useState(true);
  const [busy, setBusy] = useState(false);
  const historyRef = useRef<string[]>([]);
  const histIdxRef = useRef<number>(-1);

  const expected: ExpectedTarget = {
    paneId: orc.paneId,
    tmuxTarget: orc.tmuxTarget,
    command: orc.command,
    agentType: orc.agentType,
  };
  const overLimit = byteLength(text) > MAX_INPUT_BYTES;
  const blocked = disabled || busy;
  const armed = control.mode === 'control';

  const onSend = async (): Promise<void> => {
    if (blocked || text.length === 0 || overLimit) return;
    setBusy(true);
    const res = await api.sendInput(orc.id, { text, submit, expected });
    setBusy(false);
    const fb = classifyControl(res);
    addToast(fb.severity, fb.message);
    if (fb.shouldRefresh) void engine.refresh();
    if (res.ok) {
      historyRef.current = [...historyRef.current, text].slice(-50);
      histIdxRef.current = -1;
      setText('');
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // ⌘/Ctrl+Enter sends (plain Enter inserts a newline — multiline prompt).
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void onSend();
      return;
    }
    // History recall when the caret is at the very start (does not fight multiline editing).
    const ta = e.currentTarget;
    if (e.key === 'ArrowUp' && ta.selectionStart === 0 && historyRef.current.length > 0) {
      e.preventDefault();
      const hist = historyRef.current;
      histIdxRef.current = histIdxRef.current < 0 ? hist.length - 1 : Math.max(0, histIdxRef.current - 1);
      setText(hist[histIdxRef.current] ?? '');
    } else if (e.key === 'ArrowDown' && histIdxRef.current >= 0) {
      e.preventDefault();
      const hist = historyRef.current;
      const next = histIdxRef.current + 1;
      if (next >= hist.length) {
        histIdxRef.current = -1;
        setText('');
      } else {
        histIdxRef.current = next;
        setText(hist[next] ?? '');
      }
    }
  };

  const remainingS = Math.ceil(control.idleRemainingMs / 1000);

  return (
    <div className="oc-composed" data-testid="composed-input">
      <div className="oc-composed__controls">
        {armed ? (
          <button
            type="button"
            className="oc-btn oc-btn--primary"
            onClick={() => actions.disarm('user')}
            data-testid="disarm-btn"
          >
            Release control
          </button>
        ) : (
          <button
            type="button"
            className="oc-btn"
            disabled={disabled || armBlockedReason !== null || control.arming}
            onClick={actions.arm}
            title={armBlockedReason ?? 'Arm keyboard passthrough (take control)'}
            data-testid="arm-btn"
          >
            {control.arming ? 'Arming…' : 'Take control'}
          </button>
        )}
        <span
          className={'oc-composed__mode' + (armed ? ' oc-composed__mode--control' : '')}
          role="status"
        >
          {armed ? '⌨ CONTROL — armed' : '👁 Observing'}
        </span>
        {armed && (
          <span
            className={'oc-composed__idle' + (control.idleWarn ? ' oc-composed__idle--warn' : '')}
            role="status"
            aria-label={`auto-disarm in ${remainingS} seconds`}
          >
            auto-disarm {remainingS}s
          </span>
        )}
        <button
          type="button"
          className="oc-btn oc-btn--danger"
          disabled={blocked}
          onClick={onRequestInterrupt}
          aria-label="Interrupt agent"
        >
          Interrupt…
        </button>
      </div>

      {armBlockedReason && !armed && (
        <p className="oc-muted" style={{ fontSize: '11px' }}>
          Control unavailable: {armBlockedReason}.
        </p>
      )}
      {control.error && (
        <p className="oc-banner--error oc-muted" role="alert" style={{ fontSize: '11px' }}>
          {control.error}
        </p>
      )}
      {disabled && disabledReason && (
        <p className="oc-muted" style={{ fontSize: '11px' }}>
          Input disabled: {disabledReason}.
        </p>
      )}

      <label htmlFor="oc-composed-text" className="oc-sr-only">
        Prompt to send to the agent
      </label>
      <textarea
        id="oc-composed-text"
        className="oc-composed__text"
        value={text}
        rows={2}
        placeholder="Type a prompt… (⌘/Ctrl+Enter to send)"
        disabled={blocked}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="oc-composed__send">
        <label className="oc-dock__submit">
          <input
            type="checkbox"
            checked={submit}
            disabled={blocked}
            onChange={(e) => setSubmit(e.target.checked)}
          />{' '}
          press Enter after sending
        </label>
        <button
          className="oc-btn oc-btn--primary"
          disabled={blocked || text.length === 0 || overLimit}
          onClick={() => void onSend()}
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
      {overLimit && (
        <p className="oc-banner--error oc-muted" style={{ fontSize: '11px' }}>
          Too long (max {MAX_INPUT_BYTES} bytes).
        </p>
      )}
    </div>
  );
}

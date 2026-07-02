/**
 * SPEC-203 §2.6 + SPEC-401 client — Observe/Control mode state machine (arm/disarm lifecycle).
 *
 * arm() → POST /passthrough/arm (revalidates server-side, egress-free); on success we enter
 * Control with the server's `idleTimeoutMs` (never a client-invented value). Every keystroke calls
 * notifyKeystroke() to reset the idle timer; auto-disarm fires in step with the server when the
 * countdown expires. Exposure-off / disconnect / non-controllable force a disarm (blind-write and
 * dead-target guards, SPEC-401 §2.3/§2.6, AC-14).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/services';
import { idleStatus } from '../../terminal/controlMode';
import { PASSTHROUGH_IDLE_MS } from '../../terminal/passthrough';
import type { ExpectedTarget } from '../../types/api';
import type { Orc } from '../../types/domain';

export type ControlMode = 'observe' | 'control';
export type DisarmReason = 'user' | 'idle_timeout' | 'exposure_off' | 'not_controllable' | 'disconnected';

export interface ControlState {
  mode: ControlMode;
  armSessionId: string | null;
  idleRemainingMs: number;
  idleWarn: boolean;
  arming: boolean;
  error: string | null;
}

export interface ControlActions {
  arm: () => void;
  disarm: (reason?: DisarmReason) => void;
  notifyKeystroke: () => void;
}

const ARM_ERROR: Record<string, string> = {
  exposure_off: 'Enable preview exposure before taking control (can’t type into a hidden pane).',
  target_gone: 'Target is gone (pane closed).',
  target_mismatch: 'Target changed since you last looked — re-check before controlling.',
  not_controllable: 'This orc is not controllable (terminated/stale).',
  orc_not_found: 'Orc no longer exists.',
  unauthorized: 'Not authorized. Re-open the boot URL.',
};

export function useControlMode(
  orc: Orc | undefined,
  env: { exposureEnabled: boolean; connected: boolean; controllable: boolean },
): [ControlState, ControlActions] {
  const { api } = useServices();
  const [mode, setMode] = useState<ControlMode>('observe');
  const [armSessionId, setArmSessionId] = useState<string | null>(null);
  const [arming, setArming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const idleTimeoutRef = useRef(PASSTHROUGH_IDLE_MS);
  const lastKeystrokeRef = useRef(0);
  const armSessionRef = useRef<string | null>(null);
  armSessionRef.current = armSessionId;

  const disarm = useCallback(
    (_reason: DisarmReason = 'user') => {
      const sid = armSessionRef.current;
      setMode('observe');
      setArmSessionId(null);
      if (sid && orc) void api.disarmPassthrough(orc.id, { armSessionId: sid });
    },
    [api, orc],
  );

  const arm = useCallback(() => {
    if (!orc) return;
    setArming(true);
    setError(null);
    const expected: ExpectedTarget = {
      paneId: orc.paneId,
      tmuxTarget: orc.tmuxTarget,
      command: orc.command,
      agentType: orc.agentType,
    };
    void api.armPassthrough(orc.id, { expected }).then((res) => {
      setArming(false);
      if (res.ok) {
        idleTimeoutRef.current = res.data.idleTimeoutMs || PASSTHROUGH_IDLE_MS;
        lastKeystrokeRef.current = Date.now();
        setArmSessionId(res.data.armSessionId);
        setMode('control');
      } else {
        setError(ARM_ERROR[res.error.code] ?? res.error.message ?? 'Could not take control.');
      }
    });
  }, [api, orc]);

  const notifyKeystroke = useCallback(() => {
    lastKeystrokeRef.current = Date.now();
  }, []);

  // Auto-disarm countdown (SPEC-203 §2.6): tick while armed; disarm when the server idle window
  // elapses. UI trusts the arm response's idleTimeoutMs.
  useEffect(() => {
    if (mode !== 'control') return;
    const id = setInterval(() => {
      const s = idleStatus(
        { idleTimeoutMs: idleTimeoutRef.current, lastKeystrokeAt: lastKeystrokeRef.current },
        Date.now(),
      );
      if (s.expired) disarm('idle_timeout');
      else setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [mode, disarm]);

  // Guard rails: leaving the controllable window forces a disarm (AC-14 + dead-target).
  useEffect(() => {
    if (mode !== 'control') return;
    if (!env.exposureEnabled) disarm('exposure_off');
    else if (!env.connected) disarm('disconnected');
    else if (!env.controllable) disarm('not_controllable');
  }, [mode, env.exposureEnabled, env.connected, env.controllable, disarm]);

  // Disarm when the selected orc changes / unmounts.
  useEffect(() => {
    return () => {
      if (armSessionRef.current && orc) void api.disarmPassthrough(orc.id, { armSessionId: armSessionRef.current });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orc?.id]);

  const s = idleStatus(
    { idleTimeoutMs: idleTimeoutRef.current, lastKeystrokeAt: lastKeystrokeRef.current },
    Date.now(),
  );
  const state: ControlState = {
    mode,
    armSessionId,
    idleRemainingMs: mode === 'control' ? s.remainingMs : idleTimeoutRef.current,
    idleWarn: mode === 'control' && s.warn,
    arming,
    error,
  };
  return [state, { arm, disarm, notifyKeystroke }];
}

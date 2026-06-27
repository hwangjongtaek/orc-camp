/**
 * SPEC-400 §2.4/§2.9/§2.11 — client-side control constants + result classification.
 *
 * KEY_ALLOWLIST mirrors the server's fixed set (destructive chords excluded). The
 * classifier maps a control ApiResult to a pessimistic-flow feedback (toast severity +
 * message + whether the inspector should force-refresh because the target changed).
 */
import type { ApiResult } from './client';
import type { ControlResultBody } from '../types/api';

/** SPEC-400 §2.4 — fixed key allowlist (tmux key tokens). */
export const KEY_ALLOWLIST = [
  'Enter',
  'Tab',
  'BTab',
  'Escape',
  'Space',
  'BSpace',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Delete',
] as const;

export type AllowlistKey = (typeof KEY_ALLOWLIST)[number];

/** SPEC-400 §3 — MAX_INPUT_BYTES hypothesis (4 KiB). */
export const MAX_INPUT_BYTES = 4096;

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export type ControlFlowState = 'idle' | 'submitting' | 'success' | 'aborted' | 'failed';

export interface ControlFeedback {
  flow: ControlFlowState;
  severity: 'info' | 'warn' | 'error';
  message: string;
  shouldRefresh: boolean; // target changed → force inspector/snapshot refresh
}

/**
 * SPEC-400 §2.11 — map a control result to user-safe feedback. NO optimistic status
 * change is implied; the real orc state change arrives via WS.
 */
export function classifyControl(res: ApiResult<ControlResultBody>): ControlFeedback {
  if (res.ok) {
    const { action, outcome } = res.data;
    if (outcome === 'partial') {
      return {
        flow: 'success',
        severity: 'warn',
        message: 'Text sent, but Enter may not have registered.',
        shouldRefresh: false,
      };
    }
    const verb = action === 'interrupt' ? 'Interrupt sent' : action === 'key' ? 'Key sent' : 'Input sent';
    return { flow: 'success', severity: 'info', message: `${verb}.`, shouldRefresh: false };
  }

  const { code, message } = res.error;
  switch (code) {
    case 'target_gone':
      return { flow: 'aborted', severity: 'warn', message: 'Target is gone (pane closed). Send cancelled — refreshing.', shouldRefresh: true };
    case 'target_mismatch':
      return { flow: 'aborted', severity: 'warn', message: 'Target changed since you last looked. Send cancelled — refreshing.', shouldRefresh: true };
    case 'not_controllable':
      return { flow: 'aborted', severity: 'warn', message: 'This orc is not controllable (terminated/stale).', shouldRefresh: true };
    case 'orc_not_found':
      return { flow: 'aborted', severity: 'warn', message: 'Orc no longer exists — refreshing.', shouldRefresh: true };
    case 'confirm_required':
      return { flow: 'aborted', severity: 'warn', message: 'Confirmation required for interrupt.', shouldRefresh: false };
    case 'key_not_allowed':
      return { flow: 'failed', severity: 'error', message: 'That key is not allowed.', shouldRefresh: false };
    case 'validation_error':
      return { flow: 'failed', severity: 'error', message: message || 'Invalid request.', shouldRefresh: false };
    case 'rate_limited':
      return { flow: 'aborted', severity: 'warn', message: 'Rate limited — slow down and retry.', shouldRefresh: false };
    case 'tmux_exec_failed':
      return { flow: 'failed', severity: 'error', message: 'tmux failed to deliver the action.', shouldRefresh: false };
    case 'unauthorized':
      return { flow: 'failed', severity: 'error', message: 'Not authorized. Re-open the boot URL.', shouldRefresh: false };
    case 'snapshot_not_ready':
      return { flow: 'aborted', severity: 'warn', message: 'Server is not ready yet.', shouldRefresh: false };
    default:
      return { flow: 'failed', severity: 'error', message: message || 'Control action failed.', shouldRefresh: false };
  }
}

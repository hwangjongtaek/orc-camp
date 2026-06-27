import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandDock } from '../src/components/control/CommandDock';
import { ServicesProvider, type AppServices } from '../src/app/services';
import { setToken } from '../src/api/token';
import { useStore } from '../src/store/store';
import type { ApiResult } from '../src/api/client';
import type { ControlResultBody } from '../src/types/api';
import { makeOrc } from './fixtures';

function okResult(over: Partial<ControlResultBody> = {}): ApiResult<ControlResultBody> {
  return {
    ok: true,
    status: 200,
    etag: null,
    data: {
      ok: true,
      action: 'input',
      orcId: 'pane:%12',
      paneId: '%12',
      tmuxTarget: 'work:0.0',
      outcome: 'success',
      executedAt: '2026-06-28T00:00:00.000Z',
      requestId: null,
      auditEventId: 'a1',
      ...over,
    },
  };
}
function errResult(code: string, status: number): ApiResult<ControlResultBody> {
  return { ok: false, status, retryAfterMs: null, error: { code, message: code, requestId: '', scope: 'orc', status } };
}

interface FakeApi {
  sendInput: ReturnType<typeof vi.fn>;
  sendKey: ReturnType<typeof vi.fn>;
  sendInterrupt: ReturnType<typeof vi.fn>;
}

function makeServices(): { services: AppServices; api: FakeApi; refresh: ReturnType<typeof vi.fn> } {
  const api: FakeApi = {
    sendInput: vi.fn().mockResolvedValue(okResult()),
    sendKey: vi.fn().mockResolvedValue(okResult({ action: 'key' })),
    sendInterrupt: vi.fn().mockResolvedValue(okResult({ action: 'interrupt' })),
  };
  const refresh = vi.fn().mockResolvedValue(undefined);
  return { services: { api: api as never, engine: { refresh } as never }, api, refresh };
}

const orc = makeOrc({ paneId: '%12', tmuxTarget: 'work:0.0', command: 'node', agentType: 'claude-code', cwd: '/p' });

beforeEach(() => {
  setToken('tok');
  useStore.setState({ toasts: [] });
});

function renderDock(services: AppServices, disabled = false) {
  return render(
    <ServicesProvider services={services}>
      <CommandDock orc={orc} disabled={disabled} disabledReason={disabled ? 'disconnected' : null} />
    </ServicesProvider>,
  );
}

describe('CommandDock (SPEC-400 §2.11)', () => {
  it('renders the 4 context fields (R-CTRL-006)', () => {
    const { services } = makeServices();
    renderDock(services);
    expect(screen.getByText('Claude Code')).toBeTruthy();
    expect(screen.getByText('work:0.0')).toBeTruthy();
    expect(screen.getByText('/p')).toBeTruthy();
    expect(screen.getByText('node')).toBeTruthy();
  });

  it('sends input with expected={paneId,tmuxTarget,command,agentType} and shows success toast', async () => {
    const user = userEvent.setup();
    const { services, api } = makeServices();
    renderDock(services);
    const input = screen.getByPlaceholderText('Type text to send…') as HTMLInputElement;
    await user.type(input, 'hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(api.sendInput).toHaveBeenCalledTimes(1));
    expect(api.sendInput).toHaveBeenCalledWith('pane:%12', {
      text: 'hello',
      submit: true,
      expected: { paneId: '%12', tmuxTarget: 'work:0.0', command: 'node', agentType: 'claude-code' },
    });
    const toasts = useStore.getState().toasts;
    expect(toasts.at(-1)?.severity).toBe('info');
    expect(input.value).toBe(''); // cleared on success
  });

  it('sends an allowlist key', async () => {
    const user = userEvent.setup();
    const { services, api } = makeServices();
    renderDock(services);
    await user.click(screen.getByRole('button', { name: 'Send key Enter' }));
    await waitFor(() => expect(api.sendKey).toHaveBeenCalledTimes(1));
    expect(api.sendKey).toHaveBeenCalledWith('pane:%12', {
      key: 'Enter',
      expected: { paneId: '%12', tmuxTarget: 'work:0.0', command: 'node', agentType: 'claude-code' },
    });
  });

  it('abort (target_mismatch) → warning toast + forced refresh, no optimistic change', async () => {
    const user = userEvent.setup();
    const { services, api, refresh } = makeServices();
    api.sendInput.mockResolvedValueOnce(errResult('target_mismatch', 409));
    renderDock(services);
    await user.type(screen.getByPlaceholderText('Type text to send…'), 'x');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(useStore.getState().toasts.at(-1)?.severity).toBe('warn');
  });

  it('disables all controls when the entry predicate is disabled (AC-14)', () => {
    const { services } = makeServices();
    renderDock(services, true);
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Send key Enter' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Interrupt agent' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('interrupt → confirm modal: focus trapped on Cancel, double-gate confirmed:true', async () => {
    const user = userEvent.setup();
    const { services, api } = makeServices();
    renderDock(services);

    await user.click(screen.getByRole('button', { name: 'Interrupt agent' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    // initial focus on the safe default (Cancel)
    await waitFor(() => expect(document.activeElement).toBe(cancel));

    // focus trap: Shift+Tab from Cancel wraps to the last focusable (Interrupt confirm)
    const confirm = screen.getByRole('button', { name: 'Interrupt' });
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);

    // Escape cancels without sending
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.sendInterrupt).not.toHaveBeenCalled();

    // reopen + confirm → sendInterrupt with confirmed:true
    await user.click(screen.getByRole('button', { name: 'Interrupt agent' }));
    await user.click(screen.getByRole('button', { name: 'Interrupt' }));
    await waitFor(() => expect(api.sendInterrupt).toHaveBeenCalledTimes(1));
    expect(api.sendInterrupt).toHaveBeenCalledWith('pane:%12', {
      confirmed: true,
      expected: { paneId: '%12', tmuxTarget: 'work:0.0', command: 'node', agentType: 'claude-code' },
    });
  });
});

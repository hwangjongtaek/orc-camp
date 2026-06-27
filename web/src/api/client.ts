/**
 * SPEC-200 §2.6.3 — single REST client.
 *
 * Attaches `Authorization: Bearer <token>` (CSRF-resistant, non-simple → preflight) to
 * every protected request, maps `ApiError {code,message,requestId}` to a user-safe
 * `ClientApiError` (message only; requestId kept for diagnostics, never shown), and
 * surfaces `Retry-After` for 503/429 backoff. The client only talks to the local API.
 */
import { getToken } from './token';
import type {
  ApiErrorBody,
  CampResponse,
  ClientApiError,
  OrcPreviewResponse,
  SettingsResponse,
  SnapshotResponse,
} from '../types/api';

export type ApiResult<T> =
  | { ok: true; status: number; data: T; etag: string | null }
  | { ok: false; status: number; error: ClientApiError; retryAfterMs: number | null };

type Scope = 'global' | 'camp' | 'orc';

function retryAfterMs(res: Response): number | null {
  const h = res.headers.get('Retry-After');
  if (!h) return null;
  const secs = Number(h);
  return Number.isFinite(secs) ? Math.max(0, secs * 1000) : null;
}

async function toClientError(res: Response, scope: Scope): Promise<ClientApiError> {
  let code = `http_${res.status}`;
  let message = res.statusText || 'request failed';
  let requestId = '';
  try {
    const body = (await res.json()) as ApiErrorBody;
    if (body && body.error) {
      code = body.error.code || code;
      message = body.error.message || message;
      requestId = body.error.requestId || '';
    }
  } catch {
    /* non-JSON error body; keep status-derived defaults */
  }
  return { code, message, requestId, scope, status: res.status };
}

function networkError(scope: Scope): ClientApiError {
  return {
    code: 'network_error',
    message: 'Could not reach the local server. Is it still running?',
    requestId: '',
    scope,
    status: null,
  };
}

export class ApiClient {
  constructor(private readonly apiBase: string) {}

  private async request<T>(
    path: string,
    init: RequestInit,
    scope: Scope,
  ): Promise<ApiResult<T>> {
    const token = getToken();
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);

    let res: Response;
    try {
      res = await fetch(`${this.apiBase}${path}`, { ...init, headers });
    } catch {
      return { ok: false, status: 0, error: networkError(scope), retryAfterMs: null };
    }

    if (res.ok) {
      const etag = res.headers.get('ETag');
      // 204/empty-safe parse
      const text = await res.text();
      const data = (text ? JSON.parse(text) : undefined) as T;
      return { ok: true, status: res.status, data, etag };
    }
    return {
      ok: false,
      status: res.status,
      error: await toClientError(res, scope),
      retryAfterMs: retryAfterMs(res),
    };
  }

  getSnapshot(): Promise<ApiResult<SnapshotResponse>> {
    return this.request('/api/snapshot', { method: 'GET' }, 'global');
  }

  refresh(): Promise<ApiResult<SnapshotResponse>> {
    return this.request('/api/refresh', { method: 'POST' }, 'global');
  }

  getCamp(campId: string): Promise<ApiResult<CampResponse>> {
    return this.request(`/api/camps/${encodeURIComponent(campId)}`, { method: 'GET' }, 'camp');
  }

  getOrcPreview(orcId: string): Promise<ApiResult<OrcPreviewResponse>> {
    return this.request(
      `/api/orcs/${encodeURIComponent(orcId)}/preview`,
      { method: 'GET' },
      'orc',
    );
  }

  getSettings(): Promise<ApiResult<SettingsResponse>> {
    return this.request('/api/settings', { method: 'GET' }, 'global');
  }

  patchSettings(patch: Record<string, unknown>): Promise<ApiResult<SettingsResponse>> {
    return this.request(
      '/api/settings',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
      'global',
    );
  }
}

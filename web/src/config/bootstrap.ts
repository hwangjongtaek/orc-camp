/**
 * SPEC-200 §2.2/§2.6.1 — boot-URL parameter capture.
 *
 * The dashboard boot URL is `http://127.0.0.1:<port>/?token=<token>` (SPEC-100 §2.9).
 * We read `token` once, move it to the in-memory holder, then `history.replaceState`
 * to strip it from the visible URL (D-034 (d)). We also support two dev overrides:
 *   - `?api=<origin>`    REST/WS origin (default: same origin → works for prod build)
 *   - `?assets=<base>`   asset-pack base path (default `/asset-pack`, served in dev)
 * Both are stripped from the URL alongside the token.
 */
import { setToken } from '../api/token';

export interface BootConfig {
  hadToken: boolean;
  apiBase: string; // no trailing slash
  wsBase: string; // ws:// or wss:// origin
  assetBase: string; // no trailing slash
}

const DEFAULT_ASSET_BASE = '/asset-pack';

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function toWsBase(httpOrigin: string): string {
  return httpOrigin.replace(/^http/i, (m) => (m.toLowerCase() === 'https' ? 'wss' : 'ws'));
}

function resolveApiBase(params: URLSearchParams): string {
  const fromQuery = params.get('api');
  if (fromQuery) return stripTrailingSlash(fromQuery);
  const fromEnv = import.meta.env.VITE_API_BASE as string | undefined;
  if (fromEnv) return stripTrailingSlash(fromEnv);
  return stripTrailingSlash(window.location.origin);
}

function resolveAssetBase(params: URLSearchParams): string {
  const fromQuery = params.get('assets');
  if (fromQuery) return stripTrailingSlash(fromQuery);
  const fromEnv = import.meta.env.VITE_ASSET_BASE as string | undefined;
  if (fromEnv) return stripTrailingSlash(fromEnv);
  return DEFAULT_ASSET_BASE;
}

/** Capture boot params, move the token to memory, and scrub the URL. Call once at init. */
export function captureBoot(): BootConfig {
  const url = new URL(window.location.href);
  const params = url.searchParams;

  const token = params.get('token');
  setToken(token);
  const hadToken = token !== null && token.length > 0;

  const apiBase = resolveApiBase(params);
  const assetBase = resolveAssetBase(params);

  // Scrub sensitive / bootstrap-only params from the visible URL (token never lingers).
  let scrubbed = false;
  for (const key of ['token', 'api', 'assets']) {
    if (params.has(key)) {
      params.delete(key);
      scrubbed = true;
    }
  }
  if (scrubbed) {
    const next = url.pathname + (params.toString() ? `?${params.toString()}` : '') + url.hash;
    window.history.replaceState(window.history.state, '', next);
  }

  return {
    hadToken,
    apiBase,
    wsBase: toWsBase(apiBase),
    assetBase,
  };
}

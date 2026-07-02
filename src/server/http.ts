/**
 * SPEC-100 §2.6/§2.7 + SPEC-101 §2.5–2.11 — HTTP server wiring + REST routes.
 *
 * Request pipeline: Host validation (DNS rebinding) → CORS (allowlist) → auth
 * (timing-safe Bearer; health + preflight exempt) → route → ApiError envelope.
 * Read-only API over the snapshot runtime; the only state-changer is POST /api/refresh.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { SnapshotRuntime } from './runtime';
import {
  corsHeadersFor,
  isAllowedHost,
  isAllowedOrigin,
  type SecurityConfig,
} from './security';
import { bearerFromAuthHeader, tokensEqual } from './token';
import { attachWebSocket } from './ws';
import type { SettingsStore } from './settings';
import type { ControlService, ControlAction } from './control';
import type { PassthroughService, ExpectedTarget } from './passthrough';
import type { ApiError } from './types';

const CAMP_ID_RE = /^session:\$[0-9]+$/;
const ORC_ID_RE = /^pane:%[0-9]+$/;
const REFRESH_MIN_MS = 1000; // R_min (PoC hypothesis)

export interface HttpConfig {
  runtime: SnapshotRuntime;
  security: SecurityConfig;
  settings: SettingsStore;
  control: ControlService;
  passthrough: PassthroughService;
  token: string;
  now: () => Date;
  heartbeatMs?: number;
}

const PLACEHOLDER_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Orc Camp</title></head>
<body style="font-family:system-ui;background:#1a1410;color:#e8dcc8;padding:2rem">
<h1>🏕️ Orc Camp server</h1>
<p>The local server is running. The dashboard SPA (Epic 3) is not built yet.</p>
<p>API is token-gated. Try <code>GET /api/health</code> (no token) or
<code>GET /api/snapshot</code> with <code>Authorization: Bearer &lt;token&gt;</code>.</p>
</body></html>`;

interface ServerState {
  lastRefreshMs: number;
}

export function createHttpServer(cfg: HttpConfig): Server {
  const state: ServerState = { lastRefreshMs: 0 };
  const server = createServer((req, res) => {
    handle(req, res, cfg, state).catch((err) => {
      // Guard against a throw after headers were already sent (avoids ERR_HTTP_HEADERS_SENT).
      if (!res.headersSent) {
        sendError(res, 500, 'internal_error', 'internal server error', newRequestId(), undefined, {});
      } else {
        res.end();
      }
      // (detail would go to the debug log; never leak to the user surface)
      void err;
    });
  });
  attachWebSocket(server, { runtime: cfg.runtime, security: cfg.security, token: cfg.token, now: cfg.now, ...(cfg.heartbeatMs !== undefined ? { heartbeatMs: cfg.heartbeatMs } : {}) });
  return server;
}

function newRequestId(): string {
  return randomBytes(6).toString('hex');
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(payload);
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  requestId: string,
  fieldErrors: ApiError['error']['fieldErrors'] | undefined,
  headers: Record<string, string>,
): void {
  const body: ApiError = { error: { code, message, requestId, ...(fieldErrors ? { fieldErrors } : {}) } };
  sendJson(res, status, body, headers);
}

async function handle(req: IncomingMessage, res: ServerResponse, cfg: HttpConfig, state: ServerState): Promise<void> {
  const { runtime, security, token } = cfg;
  const method = (req.method ?? 'GET').toUpperCase();
  const origin = header(req, 'origin');
  const hostHeader = header(req, 'host');

  // 1) Host validation (DNS rebinding defense, AC-19)
  if (!isAllowedHost(hostHeader, security)) {
    sendError(res, 403, 'forbidden', 'host not allowed', newRequestId(), undefined, {});
    return;
  }

  // 2) CORS
  const cors = corsHeadersFor(origin, security);
  if (origin && cors === null) {
    // disallowed origin: no permissive CORS headers; preflight rejected
    if (method === 'OPTIONS') {
      res.writeHead(403).end();
      return;
    }
  }
  const corsHeaders = cors ?? {};
  if (method === 'OPTIONS') {
    res.writeHead(204, corsHeaders).end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${hostHeader ?? '127.0.0.1'}`);
  const segments = url.pathname.split('/').filter(Boolean);

  // Non-API: serve the placeholder shell (token not required to view the SPA shell).
  if (segments[0] !== 'api') {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders });
      res.end(PLACEHOLDER_HTML);
      return;
    }
    sendError(res, 404, 'not_found', 'not found', newRequestId(), undefined, corsHeaders);
    return;
  }

  const requestId = newRequestId();
  const route = segments.slice(1); // after 'api'

  // 3) Health is the only token-exempt API (D-024)
  if (route.length === 1 && route[0] === 'health' && method === 'GET') {
    sendJson(res, 200, runtime.getHealth(), corsHeaders);
    return;
  }

  // 4) Auth (timing-safe Bearer) for all other /api/*
  const provided = bearerFromAuthHeader(header(req, 'authorization'));
  if (!tokensEqual(token, provided)) {
    sendError(res, 401, 'unauthorized', 'missing or invalid token', requestId, undefined, corsHeaders);
    return;
  }

  // 5) Routes
  if (route[0] === 'snapshot' && route.length === 1) {
    if (method !== 'GET') return methodNotAllowed(res, requestId, corsHeaders);
    const snap = runtime.getSnapshot();
    if (snap === null) {
      sendError(res, 503, 'snapshot_not_ready', 'snapshot not ready', requestId, undefined, { ...corsHeaders, 'Retry-After': '1' });
      return;
    }
    const etag = `"${snap.snapshotVersion}"`;
    if (header(req, 'if-none-match') === etag) {
      res.writeHead(304, { ...corsHeaders, ETag: etag }).end();
      return;
    }
    sendJson(res, 200, snap, { ...corsHeaders, ETag: etag });
    return;
  }

  if (route[0] === 'camps' && route.length === 2) {
    if (method !== 'GET') return methodNotAllowed(res, requestId, corsHeaders);
    const campId = decode(route[1]!);
    if (!CAMP_ID_RE.test(campId)) {
      sendError(res, 400, 'bad_request', 'invalid camp id', requestId, undefined, corsHeaders);
      return;
    }
    const camp = runtime.getCamp(campId);
    if (!camp) {
      sendError(res, 404, 'camp_not_found', 'camp not found', requestId, undefined, corsHeaders);
      return;
    }
    sendJson(res, 200, {
      snapshotVersion: runtime.snapshotVersion,
      runtimeEpoch: runtime.runtimeEpoch,
      emittedAt: cfg.now().toISOString(),
      data: camp,
    }, { ...corsHeaders, ETag: `"${runtime.snapshotVersion}"` });
    return;
  }

  if (route[0] === 'orcs' && route.length === 3 && route[2] === 'preview') {
    if (method !== 'GET') return methodNotAllowed(res, requestId, corsHeaders);
    const orcId = decode(route[1]!);
    if (!ORC_ID_RE.test(orcId)) {
      sendError(res, 400, 'bad_request', 'invalid orc id', requestId, undefined, corsHeaders);
      return;
    }
    const preview = runtime.getOrcPreview(orcId);
    if (preview === undefined) {
      sendError(res, 404, 'orc_not_found', 'orc not found', requestId, undefined, corsHeaders);
      return;
    }
    sendJson(res, 200, preview, corsHeaders);
    return;
  }

  // SPEC-400 control actions (state-changing; behind the auth gate above)
  if (route[0] === 'orcs' && route.length === 3 && (route[2] === 'input' || route[2] === 'key' || route[2] === 'interrupt')) {
    if (method !== 'POST') return methodNotAllowed(res, requestId, corsHeaders);
    const orcId = decode(route[1]!);
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendError(res, 400, 'bad_request', 'invalid JSON body', requestId, undefined, corsHeaders);
      return;
    }
    const result = await cfg.control.handle(route[2] as ControlAction, orcId, body);
    sendJson(res, result.status, result.body, corsHeaders);
    return;
  }

  // SPEC-401 passthrough arm/disarm (no egress; behind the auth gate). length 4.
  if (route[0] === 'orcs' && route.length === 4 && route[2] === 'passthrough' && (route[3] === 'arm' || route[3] === 'disarm')) {
    if (method !== 'POST') return methodNotAllowed(res, requestId, corsHeaders);
    const orcId = decode(route[1]!);
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendError(res, 400, 'bad_request', 'invalid JSON body', requestId, undefined, corsHeaders);
      return;
    }
    if (route[3] === 'arm') {
      const expected = validateExpectedBody(body);
      if (!expected) {
        sendError(res, 422, 'validation_error', 'invalid or missing expected target', requestId, undefined, corsHeaders);
        return;
      }
      const result = await cfg.passthrough.arm(orcId, expected);
      sendJson(res, result.status, result.body, corsHeaders);
      return;
    }
    const armSessionId = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).armSessionId : undefined;
    const result = cfg.passthrough.disarm(orcId, armSessionId);
    sendJson(res, result.status, result.body, corsHeaders);
    return;
  }

  if (route[0] === 'refresh' && route.length === 1) {
    if (method !== 'POST') return methodNotAllowed(res, requestId, corsHeaders);
    const nowMs = cfg.now().getTime();
    if (state.lastRefreshMs > 0 && nowMs - state.lastRefreshMs < REFRESH_MIN_MS) {
      sendError(res, 429, 'refresh_rate_limited', 'refresh rate limited', requestId, undefined, { ...corsHeaders, 'Retry-After': '1' });
      return;
    }
    state.lastRefreshMs = nowMs;
    const snap = await runtime.refresh();
    if (snap === null) {
      sendError(res, 503, 'snapshot_not_ready', 'snapshot not ready', requestId, undefined, { ...corsHeaders, 'Retry-After': '1' });
      return;
    }
    sendJson(res, 200, snap, corsHeaders);
    return;
  }

  if (route[0] === 'settings' && route.length === 1) {
    if (method === 'GET') {
      sendJson(res, 200, cfg.settings.response(), corsHeaders);
      return;
    }
    if (method === 'PATCH') {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendError(res, 400, 'bad_request', 'invalid JSON body', requestId, undefined, corsHeaders);
        return;
      }
      const wasExposed = cfg.runtime.previewExposureEnabled();
      const result = cfg.settings.patch(body);
      if (result.ok) {
        // SPEC-401 §2.6 / D-044 — exposure on→off auto-disarms all passthrough
        // sessions (no blind writes); the live-view poll gate handles itself.
        if (wasExposed && !cfg.runtime.previewExposureEnabled()) cfg.passthrough.disposeAll('exposure_off');
        sendJson(res, 200, cfg.settings.response(), corsHeaders);
        return;
      }
      if (result.status === 500) {
        sendError(res, 500, 'config_write_failed', 'could not persist settings', requestId, result.fieldErrors, corsHeaders);
        return;
      }
      sendError(res, 422, 'validation_failed', 'settings validation failed', requestId, result.fieldErrors, corsHeaders);
      return;
    }
    return methodNotAllowed(res, requestId, corsHeaders);
  }

  sendError(res, 404, 'not_found', 'not found', requestId, undefined, corsHeaders);
}

function readJsonBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text === '') {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/** Validate an arm request body `{ expected: {paneId,tmuxTarget,command,agentType} }`. */
function validateExpectedBody(body: unknown): ExpectedTarget | null {
  if (typeof body !== 'object' || body === null) return null;
  const e = (body as Record<string, unknown>).expected;
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return null;
  const o = e as Record<string, unknown>;
  const keys = ['paneId', 'tmuxTarget', 'command', 'agentType'];
  if (Object.keys(o).some((k) => !keys.includes(k))) return null;
  if (keys.some((k) => typeof o[k] !== 'string')) return null;
  return { paneId: o.paneId as string, tmuxTarget: o.tmuxTarget as string, command: o.command as string, agentType: o.agentType as string };
}

function methodNotAllowed(res: ServerResponse, requestId: string, headers: Record<string, string>): void {
  sendError(res, 405, 'method_not_allowed', 'method not allowed', requestId, undefined, headers);
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

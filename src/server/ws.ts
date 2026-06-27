/**
 * SPEC-102 — WebSocket realtime (`/api/events`).
 *
 * Handshake auth (token via query or `Sec-WebSocket-Protocol` subprotocol) + Origin
 * check (close 4401/4403), `welcome` frame first, then per-tick `batch` diff frames,
 * `server_stale_changed`, and `server_heartbeat`. Convergent, version-carrying frames
 * (SPEC-102 §2.2/§2.3); client reconnect/resync is the dashboard's job (Epic 3).
 */
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { SnapshotRuntime } from './runtime';
import { isAllowedOrigin, type SecurityConfig } from './security';
import { tokensEqual } from './token';

export const DEFAULT_HEARTBEAT_MS = 15_000;

export interface WsConfig {
  runtime: SnapshotRuntime;
  security: SecurityConfig;
  token: string;
  now: () => Date;
  heartbeatMs?: number;
}

function extractToken(req: IncomingMessage): string | null {
  try {
    const q = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token');
    if (q) return q;
  } catch {
    /* ignore */
  }
  const proto = req.headers['sec-websocket-protocol'];
  if (proto) {
    const part = String(proto)
      .split(',')
      .map((s) => s.trim())
      .find((p) => p.startsWith('token.'));
    if (part) return part.slice('token.'.length);
  }
  return null;
}

export function attachWebSocket(server: Server, cfg: WsConfig): WebSocketServer {
  const heartbeatMs = cfg.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has('orc-camp.v1') ? 'orc-camp.v1' : false),
  });

  server.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      /* ignore */
    }
    if (pathname !== '/api/events') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws, req, cfg, heartbeatMs));
  });

  return wss;
}

function handleConnection(ws: WebSocket, req: IncomingMessage, cfg: WsConfig, heartbeatMs: number): void {
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  if (origin && !isAllowedOrigin(origin, cfg.security)) {
    ws.close(4403, 'origin not allowed');
    return;
  }
  if (!tokensEqual(cfg.token, extractToken(req))) {
    ws.close(4401, 'missing or invalid token');
    return;
  }

  let seq = 0;
  const send = (type: string, version: number | null, payload: unknown): void => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type, seq: seq++, version, emittedAt: cfg.now().toISOString(), payload }));
    }
  };

  const w = cfg.runtime.welcomeState();
  send('welcome', w.version, {
    protocolVersion: 1,
    version: w.version,
    stale: w.stale,
    lastGoodAt: w.lastGoodAt,
    heartbeatIntervalMs: heartbeatMs,
    runtimeEpoch: w.runtimeEpoch,
    serverStartedAt: w.serverStartedAt,
  });

  const unsub = cfg.runtime.subscribe((e) => {
    if (e.type === 'batch') send('batch', e.version, { version: e.version, changes: e.changes });
    else if (e.type === 'server_stale_changed') send('server_stale_changed', e.version, { stale: e.stale, lastGoodAt: e.lastGoodAt, version: e.version });
    else send('activity', cfg.runtime.snapshotVersion, e.event); // SPEC-600 activity frame
  });

  const hb = setInterval(() => {
    send('server_heartbeat', cfg.runtime.snapshotVersion, { version: cfg.runtime.snapshotVersion, stale: cfg.runtime.currentStale() });
  }, heartbeatMs);
  if (typeof hb.unref === 'function') hb.unref();

  const cleanup = (): void => {
    unsub();
    clearInterval(hb);
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
}

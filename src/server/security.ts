/**
 * SPEC-100 §2.7 — security boundary: CORS allowlist, Host-header validation
 * (DNS-rebinding defense), origin helpers. Token validation lives in token.ts;
 * this module decides which origins/hosts are allowed for the bound (host, port).
 */
export interface SecurityConfig {
  host: string; // bound host
  port: number; // actual bound port
  allowExternal: boolean;
  devOrigins: string[]; // FE dev server origins (e.g. http://localhost:5173)
}

/** Dashboard own origins (loopback + bound host) for the actual port. */
export function ownOrigins(cfg: SecurityConfig): string[] {
  const origins = new Set<string>([
    `http://127.0.0.1:${cfg.port}`,
    `http://localhost:${cfg.port}`,
  ]);
  if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') {
    origins.add(`http://${cfg.host}:${cfg.port}`);
  }
  return [...origins];
}

export function allowedOrigins(cfg: SecurityConfig): Set<string> {
  return new Set([...ownOrigins(cfg), ...cfg.devOrigins]);
}

export function isAllowedOrigin(origin: string | undefined, cfg: SecurityConfig): boolean {
  if (!origin) return true; // no Origin = non-browser/same-origin; CORS not applicable
  return allowedOrigins(cfg).has(origin);
}

/** Allowed Host header values for the bound (host, port) — strict for loopback. */
export function allowedHosts(cfg: SecurityConfig): Set<string> {
  const hosts = new Set<string>([
    `127.0.0.1:${cfg.port}`,
    `localhost:${cfg.port}`,
    `[::1]:${cfg.port}`,
  ]);
  if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') hosts.add(`${cfg.host}:${cfg.port}`);
  return hosts;
}

/**
 * Host-header validation (DNS rebinding defense, AC-19). Loopback binds enforce a
 * strict host set; external binds (user opted in via --allow-external) accept any
 * Host since the LAN client set can't be enumerated.
 */
export function isAllowedHost(hostHeader: string | undefined, cfg: SecurityConfig): boolean {
  if (cfg.allowExternal) return true; // user accepted exposure
  if (!hostHeader) return false;
  return allowedHosts(cfg).has(hostHeader.trim());
}

const CORS_METHODS = 'GET,POST,PATCH,OPTIONS';
const CORS_HEADERS = 'Authorization,Content-Type';

/** CORS response headers for an allowed origin, or null when not allowed. */
export function corsHeadersFor(
  origin: string | undefined,
  cfg: SecurityConfig,
): Record<string, string> | null {
  if (!origin) return {}; // no Origin → no CORS headers needed (request proceeds)
  if (!allowedOrigins(cfg).has(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': CORS_METHODS,
    'Access-Control-Allow-Headers': CORS_HEADERS,
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

/**
 * SPEC-100 §2.5 — port selection with fallback.
 *
 * - No --port: try preferred port; on EADDRINUSE fall back to an OS-assigned
 *   ephemeral port (port 0). Any failure → throw (caller → exit 1).
 * - Explicit --port: try only that port; on conflict throw (no silent fallback,
 *   D-034 (b)).
 */
import { createServer, type Server } from 'node:http';

export const PREFERRED_PORT = 4123; // P_pref (PoC hypothesis)

function tryListen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve(actual);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

export interface BindResult {
  port: number;
  fellBack: boolean;
}

/**
 * Bind `server` to (host, port) per the fallback policy. Returns the actual port.
 * `explicit` = true when the user passed --port (no ephemeral fallback).
 */
export async function bindWithFallback(
  server: Server,
  host: string,
  preferred: number,
  explicit: boolean,
): Promise<BindResult> {
  try {
    const port = await tryListen(server, host, preferred);
    return { port, fellBack: false };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EADDRINUSE') throw err;
    if (explicit) {
      const e = new Error(`port ${preferred} is already in use`) as NodeJS.ErrnoException;
      e.code = 'EADDRINUSE';
      throw e;
    }
    // ephemeral fallback (port 0 → OS assigns)
    const port = await tryListen(server, host, 0);
    return { port, fellBack: true };
  }
}

/** Probe whether a port is bindable on host (doctor check; does not keep it open). */
export async function isPortAvailable(host: string, port: number): Promise<boolean> {
  const probe = createServer();
  try {
    await tryListen(probe, host, port);
    await new Promise<void>((r) => probe.close(() => r()));
    return true;
  } catch {
    return false;
  }
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
export function isLoopback(host: string): boolean {
  return LOOPBACK.has(host);
}

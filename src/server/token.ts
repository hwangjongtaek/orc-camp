/**
 * SPEC-100 §2.6 — startup token: CSPRNG generation + constant-time validation.
 *
 * Token is created once per process, kept in memory only, never persisted
 * (R-CLI-007). Comparison is constant-time and length-safe (AC-16).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit CSPRNG token, base64url (~43 chars). Entropy floor 128-bit (SPEC-100 §2.6). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Constant-time token comparison. Length mismatch returns false without leaking
 * timing (we still run a fixed compare against a same-length buffer).
 */
export function tokensEqual(expected: string, provided: string | null | undefined): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) {
    // Compare against self to keep timing independent of where the mismatch is.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Extract a Bearer token from an Authorization header value. */
export function bearerFromAuthHeader(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1]!.trim() : null;
}

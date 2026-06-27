/**
 * SPEC-200 invariant ④ / SPEC-100 §2.6 — in-memory token holder.
 *
 * The startup token lives ONLY in this module singleton. It is never written to the
 * store, localStorage, sessionStorage, the DOM, the URL (after bootstrap), or any log.
 * A page reload drops it (single short-lived local process model) — re-open the boot URL.
 */
let token: string | null = null;

export function setToken(value: string | null): void {
  token = value && value.length > 0 ? value : null;
}

export function getToken(): string | null {
  return token;
}

export function hasToken(): boolean {
  return token !== null;
}

export function clearToken(): void {
  token = null;
}

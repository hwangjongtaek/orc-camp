/**
 * SPEC-006 §2.2 — redaction secret-pattern catalog (RP-01 .. RP-10).
 *
 * Each rule masks a class of secret with a STABLE replacement token of the exact
 * form `[REDACTED:<class>]` (consumers depend on the class string). Rules are
 * applied in this file's array order, which is **specific → generic**:
 *
 *   1. multi-line PEM block (RP-01)             — whole-region, no partial leak
 *   2. provider-specific tokens (RP-02..RP-04, RP-09, RP-06, RP-05, RP-07)
 *   3. env-assignment (RP-08)                   — keep KEY name, mask value
 *   4. generic high-entropy token (RP-10)       — LAST, conservative/key-ish only
 *
 * `specific` rules run before `generic` ones so a labelled token wins (and so the
 * already-substituted `[REDACTED:...]` placeholders are never re-matched: every
 * secret-value char class below excludes `[` and `]`).
 *
 * Regexes are linear / anchored (no nested quantifiers) to avoid catastrophic
 * backtracking (SPEC-006 T-10 / ReDoS); input length is additionally bounded by
 * BYTE_CAP upstream in `sanitizeCapture`.
 *
 * No example uses a real secret — token shape / placeholders only (SPEC-000).
 */
import { RP10_MIN_LEN } from '../types';

/** Stable redaction class tokens. Wire/consumer/test contract — do not rename. */
export type RedactionClass =
  | 'private-key'
  | 'aws-key'
  | 'github-token'
  | 'slack-token'
  | 'jwt'
  | 'bearer'
  | 'url-cred'
  | 'env-secret'
  | 'api-key'
  | 'token';

/**
 * A single catalog entry.
 *
 * `replace` is the substitution callback handed to `String.prototype.replace`.
 * It is typed with a pure rest parameter so both constant replacers
 * (`() => '[REDACTED:aws-key]'`) and group-preserving replacers
 * (`(m, g1) => g1 + '[REDACTED:env-secret]'`) are assignable, and so the central
 * `redact()` chokepoint can forward the match args verbatim.
 */
export interface RedactionRule {
  readonly id: string; // RP-01 .. RP-10
  readonly cls: RedactionClass;
  readonly regex: RegExp; // global; applied via String.prototype.replace
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly replace: (...args: any[]) => string;
}

// RP-10 generic lead-in: a conservative set of key-ish identifiers. The generic
// token only fires when one of these immediately precedes a `:`/`=` assignment,
// which keeps git SHAs, UUIDs and plain paths/banners (CORPUS-KEEP) untouched.
const RP10_LEAD =
  '(?:api[_-]?key|access[_-]?key|secret[_-]?key|client[_-]?secret' +
  '|auth[_-]?token|access[_-]?token|refresh[_-]?token|api[_-]?token' +
  '|secret|token|password|passwd|credential)';

// `(lead + separator + optional opening quote)(high-entropy value >= RP10_MIN_LEN)`
// Built from the constant so the floor stays tied to RP10_MIN_LEN (SPEC-006 §3.4).
const RP10_REGEX = new RegExp(
  '(\\b' + RP10_LEAD + '["\']?\\s*[:=]\\s*["\']?)[A-Za-z0-9_-]{' + RP10_MIN_LEN + ',}',
  'gi',
);

/**
 * The ordered catalog. Order IS the priority (specific → generic).
 */
export const REDACTION_RULES: readonly RedactionRule[] = [
  // RP-01 — PEM private key block. Highest priority: collapse the whole block to
  // a single token so no base64 body line can leak (AC-02). Lazy body match with
  // a hard terminator => linear, no catastrophic backtracking.
  {
    id: 'RP-01',
    cls: 'private-key',
    regex:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replace: () => '[REDACTED:private-key]',
  },

  // RP-02 — AWS access key id (AKIA/ASIA/AGPA/AIDA/AROA + uppercase/digits).
  {
    id: 'RP-02',
    cls: 'aws-key',
    regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{12,}/g,
    replace: () => '[REDACTED:aws-key]',
  },

  // RP-03 — GitHub token (PAT / OAuth / app / fine-grained).
  {
    id: 'RP-03',
    cls: 'github-token',
    regex: /\b(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{20,}/g,
    replace: () => '[REDACTED:github-token]',
  },

  // RP-04 — Slack token (xoxb-/xoxa-/xoxp-/xoxr-/xoxs-).
  {
    id: 'RP-04',
    cls: 'slack-token',
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}/g,
    replace: () => '[REDACTED:slack-token]',
  },

  // RP-09 — provider API key prefixes (sk-ant- checked before sk- so the longer,
  // hyphenated Anthropic form wins). Important: agent panes can echo real keys.
  {
    id: 'RP-09',
    cls: 'api-key',
    regex: /\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,})/g,
    replace: () => '[REDACTED:api-key]',
  },

  // RP-06 — Authorization / Bearer header. Keep the label, mask only the value
  // (AC-05). Runs before RP-05 so a `Bearer <jwt>` collapses cleanly to bearer.
  // Branch 1 captures the `Authorization:` label (group 1) and consumes an
  // optional `Bearer` keyword; branch 2 handles a bare `Bearer <token>`.
  {
    id: 'RP-06',
    cls: 'bearer',
    regex:
      /(\bauthorization\b\s*[:=]\s*)(?:bearer\s+)?[A-Za-z0-9._~+\/=-]+|\bbearer\b\s+[A-Za-z0-9._~+\/=-]+/gi,
    replace: (_m, g1) => (g1 ?? '') + '[REDACTED:bearer]',
  },

  // RP-05 — JWT (base64url header.payload.signature, header starting `eyJ`).
  {
    id: 'RP-05',
    cls: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replace: () => '[REDACTED:jwt]',
  },

  // RP-07 — URL credential. Mask only the userinfo, keep scheme/host/path so the
  // context survives (AC-03): `https://[REDACTED:url-cred]@host/path`.
  // Scheme/user/pass quantifiers are BOUNDED so a long alphanumeric run cannot
  // trigger quadratic backtracking (T-10 / ReDoS) — schemes/credentials are short.
  {
    id: 'RP-07',
    cls: 'url-cred',
    regex: /([a-zA-Z][a-zA-Z0-9+.-]{0,20}:\/\/)[^\/\s:@]{1,128}:[^\/\s@]{1,256}@/g,
    replace: (_m, g1) => g1 + '[REDACTED:url-cred]@',
  },

  // RP-08 — env / argv secret assignment. Keep the KEY name (and `=`, plus an
  // optional opening quote), mask the value up to the next whitespace/quote
  // (AC-04, AC-16). Value class excludes `[`/`]` so prior placeholders are safe.
  {
    id: 'RP-08',
    cls: 'env-secret',
    regex:
      /(\b(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|AUTH|CREDENTIAL)\b\s*=\s*["']?)[^\s"'[\]]+/gi,
    replace: (_m, g1) => g1 + '[REDACTED:env-secret]',
  },

  // RP-10 — generic high-entropy token. LAST + conservative: only a long
  // (>= RP10_MIN_LEN) value in an explicit key-ish `:`/`=` context. Keeps the
  // lead-in label, masks the value. This is the top false-positive risk; the
  // key-ish gate is what keeps SHAs/UUIDs/paths/banners out (SPEC-006 §3.5).
  {
    id: 'RP-10',
    cls: 'token',
    regex: RP10_REGEX,
    replace: (_m, g1) => g1 + '[REDACTED:token]',
  },
];

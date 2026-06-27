/**
 * SPEC-006 redaction unit tests.
 *
 * Coverage:
 *   AC-01..05 — each secret class is masked; the placeholder secret literal is
 *               absent from the output and the stable `[REDACTED:<class>]` token
 *               is present.
 *   AC-08/09  — line split (line cap is enforced UPSTREAM at collection) and the
 *               tail-preserving byte clamp at BYTE_CAP (+ byteClamped flag).
 *   AC-16     — cmdline `--token=<value>` is masked.
 *   AC-17     — cwd `/home/u/work/ghp_<token>/repo` → secret gone, non-secret
 *               path components preserved.
 *   M5        — false-redaction smoke: CORPUS-SECRET has secret_recall = 1.0 and
 *               CORPUS-KEEP (paths/hashes/UUIDs/agent banner tokens) has a low
 *               false_redaction_rate (<= 0.05).
 *
 * NEVER use a real secret. Every value below is a token-shape placeholder.
 */
import { describe, it, expect } from 'vitest';
import { redact, sanitizeCapture } from '../../src/redaction/redact';
import { BYTE_CAP, PREVIEW_LINES } from '../../src/types';

// --- placeholder secrets (token shape only, never real) ---------------------
const GH = 'ghp_EXAMPLEEXAMPLEEXAMPLE0001';
const AWS = 'AKIAEXAMPLEEXAMPLE01';
const SLACK = 'xoxb-EXAMPLEEXAMPLE-EXAMPLE01';
const JWT = 'eyJhbGc.eyJzdWI.SflKxwRJSMeKKF';
const SK_ANT = 'sk-ant-EXAMPLEEXAMPLEEXAMPLE01';
const RP10_VALUE = 'AbCdEf0123456789AbCdEf0123456789xy'; // 34 chars, key-ish ctx
const PEM_BODY = 'MIIBfakeBodyfakeBody01abcdEFGH';
const PEM = [
  '-----BEGIN RSA PRIVATE KEY-----',
  PEM_BODY,
  'ZZZfakeBodyMoreLines+/data==',
  '-----END RSA PRIVATE KEY-----',
].join('\n');

describe('redact — per-class masking (AC-01..05)', () => {
  it('AC-01: masks a GitHub token', () => {
    const r = redact(`fetching with ${GH} now`);
    expect(r.text).not.toContain(GH);
    expect(r.text).toContain('[REDACTED:github-token]');
    expect(r.redacted).toBe(true);
    expect(r.matchCount).toBe(1);
  });

  it('AC-02: collapses a PEM private-key block to one token (no partial leak)', () => {
    const r = redact(`prefix\n${PEM}\nsuffix`);
    expect(r.text).not.toContain(PEM_BODY);
    expect(r.text).not.toContain('ZZZfakeBodyMoreLines');
    expect(r.text).toContain('prefix');
    expect(r.text).toContain('suffix');
    // exactly one private-key token: the whole block became a single placeholder
    expect((r.text.match(/\[REDACTED:private-key\]/g) ?? []).length).toBe(1);
  });

  it('AC-03: masks URL userinfo, preserving scheme/host/path', () => {
    const r = redact('clone https://alice:s3cr3tPass@github.com/org/repo.git ok');
    expect(r.text).not.toContain('alice:s3cr3tPass');
    expect(r.text).not.toContain('s3cr3tPass');
    expect(r.text).toContain(
      'https://[REDACTED:url-cred]@github.com/org/repo.git',
    );
  });

  it('AC-04: masks env-secret assignment value, keeping the KEY name', () => {
    expect(redact('API_KEY=supersecretvalue123').text).toBe(
      'API_KEY=[REDACTED:env-secret]',
    );
    expect(redact('SECRET=hunter2hunter2').text).toBe(
      'SECRET=[REDACTED:env-secret]',
    );
    expect(redact('PASSWORD="quoted secret"').text).toContain(
      'PASSWORD="[REDACTED:env-secret]',
    );
  });

  it('AC-05: masks AWS / Slack / JWT / Bearer tokens to their classes', () => {
    const bearerTok = 'ABC.DEF.GHI';
    const r = redact(
      [AWS, SLACK, JWT, `Authorization: Bearer ${bearerTok}`].join('\n'),
    );
    for (const s of [AWS, SLACK, JWT, bearerTok]) {
      expect(r.text).not.toContain(s);
    }
    expect(r.text).toContain('[REDACTED:aws-key]');
    expect(r.text).toContain('[REDACTED:slack-token]');
    expect(r.text).toContain('[REDACTED:jwt]');
    expect(r.text).toContain('[REDACTED:bearer]');
    // Bearer keeps the label per §2.2
    expect(r.text).toContain('Authorization:');
  });

  it('AC-05 (provider api key): masks sk-ant- prefix', () => {
    const r = redact(`token printed: ${SK_ANT}`);
    expect(r.text).not.toContain(SK_ANT);
    expect(r.text).toContain('[REDACTED:api-key]');
  });
});

describe('redact — purity & no-op on clean text', () => {
  it('leaves non-secret text untouched', () => {
    const clean = 'npm run build && vitest run  (commit a1b2c3d4)';
    const r = redact(clean);
    expect(r.text).toBe(clean);
    expect(r.redacted).toBe(false);
    expect(r.matchCount).toBe(0);
  });

  it('is deterministic across repeated calls (global regex lastIndex reset)', () => {
    const input = `${GH} and ${GH}`;
    const a = redact(input);
    const b = redact(input);
    expect(a.text).toBe(b.text);
    expect(a.matchCount).toBe(2);
    expect(b.matchCount).toBe(2);
  });
});

describe('sanitizeCapture — line split & byte clamp (AC-08/09)', () => {
  it('AC-08: splits the redacted buffer into lines (oldest → newest)', () => {
    const sani = sanitizeCapture('line1\nline2\nline3');
    expect(sani.lines).toEqual(['line1', 'line2', 'line3']);
    expect(sani.byteClamped).toBe(false);
    // preview tail is a downstream slice of the last PREVIEW_LINES lines
    expect(sani.lines.slice(-PREVIEW_LINES).length).toBeLessThanOrEqual(
      PREVIEW_LINES,
    );
  });

  it('AC-08: does not clamp a buffer at/under BYTE_CAP', () => {
    const sani = sanitizeCapture('x'.repeat(BYTE_CAP));
    expect(sani.byteClamped).toBe(false);
    expect(Buffer.byteLength(sani.lines.join('\n'), 'utf8')).toBe(BYTE_CAP);
  });

  it('AC-09: tail-preserving byte clamp beyond BYTE_CAP sets byteClamped', () => {
    const head = 'OLD_HEAD_MARKER\n';
    const filler = 'x'.repeat(BYTE_CAP);
    const tail = '\nNEW_TAIL_MARKER';
    const raw = head + filler + tail; // strictly larger than BYTE_CAP
    const sani = sanitizeCapture(raw);
    expect(sani.byteClamped).toBe(true);
    const joined = sani.lines.join('\n');
    expect(Buffer.byteLength(joined, 'utf8')).toBeLessThanOrEqual(BYTE_CAP);
    expect(joined).toContain('NEW_TAIL_MARKER'); // newest output preserved
    expect(joined).not.toContain('OLD_HEAD_MARKER'); // oldest dropped
  });

  it('redacts secrets inside a captured buffer', () => {
    const sani = sanitizeCapture(`running\n${GH}\n$ `);
    const joined = sani.lines.join('\n');
    expect(joined).not.toContain(GH);
    expect(joined).toContain('[REDACTED:github-token]');
    expect(sani.redacted).toBe(true);
    expect(sani.matchCount).toBe(1);
  });
});

describe('redact — single chokepoint for cmdline & cwd (AC-16/17)', () => {
  it('AC-16: masks --token=<value> in a cmdline (argv passes the same redact())', () => {
    const r = redact(`node agent.js --token=${GH} --verbose`);
    expect(r.text).not.toContain(GH);
    expect(r.text).toContain('node agent.js');
    expect(r.text).toContain('--verbose');
  });

  it('AC-16: masks a non-provider --password=<value> via env-secret rule', () => {
    const r = redact('python run.py --password=hunter2hunter2 --debug');
    expect(r.text).not.toContain('hunter2hunter2');
    expect(r.text).toContain('--password=[REDACTED:env-secret]');
    expect(r.text).toContain('--debug');
  });

  it('AC-17: masks a secret embedded in cwd, preserving non-secret components', () => {
    const r = redact(`/home/u/work/${GH}/repo`);
    expect(r.text).not.toContain(GH);
    expect(r.text).toBe('/home/u/work/[REDACTED:github-token]/repo');
  });
});

// --- M5 false-redaction harness (SPEC-007 §3.3 M5, SPEC-006 AC-15) ----------

interface SecretSample {
  input: string;
  /** the sensitive substring that MUST be absent from the redacted output */
  literal: string;
}

const CORPUS_SECRET: readonly SecretSample[] = [
  { input: GH, literal: GH },
  { input: AWS, literal: AWS },
  { input: SLACK, literal: SLACK },
  { input: JWT, literal: JWT },
  { input: `Authorization: Bearer ABC.DEF.GHI`, literal: 'ABC.DEF.GHI' },
  { input: 'API_KEY=supersecretvalue123', literal: 'supersecretvalue123' },
  { input: SK_ANT, literal: SK_ANT },
  {
    input: 'git remote add o https://user:p4ssw0rdXYZ@example.com/x.git',
    literal: 'p4ssw0rdXYZ',
  },
  // generic RP-10: high-entropy value in an explicit key-ish (`:`) context
  { input: `access_token: ${RP10_VALUE}`, literal: RP10_VALUE },
  { input: PEM, literal: PEM_BODY },
];

const CORPUS_KEEP: readonly string[] = [
  '/home/user/project/src/index.ts',
  '/usr/local/bin/node',
  '@anthropic-ai/claude-code', // agent banner token (SPEC-003 coherence)
  'codex', // agent banner token
  'commit 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b done', // 40-hex git SHA
  '550e8400-e29b-41d4-a716-446655440000', // UUID
  'npm run build && vitest run',
  'installed 42 packages in 3s',
  'http://localhost:3000/health', // host:port, no credentials
  'function handleRequest(req, res) {}',
  'TypeError: cannot read property foo of undefined',
  'branch feature/ORC-123-redaction',
];

describe('redact — ReDoS resistance (T-10 / Q4)', () => {
  it('stays linear on adversarial long runs (no catastrophic backtracking)', () => {
    // Shapes that previously caused quadratic backtracking: a long scheme-like
    // run before a missing `://`, a long bearer token, a near-JWT with no dots.
    const adversarial = [
      'a' + 'x'.repeat(100_000), // url-cred scheme prefix, never reaches "://"
      'Bearer ' + 'b'.repeat(100_000), // bearer token, no terminator
      'eyJ' + 'c'.repeat(100_000), // JWT header, no dots
      'http://' + 'h'.repeat(100_000), // userinfo scan, no "@"
    ].join('\n');
    const start = Date.now();
    const r = redact(adversarial);
    expect(Date.now() - start).toBeLessThan(1000); // O(n²) would be many seconds
    expect(typeof r.text).toBe('string');
  });
});

describe('M5 — false-redaction & secret-recall (AC-15 / SPEC-007 AC-04)', () => {
  it('secret_recall == 1.0 (every known secret literal is masked)', () => {
    const leaks: string[] = [];
    for (const { input, literal } of CORPUS_SECRET) {
      const out = redact(input).text;
      if (out.includes(literal)) leaks.push(`${input} -> ${out}`);
    }
    expect(leaks).toEqual([]);
  });

  it('false_redaction_rate is low (<= 0.05) on CORPUS-KEEP', () => {
    const falsePositives: string[] = [];
    for (const s of CORPUS_KEEP) {
      const r = redact(s);
      if (r.redacted) falsePositives.push(`${s} -> ${r.text}`);
    }
    const rate = falsePositives.length / CORPUS_KEEP.length;
    expect(falsePositives).toEqual([]); // current catalog: 0 false redactions
    expect(rate).toBeLessThanOrEqual(0.05);
  });
});

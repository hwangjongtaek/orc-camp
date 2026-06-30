/**
 * SPEC-008 unit tests — usage collector data-minimization, file-access confinement, bounded
 * read, correlation/misattribution, provider fallback, and degradable isolation. Deterministic
 * and offline: every test uses temp dirs under os.tmpdir() and an injected uid; NO dependency on
 * a live ~/.claude. Symlink-escape and ownership refusals are exercised with real fs primitives.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  rmSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  statSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeConfinedReader } from '../../src/usage/reader';
import {
  makeClaudeCodeProvider,
  encodeCwd,
  extractSessionId,
} from '../../src/usage/providers/claude-code';
import { makeCodexProvider } from '../../src/usage/providers/codex';
import { estimateCostUsd } from '../../src/usage/cost';
import { makeUsageCollector, type UsageDebugEntry } from '../../src/usage/collect';
import { makeOpenHandleLocator } from '../../src/usage/openhandle';
import type { UsageLocateHint, AgentType, ProcessSpawn, SpawnResult } from '../../src/types';
import type { UsageProvider } from '../../src/usage/provider';
import {
  claudeLine,
  userLine,
  makeClaudeRoot,
  makeTmpDir,
  writeSession,
  sessionDir,
  CURRENT_UID,
  FAKE_GH_TOKEN,
  FAKE_API_KEY,
  MARKER_BODY,
  MARKER_TOOL,
  MARKER_CWD,
  MARKER_BRANCH,
} from '../fixtures/usage';

const ALL_MARKERS = [FAKE_GH_TOKEN, FAKE_API_KEY, MARKER_BODY, MARKER_TOOL, MARKER_CWD, MARKER_BRANCH];
const CWD = '/Users/agent/project-alpha';
const SID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const cleanups: string[] = [];
function tmp(maker: () => string): string {
  const d = maker();
  cleanups.push(d);
  return d;
}
afterEach(() => {
  while (cleanups.length) {
    const d = cleanups.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function hint(over: Partial<UsageLocateHint> = {}): UsageLocateHint {
  return {
    paneId: '%1',
    agentType: 'claude-code',
    cwd: CWD,
    processTreeCommands: [`claude --resume ${SID}`],
    agentPids: [4242],
    lastActivityAt: '2026-06-29T12:00:00.000Z',
    ...over,
  };
}

function collector(root: string, over: Parameters<typeof makeUsageCollector>[0] = {}) {
  return makeUsageCollector({
    roots: { claudeProjects: root },
    getUid: () => CURRENT_UID,
    // Offline default: no open handles → no live lsof. The §4.2a fd tests below override this
    // (with a mock locator or a mock spawn) to exercise open-handle correlation deterministically.
    openHandle: async () => [],
    ...over,
  });
}

// --- open-handle (fd) locator test doubles (no live lsof ever runs) ---------
function okSpawn(stdout: string): SpawnResult {
  return { stdout, stderr: '', exitCode: 0, timedOut: false, spawnError: null, durationMs: 1 };
}

/** Mock `lsof` spawn: per-pid canned `-F n` stdout, keyed by the trailing `-p <pid>` arg. */
function mockLsof(byPid: Record<number, string>): ProcessSpawn {
  return async (_file, args) => okSpawn(byPid[Number(args[args.length - 1])] ?? '');
}

/** A spawn reporting a spawn error (e.g. lsof not installed) → locator must skip → []. */
const erroringSpawn: ProcessSpawn = async () => ({
  stdout: '',
  stderr: '',
  exitCode: null,
  timedOut: false,
  spawnError: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) as NodeJS.ErrnoException,
  durationMs: 0,
});

/** A spawn that always succeeds with empty output (used where spawn output is irrelevant). */
const okOnlySpawn: ProcessSpawn = async () => okSpawn('');

// ---------------------------------------------------------------------------
// SPEC-008-AC-01 — data minimization: only the 4 scalars escape the parser
// ---------------------------------------------------------------------------
describe('SPEC-008-AC-01 — only OrcUsage scalars are emitted', () => {
  it('returns exactly {cumulativeTokens,cumulativeCostUsd,source,measuredAt}; no content/path/secret', async () => {
    const root = tmp(makeClaudeRoot);
    writeSession(root, CWD, SID, [claudeLine({ input: 1000, output: 500 }), claudeLine({ input: 200, output: 100 })]);
    const usage = await collector(root)(hint());
    expect(usage).not.toBeNull();
    expect(Object.keys(usage!).sort()).toEqual(
      ['cumulativeCostUsd', 'cumulativeTokens', 'measuredAt', 'source'].sort(),
    );
    expect(usage!.cumulativeTokens).toBe(1800); // (1000+500)+(200+100)
    expect(usage!.source).toBe('estimated');
    // measuredAt is the last event timestamp (ISO 8601), never free text
    expect(usage!.measuredAt).toBe('2026-06-29T12:00:00.000Z');
    expect(usage!.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    const serialized = JSON.stringify(usage);
    for (const m of ALL_MARKERS) expect(serialized).not.toContain(m);
  });

  it('a non-ISO timestamp is rejected → measuredAt falls back to file mtime (never free text)', async () => {
    const root = tmp(makeClaudeRoot);
    writeSession(root, CWD, SID, [claudeLine({ input: 10, output: 10, timestamp: `NOT-A-DATE-${MARKER_BODY}` })]);
    const usage = await collector(root)(hint());
    expect(usage!.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(usage!.measuredAt).not.toContain(MARKER_BODY);
  });
});

// ---------------------------------------------------------------------------
// SPEC-008-AC-04/05/11 — confinement, ownership, read-only + TOCTOU-safe
// ---------------------------------------------------------------------------
describe('SPEC-008-AC-04 — symlink/traversal escape is refused (target never read)', () => {
  it('a session file that is a symlink to outside the root → null, secret not read', async () => {
    const root = tmp(makeClaudeRoot);
    const outside = tmp(makeTmpDir);
    const secretFile = join(outside, 'secret.jsonl');
    writeFileSync(secretFile, claudeLine({ input: 9999, output: 9999, content: `LEAK ${MARKER_BODY}` }) + '\n');
    const dir = sessionDir(root, CWD);
    symlinkSync(secretFile, join(dir, `${SID}.jsonl`)); // session file → escapes root

    const usage = await collector(root)(hint());
    expect(usage).toBeNull();
  });

  it('a session DIRECTORY symlinked outside the root → null', async () => {
    const root = tmp(makeClaudeRoot);
    const outside = tmp(makeTmpDir);
    writeFileSync(join(outside, `${SID}.jsonl`), claudeLine({ input: 5, output: 5 }) + '\n');
    // encoded dir itself is a symlink pointing outside the allowlist root
    symlinkSync(outside, join(root, encodeCwd(CWD)));
    const usage = await collector(root)(hint());
    expect(usage).toBeNull();
  });
});

describe('SPEC-008-AC-05 — ownership: other-user file is refused, not read', () => {
  it('st_uid !== getuid() → null (file owned by current user, but injected uid mismatches)', async () => {
    const root = tmp(makeClaudeRoot);
    writeSession(root, CWD, SID, [claudeLine({ input: 100, output: 50 })]);
    const usage = await collector(root, { getUid: () => CURRENT_UID + 12345 })(hint());
    expect(usage).toBeNull();
  });

  it('uid unavailable (-1, e.g. non-POSIX) → null (degrade)', async () => {
    const root = tmp(makeClaudeRoot);
    writeSession(root, CWD, SID, [claudeLine({ input: 100, output: 50 })]);
    const usage = await collector(root, { getUid: () => -1 })(hint());
    expect(usage).toBeNull();
  });
});

describe('SPEC-008-AC-11 — read-only: collection never mutates the session file', () => {
  it('file bytes + mtime are unchanged after a successful collect', async () => {
    const root = tmp(makeClaudeRoot);
    const file = writeSession(root, CWD, SID, [claudeLine({ input: 100, output: 50 })]);
    const before = readFileSync(file, 'utf8');
    const beforeMtime = statSync(file).mtimeMs;
    const usage = await collector(root)(hint());
    expect(usage).not.toBeNull();
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(statSync(file).mtimeMs).toBe(beforeMtime);
  });
});

// ---------------------------------------------------------------------------
// SPEC-008-AC-06 — bounded read (DoS-safe): caps stop the read; no whole-file load
// ---------------------------------------------------------------------------
describe('SPEC-008-AC-06 — bounded read', () => {
  it('byte cap stops the read mid-file (partial best-effort), never loads the whole file', () => {
    const root = tmp(makeTmpDir);
    const lines: string[] = [];
    for (let i = 0; i < 500; i++) lines.push(JSON.stringify({ n: i, pad: 'x'.repeat(200) }));
    const file = join(root, 'big.jsonl');
    writeFileSync(file, lines.join('\n') + '\n');

    const reader = makeConfinedReader({ root, getUid: () => CURRENT_UID, maxBytes: 4096 });
    let seen = 0;
    const stats = reader.readLines(file, () => {
      seen += 1;
    });
    expect(stats).not.toBeNull();
    expect(stats!.truncated).toBe(true);
    expect(stats!.bytesRead).toBeLessThanOrEqual(4096);
    expect(seen).toBeLessThan(500); // did not read all lines
  });

  it('a pathologically long newline-less line is bounded (skipped), not buffered unboundedly', () => {
    const root = tmp(makeTmpDir);
    const file = join(root, 'monster.jsonl');
    // 4 MiB single line with no newline, then a real line.
    writeFileSync(file, 'x'.repeat(4 * 1024 * 1024) + '\n' + JSON.stringify({ ok: 1 }) + '\n');
    const reader = makeConfinedReader({ root, getUid: () => CURRENT_UID, maxLineBytes: 1 * 1024 * 1024 });
    const emitted: string[] = [];
    const stats = reader.readLines(file, (l) => emitted.push(l));
    expect(stats).not.toBeNull();
    expect(stats!.truncated).toBe(true);
    // the monster line is dropped; we never emit a multi-MB string
    expect(emitted.every((l) => l.length <= 1 * 1024 * 1024)).toBe(true);
  });

  it('time budget halts the read', () => {
    const root = tmp(makeTmpDir);
    const file = join(root, 't.jsonl');
    writeFileSync(file, Array.from({ length: 100 }, (_, i) => JSON.stringify({ i })).join('\n') + '\n');
    let t = 0;
    const reader = makeConfinedReader({
      root,
      getUid: () => CURRENT_UID,
      now: () => (t += 1000), // every clock read advances 1s → budget exceeded immediately
      timeBudgetMs: 250,
    });
    const stats = reader.readLines(file, () => {});
    expect(stats!.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SPEC-008-AC-07 — absent / unreadable / ambiguous → null (no guessing)
// ---------------------------------------------------------------------------
describe('SPEC-008-AC-07 — degrade to null', () => {
  it('(a) absent file (explicit id points nowhere) → null', async () => {
    const root = tmp(makeClaudeRoot);
    sessionDir(root, CWD); // dir exists, file does not
    expect(await collector(root)(hint())).toBeNull();
  });

  it('(b) invalid-JSON lines are skipped; a file with no usage → null', async () => {
    const root = tmp(makeClaudeRoot);
    writeSession(root, CWD, SID, ['not json at all {', userLine(), '   ', '}{']);
    expect(await collector(root)(hint())).toBeNull();
  });

  it('(c) multiple candidates with NO explicit id → null (no arbitrary pick)', async () => {
    const root = tmp(makeClaudeRoot);
    writeSession(root, CWD, 'aaaaaaaa-1111-1111-1111-111111111111', [claudeLine({ input: 1 })]);
    writeSession(root, CWD, 'bbbbbbbb-2222-2222-2222-222222222222', [claudeLine({ input: 2 })]);
    // no session id in argv → ambiguous directory
    expect(await collector(root)(hint({ processTreeCommands: ['zsh', 'node'] }))).toBeNull();
  });

  it('single *.jsonl with no explicit id → used (single-recent match)', async () => {
    const root = tmp(makeClaudeRoot);
    writeSession(root, CWD, SID, [claudeLine({ input: 1000, output: 500 })]);
    const usage = await collector(root)(hint({ processTreeCommands: ['zsh', 'node'] }));
    expect(usage!.cumulativeTokens).toBe(1500);
  });
});

// ---------------------------------------------------------------------------
// SPEC-008-AC-08 — identity: explicit id binds the exact file; no B→A bleed
// ---------------------------------------------------------------------------
describe('SPEC-008-AC-08 — misattribution forbidden', () => {
  it("orc A's explicit session-id reads ONLY A's file even when B's file shares the directory", async () => {
    const root = tmp(makeClaudeRoot);
    const sidA = SID;
    const sidB = 'ffffffff-9999-9999-9999-999999999999';
    writeSession(root, CWD, sidA, [claudeLine({ input: 1000, output: 0 })]); // A → 1000
    writeSession(root, CWD, sidB, [claudeLine({ input: 7777, output: 7777 })]); // B → 15554

    const usage = await collector(root)(hint({ processTreeCommands: [`claude --resume ${sidA}`] }));
    expect(usage!.cumulativeTokens).toBe(1000); // exactly A; B's tokens never mixed in
  });

  it('explicit id whose file is absent → null (does NOT fall back to a sibling guess)', async () => {
    const root = tmp(makeClaudeRoot);
    writeSession(root, CWD, 'cccccccc-3333-3333-3333-333333333333', [claudeLine({ input: 42 })]);
    const usage = await collector(root)(hint({ processTreeCommands: [`claude --resume ${SID}`] }));
    expect(usage).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SPEC-008-AC-09 — provider-pluggable + fallback; root is fixed
// ---------------------------------------------------------------------------
describe('SPEC-008-AC-09 — providers + fallback', () => {
  it('claude-code sums input+output tokens; cost is estimated', async () => {
    const root = tmp(makeClaudeRoot);
    writeSession(root, CWD, SID, [claudeLine({ input: 1_000_000, output: 500_000, model: 'claude-opus-4-8' })]);
    const usage = await collector(root)(hint());
    expect(usage!.cumulativeTokens).toBe(1_500_000);
    expect(usage!.source).toBe('estimated');
    // opus: 1M input * $5/M + 0.5M output * $25/M = 5 + 12.5 = 17.5
    expect(usage!.cumulativeCostUsd).toBeCloseTo(17.5, 5);
  });

  it('codex provider is a stub → null; unknown agentType → null', async () => {
    const root = tmp(makeClaudeRoot);
    writeSession(root, CWD, SID, [claudeLine({ input: 1, output: 1 })]);
    const c = collector(root, { roots: { claudeProjects: root, codexSessions: root } });
    expect(await c(hint({ agentType: 'codex' }))).toBeNull();
    expect(await c(hint({ agentType: 'unknown' as AgentType }))).toBeNull();
  });

  it('root is fixed: a session under a DIFFERENT root is not found → null (no arbitrary path read)', async () => {
    const fixedRoot = tmp(makeClaudeRoot);
    const otherRoot = tmp(makeClaudeRoot);
    writeSession(otherRoot, CWD, SID, [claudeLine({ input: 1000, output: 1000 })]);
    // collector confined to fixedRoot; the hint cannot redirect it to otherRoot
    expect(await collector(fixedRoot)(hint())).toBeNull();
  });

  it('estimateCostUsd returns null for an unknown model (tokens may still be present)', () => {
    expect(estimateCostUsd(new Map([['some-future-model', { input: 1000, output: 1000, cacheCreation: 0, cacheRead: 0 }]]))).toBeNull();
    expect(estimateCostUsd(new Map([['claude-haiku-4-5', { input: 1_000_000, output: 0, cacheCreation: 0, cacheRead: 0 }]]))).toBeCloseTo(1, 5);
  });
});

// ---------------------------------------------------------------------------
// SPEC-008-AC-10 — degradable isolation: collector NEVER throws
// ---------------------------------------------------------------------------
describe('SPEC-008-AC-10 — collector never throws', () => {
  it('a provider that throws is swallowed → resolves to null', async () => {
    const throwing: UsageProvider = {
      id: 'claude-code',
      root: '/nonexistent',
      collect() {
        throw new Error('boom');
      },
    };
    const c = makeUsageCollector({
      providers: new Map<AgentType, UsageProvider>([['claude-code', throwing]]),
      getUid: () => CURRENT_UID,
    });
    await expect(c(hint())).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SPEC-008-AC-03 — debug log is metadata-only (no content/secret/path)
// ---------------------------------------------------------------------------
describe('SPEC-008-AC-03 — metadata-only debug entries', () => {
  it('debug sink receives only metadata keys and no transcript content/secret/path', async () => {
    const root = tmp(makeClaudeRoot);
    writeSession(root, CWD, SID, [claudeLine({ input: 1000, output: 500 })]);
    const entries: UsageDebugEntry[] = [];
    await collector(root, { onDebug: (e) => entries.push(e) })(hint());
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(Object.keys(e).sort()).toEqual(
      ['bytesRead', 'durationMs', 'lineCount', 'outcome', 'paneId', 'phase', 'provider'].sort(),
    );
    expect(e.outcome).toBe('ok');
    expect(e.provider).toBe('claude-code');
    const serialized = JSON.stringify(entries);
    for (const m of [...ALL_MARKERS, encodeCwd(CWD)]) expect(serialized).not.toContain(m);
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
describe('pure helpers', () => {
  it('extractSessionId pulls a UUID from --resume/--session-id/--session, ignores non-uuid', () => {
    expect(extractSessionId([`claude --resume ${SID}`])).toBe(SID);
    expect(extractSessionId([`claude --session-id=${SID}`])).toBe(SID);
    expect(extractSessionId([`claude --session ${SID.toUpperCase()}`])).toBe(SID);
    expect(extractSessionId(['claude --resume not-a-uuid'])).toBeNull();
    expect(extractSessionId(['zsh', 'node server.js'])).toBeNull();
  });

  it('encodeCwd replaces separators and dots with - and neutralizes traversal', () => {
    expect(encodeCwd('/Users/me/app.v2')).toBe('-Users-me-app-v2');
    expect(encodeCwd('/a/../b')).toBe('-a----b'); // no real ".." segment survives
    expect(encodeCwd('/a/../b')).not.toContain('..');
  });
});

// ---------------------------------------------------------------------------
// SPEC-008-AC-12 — open-handle (fd) correlation: deterministic, confined, precedence
// ---------------------------------------------------------------------------
describe('SPEC-008-AC-12 — open-handle (fd) correlation', () => {
  it('exactly one in-root .jsonl open handle (no explicit id) → that file is parsed', async () => {
    const root = tmp(makeClaudeRoot);
    // Two sessions in the dir → the single-`*.jsonl` fallback alone would be ambiguous (null).
    const fileA = writeSession(root, CWD, SID, [claudeLine({ input: 1234, output: 0 })]);
    writeSession(root, CWD, 'bbbbbbbb-2222-2222-2222-222222222222', [claudeLine({ input: 9, output: 9 })]);
    const usage = await collector(root, { openHandle: async () => [fileA] })(
      hint({ processTreeCommands: ['zsh', 'node'] }),
    );
    expect(usage!.cumulativeTokens).toBe(1234); // deterministically the open handle, not a guess
  });

  it('explicit session-id still WINS over an open handle (id is the strongest signal)', async () => {
    const root = tmp(makeClaudeRoot);
    const sidA = SID;
    const fileB = writeSession(root, CWD, 'ffffffff-9999-9999-9999-999999999999', [
      claudeLine({ input: 7777, output: 7777 }),
    ]);
    writeSession(root, CWD, sidA, [claudeLine({ input: 1000, output: 0 })]); // A → 1000
    // openHandle would point at B, but the explicit --resume id must take precedence.
    const usage = await collector(root, { openHandle: async () => [fileB] })(
      hint({ processTreeCommands: [`claude --resume ${sidA}`] }),
    );
    expect(usage!.cumulativeTokens).toBe(1000); // A's file via explicit id, NOT B via fd
  });

  it('open handle WINS over the single-dir-file fallback when present', async () => {
    const root = tmp(makeClaudeRoot);
    // CWD's dir has exactly ONE jsonl (the single-file fallback would pick it → 111).
    writeSession(root, CWD, SID, [claudeLine({ input: 111, output: 0 })]);
    // A DIFFERENT in-root file (different cwd dir) → only reachable via the fd handle → 222.
    const other = writeSession(root, '/Users/agent/project-beta', 'cccccccc-3333-3333-3333-333333333333', [
      claudeLine({ input: 222, output: 0 }),
    ]);
    const usage = await collector(root, { openHandle: async () => [other] })(
      hint({ processTreeCommands: ['zsh', 'node'] }),
    );
    expect(usage!.cumulativeTokens).toBe(222); // fd is consulted BEFORE the dir-listing fallback
  });

  it('two in-root .jsonl handles → no guess; falls through to the (ambiguous) dir → null', async () => {
    const root = tmp(makeClaudeRoot);
    const a = writeSession(root, CWD, SID, [claudeLine({ input: 1 })]);
    const b = writeSession(root, CWD, 'bbbbbbbb-2222-2222-2222-222222222222', [claudeLine({ input: 2 })]);
    const usage = await collector(root, { openHandle: async () => [a, b] })(
      hint({ processTreeCommands: ['zsh', 'node'] }),
    );
    expect(usage).toBeNull(); // 2 handles → ambiguous → never picks one
  });

  it('two handles but a single dir file → falls through to that single file (proves no fd guess)', async () => {
    const root = tmp(makeClaudeRoot);
    const a = writeSession(root, CWD, SID, [claudeLine({ input: 500, output: 0 })]);
    const b = writeSession(root, '/Users/agent/project-beta', 'cccccccc-3333-3333-3333-333333333333', [
      claudeLine({ input: 9 }),
    ]);
    // CWD dir has exactly one jsonl; 2 handles are ambiguous so step (2) is skipped → step (3) used.
    const usage = await collector(root, { openHandle: async () => [a, b] })(
      hint({ processTreeCommands: ['zsh', 'node'] }),
    );
    expect(usage!.cumulativeTokens).toBe(500); // the single dir file, not handle[0]
  });
});

// ---------------------------------------------------------------------------
// SPEC-008-AC-12/AC-10 — degradable: locator throws / spawn errors → [] → usage null, scan ok
// ---------------------------------------------------------------------------
describe('SPEC-008-AC-12 — open-handle correlation is degradable', () => {
  it('a locator that throws is swallowed → [] → falls through → resolves to null (never rejects)', async () => {
    const root = tmp(makeClaudeRoot);
    writeSession(root, CWD, SID, [claudeLine({ input: 1 })]);
    writeSession(root, CWD, 'bbbbbbbb-2222-2222-2222-222222222222', [claudeLine({ input: 2 })]);
    const c = collector(root, {
      openHandle: async () => {
        throw new Error('lsof exploded');
      },
    });
    await expect(c(hint({ processTreeCommands: ['zsh', 'node'] }))).resolves.toBeNull();
  });

  it('a spawn that errors (lsof missing) → locator yields [] (skip), scan unaffected', async () => {
    const root = tmp(makeClaudeRoot);
    const rootReal = realpathSync(root);
    writeSession(root, CWD, SID, [claudeLine({ input: 1 })]);
    const locator = makeOpenHandleLocator(erroringSpawn, { platform: 'darwin' });
    await expect(locator([4242], rootReal)).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SPEC-008-AC-13 — open-handle non-over-disclosure: only in-root .jsonl is kept (darwin lsof)
// ---------------------------------------------------------------------------
describe('SPEC-008-AC-13 — lsof -F n parsing keeps ONLY in-root .jsonl handles', () => {
  it('non-root / non-.jsonl / secret-sibling / socket fd paths are filtered out (never read)', async () => {
    const root = tmp(makeClaudeRoot);
    const rootReal = realpathSync(root);
    const wanted = writeSession(root, CWD, SID, [claudeLine({ input: 1 })]); // the ONE we keep
    // A non-.jsonl file inside the root (extension filter must drop it).
    const inRootTxt = join(root, encodeCwd(CWD), 'notes.txt');
    writeFileSync(inRootTxt, 'x');
    // A real .jsonl OUTSIDE the root (containment filter must drop it even though ext matches).
    const outside = tmp(makeTmpDir);
    const outsideSecret = join(outside, 'secret.jsonl');
    writeFileSync(outsideSecret, claudeLine({ input: 9999, content: `LEAK ${MARKER_BODY}` }) + '\n');

    // lsof -F n emits one field per line: `p<pid>` (process), `f<fd>`, `n<name>`. We read ONLY `n`.
    const stdout = [
      'p4242',
      'fcwd',
      `n${join(root, encodeCwd(CWD))}`, // a directory (ext filter drops it)
      'f3',
      `n${wanted}`, // KEEP
      'f4',
      `n${inRootTxt}`, // drop: not .jsonl
      'f5',
      `n${outsideSecret}`, // drop: outside root
      'f6',
      'n/etc/passwd', // drop: outside root + not .jsonl
      'f7',
      `n${join(process.env.HOME ?? '/nonexistent', '.codex', 'auth.json')}`, // drop: secret sibling
      'f8',
      'n[::1]:443->[::1]:51000 (ESTABLISHED)', // drop: socket (realpath throws)
      '',
    ].join('\n');

    const locator = makeOpenHandleLocator(mockLsof({ 4242: stdout }), { platform: 'darwin' });
    const result = await locator([4242], rootReal);
    expect(result).toEqual([realpathSync(wanted)]); // exactly the one in-root .jsonl
    expect(result).not.toContain(outsideSecret);
    expect(result.join('|')).not.toContain('passwd');
    expect(result.join('|')).not.toContain('auth.json');
    expect(result.join('|')).not.toContain(MARKER_BODY); // content of the secret was never read
  });

  it('lsof -F n: ignores p/f lines, merges multiple pids, dedupes the same handle', async () => {
    const root = tmp(makeClaudeRoot);
    const rootReal = realpathSync(root);
    const a = writeSession(root, CWD, SID, [claudeLine({ input: 1 })]);
    const b = writeSession(root, CWD, 'bbbbbbbb-2222-2222-2222-222222222222', [claudeLine({ input: 2 })]);
    const locator = makeOpenHandleLocator(
      mockLsof({
        4242: ['p4242', `n${a}`, ''].join('\n'),
        4243: ['p4243', `n${b}`, `n${a}`, ''].join('\n'), // also holds `a` → must dedupe
      }),
      { platform: 'darwin' },
    );
    const result = await locator([4242, 4243], rootReal);
    expect(result.slice().sort()).toEqual([realpathSync(a), realpathSync(b)].sort());
  });

  it('only positive-integer pids are passed to lsof (numeric pid contract, AC-13)', async () => {
    const root = tmp(makeClaudeRoot);
    const rootReal = realpathSync(root);
    const seen: string[] = [];
    const spy: ProcessSpawn = async (file, args) => {
      seen.push(`${file} ${args.join(' ')}`);
      return okSpawn('');
    };
    const locator = makeOpenHandleLocator(spy, { platform: 'darwin' });
    await locator([4242, -1, 0, 1.5 as number, NaN], rootReal);
    expect(seen).toEqual(['lsof -n -P -b -w -F n -p 4242']); // -1/0/1.5/NaN dropped; -n -P present
  });
});

// ---------------------------------------------------------------------------
// SPEC-008 §4.2a — linux /proc/<pid>/fd path (subprocess-free; injected fakes)
// ---------------------------------------------------------------------------
describe('SPEC-008 §4.2a — linux /proc path (no spawn, readlink target string only)', () => {
  it('reads /proc/<pid>/fd via readdir+readlink, keeps only the in-root .jsonl', async () => {
    const root = tmp(makeClaudeRoot);
    const rootReal = realpathSync(root);
    const wanted = writeSession(root, CWD, SID, [claudeLine({ input: 1 })]);
    const fdTargets: Record<string, string> = {
      '/proc/4242/fd/0': '/dev/pts/3',
      '/proc/4242/fd/1': '/dev/null',
      '/proc/4242/fd/7': wanted, // the session log held open
      '/proc/4242/fd/9': '/etc/passwd', // outside root → dropped
    };
    let spawned = false;
    const spawnSpy: ProcessSpawn = async () => {
      spawned = true;
      return okSpawn('');
    };
    const locator = makeOpenHandleLocator(spawnSpy, {
      platform: 'linux',
      readdirSync: (p) => (p === '/proc/4242/fd' ? ['0', '1', '7', '9'] : []),
      readlinkSync: (p) => {
        const t = fdTargets[p];
        if (t === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return t;
      },
    });
    const result = await locator([4242], rootReal);
    expect(result).toEqual([realpathSync(wanted)]);
    expect(spawned).toBe(false); // linux path NEVER spawns lsof
  });

  it('EACCES on another-uid /proc/<pid>/fd is fail-closed → skipped (→ [])', async () => {
    const root = tmp(makeClaudeRoot);
    const rootReal = realpathSync(root);
    const locator = makeOpenHandleLocator(okOnlySpawn, {
      platform: 'linux',
      readdirSync: () => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      },
      readlinkSync: () => '/should/not/be/called',
    });
    await expect(locator([4242], rootReal)).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SPEC-008 §4.2a — locator guards: empty pids / unsupported platform → []
// ---------------------------------------------------------------------------
describe('SPEC-008 §4.2a — locator guards', () => {
  it('empty pid list → [] (no spawn, no fs)', async () => {
    const locator = makeOpenHandleLocator(okOnlySpawn, { platform: 'darwin' });
    await expect(locator([], '/tmp')).resolves.toEqual([]);
  });

  it('unsupported platform (e.g. win32) → [] (degrade, never throws)', async () => {
    const locator = makeOpenHandleLocator(okOnlySpawn, { platform: 'win32' });
    await expect(locator([4242], '/tmp')).resolves.toEqual([]);
  });

  it('falsy rootReal → [] (reader root did not resolve)', async () => {
    const locator = makeOpenHandleLocator(okOnlySpawn, { platform: 'darwin' });
    await expect(locator([4242], '')).resolves.toEqual([]);
  });
});

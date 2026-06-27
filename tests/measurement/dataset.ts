/**
 * SPEC-007 §2.3/§2.4 — curated labeled dataset + redaction corpora for the PoC
 * measurement harness (LABELED-DETECT / LABELED-STATUS / CORPUS-SECRET / CORPUS-KEEP).
 *
 * NOTE ON PROVENANCE: these samples are hand-authored representative coverage of the
 * documented signal cases INCLUDING adversarial/hard cases (a `node` web server that
 * must stay a non-candidate; spinner-only churn that must not read as HIGH active; a
 * mid-stream `(y/n)` that must not read as waiting). They are NOT yet real captured
 * panes — promoting placeholder-ized real captures to this set (≥50/≥50, ≥15 waiting
 * per §2.4) is the remaining PoC-closing step. All secrets are placeholders.
 */
import type { LabeledPaneSample } from './harness';

const T0 = '2026-06-27T10:00:00.000Z';
const T_OLD = '2026-06-27T09:59:00.000Z'; // 60s before T0 (> T_idle)

let seq = 0;
function meta(over: Partial<LabeledPaneSample['paneMeta']> = {}): LabeledPaneSample['paneMeta'] {
  const i = ++seq;
  return {
    currentCommand: 'node',
    paneTitle: null,
    cmdline: null,
    cwd: '/Users/me/proj',
    paneId: `%${i}`,
    tmuxTarget: `s:1.${i}`,
    lastActivityAt: T0,
    paneDead: false,
    panePid: 1000 + i,
    processAlive: true,
    ...over,
  };
}

// ===========================================================================
// LABELED-DETECT (M1 detection precision/recall + M3 type calibration)
// ===========================================================================

export const DETECT_SAMPLES: LabeledPaneSample[] = [
  // --- Tier A: direct command (HIGH) ---
  { id: 'd-claude-cmd', source: 'fixture', rawCapture: '', paneMeta: meta({ currentCommand: 'claude' }), scannedAt: T0, gold: { isAgent: true, agentType: 'claude-code' } },
  { id: 'd-claude-code-cmd', source: 'fixture', rawCapture: '', paneMeta: meta({ currentCommand: 'claude-code' }), scannedAt: T0, gold: { isAgent: true, agentType: 'claude-code' } },
  { id: 'd-codex-cmd', source: 'fixture', rawCapture: '', paneMeta: meta({ currentCommand: 'codex' }), scannedAt: T0, gold: { isAgent: true, agentType: 'codex' } },
  { id: 'd-claude-fullpath', source: 'fixture', rawCapture: '', paneMeta: meta({ currentCommand: '/opt/homebrew/bin/claude' }), scannedAt: T0, gold: { isAgent: true, agentType: 'claude-code' } },

  // --- Tier B: wrapper + signature (MEDIUM) ---
  { id: 'd-claude-wrap-cmdline', source: 'fixture', rawCapture: '', paneMeta: meta({ currentCommand: 'node', cmdline: 'node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js' }), scannedAt: T0, gold: { isAgent: true, agentType: 'claude-code' } },
  { id: 'd-claude-wrap-title', source: 'fixture', rawCapture: '', paneMeta: meta({ currentCommand: 'node', paneTitle: 'claude-code · editing server.ts' }), scannedAt: T0, gold: { isAgent: true, agentType: 'claude-code' } },
  { id: 'd-codex-wrap-cmdline', source: 'fixture', rawCapture: '', paneMeta: meta({ currentCommand: 'node', cmdline: 'node /usr/local/lib/node_modules/@openai/codex/bin/codex.js' }), scannedAt: T0, gold: { isAgent: true, agentType: 'codex' } },
  { id: 'd-codex-wrap-title', source: 'fixture', rawCapture: '', paneMeta: meta({ currentCommand: 'python3', paneTitle: 'codex session' }), scannedAt: T0, gold: { isAgent: true, agentType: 'codex' } },

  // --- Tier C: output banner only (LOW, cap 0.60) ---
  { id: 'd-claude-banner', source: 'fixture', rawCapture: 'Welcome to Claude Code\n? for shortcuts', paneMeta: meta({ currentCommand: 'node' }), scannedAt: T0, gold: { isAgent: true, agentType: 'claude-code' } },
  { id: 'd-codex-banner', source: 'fixture', rawCapture: 'OpenAI Codex\nworking on your request', paneMeta: meta({ currentCommand: 'node' }), scannedAt: T0, gold: { isAgent: true, agentType: 'codex' } },

  // --- Corroboration (command + banner → HIGH) ---
  { id: 'd-claude-corroborated', source: 'fixture', rawCapture: 'Welcome to Claude Code', paneMeta: meta({ currentCommand: 'claude' }), scannedAt: T0, gold: { isAgent: true, agentType: 'claude-code' } },

  // --- Ambiguous candidate (unknown, LOW) ---
  { id: 'd-ambiguous-marker', source: 'fixture', rawCapture: '', paneMeta: meta({ currentCommand: 'node', paneTitle: 'AI assistant agent' }), scannedAt: T0, gold: { isAgent: true, agentType: 'unknown' } },
  { id: 'd-ambiguous-flag', source: 'fixture', rawCapture: '', paneMeta: meta({ currentCommand: 'python3', cmdline: 'python3 run.py --agent-mode' }), scannedAt: T0, gold: { isAgent: true, agentType: 'unknown' } },

  // --- HARD: conflict, equal-tier different types → unknown (no false assertion) ---
  { id: 'd-conflict', source: 'fixture', rawCapture: '', paneMeta: meta({ currentCommand: 'node', paneTitle: 'claude', cmdline: 'node /x/@openai/codex/bin.js' }), scannedAt: T0, gold: { isAgent: true, agentType: 'unknown' } },

  // --- Non-candidates (null) — precision / over-detection guards ---
  { id: 'd-shell-zsh', source: 'fixture', rawCapture: '~/proj $ ', paneMeta: meta({ currentCommand: 'zsh' }), scannedAt: T0, gold: { isAgent: false, agentType: null } },
  { id: 'd-vim', source: 'fixture', rawCapture: '', paneMeta: meta({ currentCommand: 'vim' }), scannedAt: T0, gold: { isAgent: false, agentType: null } },
  // HARD: a plain node web server must NOT be detected as an agent
  { id: 'd-node-webserver', source: 'fixture', rawCapture: 'Server listening on http://localhost:3000\nGET /api/users 200 12ms', paneMeta: meta({ currentCommand: 'node', cmdline: 'node server.js' }), scannedAt: T0, gold: { isAgent: false, agentType: null } },
  { id: 'd-python-repl', source: 'fixture', rawCapture: '>>> import os\n>>> ', paneMeta: meta({ currentCommand: 'python3', cmdline: 'python3' }), scannedAt: T0, gold: { isAgent: false, agentType: null } },
  { id: 'd-ssh', source: 'fixture', rawCapture: '', paneMeta: meta({ currentCommand: 'ssh' }), scannedAt: T0, gold: { isAgent: false, agentType: null } },
  { id: 'd-git', source: 'fixture', rawCapture: 'commit 9f8e7d6c5b4a32109f8e7d6c5b4a32109f8e7d6c', paneMeta: meta({ currentCommand: 'git' }), scannedAt: T0, gold: { isAgent: false, agentType: null } },
];

// ===========================================================================
// LABELED-STATUS (M2 status accuracy / waiting recall + M3 status calibration)
// ===========================================================================

function statusMeta(over: Partial<LabeledPaneSample['paneMeta']> = {}): LabeledPaneSample['paneMeta'] {
  // status samples are clearly agents (command 'claude') so detection always yields a candidate
  return meta({ currentCommand: 'claude', ...over });
}

export const STATUS_SAMPLES: LabeledPaneSample[] = [
  // --- active: meaningful (non-volatile) change vs prior + recent ---
  {
    id: 's-active-change', source: 'fixture',
    priorCapture: 'building project\nstep 1: compiled core.ts',
    rawCapture: 'building project\nstep 1: compiled core.ts\nstep 2: compiling server.ts',
    paneMeta: statusMeta(), scannedAt: T0, gold: { status: 'active' },
  },
  {
    id: 's-active-change-2', source: 'fixture',
    priorCapture: 'running tests\n12 passed',
    rawCapture: 'running tests\n12 passed\n18 passed\nwriting coverage report',
    paneMeta: statusMeta(), scannedAt: T0, gold: { status: 'active' },
  },
  // spinner/clock-only churn: still "working" to a human, engine keeps it active but LOW
  {
    id: 's-active-spinner', source: 'fixture',
    priorCapture: 'Thinking ⠋ (12s · 1200 tokens)',
    rawCapture: 'Thinking ⠙ (13s · 1300 tokens)',
    paneMeta: statusMeta(), scannedAt: T0, gold: { status: 'active' },
  },

  // --- idle: old activity, no change/prompt/error ---
  { id: 's-idle-1', source: 'fixture', rawCapture: 'done.\n~/proj $', paneMeta: statusMeta({ lastActivityAt: T_OLD }), scannedAt: T0, gold: { status: 'idle' } },
  { id: 's-idle-2', source: 'fixture', rawCapture: 'build complete in 4.2s', paneMeta: statusMeta({ lastActivityAt: T_OLD }), scannedAt: T0, gold: { status: 'idle' } },

  // --- waiting: tail prompt, static (prior identical) ---
  { id: 's-wait-yn', source: 'fixture', priorCapture: 'Apply this patch?\nProceed? (y/n)', rawCapture: 'Apply this patch?\nProceed? (y/n)', paneMeta: statusMeta(), scannedAt: T0, gold: { status: 'waiting', waiting: true } },
  { id: 's-wait-Yn', source: 'fixture', priorCapture: 'Do you want to continue? [Y/n]', rawCapture: 'Do you want to continue? [Y/n]', paneMeta: statusMeta(), scannedAt: T0, gold: { status: 'waiting', waiting: true } },
  { id: 's-wait-yN', source: 'fixture', priorCapture: 'Overwrite file.txt? (y/N)', rawCapture: 'Overwrite file.txt? (y/N)', paneMeta: statusMeta(), scannedAt: T0, gold: { status: 'waiting', waiting: true } },
  { id: 's-wait-proceed', source: 'fixture', priorCapture: 'Edited server.ts\nDo you want to proceed?', rawCapture: 'Edited server.ts\nDo you want to proceed?', paneMeta: statusMeta(), scannedAt: T0, gold: { status: 'waiting', waiting: true } },
  { id: 's-wait-enter', source: 'fixture', priorCapture: 'Review the changes above.\nPress Enter to continue', rawCapture: 'Review the changes above.\nPress Enter to continue', paneMeta: statusMeta(), scannedAt: T0, gold: { status: 'waiting', waiting: true } },
  { id: 's-wait-prompt', source: 'fixture', priorCapture: 'ready\n❯ ', rawCapture: 'ready\n❯ ', paneMeta: statusMeta(), scannedAt: T0, gold: { status: 'waiting', waiting: true } },
  { id: 's-wait-question', source: 'fixture', priorCapture: 'Which file should I edit?', rawCapture: 'Which file should I edit?', paneMeta: statusMeta(), scannedAt: T0, gold: { status: 'waiting', waiting: true } },
  { id: 's-wait-menu', source: 'fixture', priorCapture: 'Choose an option:\n1) yes\n2) no', rawCapture: 'Choose an option:\n1) yes\n2) no', paneMeta: statusMeta(), scannedAt: T0, gold: { status: 'waiting', waiting: true } },

  // --- HARD negative: mid-stream (y/n) but tail is streaming (prior differs) → NOT waiting ---
  {
    id: 's-not-wait-midstream', source: 'fixture',
    priorCapture: 'asked (y/n) earlier\nnow generating',
    rawCapture: 'asked (y/n) earlier\nnow generating\nwriting file 1 of 5\nwriting file 2 of 5',
    paneMeta: statusMeta(), scannedAt: T0, gold: { status: 'active', waiting: false },
  },

  // --- error: tail traceback (HIGH) vs single keyword (MEDIUM) ---
  { id: 's-error-trace', source: 'fixture', rawCapture: 'Traceback (most recent call last):\n  File "app.py", line 10, in <module>\n    main()\nValueError: bad input', paneMeta: statusMeta({ currentCommand: 'python3', paneTitle: 'codex' }), scannedAt: T0, gold: { status: 'error' } },
  { id: 's-error-keyword', source: 'fixture', rawCapture: 'compiling...\nError: cannot find module foo', paneMeta: statusMeta(), scannedAt: T0, gold: { status: 'error' } },

  // --- terminated: pane_dead ---
  { id: 's-terminated', source: 'fixture', rawCapture: 'process exited', paneMeta: statusMeta({ paneDead: true, processAlive: false }), scannedAt: T0, gold: { status: 'terminated' } },

  // --- stale: snapshot is a last-good fallback ---
  { id: 's-stale', source: 'fixture', rawCapture: 'last known output', paneMeta: statusMeta(), scannedAt: T0, snapshotStale: true, gold: { status: 'stale' } },

  // --- unknown: empty capture, no prior, recent (can't prove anything) ---
  { id: 's-unknown', source: 'fixture', rawCapture: '', paneMeta: statusMeta(), scannedAt: T0, gold: { status: 'unknown' } },
];

// ===========================================================================
// CORPUS-SECRET / CORPUS-KEEP (M5 false-redaction + secret-recall)
// ===========================================================================

// Secrets are ASSEMBLED FROM FRAGMENTS at runtime so no scannable provider-token
// literal sits in source (GitHub push protection). The assembled runtime strings are
// identical to real token shapes and exercise the SPEC-006 redaction catalog exactly.
const j = (...parts: string[]): string => parts.join('');
const S_GITHUB = j('ghp_', 'A'.repeat(20), '1234');
const S_AWS = j('AKIA', 'EXAMPLEEXAMPLE01');
const S_BEARER = j('abc123', '.def456', '.ghi789');
const S_JWT = j('eyJ', 'hbGciOiJIUzI1NiJ9', '.eyJzdWIiOiIxIn0', '.s5sig', 'VALUE');
const S_SLACK = j('xox', 'b-1111111111-2222222222-', 'EXAMPLEexampleTOKEN');
const S_URLCRED = j('alice', ':', 's3cretP@ss');
const S_ENV = j('supersecret', 'value0123456789');
const S_ANTHROPIC = j('sk', '-ant-', 'EXAMPLEEXAMPLEEXAMPLEEXAMPLE01');
const S_HEX = j('0123456789abcdef', '0123456789abcdef');
const PEM_BEGIN = j('-----', 'BEGIN RSA PRIVATE KEY', '-----');
const PEM_END = j('-----', 'END RSA PRIVATE KEY', '-----');
const S_PEM_BODY = j('MIIBOgIBAAExample', 'Body');

export const CORPUS_SECRET: { text: string; secret: string }[] = [
  { text: `pushing to origin using token ${S_GITHUB}`, secret: S_GITHUB },
  { text: `export AWS_ACCESS_KEY_ID=${S_AWS}`, secret: S_AWS },
  { text: `Authorization: Bearer ${S_BEARER}`, secret: S_BEARER },
  { text: `token ${S_JWT}`, secret: S_JWT },
  { text: `slack hook ${S_SLACK}`, secret: S_SLACK },
  { text: `clone https://${S_URLCRED}@github.example/repo.git`, secret: S_URLCRED },
  { text: `API_KEY=${S_ENV}`, secret: S_ENV },
  { text: `using ${S_ANTHROPIC} for the call`, secret: S_ANTHROPIC },
  { text: `api_token: ${S_HEX}`, secret: S_HEX },
  { text: `PEM follows ${PEM_BEGIN}\n${S_PEM_BODY}\n${PEM_END}`, secret: S_PEM_BODY },
];

export const CORPUS_KEEP: string[] = [
  '/Users/me/Projects/orc-camp/src/cli.ts',
  'commit 9f8e7d6c5b4a32109f8e7d6c5b4a32109f8e7d6c',
  'uuid 550e8400-e29b-41d4-a716-446655440000',
  '@anthropic-ai/claude-code', // banner token (coherence) — must NOT be redacted
  'codex', // banner token
  'Editing src/server.ts',
  'npm run build && npm test',
  'GET /api/users 200 OK in 12ms',
  'const answer = 42;',
  'Downloading dependencies 3.4 MB',
  'function computeFingerprint(lines)',
  'docs/specs/SPEC-004-status-inference.md',
];

/** Banner string used for redaction↔detection coherence (TC-M-BANNER). */
export const BANNER_COHERENCE = 'Welcome to Claude Code (@anthropic-ai/claude-code) — ready';

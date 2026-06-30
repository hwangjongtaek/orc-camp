/**
 * SPEC-008 integration — usage collection through the REAL scan pipeline (real redaction, real
 * assemble, real ConfinedReader) with a temp-root collector. The headline test is AC-02
 * non-leak: a fixture JSONL carrying fake secrets + unique markers ON THE SAME LINES as usage is
 * collected for a claude orc, and we assert NONE of that content reaches ANY output path
 * (--json, table, debug sink) — only the 4 usage scalars survive. Offline; no live ~/.claude.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { ScanRunner, type ScanRuntimeDeps } from '../../src/scan';
import { makeDeps, type Scenario } from '../helpers/fixture';
import { makeUsageCollector, type UsageDebugEntry } from '../../src/usage/collect';
import { renderTable } from '../../src/render/table';
import { toJsonLine } from '../../src/render/json';
import {
  claudeLine,
  makeClaudeRoot,
  writeSession,
  CURRENT_UID,
  FAKE_GH_TOKEN,
  FAKE_API_KEY,
  MARKER_BODY,
  MARKER_TOOL,
  MARKER_CWD,
  MARKER_BRANCH,
} from '../fixtures/usage';

const ALL_MARKERS = [FAKE_GH_TOKEN, FAKE_API_KEY, MARKER_BODY, MARKER_TOOL, MARKER_CWD, MARKER_BRANCH];
const PANE_CWD = '/Users/agent/project-omega';
const SID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const CLOCK = '2026-06-29T12:30:00.000Z';

const cleanups: string[] = [];
afterEach(() => {
  while (cleanups.length) {
    try {
      rmSync(cleanups.pop()!, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

/** A scenario with one claude orc whose process subtree carries the explicit --resume id. */
function claudeScenario(): Scenario {
  return {
    sessions: [{ sessionId: '$0', sessionName: 'work' }],
    panes: [
      {
        sessionName: 'work',
        windowIndex: 0,
        paneIndex: 0,
        paneId: '%1',
        command: 'claude',
        cwd: PANE_CWD,
        pid: 4242,
        active: true,
      },
    ],
    // pane_pid 4242 → depth-0 argv carries the explicit session id (survives redaction).
    processTable: [{ pid: 4242, ppid: 1, command: `claude --resume ${SID}` }],
  };
}

describe('SPEC-008-AC-02 — non-leak through the full scan pipeline', () => {
  it('only the 4 usage scalars survive; no marker/secret reaches --json, table, or debug log', async () => {
    const root = makeClaudeRoot();
    cleanups.push(root);
    // usage-bearing lines co-located with secrets + markers (content we must never read)
    writeSession(root, PANE_CWD, SID, [
      claudeLine({ input: 1000, output: 500, model: 'claude-opus-4-8' }),
      claudeLine({ input: 200, output: 100, model: 'claude-opus-4-8' }),
    ]);

    const debug: UsageDebugEntry[] = [];
    const collectUsage = makeUsageCollector({
      roots: { claudeProjects: root },
      getUid: () => CURRENT_UID,
      onDebug: (e) => debug.push(e),
    });
    const { deps } = makeDeps(claudeScenario(), CLOCK, collectUsage);
    const result = await new ScanRunner(deps).scanOnce();

    const orc = result.camps[0]!.orcs[0]!;
    expect(orc.agentType).toBe('claude-code');

    // The 4 scalars are present and correct (tokens summed across both lines).
    expect(orc.usage).not.toBeNull();
    expect(Object.keys(orc.usage!).sort()).toEqual(
      ['cumulativeCostUsd', 'cumulativeTokens', 'measuredAt', 'source'].sort(),
    );
    expect(orc.usage!.cumulativeTokens).toBe(1800);
    expect(orc.usage!.source).toBe('estimated');
    expect(orc.usage!.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    // Non-leak across EVERY output path.
    const json = toJsonLine(result);
    const table = renderTable(result, { color: false });
    const debugDump = JSON.stringify(debug);
    for (const m of ALL_MARKERS) {
      expect(json, `--json must not contain ${m}`).not.toContain(m);
      expect(table, `table must not contain ${m}`).not.toContain(m);
      expect(debugDump, `debug log must not contain ${m}`).not.toContain(m);
    }
    // Debug entry recorded the collection as metadata-only and succeeded.
    expect(debug).toHaveLength(1);
    expect(debug[0]!.outcome).toBe('ok');
    expect(debug[0]!.provider).toBe('claude-code');
  });
});

describe('SPEC-008-AC-10 — degradable isolation through the pipeline', () => {
  it('a usage collector that rejects leaves the orc usage=null and the scan completes', async () => {
    const collectUsage = async (): Promise<never> => {
      throw new Error('usage backend exploded');
    };
    const { deps } = makeDeps(claudeScenario(), CLOCK, collectUsage as ScanRuntimeDeps['collectUsage']);
    const result = await new ScanRunner(deps).scanOnce();
    const orc = result.camps[0]!.orcs[0]!;
    expect(orc.agentType).toBe('claude-code'); // detection/status unaffected
    expect(orc.usage).toBeNull(); // failure isolated to this axis
    expect(result.diagnostics.tmuxErrors).toEqual([]); // scan otherwise clean
  });

  it('with no usage configured (default null-emitter), orcs carry usage=null', async () => {
    const { deps } = makeDeps(claudeScenario(), CLOCK); // no usage collector → fixture default null
    const result = await new ScanRunner(deps).scanOnce();
    expect(result.camps[0]!.orcs[0]!.usage).toBeNull();
  });
});

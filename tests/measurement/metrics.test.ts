/**
 * SPEC-007 §2.5/§3.3 — measurement tests (TC-M-*). Fixture-based ⇒ deterministic,
 * CI-gated (§3.1-1). Each test COMPUTES + REPORTS the PoC metric and asserts the
 * confirmed targets hard (secret-recall = 1.0, calibration monotonicity, no
 * over-detection) plus the project success hypotheses (precision ≥ 0.9, waiting
 * recall ≥ 0.7) against the current curated dataset.
 */
import { describe, expect, it } from 'vitest';
import {
  AGENT_BAND,
  STATUS_BAND,
  computeCalibration,
  computeDetectionMetrics,
  computeRedactionMetrics,
  computeStatusMetrics,
  isMonotonic,
  toPaneSignal,
  toStatusInput,
  type CalibrationRow,
} from './harness';
import {
  BANNER_COHERENCE,
  CORPUS_KEEP,
  CORPUS_SECRET,
  CORPUS_STYLED,
  STYLED_SPAN_CASES,
  DETECT_SAMPLES,
  STATUS_SAMPLES,
  PROCTREE_DETECT_SAMPLES,
  PROCTREE_STATUS_SAMPLES,
} from './dataset';
import { redact, sanitizeStyledCapture } from '../../src/redaction/redact';
import { stripAnsi } from '../../src/redaction/ansi';
import { SGR_RE, MAX_SPANS_PER_LINE, type StyleSpan } from '../../src/server/live-view';
import { detectOrc, defaultDetectors } from '../../src/detection/detect';
import { inferStatus } from '../../src/status/infer';

function pct(n: number): string {
  return Number.isNaN(n) ? '  n/a' : `${(n * 100).toFixed(1)}%`;
}
function calibTable(label: string, rows: CalibrationRow[]): string {
  const body = rows.map((r) => `    ${r.band.padEnd(7)} n=${String(r.n).padStart(3)}  acc=${pct(r.acc)}`).join('\n');
  return `  ${label} calibration:\n${body}`;
}

describe('TC-M-PRECISION (M1) — agent detection precision/recall', () => {
  it('micro precision ≥ 0.9 (hypothesis) with no over-detection of clear non-agents', () => {
    const m = computeDetectionMetrics(DETECT_SAMPLES);
    // eslint-disable-next-line no-console
    console.log(
      `\n[M1] detection (n=${m.n})  micro precision=${pct(m.microPrecision)} recall=${pct(m.microRecall)}\n` +
        `  claude-code: P=${pct(m.perType['claude-code'].precision)} R=${pct(m.perType['claude-code'].recall)} (tp=${m.perType['claude-code'].tp} fp=${m.perType['claude-code'].fp} fn=${m.perType['claude-code'].fn})\n` +
        `  codex      : P=${pct(m.perType.codex.precision)} R=${pct(m.perType.codex.recall)} (tp=${m.perType.codex.tp} fp=${m.perType.codex.fp} fn=${m.perType.codex.fn})`,
    );
    expect(m.microPrecision).toBeGreaterThanOrEqual(0.9); // PoC hypothesis
    // confirmed guard: clearly non-agent panes must stay non-candidates (no false positive)
    for (const id of ['d-node-webserver', 'd-shell-zsh', 'd-vim', 'd-python-repl', 'd-git']) {
      const s = DETECT_SAMPLES.find((x) => x.id === id)!;
      expect(detectOrc(toPaneSignal(s), defaultDetectors)).toBeNull();
    }
  });
});

describe('TC-M-STATUS (M2) — status accuracy / waiting recall', () => {
  it('waiting recall ≥ 0.7 (hypothesis); reports overall accuracy', () => {
    const m = computeStatusMetrics(STATUS_SAMPLES);
    // eslint-disable-next-line no-console
    console.log(
      `\n[M2] status (n=${m.n})  accuracy=${pct(m.accuracy)}  waiting recall=${pct(m.waitingRecall)} ` +
        `precision=${pct(m.waitingPrecision)} (waiting gold=${m.waitingN})` +
        (m.confusion.length ? `\n  mismatches: ${m.confusion.map((c) => `${c.id}[gold=${c.gold},pred=${c.pred}]`).join(', ')}` : '\n  mismatches: none'),
    );
    expect(m.waitingRecall).toBeGreaterThanOrEqual(0.7); // PoC hypothesis
    expect(m.accuracy).toBeGreaterThanOrEqual(0.8); // report-grade floor for this curated set
  });
});

describe('TC-M-CALIB (M3) — confidence calibration monotonicity', () => {
  it('agentTypeConfidence + statusConfidence are non-decreasing across bands', () => {
    const det = computeDetectionMetrics(DETECT_SAMPLES);
    const stat = computeStatusMetrics(STATUS_SAMPLES);
    const detRows = computeCalibration(det.calibrationPoints, AGENT_BAND);
    const statRows = computeCalibration(stat.calibrationPoints, STATUS_BAND);
    // eslint-disable-next-line no-console
    console.log(`\n[M3] calibration\n${calibTable('agentType', detRows)}\n${calibTable('status', statRows)}`);
    expect(isMonotonic(detRows, 1)).toBe(true);
    expect(isMonotonic(statRows, 1)).toBe(true);
  });
});

describe('TC-M-FALSERED (M5) — false-redaction + secret-recall', () => {
  it('secret-recall = 1.0 (confirmed target) and false-redaction-rate ≤ 0.05', () => {
    const m = computeRedactionMetrics(CORPUS_SECRET, CORPUS_KEEP);
    // eslint-disable-next-line no-console
    console.log(
      `\n[M5] redaction  secret-recall=${pct(m.secretRecall)} false-redaction-rate=${pct(m.falseRedactionRate)}` +
        (m.leaked.length ? `\n  LEAKED: ${m.leaked.join(', ')}` : '') +
        (m.falsePositives.length ? `\n  false-positives: ${m.falsePositives.join(' | ')}` : ''),
    );
    expect(m.secretRecall).toBe(1); // confirmed: every known secret masked
    expect(m.leaked).toEqual([]);
    expect(m.falseRedactionRate).toBeLessThanOrEqual(0.05); // PoC hypothesis τ
  });
});

describe('TC-M-STYLED (SPEC-007 §3.3 / SPEC-006 AC-20/AC-22 / SPEC-103 AC-18~21) — styled redaction gate', () => {
  const ESC = '\x1b';
  const TOKEN_RE = /\[REDACTED:[a-z-]+\]/g;

  // (c) structural: no span crosses [REDACTED:*]; runs sorted, non-overlapping, ≤ cap.
  const assertStructure = (lines: string[], spans: StyleSpan[][] | null): void => {
    if (spans === null) return;
    expect(spans.length).toBe(lines.length);
    lines.forEach((line, i) => {
      const tokens: [number, number][] = [];
      TOKEN_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TOKEN_RE.exec(line)) !== null) tokens.push([m.index, m.index + m[0].length]);
      let prevEnd = -1;
      const arr = spans[i]!;
      expect(arr.length).toBeLessThanOrEqual(MAX_SPANS_PER_LINE);
      for (const sp of arr) {
        expect(sp.start).toBeGreaterThanOrEqual(prevEnd);
        expect(sp.start).toBeLessThan(sp.end);
        for (const [ts, te] of tokens) expect(sp.start >= te || sp.end <= ts).toBe(true);
        prevEnd = sp.end;
      }
    });
  };

  it('CORPUS-STYLED: five assertions (a)-(e) hold for every escape-fragmented secret', () => {
    for (const c of CORPUS_STYLED) {
      const r = sanitizeStyledCapture(c.raw);
      const joined = r.lines.join('\n');
      // (a) secret-recall == 1.0 == plain
      expect(joined, `[${c.label}] secret leaked`).not.toContain(c.secret);
      // (b) lines element-wise == redact(stripAll(raw))  (non-destructive overlay)
      expect(r.lines, `[${c.label}] lines != baseline`).toEqual(redact(stripAnsi(c.raw).plain).text.split('\n'));
      // (c) structural: spans don't cross tokens, sorted/non-overlapping/≤cap
      assertStructure(r.lines, r.spans);
      // (d) no raw ESC byte in any frame field
      for (const l of r.lines) expect(l).not.toContain(ESC);
      if (r.spans) for (const arr of r.spans) for (const s of arr) expect(s.sgr).not.toContain(ESC);
      // (e) every span sgr matches the charset/length regex
      if (r.spans) for (const arr of r.spans) for (const s of arr) expect(SGR_RE.test(s.sgr), `[${c.label}] bad sgr ${s.sgr}`).toBe(true);
    }
  });

  it('STYLED_SPAN_CASES: styling is faithfully mapped onto the redacted line', () => {
    for (const c of STYLED_SPAN_CASES) {
      const r = sanitizeStyledCapture(c.raw);
      expect(r.lines, `[${c.label}]`).toEqual([c.wantLine]);
      expect(r.spans, `[${c.label}]`).toEqual([c.wantSpans]);
      assertStructure(r.lines, r.spans);
    }
  });
});

describe('TC-M-PROCTREE (SPEC-007-AC-14) — live-process-tree oracle: recall + active-FP', () => {
  it('wrapper-chain agent (argv in descendant) is detected = RECALL fix', () => {
    const m = computeDetectionMetrics(PROCTREE_DETECT_SAMPLES);
    // eslint-disable-next-line no-console
    console.log(
      `\n[M1-PROCTREE] detection (n=${m.n})  claude-code recall=${pct(m.perType['claude-code'].recall)}`,
    );
    // the wrapped pane (foreground=node, agent only in a descendant) is now detected
    const wrap = PROCTREE_DETECT_SAMPLES.find((s) => s.id === 'pt-wrap-claude')!;
    const cand = detectOrc(toPaneSignal(wrap), defaultDetectors);
    expect(cand?.agentType).toBe('claude-code');
    expect(cand?.processCorroborated).toBe(true);
    expect(cand?.matchedSignals.some((sig) => sig.signal === 'process' && sig.tier === 'A')).toBe(true);
    expect(m.perType['claude-code'].recall).toBe(1); // wrapper chain no longer missed
  });

  it('no-live-agent pane (stale title) is NOT a confident live agent (residual LOW)', () => {
    const stale = PROCTREE_DETECT_SAMPLES.find((s) => s.id === 'pt-stale-title')!;
    const cand = detectOrc(toPaneSignal(stale), defaultDetectors);
    // candidate kept (retention) but residual-capped LOW + not process-corroborated
    expect(cand?.agentTypeConfidence).toBeLessThanOrEqual(0.49);
    expect(cand?.processCorroborated).toBe(false);
  });

  it('no-live-agent pane is never reported active; agent-gone → terminated = active-FP fix', () => {
    const gone = PROCTREE_STATUS_SAMPLES.find((s) => s.id === 'pt-agent-gone')!;
    const cand = detectOrc(toPaneSignal(gone), defaultDetectors)!;
    const inf = inferStatus(toStatusInput(gone, cand));
    expect(inf.status).not.toBe('active');
    expect(inf.status).toBe('terminated');

    // live wrapped agent with a change still resolves to active (gate allows liveness)
    const live = PROCTREE_STATUS_SAMPLES.find((s) => s.id === 'pt-wrap-active')!;
    const liveCand = detectOrc(toPaneSignal(live), defaultDetectors)!;
    const liveInf = inferStatus(toStatusInput(live, liveCand));
    expect(liveInf.status).toBe('active');
    expect(liveInf.statusConfidence).toBeGreaterThanOrEqual(0.8);
  });
});

describe('TC-M-BANNER — redaction↔detection coherence', () => {
  it('banner tokens survive redaction and detection still fires on redacted output', () => {
    const r = redact(BANNER_COHERENCE);
    expect(r.text).toContain('@anthropic-ai/claude-code'); // banner not masked
    // detection on the redacted banner (output-only) must still identify claude-code
    const cand = detectOrc(
      {
        paneId: '%1',
        tmuxTarget: 's:1.0',
        command: 'node',
        paneTitle: null,
        cmdline: null,
        cwd: '/x',
        recentOutput: [r.text],
      },
      defaultDetectors,
    );
    expect(cand?.agentType).toBe('claude-code');
  });
});

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
  type CalibrationRow,
} from './harness';
import { BANNER_COHERENCE, CORPUS_KEEP, CORPUS_SECRET, DETECT_SAMPLES, STATUS_SAMPLES } from './dataset';
import { redact } from '../../src/redaction/redact';
import { detectOrc, defaultDetectors } from '../../src/detection/detect';

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

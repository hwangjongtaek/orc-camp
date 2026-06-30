/**
 * SPEC-301 §2.6b (#50/#52) — intermittent ambient speech (pure schedule + orcish-mixed word-combo).
 */
import { describe, it, expect } from 'vitest';
import { buildSpeechPool, speechAt } from '../src/scene/speech';
import { isOrcishToken, ORCISH_TOKENS } from '../src/scene/orcish';
import { SPEECH_DUR_MS } from '../src/scene/stations';

describe('buildSpeechPool', () => {
  it('tokenises preview/summary text into a deduped word pool', () => {
    const pool = buildSpeechPool('Running tests for the parser', 'running node parser.ts');
    expect(pool).toContain('Running');
    expect(pool).toContain('parser');
    // dedupe is case-insensitive (Running/running collapse to one entry)
    expect(pool.filter((w) => w.toLowerCase() === 'running')).toHaveLength(1);
    // 1-char noise ("the" stays, single letters dropped)
    expect(pool.every((w) => w.length >= 2)).toBe(true);
  });

  it('falls back to orc-chatter words when there is no usable text', () => {
    const pool = buildSpeechPool(null, undefined, '');
    expect(pool.length).toBeGreaterThan(0); // never empty → orc still mutters occasionally
  });

  it('caps the pool size for a huge preview tail', () => {
    const huge = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ');
    expect(buildSpeechPool(huge).length).toBeLessThanOrEqual(24);
  });
});

describe('speechAt', () => {
  const pool = ['compile', 'parser', 'orc', 'tests', 'deploy'];

  it('is silent when the pool is empty (speech gated off)', () => {
    for (let t = 0; t <= 60000; t += 250) expect(speechAt('pane:%1', t, [])).toBeNull();
  });

  it('speaks intermittently — silent most of the time, then an utterance', () => {
    let spoke = 0;
    let silent = 0;
    for (let t = 0; t <= 120000; t += 100) {
      if (speechAt('pane:%1', t, pool) === null) silent += 1;
      else spoke += 1;
    }
    expect(spoke).toBeGreaterThan(0); // it does speak
    expect(silent).toBeGreaterThan(spoke); // …but is quiet most of the time (intermittent)
  });

  it('an utterance mixes pool words with orcish lexicon, held for SPEECH_DUR_MS', () => {
    // find a moment it is speaking
    let start = -1;
    for (let t = 0; t <= 120000; t += 50) {
      if (speechAt('pane:%2', t, pool) !== null) {
        start = t;
        break;
      }
    }
    expect(start).toBeGreaterThanOrEqual(0);
    const line = speechAt('pane:%2', start, pool)!;
    // every spoken word is either a pool word or an orcish-lexicon token (the mix, #52)
    for (const w of line.split(' ')) expect(pool.includes(w) || isOrcishToken(w)).toBe(true);
    // the line is stable across the utterance window (doesn't flicker mid-sentence)
    expect(speechAt('pane:%2', start + Math.floor(SPEECH_DUR_MS / 2), pool)).toBe(line);
  });

  it('active orcs speak a longer (≈2–3 line) utterance bookended by orcish opener + closer', () => {
    const bigPool = ['compile', 'parser', 'orc', 'tests', 'deploy', 'build', 'lint', 'cache'];
    // find a moment pane:%3 is speaking (schedule is identical for active/non-active)
    let start = -1;
    for (let t = 0; t <= 120000; t += 50) {
      if (speechAt('pane:%3', t, bigPool, true) !== null) {
        start = t;
        break;
      }
    }
    expect(start).toBeGreaterThanOrEqual(0);
    const activeLine = speechAt('pane:%3', start, bigPool, true)!;
    const idleLine = speechAt('pane:%3', start, bigPool, false)!;
    // active is reliably longer (always opener + ≥4 work words + closer ⇒ ≥6 tokens)
    expect(activeLine.split(' ').length).toBeGreaterThanOrEqual(6);
    expect(activeLine.split(' ').length).toBeGreaterThan(idleLine.split(' ').length);
    // it still contains real work words AND orcish tokens (the mix)
    expect(activeLine.split(' ').some((w) => bigPool.includes(w))).toBe(true);
    expect(activeLine.split(' ').some((w) => isOrcishToken(w))).toBe(true);
  });

  it('is deterministic and desyncs different orcs', () => {
    expect(speechAt('pane:%2', 4321, pool)).toBe(speechAt('pane:%2', 4321, pool));
    let differ = false;
    for (let t = 0; t <= 60000; t += 200) {
      if ((speechAt('pane:%1', t, pool) === null) !== (speechAt('pane:%2', t, pool) === null)) {
        differ = true;
        break;
      }
    }
    expect(differ).toBe(true); // they don't all talk at the same instant
  });
});

describe('orcish lexicon (#52)', () => {
  it('exposes recognisable WoW-inspired orcish tokens', () => {
    expect(ORCISH_TOKENS.size).toBeGreaterThan(0);
    // a few canonical Warcraft orcish words are present (normalised, lower-case, apostrophes kept)
    for (const w of ['zug', "lok'tar", 'dabu', 'throm-ka']) expect(ORCISH_TOKENS.has(w)).toBe(true);
  });

  it('isOrcishToken matches tokens as they appear in a line (punctuation and all)', () => {
    expect(isOrcishToken('Zug')).toBe(true);
    expect(isOrcishToken("Lok'tar!")).toBe(true);
    expect(isOrcishToken('Throm-Ka.')).toBe(true);
    // a real work word is NOT orcish
    expect(isOrcishToken('parser')).toBe(false);
  });
});

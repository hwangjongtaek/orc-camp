/**
 * SPEC-301 §2.6b (#50/#52) — intermittent ambient "speech", PURE & shared-clock-driven.
 *
 * `speechAt(orcId, t, pool, active?)` decides whether an orc is uttering a speech bubble at
 * shared-clock time `t` and, if so, returns the line — a WoW-inspired orcish opener/closer
 * (scene/orcish.ts) wrapped around a random combo of the orc's preview/summary `pool` words.
 * It is a deterministic function of (orcId, t, active): a seeded PERIOD with a seeded phase, the
 * bubble visible for `SPEECH_DUR_MS` at the start of each period, and the line re-rolled per period
 * (so the same orc says the same thing for the whole utterance, then changes). When `active` is
 * true the orc is "talking while it works": a LONGER utterance (more work words + always an orcish
 * opener & closer + interleaved grunts) so the bubble fills ~2–3 lines. No Math.random / Date.now
 * (fits the single shared clock; testable). Callers gate it off under reduced-motion / for
 * terminated orcs by passing an empty pool.
 *
 * `buildSpeechPool(...texts)` tokenises the preview/summary text into a deduped word pool.
 */
import { paneHash } from './wander';
import {
  ORCISH_CHATTER,
  ORCISH_CLOSERS,
  ORCISH_FILLERS,
  ORCISH_OPENERS,
} from './orcish';
import {
  SPEECH_DUR_MS,
  SPEECH_PERIOD_MAX_MS,
  SPEECH_PERIOD_MIN_MS,
  SPEECH_WORDS_ACTIVE_MAX,
  SPEECH_WORDS_ACTIVE_MIN,
  SPEECH_WORDS_MAX,
  SPEECH_WORDS_MIN,
} from './stations';

/** Deterministic integer mix → fresh 32-bit hash from (base seed, integer k). */
function mix(h: number, k: number): number {
  let x = (h ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

const frac = (h: number): number => (h >>> 8) / 0x1000000;

/** A tiny orc-flavoured fallback so an orc with no preview words still mutters occasionally. */
const FALLBACK_WORDS = [...ORCISH_CHATTER];

const MAX_POOL = 24; // cap so a huge preview tail doesn't bloat the pool
const MAX_WORD_LEN = 16;

/**
 * Tokenise preview/summary text into a deduped, length-bounded word pool. Splits on
 * non-word characters, drops 1-char noise (keeps a couple of evocative ones), trims to MAX_POOL.
 * Falls back to a small orc-chatter pool when nothing usable is found.
 */
export function buildSpeechPool(...texts: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    for (const raw of text.split(/[^\p{L}\p{N}_-]+/u)) {
      const w = raw.trim();
      if (w.length < 2 || w.length > MAX_WORD_LEN) continue;
      const key = w.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(w);
      if (out.length >= MAX_POOL) return out;
    }
  }
  return out.length > 0 ? out : [...FALLBACK_WORDS];
}

/**
 * The utterance an orc is showing at time `t`, or null when it is silent (most of the time) or the
 * pool is empty (speech gated off). Pure on (orcId, t, pool, active). `active` orcs talk while they
 * work → a longer (≈2–3 line) line; the SCHEDULE (period/phase/duration) is identical regardless.
 */
export function speechAt(orcId: string, t: number, pool: string[], active = false): string | null {
  if (pool.length === 0) return null;
  const seed = paneHash(orcId);
  const period =
    SPEECH_PERIOD_MIN_MS + frac(mix(seed, 2)) * (SPEECH_PERIOD_MAX_MS - SPEECH_PERIOD_MIN_MS);
  const phase = frac(mix(seed, 3)) * period;
  const local = t + phase;
  const within = local - Math.floor(local / period) * period;
  if (within >= SPEECH_DUR_MS) return null; // silent for the rest of the period
  const n = Math.floor(local / period); // which utterance (re-rolls the line each period)
  return composeLine(seed, n, pool, active);
}

/** Deterministically pick one entry from `arr`, seeded by hash `h`. */
function pick<T>(arr: readonly T[], h: number): T {
  return arr[h % arr.length] as T;
}

/**
 * Build the spoken line, seeded by (orc seed, utterance n). Mixes the WoW-inspired orcish lexicon
 * (scene/orcish.ts) around a combo of the orc's `pool` words:
 *   [opener] work… [closer]. `active` orcs use the longer ACTIVE word range, ALWAYS get an
 *   opener + closer, and pepper grunt FILLERS between work words (→ ~2–3 lines). Non-active orcs
 *   stay terse: a short combo with an occasional opener/closer.
 */
function composeLine(seed: number, n: number, pool: string[], active: boolean): string {
  const base = mix(seed, 7000 + n);
  const wmin = active ? SPEECH_WORDS_ACTIVE_MIN : SPEECH_WORDS_MIN;
  const wmax = active ? SPEECH_WORDS_ACTIVE_MAX : SPEECH_WORDS_MAX;
  const span = wmax - wmin;
  const count = Math.min(pool.length, wmin + (span > 0 ? mix(base, 1) % (span + 1) : 0));

  const used = new Set<number>();
  const work: string[] = [];
  for (let i = 0; i < count; i += 1) {
    let idx = mix(base, 11 + i) % pool.length;
    for (let tries = 0; used.has(idx) && tries < pool.length; tries += 1) {
      idx = (idx + 1) % pool.length;
    }
    used.add(idx);
    const w = pool[idx];
    if (w) work.push(w);
  }

  const parts: string[] = [];
  // Opener: always for active orcs; ~half the time otherwise.
  if (active || mix(base, 2) % 2 === 0) parts.push(pick(ORCISH_OPENERS, mix(base, 3)));
  for (let i = 0; i < work.length; i += 1) {
    parts.push(work[i] as string);
    // Active: sprinkle a grunt between work words (every ~3rd gap) so it reads like chatter.
    if (active && i < work.length - 1 && mix(base, 50 + i) % 3 === 0) {
      parts.push(pick(ORCISH_FILLERS, mix(base, 80 + i)));
    }
  }
  // Closer: always for active orcs; ~a third of the time otherwise.
  if (active || mix(base, 4) % 3 === 0) parts.push(pick(ORCISH_CLOSERS, mix(base, 5)));

  return parts.join(' ');
}

/**
 * SPEC-008 §4.4 / Open Question Q3 — model→price estimation, kept INTERNAL to the usage
 * surface. The model id is read transiently from a transcript line ONLY to look up a price;
 * it is never returned, stored, logged, or serialized (it stays out of OrcUsage — G1/AC-01).
 *
 * Prices are USD per 1,000,000 tokens, sourced from Anthropic's published list prices via the
 * claude-api skill (cached 2026-06-04): Opus input $5 / output $25, Sonnet $3 / $15, Haiku
 * $1 / $5. Cache-write is the 5-minute-TTL premium (1.25× input); cache-read is ~0.1× input
 * (prompt-caching economics). These are a PoC SEED and tunable (Q3); because the prestige tier
 * uses tokens as its primary axis (SPEC-302 §3.2), cost imprecision has limited downstream
 * effect, and any derived cost is always labeled `source:'estimated'`.
 */

/** Per-model token totals accumulated while parsing (numbers only — never content). */
export interface ModelTokenTotals {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

interface Price {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/**
 * Matched by substring against the transcript's `message.model` so version/date drift in the id
 * (`claude-opus-4-...`, `claude-3-5-haiku-...`) still resolves. Order: most specific first.
 */
const PRICE_TABLE: ReadonlyArray<{ match: RegExp; price: Price }> = [
  { match: /opus/i, price: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 } },
  { match: /sonnet/i, price: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 } },
  { match: /haiku/i, price: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 } },
];

function priceFor(model: string): Price | null {
  for (const entry of PRICE_TABLE) {
    if (entry.match.test(model)) return entry.price;
  }
  return null;
}

/**
 * Estimate cumulative cost (USD) from per-model token totals. Returns null when NO model in the
 * map has a known price (tokens may still be present → caller keeps cumulativeTokens with a null
 * cost). Unknown-model entries contribute nothing rather than guessing a price.
 */
export function estimateCostUsd(perModel: Map<string, ModelTokenTotals>): number | null {
  let total = 0;
  let matchedAny = false;
  for (const [model, t] of perModel) {
    const p = priceFor(model);
    if (!p) continue;
    matchedAny = true;
    total +=
      (t.input / 1e6) * p.input +
      (t.output / 1e6) * p.output +
      (t.cacheCreation / 1e6) * p.cacheWrite +
      (t.cacheRead / 1e6) * p.cacheRead;
  }
  if (!matchedAny) return null;
  return Math.round(total * 1e6) / 1e6; // round to 6 decimals (avoid float noise)
}

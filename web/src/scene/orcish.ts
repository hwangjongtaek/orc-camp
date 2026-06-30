/**
 * SPEC-301 §2.6b (#50/#52) — WoW-inspired orcish lexicon (word-unit library) mixed into ambient speech.
 *
 * A small, curated vocabulary of Warcraft-style orcish (peon/grunt/warchief voice lines) stored
 * WORD-BY-WORD and grouped by the ROLE a token plays in a spoken line, so scene/speech.ts can
 * assemble a readable orc-flavoured sentence:
 *   [OPENER] (greeting/affirmation)  →  the orc's real work words (optionally peppered with
 *   FILLER grunts)  →  [CLOSER] (battle-cry / exclamation).
 * Pure data only (no Math.random / Date.now) so the speech schedule stays deterministic & testable.
 *
 * Source phrases are inspired by Blizzard's Warcraft/WoW orcish (e.g. "Zug zug" = work work / okay,
 * "Lok'tar" = victory, "Lok'tar ogar" = victory or death, "Dabu" = I obey, "Throm-Ka" = well met,
 * "Aka'Magosh" = a blessing on you, "Gol'Kosh" = by my axe, "Swobu" = as you wish, "Kagh!" = run/move,
 * "Kek" = laughter, "Blood and thunder!" = Garrosh's cry).
 */

/** Greeting / acknowledgement that OPENS a line ("Zug zug. <work> …"). */
export const ORCISH_OPENERS: readonly string[] = [
  'Zug zug.',
  "Lok'tar!",
  'Throm-Ka.',
  'Dabu.',
  "Aka'Magosh.",
  'Swobu.',
  'Work work.',
  'Kagh!',
  'Hrmph.',
];

/** Battle-cry / exclamation that CLOSES a line ("… Lok'tar ogar!"). */
export const ORCISH_CLOSERS: readonly string[] = [
  "Lok'tar ogar!",
  'For the Horde!',
  "Gol'Kosh!",
  'Blood and thunder!',
  'Victory or death!',
  'Kek!',
  'Zug zug!',
  'Dabu!',
];

/** Short grunt FILLER interleaved between the orc's work words ("compile grah parser"). */
export const ORCISH_FILLERS: readonly string[] = [
  'hrm',
  'grah',
  'zug',
  "gar'mak",
  'mok',
  'gol',
  'rok',
  'gah',
];

/** Pure-orcish CHATTER used when an orc has no work text at all (fallback pool). */
export const ORCISH_CHATTER: readonly string[] = [
  'Zug',
  'Grah',
  'Hrm',
  'Mok',
  'Dabu',
  'Lok',
  'Throm',
  'Gol',
];

/** Lower-case, edge-punctuation-stripped form of a token (keeps internal `'` and `-`). */
function norm(word: string): string {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * Every individual whitespace-split token across the lexicon (normalised). Lets callers/tests
 * tell an orcish word apart from a work word in a rendered, space-joined line.
 */
export const ORCISH_TOKENS: ReadonlySet<string> = new Set(
  [...ORCISH_OPENERS, ...ORCISH_CLOSERS, ...ORCISH_FILLERS, ...ORCISH_CHATTER]
    .flatMap((phrase) => phrase.split(/\s+/))
    .map(norm)
    .filter(Boolean),
);

/** True when `word` (as it appears in a spoken line, punctuation and all) is from the orcish lexicon. */
export function isOrcishToken(word: string): boolean {
  return ORCISH_TOKENS.has(norm(word));
}

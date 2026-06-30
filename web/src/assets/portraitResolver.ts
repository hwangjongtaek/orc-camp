/**
 * SPEC-304 §2.2 — deterministic portrait resolver for the OrcInspector (Details) slot.
 *
 * Pure function: (PortraitInput + PortraitEnv) → PortraitState. The IDENTITY character key mirrors
 * the sprite resolver (SPEC-300 §2.3: explicit characterKey → agentType→character → mascot, gated
 * on `manifest.characters`). The portrait FILE is then resolved against the separate
 * `manifest.portraits.items` block via a fallback chain (resolved-tier → base → agentType base →
 * mascot base → CSS placeholder). The numeric `displayedTier` from SPEC-302 is mapped to a per-
 * character suffix here (§7 table is the SSOT). Same input ⇒ same output (testable).
 */
import type { AgentType } from '../types/domain';
import type { AssetManifest } from './manifest';
import { AGENT_TO_CHARACTER, MASCOT_KEY } from './spriteResolver';

/** SPEC-304 §1 / §2.1 — canonical 2:3 source default when the manifest omits one. */
const DEFAULT_SOURCE_SIZE: [number, number] = [512, 768];

/**
 * SPEC-304 §2.2-2 / §7 — numeric `displayedTier` (1..3) → per-character portrait suffix. SSOT for
 * the numeric→suffix bridge (SPEC-302 emits only the number). Order = [T1, T2, T3].
 */
export const PORTRAIT_TIER_SUFFIXES: Record<string, [string, string, string]> = {
  'orc-high-warchief-mascot': ['veteran', 'champion', 'warlord'],
  'orc-claude-storm-shaman': ['adept', 'tempest', 'archon'],
  'orc-codex-field-engineer': ['senior', 'artificer', 'forgewright'],
  'orc-unknown': ['seasoned', 'veteran', 'elder'],
  'orc-iron-commander': ['enforcer', 'marshal', 'sovereign'],
};

/** SPEC-304 §7 — caption (display name + role) per character key. */
export const PORTRAIT_CAPTION: Record<string, { name: string; role: string }> = {
  'orc-high-warchief-mascot': { name: 'Orc High Warchief', role: '주인공 mascot · camp leader' },
  'orc-claude-storm-shaman': { name: 'Orc Storm Shaman', role: 'Claude agent' },
  'orc-codex-field-engineer': { name: 'Orc Field Engineer', role: 'Codex agent' },
  'orc-unknown': { name: 'Unknown Orc', role: 'agent type 미확정' },
  'orc-iron-commander': { name: 'Orc Iron Commander', role: 'control/interrupt 상징' },
};

export interface PortraitInput {
  /** Sequential characterKey (SPEC-300 §2.3); undefined ⇒ agentType mapping. */
  characterKey?: string;
  agentType: AgentType;
  /** SPEC-302 §3.3 resolved tier (0 = base). */
  displayedTier: 0 | 1 | 2 | 3;
}

export interface PortraitEnv {
  manifest: AssetManifest | null;
  assetBasePath: string;
}

export interface PortraitState {
  /** Identity character (mirrors the on-map sprite), resolved against manifest.characters. */
  characterKey: string;
  /** Applied portrait tier suffix; null when the base portrait is shown. */
  tier: string | null;
  mode: 'asset' | 'placeholder';
  /** Asset path when mode==='asset'; null for placeholder. */
  src: string | null;
  frameAspect: '2:3';
  sourceSize: [number, number];
  caption: { name: string; role: string };
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

/**
 * §2.2-1 — IDENTITY character key (mirror sprite). Gated on `manifest.characters` so the portrait
 * shows the same archetype the sprite uses. Without a manifest, fall back to the requested/agent
 * key for the caption only.
 */
function resolveIdentityKey(manifest: AssetManifest | null, input: PortraitInput): string {
  const requested = input.characterKey;
  const agent = AGENT_TO_CHARACTER[input.agentType];
  if (!manifest) return requested ?? agent;
  if (requested && manifest.characters[requested]) return requested;
  if (manifest.characters[agent]) return agent;
  return MASCOT_KEY;
}

export function resolvePortrait(input: PortraitInput, env: PortraitEnv): PortraitState {
  const manifest = env.manifest;
  const key = resolveIdentityKey(manifest, input);
  const caption = PORTRAIT_CAPTION[key] ?? { name: key, role: '' };
  const blockDefault = manifest?.portraits?.source_size ?? DEFAULT_SOURCE_SIZE;

  const placeholder = (): PortraitState => ({
    characterKey: key,
    tier: null,
    mode: 'placeholder',
    src: null,
    frameAspect: '2:3',
    sourceSize: blockDefault,
    caption,
  });

  // No portraits block (or no manifest) → graceful CSS placeholder (never a broken image).
  const portraits = manifest?.portraits;
  if (!portraits) return placeholder();

  const root = `${stripTrailingSlash(env.assetBasePath)}/${portraits.root}`;
  const suffix =
    input.displayedTier >= 1 ? PORTRAIT_TIER_SUFFIXES[key]?.[input.displayedTier - 1] ?? null : null;
  const agentKey = AGENT_TO_CHARACTER[input.agentType];

  // §2.2-3 file fallback chain (first available wins). Tier fallback is resolved-tier → base only
  // (no intermediate down-walk — SPEC-302 already resolved displayedTier).
  const chain: Array<{ charKey: string; suffix: string | null }> = [];
  if (suffix) chain.push({ charKey: key, suffix });
  chain.push({ charKey: key, suffix: null });
  if (agentKey !== key) chain.push({ charKey: agentKey, suffix: null });
  if (MASCOT_KEY !== key && MASCOT_KEY !== agentKey) chain.push({ charKey: MASCOT_KEY, suffix: null });

  for (const cand of chain) {
    const item = portraits.items[cand.charKey];
    if (!item) continue;
    if (cand.suffix) {
      const t = item.tiers?.[cand.suffix];
      if (t?.file) {
        return {
          characterKey: key,
          tier: cand.suffix,
          mode: 'asset',
          src: `${root}/${t.file}`,
          frameAspect: '2:3',
          sourceSize: t.source_size ?? item.source_size ?? blockDefault,
          caption,
        };
      }
      continue; // tier file missing → fall through (the base candidate for `key` is next)
    }
    if (item.file) {
      return {
        characterKey: key,
        tier: null,
        mode: 'asset',
        src: `${root}/${item.file}`,
        frameAspect: '2:3',
        sourceSize: item.source_size ?? blockDefault,
        caption,
      };
    }
  }

  return placeholder();
}

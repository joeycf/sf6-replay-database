// Shared roster + ladder helpers for the parse/emit stages.
//
// Character matching: longest-alias-first whole-word search over free text
// (title paren contents, description sides) — "Dee Jay" wins over "Ed",
// "M. Bison" over "Bison", "C. Viper" over "Viper". Aliases come from
// data/characters.json (scripts/characters.ts writes short + official full
// names + curated variants), so parse vocabulary and the app's search
// vocabulary are the same data.
//
// Rank normalization: SF6's ladder is the 9 named leagues (data/ranks.json —
// the single source app/app.config.ts also imports). Two collapses are needed:
// numeric divisions (every league below Master is split 1-5, written "Gold 3")
// fold to their league, and Master's MR sub-tiers ("Master 2", "MR 1700") fold
// to "Master". Legend is the top-500-of-Master distinction and stands alone.
//
// CRITICAL: rank extraction is anchored to the literal " rank " that the
// channels write ("Legend rank Chun-Li"), never a bare ladder-word scan. The
// corpus contains handles like "KUNG FU MASTER" and "YHC MOCHI"; a loose scan
// over a title would read "MASTER" out of a player's name and file the replay
// under a rank nobody claimed.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import RANKS from '../data/ranks.json';
import type { CharacterRecord } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export { RANKS };
export const RANK_SET = new Set<string>(RANKS);

export async function loadCharacters(): Promise<CharacterRecord[]> {
  const raw = await readFile(join(ROOT, 'data', 'characters.json'), 'utf8');
  const characters = JSON.parse(raw) as CharacterRecord[];
  if (characters.length === 0) {
    throw new Error('data/characters.json is empty — run `npm run data:characters` first.');
  }
  return characters;
}

export interface AliasMatch {
  id: string;
  /** [start, end) span of the alias inside the searched text. */
  start: number;
  end: number;
}

export interface AliasMatcher {
  /** All character matches in the text, longest-alias-first, overlaps
   *  suppressed (so "Dee Jay" absorbs a stray inner match). */
  find(text: string): AliasMatch[];
  /** The single character a side-sized fragment names, or null when the
   *  fragment names zero or 2+ characters. */
  one(text: string): string | null;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildAliasMatcher(characters: CharacterRecord[]): AliasMatcher {
  // alias → id, longest first so greedy scanning prefers the longest name
  const entries: { alias: string; id: string; re: RegExp }[] = [];
  for (const c of characters) {
    const aliases = c.extra?.aliases ?? [c.name.toLowerCase()];
    for (const alias of aliases) {
      entries.push({
        alias,
        id: c.id,
        // word-ish boundaries: aliases may contain spaces/dots/hyphens
        re: new RegExp(`(?<![a-z0-9])${escapeRegExp(alias)}(?![a-z0-9])`, 'gi'),
      });
    }
  }
  entries.sort((a, b) => b.alias.length - a.alias.length);

  function find(text: string): AliasMatch[] {
    const taken: AliasMatch[] = [];
    for (const { id, re } of entries) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const span = { id, start: m.index, end: m.index + m[0].length };
        if (!taken.some((t) => span.start < t.end && t.start < span.end)) taken.push(span);
      }
    }
    return taken.sort((a, b) => a.start - b.start);
  }

  return {
    find,
    one(text: string): string | null {
      const found = find(text);
      const ids = [...new Set(found.map((f) => f.id))];
      return ids.length === 1 ? ids[0]! : null;
    },
  };
}

// ── the leaderboard-position prefix ──────────────────────────────────────────
// 35-65% of titles write the paren as "#3 Ranked Guile" — that is the player's
// position on the per-character leaderboard, NOT a ladder rank. It is stripped
// before character matching so the report's char-unresolved rows stay honest,
// and it is never mistaken for Side.rank.
const LEADERBOARD_RE = /#\s*\d+\s*ranked\s*/gi;

export const stripLeaderboard = (text: string): string =>
  text.replace(LEADERBOARD_RE, ' ').replace(/\s+/g, ' ').trim();

// ── ladder-rank extraction ───────────────────────────────────────────────────
// Anchored to the channels' actual phrasing: "<League> rank <Character>",
// case-insensitive, optionally with a division/MR figure between the league and
// the word "rank" ("Master 2 rank", "Diamond 4 Rank"). Longest-first over the
// ladder so "Legend" can never be shadowed.
const LEAGUE_ALTS = [...RANKS].sort((a, b) => b.length - a.length).map(escapeRegExp);
const RANK_RE = new RegExp(
  `(?<![a-z])(${LEAGUE_ALTS.join('|')})\\s*(?:[1-5]|[ivx]+)?\\s*(?:\\(?\\s*MR\\s*\\d{3,5}\\s*\\)?\\s*)?rank\\b`,
  'i',
);
// "MR 1700 Ryu" / "Master Rate 1700" with no league word: MR is a Master-only
// metric, so an MR figure alone is unambiguously Master.
const MR_ONLY_RE = /(?<![a-z])(?:MR|master\s*rate)\s*:?\s*\d{3,5}\b/i;

/**
 * The normalized GameConfig.ranks entry a fragment claims, or undefined.
 * Pass a side-sized fragment (one description clause), never a whole title.
 */
export function extractRank(text: string): string | undefined {
  const m = RANK_RE.exec(text);
  if (m) {
    const league = m[1]!.toLowerCase();
    return RANKS.find((r) => r.toLowerCase() === league);
  }
  if (MR_ONLY_RE.test(text)) return 'Master';
  return undefined;
}

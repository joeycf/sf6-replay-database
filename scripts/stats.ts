// Shared counting, extracted so parse.ts and the standalone emit.ts derive
// IDENTICAL numbers from the same substrate — the double-emit byte-identity
// gate in scripts/e2e.ts depends on it.
//
// Semantics that matter: characterUsage counts SIDE APPEARANCES, so a Ryu
// mirror adds 2. The same denominator drives the usage bars, the per-season
// timeline, and the player tables, which is what makes those three views
// agree.
//
// The duo-only keys (pairingUsage / playerPairings) are deliberately ABSENT:
// SF6 is 1v1, and every engine duo panel self-hides on charactersPerSide === 1.

import type { MatchVideo } from '../types/index';

export interface PipelineStats {
  characterUsage: Record<string, number>;
  /** season key ('1' | '2' | …) → characterId → side appearances */
  bySeasonUsage: Record<string, Record<string, number>>;
  playerCharacters: Record<string, Record<string, number>>;
  totals: { videos: number; bySeason: Record<string, number> };
}

/** Sort a flat object by key — byte-stable output across runs. */
export const sort1 = <T>(o: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

/** Sort a nested object by key at both levels. */
export const sort2 = (
  o: Record<string, Record<string, number>>,
): Record<string, Record<string, number>> =>
  Object.fromEntries(
    Object.entries(o)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sort1(v)]),
  );

export function buildStats(records: MatchVideo[]): PipelineStats {
  const characterUsage: Record<string, number> = {};
  const bySeasonUsage: Record<string, Record<string, number>> = {};
  const playerCharacters: Record<string, Record<string, number>> = {};
  const bySeason: Record<string, number> = {};

  for (const v of records) {
    const skey = String(v.season);
    bySeason[skey] = (bySeason[skey] ?? 0) + 1;
    bySeasonUsage[skey] ??= {};

    for (const s of v.sides) {
      characterUsage[s.character] = (characterUsage[s.character] ?? 0) + 1;
      bySeasonUsage[skey]![s.character] = (bySeasonUsage[skey]![s.character] ?? 0) + 1;
      playerCharacters[s.player] ??= {};
      playerCharacters[s.player]![s.character] =
        (playerCharacters[s.player]![s.character] ?? 0) + 1;
    }
  }

  return {
    characterUsage: sort1(characterUsage),
    bySeasonUsage: sort2(bySeasonUsage),
    playerCharacters: sort2(playerCharacters),
    totals: { videos: records.length, bySeason: sort1(bySeason) },
  };
}

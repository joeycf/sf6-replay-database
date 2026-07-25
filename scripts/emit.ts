// Stage 3: project the bespoke SF6 substrate (data/videos.json) onto the
// engine's GENERIC contract and write what the site actually reads.
//
// Two schemas, deliberately: the substrate keeps everything the parser learned
// (intake channel, handles, per-side rank, season), while the emitted
// replays.json carries only what the engine's types declare. The engine never
// learns anything SF6-shaped.
//
// Run standalone: npm run data:emit   (re-derives from the committed substrate
// with no YouTube access — which is what makes the e2e's double-emit
// byte-identity gate possible).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHANNELS } from './channels';
import { RANK_SET } from './roster';
import { SEASONS, buildPatchGroups, seasonToken, validateSeasons } from './seasons';
import { buildStats, sort1, sort2 } from './stats';
import type { CharacterRecord, MatchVideo, PlayerRecord, VideoOverride } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── the engine contract, restated locally ────────────────────────────────────
// The pipeline can't resolve the Nuxt `@engine` alias, so the emitted shapes
// are declared here. They must mirror replay-engine/types/replay.ts.
export interface GenericSide {
  player: string;
  characters: string[];
  rank?: string;
}
export interface GenericReplay {
  id: string;
  sides: [GenericSide, GenericSide];
  date: string;
  patch?: string;
  source: string;
  title: string;
  views?: number;
  durationSec?: number;
}

/**
 * `thumb` is deliberately NEVER emitted. Replay.id is a YouTube id and the
 * engine derives https://i.ytimg.com/vi/<id>/hqdefault.jpg at render time
 * (BrowseCard/VideoModal). Emitting it would add ~1 MB to the whale file for
 * a string every client can compute. Revisit only if the engine's client-side
 * maxres→hq fallback lands — until then, omission is the correct choice and
 * the e2e asserts the derived URL is what ships.
 */
function toReplay(v: MatchVideo): GenericReplay {
  return {
    id: v.id,
    sides: v.sides.map((s) => ({
      player: s.player,
      characters: [s.character],
      ...(s.rank ? { rank: s.rank } : {}),
    })) as [GenericSide, GenericSide],
    date: v.publishedAt,
    patch: seasonToken(v.season),
    source: v.channel,
    title: v.title,
    ...(v.viewCount !== undefined ? { views: v.viewCount } : {}),
    ...(v.durationSec ? { durationSec: v.durationSec } : {}),
  };
}

/** Manual corrections, applied last. Shared by parse.ts and the standalone
 *  entry so both paths see the same record set. */
export function applyOverrides(
  records: MatchVideo[],
  overrides: Record<string, VideoOverride>,
): MatchVideo[] {
  const excluded = new Set(
    Object.entries(overrides)
      .filter(([, ov]) => ov.exclude === true)
      .map(([id]) => id),
  );
  const out: MatchVideo[] = [];
  for (const v of records) {
    if (excluded.has(v.id)) continue;
    const ov = overrides[v.id];
    out.push(
      ov
        ? {
            ...v,
            ...(ov.season ? { season: ov.season } : {}),
            ...(ov.sides ? { sides: ov.sides } : {}),
          }
        : v,
    );
  }
  if (excluded.size > 0) {
    console.log(`  overrides.json excludes ${records.length - out.length} record(s)`);
  }
  return out;
}

export async function emitGeneric(
  records: MatchVideo[],
  characters: CharacterRecord[],
  players: PlayerRecord[],
): Promise<void> {
  validateSeasons();

  const replays = records.map(toReplay);
  const pipelineStats = buildStats(records);

  // ── contract assertions: every one a throw. A silent schema drift here
  // ships a site that renders wrong numbers, which is worse than no site.
  if (replays.length !== records.length) {
    throw new Error(`emit: replay count ${replays.length} !== record count ${records.length}`);
  }

  const rosterIds = new Set(characters.map((c) => c.id));
  const playerIds = new Set(players.map((p) => p.id));
  const sourceIds = new Set<string>(CHANNELS.map((c) => c.source));
  const seasonTokens = new Set(SEASONS.map((s) => seasonToken(s.season)));

  for (const r of replays) {
    if (r.sides.length !== 2) throw new Error(`emit: ${r.id} lost its two-sides invariant`);
    for (const s of r.sides) {
      if (s.characters.length !== 1) {
        throw new Error(`emit: ${r.id} side has ${s.characters.length} characters (SF6 is 1v1)`);
      }
      if (!rosterIds.has(s.characters[0]!)) {
        throw new Error(`emit: ${r.id} references unknown character '${s.characters[0]}'`);
      }
      if (!playerIds.has(s.player)) {
        throw new Error(`emit: ${r.id} references unknown player '${s.player}'`);
      }
      if (s.rank && !RANK_SET.has(s.rank)) {
        throw new Error(`emit: ${r.id} carries off-ladder rank '${s.rank}'`);
      }
    }
    if (!sourceIds.has(r.source)) {
      throw new Error(`emit: ${r.id} references untracked source '${r.source}'`);
    }
    if (!r.patch || !seasonTokens.has(r.patch)) {
      throw new Error(`emit: ${r.id} carries unknown season token '${r.patch}'`);
    }
  }

  // index-aligned: the emitted token must agree with the substrate's season
  for (let i = 0; i < replays.length; i++) {
    if (replays[i]!.patch !== seasonToken(records[i]!.season)) {
      throw new Error(
        `emit: ${replays[i]!.id} patch ${replays[i]!.patch} contradicts season ${records[i]!.season}`,
      );
    }
  }

  // ── the engine's KnownStats shape (season keys become era tokens) ─────────
  const byPatchUsage = sort2(
    Object.fromEntries(
      Object.entries(pipelineStats.bySeasonUsage).map(([s, m]) => [seasonToken(Number(s)), m]),
    ),
  );
  const byPatch = sort1(
    Object.fromEntries(
      Object.entries(pipelineStats.totals.bySeason).map(([s, n]) => [seasonToken(Number(s)), n]),
    ),
  );
  const genericStats = {
    totals: {
      replays: records.length,
      characters: characters.length,
      players: players.length,
      byPatch,
    },
    characterUsage: pipelineStats.characterUsage,
    byPatchUsage,
    playerCharacters: pipelineStats.playerCharacters,
  };

  if (genericStats.totals.replays !== records.length) {
    throw new Error('emit: stats.totals.replays drifted from the record count');
  }
  const usageTotal = Object.values(pipelineStats.characterUsage).reduce((a, b) => a + b, 0);
  if (usageTotal !== records.length * 2) {
    throw new Error(
      `emit: characterUsage sums to ${usageTotal}, expected ${records.length * 2} side appearances`,
    );
  }

  const dataDir = join(ROOT, 'data');
  const publicDataDir = join(ROOT, 'public', 'data');
  await mkdir(publicDataDir, { recursive: true });

  // no indent on the whale — it is fetched by every visitor
  await writeFile(join(dataDir, 'replays.json'), JSON.stringify(replays) + '\n', 'utf8');
  await writeFile(join(publicDataDir, 'replays.json'), JSON.stringify(replays) + '\n', 'utf8');
  await writeFile(
    join(dataDir, 'stats.json'),
    JSON.stringify(genericStats, null, 2) + '\n',
    'utf8',
  );
  await writeFile(
    join(dataDir, 'patchGroups.json'),
    JSON.stringify(buildPatchGroups(), null, 2) + '\n',
    'utf8',
  );

  console.log(
    `✔ emitted ${replays.length} replays, ${characters.length} characters, ${players.length} players`,
  );
  console.log(
    `  seasons: ${Object.entries(byPatch)
      .map(([k, n]) => `${k}=${n}`)
      .join(' ')}`,
  );
}

// ── standalone entry ─────────────────────────────────────────────────────────
const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const read = async <T>(p: string): Promise<T> =>
    JSON.parse(await readFile(join(ROOT, 'data', p), 'utf8')) as T;

  const videos = await read<MatchVideo[]>('videos.json');
  const characters = await read<CharacterRecord[]>('characters.json');
  const players = await read<PlayerRecord[]>('players.json');
  const overrides = await read<Record<string, VideoOverride>>('overrides.json').catch(() => ({}));

  await emitGeneric(applyOverrides(videos, overrides), characters, players);
}

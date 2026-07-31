// Stage 3: project the bespoke SF6 substrate (data/videos.json) onto the
// engine's GENERIC contract and write what the site actually reads.
//
// Two schemas, deliberately: the substrate keeps everything the parser learned
// (intake channel, handles, per-side rank, season), while the emitted
// replays.json carries only what the engine's types declare. The engine never
// learns anything SF6-shaped.
//
// Alongside those, data/summary.json — the apex selector's card payload
// (Phase 6). Committed like the rest, and copied into public/data/ by the
// build's build:before hook.
//
// Run standalone: npm run data:emit   (re-derives from the committed substrate
// with no YouTube access — which is what makes the e2e's double-emit
// byte-identity gate possible).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHANNELS } from './channels';
import { RANK_SET } from './roster';
import {
  PATCHES,
  SEASONS,
  buildPatchGroups,
  patchForDate,
  patchWindows,
  seasonToken,
  validatePatches,
  validateSeasons,
} from './seasons';
import { buildStats, sort1, sort2 } from './stats';
import type { CharacterRecord, MatchVideo, PlayerRecord, VideoOverride } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The game's identity as it appears in data/summary.json — the shell selector
 *  keys its cards on it. Restated here for the same reason the generic shapes
 *  below are: the pipeline can't resolve the Nuxt `@engine`/app.config graph.
 *  app/app.config.ts is the authority; the shell's verify:cutover asserts these
 *  two values against its own GAMES table, so a drift fails at the apex. */
const GAME_ID = 'sf6';
const GAME_NAME = 'Street Fighter 6';

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
 * The fine patch token for a capture date, with the era token as the
 * documented "era known, patch unknown" fallback (engine v0.6.0: the grouped
 * facet expands a parent selection to itself PLUS its children, so an
 * era-token replay still matches `?patch=S3`).
 *
 * Two ways to land on the fallback, and both are live states rather than
 * defensive padding: a date after the newest patch but inside an era that has
 * opened (S4 from 2026-08-03 until Capcom ships and the wiki pages Yasmine's
 * version), and an override that moves a replay's season away from the one its
 * date-derived patch belongs to. The second is what Tekken and 2XKO call the
 * normalize step; here it is the same rule, evaluated where the token is made.
 */
function patchToken(v: MatchVideo, windows = patchWindows()): string {
  const w = patchForDate(v.publishedAt, windows);
  return w && w.season === v.season ? w.version : seasonToken(v.season);
}

/**
 * `thumb` is deliberately NEVER emitted. Replay.id is a YouTube id and the
 * engine derives https://i.ytimg.com/vi/<id>/hqdefault.jpg at render time
 * (BrowseCard/VideoModal). Emitting it would add ~1 MB to the whale file for
 * a string every client can compute. Revisit only if the engine's client-side
 * maxres→hq fallback lands — until then, omission is the correct choice and
 * the e2e asserts the derived URL is what ships.
 */
function toReplay(v: MatchVideo, windows = patchWindows()): GenericReplay {
  return {
    id: v.id,
    sides: v.sides.map((s) => ({
      player: s.player,
      characters: [s.character],
      ...(s.rank ? { rank: s.rank } : {}),
    })) as [GenericSide, GenericSide],
    date: v.publishedAt,
    patch: patchToken(v, windows),
    source: v.channel,
    title: v.title,
    ...(v.viewCount !== undefined ? { views: v.viewCount } : {}),
    ...(v.durationSec ? { durationSec: v.durationSec } : {}),
  };
}

/** Manual corrections, applied last. Shared by parse.ts and the standalone
 *  entry so both paths see the same record set. `channel` is the
 *  source-classification verdict (beats the KingArena title classifier). */
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
            ...(ov.channel ? { channel: ov.channel } : {}),
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
  validatePatches();

  const windows = patchWindows();
  const replays = records.map((v) => toReplay(v, windows));
  const pipelineStats = buildStats(records);

  // ── contract assertions: every one a throw. A silent schema drift here
  // ships a site that renders wrong numbers, which is worse than no site.
  if (replays.length !== records.length) {
    throw new Error(`emit: replay count ${replays.length} !== record count ${records.length}`);
  }

  const rosterIds = new Set(characters.map((c) => c.id));
  const playerIds = new Set(players.map((p) => p.id));
  // every token a channel can publish under — kingArena emits two
  const sourceIds = new Set<string>(
    CHANNELS.flatMap((c) => (c.eventSource ? [c.source, c.eventSource] : [c.source])),
  );
  const seasonTokens = new Set(SEASONS.map((s) => seasonToken(s.season)));
  const patchTokens = new Set(PATCHES.map((p) => p.version));

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
    if (!r.patch || !(patchTokens.has(r.patch) || seasonTokens.has(r.patch))) {
      throw new Error(`emit: ${r.id} carries unknown patch token '${r.patch}'`);
    }
  }

  // index-aligned: the emitted token must agree with the substrate's season —
  // an era token IS that season, a fine token must nest under it
  const seasonOfPatch = new Map(windows.map((w) => [w.version, w.season]));
  for (let i = 0; i < replays.length; i++) {
    const token = replays[i]!.patch!;
    const season = records[i]!.season;
    const parent = seasonTokens.has(token) ? Number(token.slice(1)) : seasonOfPatch.get(token);
    if (parent !== season) {
      throw new Error(
        `emit: ${replays[i]!.id} patch ${token} contradicts season ${season} (parent ${parent})`,
      );
    }
  }

  // ── the grouped patch facet: the hierarchy must ACCOUNT FOR the tokens ────
  // The engine is forgiving here — a token no group declares falls through to
  // ungroupedPatchTokens() and renders as a loose trailing chip — so a drift
  // between the table and the emitted data would ship a working-looking site
  // with an orphan chip. These two throws are what make that impossible.
  const groups = buildPatchGroups();
  const groupIds: string[] = [];
  for (const g of groups) {
    groupIds.push(g.id);
    for (const c of g.children ?? []) groupIds.push(c.id);
  }
  const dupe = groupIds.find((id, i) => groupIds.indexOf(id) !== i);
  if (dupe !== undefined) {
    throw new Error(`emit: patchGroups id '${dupe}' appears twice (ids must be unique)`);
  }
  const grouped = new Set(groupIds);
  const ungrouped = [...new Set(replays.map((r) => r.patch!))].filter((t) => !grouped.has(t));
  if (ungrouped.length > 0) {
    throw new Error(`emit: patch token(s) no group accounts for: ${ungrouped.join(', ')}`);
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

  // ── the shell selector's payload (Phase 6) ───────────────────────────────
  // Tiny, and fetched same-origin by the apex selector through its /sf6
  // rewrite — so it has to be COMMITTED (Vercel never runs the pipeline);
  // data/summary.json is the committed artifact and the build's build:before
  // hook copies it into public/data/ alongside the whale.
  //
  // `updated` is the newest replay's DATE, never build time. A build timestamp
  // would rewrite this file on a zero-new-video day and defeat the cron's
  // commit guard, turning every no-op day into a commit and a deploy.
  const newest = records.reduce((max, v) => (v.publishedAt > max ? v.publishedAt : max), '');
  // The counts are READ FROM the stats artifact rather than re-derived, so the
  // selector and the site's own stats page cannot disagree by construction.
  // (Re-deriving them here and asserting equality would compare `players.length`
  // with `players.length` — a throw that can never fire is not a gate.) What
  // follows are the two comparisons that CAN fire; `updated` gets its real teeth
  // in scripts/e2e.ts, which recomputes it from the substrate independently.
  const summary = {
    game: GAME_ID,
    name: GAME_NAME,
    replays: genericStats.totals.replays,
    players: genericStats.totals.players,
    characters: genericStats.totals.characters,
    updated: newest.slice(0, 10),
  };
  if (summary.replays !== replays.length) {
    throw new Error(
      `emit: summary.replays ${summary.replays} !== emitted replay count ${replays.length}`,
    );
  }
  if (summary.players < 1 || summary.characters < 1) {
    throw new Error(
      `emit: summary has an empty registry (players ${summary.players}, characters ${summary.characters})`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(summary.updated)) {
    throw new Error(`emit: summary.updated is not a replay date ("${summary.updated}")`);
  }

  const dataDir = join(ROOT, 'data');
  const publicDataDir = join(ROOT, 'public', 'data');
  await mkdir(publicDataDir, { recursive: true });

  // no indent on the whale — it is fetched by every visitor
  await writeFile(join(dataDir, 'replays.json'), JSON.stringify(replays) + '\n', 'utf8');
  await writeFile(join(publicDataDir, 'replays.json'), JSON.stringify(replays) + '\n', 'utf8');
  const summaryJson = JSON.stringify(summary, null, 2) + '\n';
  await writeFile(join(dataDir, 'summary.json'), summaryJson, 'utf8');
  await writeFile(join(publicDataDir, 'summary.json'), summaryJson, 'utf8');
  await writeFile(
    join(dataDir, 'stats.json'),
    JSON.stringify(genericStats, null, 2) + '\n',
    'utf8',
  );
  await writeFile(
    join(dataDir, 'patchGroups.json'),
    JSON.stringify(groups, null, 2) + '\n',
    'utf8',
  );
  // The patch table mirrored to data/, the way parse.ts mirrors SEASONS to
  // seasonBoundaries.json — so the e2e can derive its expected per-patch counts
  // from a committed artifact by walking the windows itself, instead of
  // importing the module it is meant to be testing.
  await writeFile(
    join(dataDir, 'patchBoundaries.json'),
    JSON.stringify(PATCHES, null, 2) + '\n',
    'utf8',
  );

  const byToken = replays.reduce<Record<string, number>>((acc, r) => {
    acc[r.patch!] = (acc[r.patch!] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    `✔ emitted ${replays.length} replays, ${characters.length} characters, ${players.length} players`,
  );
  console.log(
    `  seasons: ${Object.entries(byPatch)
      .map(([k, n]) => `${k}=${n}`)
      .join(' ')}`,
  );
  console.log(
    `  patches: ${PATCHES.map((p) => `${p.version}=${byToken[p.version] ?? 0}`).join(' ')}`,
  );
  console.log(`  summary.json → ${summary.replays} replays, newest ${summary.updated}`);
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

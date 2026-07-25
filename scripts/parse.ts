// Stage 2: parse raw/<channel>.json into the committed substrate
// (data/videos.json), derive the player registry (data/players.json), persist
// the season windows, write the coverage report, then emit the generic schema
// (scripts/emit.ts).
//
// Title contract (all three tracked channels share it):
//   SF6 <delim> PLAYER_A (CharacterA) vs PLAYER_B (CharacterB) <delim> …
// The paren often carries a LEADERBOARD POSITION rather than a bare character
// ("#3 Ranked Guile"). That is a per-character world ranking, NOT a ladder
// rank; it is stripped before matching and never becomes Side.rank.
//
// LADDER RANKS come from the DESCRIPTIONS, which write them as
// "<League> rank <Character>":
//   "Haitani (Legend rank Chun-Li) and Yoshikibi (Legend rank Cammy)"
// Never scan a title for ladder words — this corpus contains handles like
// "KUNG FU MASTER" and "Oil King", and a loose scan would invent ranks.
//
// Run: npm run data:parse   (pure: no network, no API key)

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyOverrides, emitGeneric } from './emit';
import { CHANNELS } from './channels';
import { dueExpiries, formatExpiries } from './expiries';
import { LAUNCH, SEASONS, seasonForDate, validateSeasons } from './seasons';
import { buildAliasMatcher, extractRank, loadCharacters, stripLeaderboard } from './roster';
import type {
  MatchSide,
  MatchVideo,
  PlayerRecord,
  RawVideoRecord,
  VideoOverride,
} from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

validateSeasons();

// Curated famous-pro list (marks Player.featured when present in the data —
// harmless for ids that never appear). Slugs verified against the real corpus.
const FEATURED = new Set([
  'daigo',
  'tokido',
  'itazan',
  'bonchan',
  'kazunoko',
  'punk',
  'menard',
  'nemo',
  'fuudo',
  'mago',
  'kawano',
  'xiaohai',
  'dogura',
  'angrybird',
  'problem-x',
  'snake-eyez',
  'nuckledu',
  'chris-wong',
  'ending-walker',
  'big-bird',
  'gachikun',
  'haitani',
  'moke',
  'blaz',
  'go1',
  'xian',
  'sako',
  'idom',
  'broski',
  'nephew',
  'oil-king',
  'mister-crimson',
  'valmaster',
  'higuchi',
  'yhc-mochi',
  'kobayan',
  'leshar',
  'kakeru',
  'shuto',
  'hotdog29',
]);

// ── handle identity ──────────────────────────────────────────────────────────
// SF6's channels do NOT prefix handles with esports org tags — verified across
// all 20,000+ parseable titles: not one known FGC org (FLY, PXG, RB, MOUZ,
// FALCONS, ZETA, CAG, …) appears in handle position. The frequent leading
// tokens are all integral parts of names: "Oil King", "Big Bird", "Problem X",
// "Ending Walker", "YHC Mochi", "SNB Johnny", "801 Strider", "PR Balrog".
// Tekken's stripOrgPrefix is therefore deliberately ABSENT here — porting it
// would fragment real players rather than merge sponsored ones.
//
// What DOES fragment this corpus is punctuation and spacing: the same player
// is written "Ending Walker" (333 sides) and "EndingWalker" (296), "Problem X"
// (434) and "ProblemX" (230), "MenaRD" and "Mena RD", "Big Bird" and "BIGBIRD".
// Identity is therefore keyed on the handle with ALL non-alphanumerics removed,
// while the public id keeps the readable hyphenated form of whichever spelling
// the sources use most. Two spellings of one player collapse to one page; two
// genuinely different players cannot collide, because differing alphanumerics
// produce differing keys.
const idKey = (handle: string): string => handle.toLowerCase().replace(/[^a-z0-9]+/g, '');
const slug = (handle: string): string =>
  handle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const isUpper = (s: string) => s === s.toUpperCase() && s !== s.toLowerCase();

// ── the is-SF6 predicate ─────────────────────────────────────────────────────
// Two of the three channels carry a Street Fighter V back-catalogue (990 on
// @TheFGCplace, 969 on @streetfighterreplays41). Every SF6 upload on all three
// carries an explicit game marker in the title, so this is a title test, not a
// tag test — the tags on these channels are SEO soup and name both games.
const SF6_RE = /\bSF6\b|STREET\s*FIGHTER\s*6|スト6/i;

// ── title parsing ────────────────────────────────────────────────────────────
const VS_RE = /(.+?)\(([^()]{1,60})\)\s*(?:vs\.?|versus)\s*(.+?)\(([^()]{1,60})\)/iu;
// channel-brand segment delimiters seen in the tracked channels' titles
// (▰ = High Level, 🤜🤛 = The FGC Place, 🔥 = SF Replays)
const SEG_RE = /[▰🔥⚡•▶►|🤜🤛]+/u;

function cleanHandle(raw: string): string | null {
  let t = raw.split(SEG_RE).pop() ?? '';
  t = t.split(/\s[-–—]\s/).pop() ?? '';
  t = t
    .replace(/^[\s,.:;–—-]+/u, '')
    .replace(/[\s,.:;–—-]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length > 40) return null;
  return t;
}

interface TitleSides {
  handles: [string, string];
  parens: [string, string];
}
function parseTitle(title: string): TitleSides | null {
  const m = VS_RE.exec(title);
  if (!m) return null;
  const a = cleanHandle(m[1]!);
  const b = cleanHandle(m[3]!);
  if (!a || !b) return null;
  return { handles: [a, b], parens: [m[2]!, m[4]!] };
}

// ── description side pass (ladder ranks + nicer handle casing) ───────────────
// The connector varies by channel: High Level writes "A (…) and B (…)",
// The FGC Place writes "A (…) versus B (…)".
const DESC_RE =
  /([^():\n!]{1,50}?)\s*\(([^()\n]{1,90})\)\s*(?:versus|vs\.?|and)\s*([^():\n!]{1,50}?)\s*\(([^()\n]{1,90})\)/iu;

interface DescSide {
  handle: string;
  character: string | null;
  rank?: string;
}
function parseDescSides(
  description: string,
  matcher: ReturnType<typeof buildAliasMatcher>,
): [DescSide, DescSide] | null {
  const m = DESC_RE.exec(description);
  if (!m) return null;
  const side = (name: string, paren: string): DescSide => {
    const rank = extractRank(paren);
    return {
      handle: name.replace(/\s+/g, ' ').trim(),
      character: matcher.one(stripLeaderboard(paren)),
      ...(rank ? { rank } : {}),
    };
  };
  return [side(m[1]!, m[2]!), side(m[3]!, m[4]!)];
}

// ── main ─────────────────────────────────────────────────────────────────────
const characters = await loadCharacters();
const matcher = buildAliasMatcher(characters);

const SOURCE_OF = new Map(CHANNELS.map((c) => [c.id, c.source]));

const readJson = async <T>(p: string): Promise<T> => JSON.parse(await readFile(p, 'utf8')) as T;
const raws: RawVideoRecord[] = [];
for (const ch of CHANNELS) {
  const path = join(ROOT, 'raw', `${ch.id}.json`);
  try {
    raws.push(...(await readJson<RawVideoRecord[]>(path)));
  } catch {
    console.error(`✖ ${path} missing/unreadable — run \`npm run data:fetch\` first.`);
    process.exit(1);
  }
}
const overrides = await readJson<Record<string, VideoOverride>>(join(DATA, 'overrides.json')).catch(
  () => ({}) as Record<string, VideoOverride>,
);

type MissReason =
  | 'not-sf6'
  | 'live-or-upcoming'
  | 'shorts'
  | 'short-duration'
  | 'pre-launch'
  | 'no-vs-title'
  | 'char-unresolved'
  | 'bad-handle';
const misses: { id: string; channel: string; reason: MissReason; title: string }[] = [];
const miss = (r: RawVideoRecord, reason: MissReason) =>
  misses.push({ id: r.id, channel: r.channel, reason, title: r.title });

interface Candidate {
  raw: RawVideoRecord;
  handles: [string, string];
  chars: [string, string];
  ranks: [string | undefined, string | undefined];
  descHandles: [string | undefined, string | undefined];
}
const candidates: Candidate[] = [];

for (const r of raws) {
  if (!SF6_RE.test(r.title)) {
    miss(r, 'not-sf6');
    continue;
  }
  if (r.liveBroadcastContent !== 'none' || r.durationSec === 0) {
    miss(r, 'live-or-upcoming');
    continue;
  }
  if (/#shorts?\b/i.test(r.title)) {
    miss(r, 'shorts');
    continue;
  }
  if (r.durationSec < 120) {
    miss(r, 'short-duration');
    continue;
  }
  if (r.publishedAt.slice(0, 10) < LAUNCH) {
    miss(r, 'pre-launch');
    continue;
  }
  const t = parseTitle(r.title);
  if (!t) {
    miss(r, 'no-vs-title');
    continue;
  }
  const charA = matcher.one(stripLeaderboard(t.parens[0]));
  const charB = matcher.one(stripLeaderboard(t.parens[1]));
  if (!charA || !charB) {
    miss(r, 'char-unresolved');
    continue;
  }
  if (!slug(t.handles[0]) || !slug(t.handles[1])) {
    miss(r, 'bad-handle');
    continue;
  }

  // description pass: ladder ranks + nicer casing, aligned to the title sides
  let ranks: Candidate['ranks'] = [undefined, undefined];
  let descHandles: Candidate['descHandles'] = [undefined, undefined];
  const desc = parseDescSides(r.description, matcher);
  if (desc) {
    const [d0, d1] = desc;
    let order: [DescSide, DescSide] | null = null;
    if (d0.character === charA && d1.character === charB) {
      // mirror matchups (charA === charB) are order-ambiguous by character
      // alone — require a handle correspondence before trusting the order
      order = charA !== charB || idKey(d0.handle) === idKey(t.handles[0]) ? [d0, d1] : null;
      if (!order && idKey(d1.handle) === idKey(t.handles[0])) order = [d1, d0];
    } else if (d0.character === charB && d1.character === charA) {
      order = [d1, d0];
    }
    if (order) {
      ranks = [order[0].rank, order[1].rank];
      descHandles = [
        idKey(order[0].handle) === idKey(t.handles[0]) ? order[0].handle : undefined,
        idKey(order[1].handle) === idKey(t.handles[1]) ? order[1].handle : undefined,
      ];
    }
  }

  candidates.push({ raw: r, handles: t.handles, chars: [charA, charB], ranks, descHandles });
}

// ── player registry: one identity per idKey, best spelling wins the id ───────
// Description mixed-case outweighs ALL-CAPS titles 1000×; frequency is the
// tiebreak. The winning spelling supplies BOTH the display handle and the
// hyphenated public id, so /players/ending-walker beats /players/endingwalker
// purely because the sources write it that way more often.
const casing = new Map<string, Map<string, number>>(); // idKey → spelling → weight
function noteHandle(key: string, variant: string, weight: number) {
  const m = casing.get(key) ?? new Map<string, number>();
  m.set(variant, (m.get(variant) ?? 0) + weight);
  casing.set(key, m);
}

for (const c of candidates) {
  for (let i = 0; i < 2; i++) {
    const handle = c.handles[i]!;
    noteHandle(idKey(handle), handle, 1);
    const dh = c.descHandles[i];
    if (dh && !isUpper(dh)) noteHandle(idKey(handle), dh, 1000); // desc casing wins
  }
}

const bestSpelling = new Map<string, string>(); // idKey → chosen handle
for (const [key, variants] of casing) {
  bestSpelling.set(key, [...variants.entries()].sort((a, b) => b[1] - a[1])[0]![0]);
}
const idOf = (handle: string): string => slug(bestSpelling.get(idKey(handle)) ?? handle);

const videos: MatchVideo[] = candidates.map((c) => {
  const sides = c.chars.map((character, i) => {
    const handle = c.handles[i]!;
    const key = idKey(handle);
    return {
      player: idOf(handle),
      handle: bestSpelling.get(key) ?? handle,
      character,
      ...(c.ranks[i] ? { rank: c.ranks[i] } : {}),
    } as MatchSide;
  }) as [MatchSide, MatchSide];
  return {
    id: c.raw.id,
    channel: SOURCE_OF.get(c.raw.channel)!,
    title: c.raw.title,
    publishedAt: c.raw.publishedAt,
    durationSec: c.raw.durationSec,
    ...(c.raw.viewCount !== undefined ? { viewCount: c.raw.viewCount } : {}),
    season: seasonForDate(c.raw.publishedAt),
    sides,
  };
});
videos.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id));

const records = applyOverrides(videos, overrides);

const seen = new Map<string, string>(); // id → handle
for (const v of records) for (const s of v.sides) seen.set(s.player, s.handle);
const players: PlayerRecord[] = [...seen.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, handle]) => ({ id, handle, ...(FEATURED.has(id) ? { featured: true } : {}) }));

// ── write artifacts ──────────────────────────────────────────────────────────
await writeFile(join(DATA, 'videos.json'), JSON.stringify(records, null, 1) + '\n', 'utf8');
await writeFile(join(DATA, 'players.json'), JSON.stringify(players, null, 2) + '\n', 'utf8');
await writeFile(
  join(DATA, 'seasonBoundaries.json'),
  JSON.stringify(SEASONS, null, 2) + '\n',
  'utf8',
);

// ── report ───────────────────────────────────────────────────────────────────
const channelOf = new Map(raws.map((r) => [r.id, r.channel]));
const byChannel = (id: string) => ({
  raw: raws.filter((r) => r.channel === id).length,
  sf6: raws.filter((r) => r.channel === id && SF6_RE.test(r.title)).length,
  parsed: records.filter((v) => channelOf.get(v.id) === id).length,
  ranked: records
    .filter((v) => channelOf.get(v.id) === id)
    .reduce((n, v) => n + v.sides.filter((s) => s.rank).length, 0),
});
const rankSides = records.reduce((n, v) => n + v.sides.filter((s) => s.rank).length, 0);
const rankDist = records.reduce<Record<string, number>>((acc, v) => {
  for (const s of v.sides) if (s.rank) acc[s.rank] = (acc[s.rank] ?? 0) + 1;
  return acc;
}, {});
const seasonDist = records.reduce<Record<string, number>>((acc, v) => {
  acc[`S${v.season}`] = (acc[`S${v.season}`] ?? 0) + 1;
  return acc;
}, {});
const reasonCounts = misses.reduce<Record<string, number>>((acc, m) => {
  acc[m.reason] = (acc[m.reason] ?? 0) + 1;
  return acc;
}, {});

// The SOFT half of the self-expiring gates (scripts/expiries.ts). This path is
// the daily cron's, so it must NEVER exit: failing here would stop the data
// refresh entirely, which is worse than the misfiling it warns about. The
// workflow's final step turns the run red AFTER the data is committed and
// pushed. Do not "fix" this by making it throw.
const due = dueExpiries();
const actionRequired =
  due.length > 0 ? ['## ⚠ ACTION REQUIRED', '', formatExpiries(due), '', '---', ''].join('\n') : '';

const report = [
  actionRequired,
  '# SF6 pipeline report',
  '',
  `**${records.length} matches** parsed from ${raws.length} uploads across ${CHANNELS.length} channels · ` +
    `${players.length} players · ranked sides ${rankSides}/${records.length * 2} ` +
    `(${((rankSides / (records.length * 2)) * 100).toFixed(1)}%)`,
  '',
  '| channel | source | uploads | is-SF6 | parsed | of SF6 | ranked sides |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ...CHANNELS.map((ch) => {
    const s = byChannel(ch.id);
    return (
      `| ${ch.id} | ${ch.source} | ${s.raw} | ${s.sf6} | ${s.parsed} | ` +
      `${((s.parsed / Math.max(1, s.sf6)) * 100).toFixed(1)}% | ${s.ranked} |`
    );
  }),
  '',
  `Seasons: ${Object.entries(seasonDist)
    .sort()
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ')}`,
  '',
  `Rank distribution (side appearances): ${
    Object.entries(rankDist)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ') || 'none'
  }`,
  '',
  `Misses by reason: ${
    Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ') || 'none'
  }`,
  '',
  '## Sample misses (first 30 that are not shorts/live/not-sf6)',
  '',
  ...misses
    .filter((m) => !['shorts', 'live-or-upcoming', 'not-sf6'].includes(m.reason))
    .slice(0, 30)
    .map((m) => `- \`${m.id}\` [${m.channel}] ${m.reason}: ${m.title.slice(0, 110)}`),
  '',
  `_Generated ${new Date().toISOString()}_`,
  '',
].join('\n');
await writeFile(join(DATA, 'report.md'), report, 'utf8');

if (due.length > 0) {
  console.error('\n' + '='.repeat(72));
  console.error(`FAILURE SIGNAL — ${due.length} expiry/expiries due (data still written)`);
  console.error('='.repeat(72));
  console.error(formatExpiries(due));
  console.error('='.repeat(72) + '\n');
}

console.log(
  `✔ Parsed ${records.length}/${raws.length} uploads → data/videos.json (misses: ${misses.length}; see data/report.md)`,
);
console.log(
  `  seasons ${Object.entries(seasonDist)
    .sort()
    .map(([k, n]) => `${k}:${n}`)
    .join(' ')} · ranked sides ${rankSides} · players ${players.length}`,
);

// ── emit the generic schema (same code path as `npm run data:emit`) ──────────
await emitGeneric(records, characters, players);

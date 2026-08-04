// SPIKE A1: isolate the match-shaped SF6 corpus on @EvoEvents.
//
// Scratchpad only — writes nothing into data/. The enumeration lands in the
// gitignored cache/evo/ so the ~110 quota units are spent once and every later
// spike step reads the cache.
//
// @EvoEvents is the channel scripts/channels.ts evaluated and deliberately did
// NOT track: its titles name players, game and round but never characters
// ("Evo 2026: MenaRD vs Shigematsu | Street Fighter 6 | Grand Final"), and
// emit.ts hard-fails a side without one. This script establishes how much
// match-shaped footage is actually there before any pixel gets read.
//
// Run: tsx --env-file-if-exists=.env scripts/spike/evo-corpus.ts [--refresh]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LAUNCH } from '../seasons';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'cache', 'evo');
const API_BASE = 'https://www.googleapis.com/youtube/v3';

// @EvoEvents — the id and pinned uploads playlist (UU + channelId.slice(2)),
// same convention as scripts/channels.ts.
const CHANNEL_ID = 'UCWI626ZNdqM5tOlctPUTW2g';
const UPLOADS = 'UUWI626ZNdqM5tOlctPUTW2g';

const refresh = process.argv.includes('--refresh');

// ── the SF6 marker, verbatim from scripts/parse.ts:126 ───────────────────────
// Reused rather than re-spelled so the spike's counts mean the same thing the
// pipeline's do.
const SF6_RE = /\bSF6\b|STREET\s*FIGHTER\s*6|スト6/i;

interface EvoRecord {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  durationSec: number;
  viewCount?: number;
  liveBroadcastContent: string;
  tags?: string[];
}

// ── API plumbing (same shape as scripts/fetch.ts; copied, not imported — that
// file is a top-level-await script that would run its whole fetch on import) ──
const rawKey = process.env.YT_API_KEY;
if (!rawKey) {
  console.error('✖ Missing YT_API_KEY (see .env.example).');
  process.exit(1);
}
const API_KEY: string = rawKey;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiGet<T>(
  endpoint: string,
  params: Record<string, string>,
  retries = 5,
): Promise<T> {
  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', API_KEY);

  for (let attempt = 1; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    const body = await res.text().catch(() => '');
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      continue;
    }
    throw new Error(`YouTube API HTTP ${res.status} on ${endpoint}\n${body}`);
  }
  throw new Error('unreachable');
}

function parseDuration(iso: string | undefined): number {
  if (!iso) return 0;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

interface PlaylistItemsResponse {
  items: { contentDetails: { videoId: string } }[];
  nextPageToken?: string;
}
interface VideosResponse {
  items: {
    id: string;
    snippet: {
      title: string;
      description: string;
      publishedAt: string;
      liveBroadcastContent: string;
      tags?: string[];
    };
    contentDetails: { duration?: string };
    statistics?: { viewCount?: string };
  }[];
}

async function enumerate(): Promise<EvoRecord[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page: PlaylistItemsResponse = await apiGet('playlistItems', {
      part: 'contentDetails',
      playlistId: UPLOADS,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    });
    for (const it of page.items) ids.push(it.contentDetails.videoId);
    pageToken = page.nextPageToken;
    if (ids.length % 500 === 0) console.log(`  …enumerated ${ids.length}`);
  } while (pageToken);

  const records: EvoRecord[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const res: VideosResponse = await apiGet('videos', {
      part: 'snippet,contentDetails,statistics',
      id: ids.slice(i, i + 50).join(','),
      maxResults: '50',
    });
    for (const v of res.items) {
      records.push({
        id: v.id,
        title: v.snippet.title,
        description: v.snippet.description,
        publishedAt: v.snippet.publishedAt,
        durationSec: parseDuration(v.contentDetails.duration),
        ...(v.statistics?.viewCount ? { viewCount: Number(v.statistics.viewCount) } : {}),
        liveBroadcastContent: v.snippet.liveBroadcastContent,
        ...(v.snippet.tags ? { tags: v.snippet.tags } : {}),
      });
    }
    if ((i / 50) % 20 === 19) console.log(`  …hydrated ${records.length}/${ids.length}`);
  }
  records.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  return records;
}

// ── main ─────────────────────────────────────────────────────────────────────
await mkdir(CACHE, { recursive: true });
const cachePath = join(CACHE, 'enumeration.json');

let all: EvoRecord[];
if (!refresh) {
  try {
    all = JSON.parse(await readFile(cachePath, 'utf8')) as EvoRecord[];
    console.log(`Using cached enumeration (${all.length} uploads) — --refresh to re-fetch.`);
  } catch {
    console.log(`Enumerating @EvoEvents (${CHANNEL_ID})…`);
    all = await enumerate();
    await writeFile(cachePath, JSON.stringify(all, null, 1) + '\n', 'utf8');
  }
} else {
  console.log(`Enumerating @EvoEvents (${CHANNEL_ID})…`);
  all = await enumerate();
  await writeFile(cachePath, JSON.stringify(all, null, 1) + '\n', 'utf8');
}

// ── gate the corpus down, counting at every step ─────────────────────────────
// Same predicates and same order as scripts/parse.ts's per-video loop, so a
// number here is comparable to a number in data/report.md.
const gates: { label: string; kept: number; dropped: number }[] = [];
const step = (label: string, input: EvoRecord[], keep: (r: EvoRecord) => boolean) => {
  const out = input.filter(keep);
  gates.push({ label, kept: out.length, dropped: input.length - out.length });
  return out;
};

let cur = all;
gates.push({ label: 'all uploads', kept: cur.length, dropped: 0 });
cur = step(
  'is-SF6 (title or description)',
  cur,
  (r) => SF6_RE.test(r.title) || SF6_RE.test(r.description),
);
const sf6 = cur;
cur = step('not live/upcoming', cur, (r) => r.liveBroadcastContent === 'none' && r.durationSec > 0);
cur = step('not #shorts', cur, (r) => !/#shorts?\b/i.test(r.title));
cur = step('duration ≥ 120s', cur, (r) => r.durationSec >= 120);
cur = step(`published ≥ ${LAUNCH}`, cur, (r) => r.publishedAt.slice(0, 10) >= LAUNCH);

const w = Math.max(...gates.map((g) => g.label.length));
console.log('\n── gate table ─────────────────────────────────────────');
for (const g of gates) {
  console.log(
    `  ${g.label.padEnd(w)}  ${String(g.kept).padStart(5)}` +
      (g.dropped ? `   (−${g.dropped})` : ''),
  );
}

// ── the title grammar, read rather than guessed ──────────────────────────────
// The match-shape filter is written AFTER looking at this. Dump the survivors
// grouped by year so the per-event title conventions are visible.
const byYear = new Map<string, EvoRecord[]>();
for (const r of cur) {
  const y = r.publishedAt.slice(0, 4);
  (byYear.get(y) ?? byYear.set(y, []).get(y)!).push(r);
}
console.log('\n── SF6-marked survivors by upload year ────────────────');
for (const [y, rs] of [...byYear.entries()].sort()) {
  console.log(`  ${y}: ${rs.length}`);
}

const durs = cur.map((r) => r.durationSec).sort((a, b) => a - b);
const pct = (p: number) => durs[Math.floor((durs.length - 1) * p)] ?? 0;
const fmt = (s: number) => `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
console.log(
  `\n  duration: min ${fmt(durs[0] ?? 0)} · p25 ${fmt(pct(0.25))} · median ${fmt(pct(0.5))} · p75 ${fmt(pct(0.75))} · max ${fmt(durs[durs.length - 1] ?? 0)}`,
);

await writeFile(join(CACHE, 'sf6-candidates.json'), JSON.stringify(cur, null, 1) + '\n', 'utf8');

// ── match shape ──────────────────────────────────────────────────────────────
// Three title grammars across Evo 2023→2026, all segment-delimited by "|":
//   2023-24  "Evo 2023: Street Fighter 6 Winners Semifinals | Kakeru vs AngryBird"
//   2025-26J "Evo 2025: Street Fighter 6 | Kakeru vs Fuudo | Winners Semifinals"
//   2026     "Evo 2026: Shigematsu vs MenaRD | Street Fighter 6 | Winners Final"
// Rather than three regexes that rot when Evo reshuffles the segments again,
// split on "|" and find the ONE segment carrying a versus — the players are
// always inside a single segment, the game name and round are always in others.
const GAME_RE = /^(?:street\s*fighter\s*6|sf6)$/i;
const VS_SPLIT = /\s+(?:vs\.?|versus)\s+/i;

// Non-match footage that ALSO carries a versus. The vs-shape above already
// excludes every stream VOD, bracket compilation, best-of and intro in this
// corpus — none of them put "A vs B" in a segment — so this list stays narrow
// on purpose. In particular it must NOT contain "Top \d+": Evo writes the
// bracket round as "Top 24" / "Top 96" / "Losers Top 8", so a Top-N filter here
// eats six real single matches ("Evo 2023: Street Fighter 6 Top 96 | AngryBird
// vs SonicFox"). "Top 8" alone with no versus is the compilation, and the shape
// gate already has it.
//
// "OG Hunt" is the genuine exception: a vs-titled cross-game exhibition series
// (Betty vs Justin Wong, Betty vs Ryan Hart) that is not one SF6 match.
const NOT_A_MATCH_RE = new RegExp(
  [
    '\\bOG\\s*Hunt\\b',
    'watch\\s*party',
    '\\bbest\\s*of\\b',
    '\\bintro\\b',
    'dev\\s*panel',
    'road\\s+to\\s+evo',
    'matches\\s+you\\s+missed',
    '\\brecap\\b',
    'highlights?',
  ].join('|'),
  'i',
);

// A single bracket match runs 6–25 min across all four years. Longer vs-titled
// uploads are exhibitions/showcases (Daigo vs MenaRD at 62m, an FT10) where a
// player can switch character between games — a different extraction problem,
// deferred rather than silently dropped.
const MAX_MATCH_SEC = 30 * 60;

interface EvoTitle {
  event: string;
  round: string | null;
  handles: [string, string];
}

function parseEvoTitle(title: string): EvoTitle | null {
  const segs = title
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segs.length < 2) return null;

  // "Evo Japan 2026: …" — the event prefix rides on whichever segment is first,
  // which differs by grammar, so strip it wherever it appears.
  const stripEvent = (s: string) => {
    const i = s.indexOf(':');
    return i === -1 ? s : s.slice(i + 1).trim();
  };
  const event = (/^([^:|]*\b(?:evo)\b[^:|]*)/i.exec(title)?.[1] ?? '').trim();
  if (!event) return null;

  const vsIdx = segs.findIndex((s) => VS_SPLIT.test(stripEvent(s)));
  if (vsIdx === -1) return null;
  // exactly one versus segment, and exactly two sides within it
  if (segs.filter((s) => VS_SPLIT.test(stripEvent(s))).length !== 1) return null;
  const parts = stripEvent(segs[vsIdx]!).split(VS_SPLIT);
  if (parts.length !== 2) return null;
  const [a, b] = parts.map((p) => p.trim());
  if (!a || !b || a.length > 40 || b.length > 40) return null;

  // The round is whatever non-game text survives in the other segments — the
  // 2023-24 grammar hides it behind the game name in the same segment.
  let round: string | null = null;
  for (const [i, s] of segs.entries()) {
    if (i === vsIdx) continue;
    const rest = stripEvent(s)
      .replace(/street\s*fighter\s*6|sf6/gi, '')
      .trim();
    if (rest && !GAME_RE.test(rest)) {
      round = rest;
      break;
    }
  }
  return { event, round, handles: [a, b] };
}

const excluded: { r: EvoRecord; why: string }[] = [];
const matches: { r: EvoRecord; t: EvoTitle }[] = [];
for (const r of cur) {
  // shape first — it is the strongest signal and the marker list below is only
  // there to catch what survives it
  const t = parseEvoTitle(r.title);
  if (!t) {
    excluded.push({ r, why: 'no vs-shape (stream/compilation/best-of/intro)' });
    continue;
  }
  if (NOT_A_MATCH_RE.test(r.title)) {
    excluded.push({ r, why: 'vs-titled but not one match' });
    continue;
  }
  if (r.durationSec > MAX_MATCH_SEC) {
    excluded.push({ r, why: `long-form (${fmt(r.durationSec)}) — exhibition, deferred` });
    continue;
  }
  matches.push({ r, t });
}

console.log('\n── match-shape gate ───────────────────────────────────');
console.log(`  SF6 candidates in           ${cur.length}`);
console.log(`  excluded                    ${excluded.length}`);
console.log(`  MATCH-SHAPED                ${matches.length}`);

const byEvent = new Map<string, number>();
for (const m of matches) byEvent.set(m.t.event, (byEvent.get(m.t.event) ?? 0) + 1);
console.log('\n── match-shaped by event ──────────────────────────────');
for (const [e, n] of [...byEvent.entries()].sort()) console.log(`  ${e.padEnd(22)} ${n}`);

const mdurs = matches.map((m) => m.r.durationSec).sort((a, b) => a - b);
console.log(
  `\n  duration: min ${fmt(mdurs[0] ?? 0)} · median ${fmt(mdurs[Math.floor((mdurs.length - 1) / 2)] ?? 0)} · max ${fmt(mdurs[mdurs.length - 1] ?? 0)}`,
);
console.log(`  total footage: ${Math.round(mdurs.reduce((a, b) => a + b, 0) / 60)} min`);

console.log(`\n── the corpus (${matches.length}) ────────────────────────────────`);
for (const { r, t } of [...matches].sort((x, y) => (x.r.publishedAt < y.r.publishedAt ? -1 : 1))) {
  console.log(
    `  ${r.publishedAt.slice(0, 10)} ${fmt(r.durationSec).padStart(7)} ${r.id}  ${t.handles[0]} vs ${t.handles[1]}  ${t.round ? `[${t.round}]` : '[—]'}`,
  );
}

console.log(`\n── excluded (${excluded.length}) ──────────────────────────────────`);
for (const { r, why } of excluded) console.log(`  ${why.padEnd(38)} ${r.title}`);

await writeFile(
  join(CACHE, 'corpus.json'),
  JSON.stringify(
    matches.map(({ r, t }) => ({
      id: r.id,
      title: r.title,
      publishedAt: r.publishedAt,
      durationSec: r.durationSec,
      event: t.event,
      round: t.round,
      handles: t.handles,
    })),
    null,
    1,
  ) + '\n',
  'utf8',
);

console.log(
  `\n✔ cache/evo/enumeration.json (${all.length}) · sf6-candidates.json (${cur.length}) · corpus.json (${matches.length})`,
);
console.log(`  SF6-marked before the structural gates: ${sf6.length}`);

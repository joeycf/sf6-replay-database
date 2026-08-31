// Stage 1 for the INDEX intake: pull Replay Theater's tagged Street Fighter 6
// tournament matches, join each to the YouTube metadata of the VOD it points
// into, and dump the result to raw/replayTheater.json.
//
// Run: npm run data:theater
//
// WHY THIS IS A SEPARATE COMMAND, and not part of data:fetch. data:fetch runs in
// the daily cron. A third party's uptime and goodwill should not become a cron
// dependency on day one of an integration, and committed records survive source
// loss anyway. So this is LOCAL-FIRST: run by hand, on a cadence a human
// chooses, and parse.ts carries the committed records forward on every run that
// finds no dump — which is every cron run.
//
// WHAT IT IS NOT. Replay Theater hosts no video. It is an index: a match is a
// (videoId, startSeconds) pair plus players, characters and an event tag. So a
// record here is a SEGMENT — 1,044 of the 1,065 share a VOD with another — and
// its id is `${videoId}@${startSeconds}`, never a YouTube id.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHANNELS } from './channels';
import { fetchVideoMeta, requireApiKey, sleep } from './youtube';
import type { TheaterRawRecord } from '../types/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RAW_DIR = join(ROOT, 'raw');
const OUT = join(RAW_DIR, 'replayTheater.json');
// What the pull learned about ITSELF, beside the dump. parse.ts reads it so
// report.md can state the collapse rather than absorb it silently — a number the
// records alone cannot reconstruct, because the collapsed entries are gone by
// then. Absent on a carrying run, which report.md says rather than printing 0.
const STATS = join(RAW_DIR, '.replayTheater.stats.json');
const PARTIAL = join(RAW_DIR, '.replayTheater.partial.json');

const CH = CHANNELS.find((c) => c.id === 'replayTheater');
if (!CH?.index) throw new Error('replayTheater is not registered as an index channel');
const INDEX = CH.index;

// ── flags ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const FRESH = argv.includes('--fresh');
const opt = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
};
// `--max-pages` with no value yields NaN, and Math.min(pages, NaN) is NaN — the
// loop then never runs and you silently get page 1. A flag that is present must
// carry a usable number or stop the run.
const maxPagesRaw = opt('--max-pages');
let MAX_PAGES = Infinity;
if (argv.includes('--max-pages')) {
  const n = Number(maxPagesRaw);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`✖ --max-pages needs a positive integer (got ${JSON.stringify(maxPagesRaw)}).`);
    process.exit(1);
  }
  MAX_PAGES = n;
}

requireApiKey('data:theater');

const pct = (n: number, total: number) => (total === 0 ? '0.0' : ((n / total) * 100).toFixed(1));

// ── the index API ───────────────────────────────────────────────────────────

/** One entry exactly as the catalogue publishes it. Everything is nullable:
 *  this is someone else's schema and we do not get to assume. */
interface TheaterEntry {
  id?: number;
  game?: string | null;
  video_link?: string | null;
  tag?: string | null;
  upload_date?: string | null;
  p1_name?: string | null;
  p2_name?: string | null;
  p1_char?: string | null;
  p1_char2?: string | null;
  p1_char3?: string | null;
  p1_char4?: string | null;
  p2_char?: string | null;
  p2_char2?: string | null;
  p2_char3?: string | null;
  p2_char4?: string | null;
}
interface TheaterPage {
  matches?: TheaterEntry[];
  total_count?: number | string;
}

async function getPage(page: number, retries = 4): Promise<TheaterPage> {
  const url = `${INDEX.endpoint}?game=${encodeURIComponent(INDEX.slug)}&page=${page}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          accept: 'application/json',
          // Identify the client. This is a fellow fan project, not a target.
          'user-agent': 'replay-database/sf6 (+https://github.com/joeycf) data:theater',
        },
      });
      if (res.ok) return (await res.json()) as TheaterPage;
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
      throw new Error(`HTTP ${res.status} (not retryable)\n${await res.text().catch(() => '')}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= retries || msg.includes('not retryable')) {
        throw new Error(`Replay Theater page ${page} failed: ${msg}`, { cause: err });
      }
      const wait = Math.min(1500 * 2 ** (attempt - 1), 10_000);
      console.warn(
        `  ⚠ page ${page} (attempt ${attempt}/${retries}): ${msg}; retrying in ${wait}ms`,
      );
      await sleep(wait);
    }
  }
  throw new Error(`Exhausted retries for page ${page}`);
}

// ── video link → (videoId, startSeconds) ────────────────────────────────────
//
// THE LINKS ARE CONCATENATED, NOT BUILT. Replay Theater's submission form does
// `video_link = base + "&t=" + t + "s"` regardless of what `base` looks like, so
// a youtu.be submission produces `https://youtu.be/<id>&t=554s` — a PATH with no
// query string at all. 605 of the 1,191 tagged SF6 entries are that shape, just
// over half. A URL-parsing extractor reads the id as "abcdefghijk&t=554s"; this
// matches the id shape explicitly and refuses anything else rather than guessing.
const VIDEO_ID =
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/(?:live|shorts|embed)\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/;

// GLOBAL, and the LAST match wins. The form appends its own offset last, so an
// earlier `t=` is whatever the submitter's clipboard carried in — a share link
// already carrying a timestamp. Taking the first reads the clipboard and throws
// away the catalogue's own value. This catalogue is where that was discovered:
// five entries on VOD YHpoXQJTJ_Y read `...&t=747s&pp=...&t=0s|293s|847s|1267s`,
// and first-wins collapses all five onto `YHpoXQJTJ_Y@747`.
const START_ALL = /[?&]t=([^&#]*)/g;
const START_VALUE = /^(\d+)s?$/;

interface Link {
  videoId: string;
  startSeconds: number;
  /** How many `t=` params the link carried; >1 is worth seeing in recon. */
  tCount: number;
}

function parseLink(link: string): Link | { error: string } {
  const id = VIDEO_ID.exec(link ?? '');
  if (!id) return { error: 'no extractable YouTube id' };
  const values = [...(link ?? '').matchAll(START_ALL)].map((m) => m[1] ?? '');
  if (values.length === 0) return { videoId: id[1]!, startSeconds: 0, tCount: 0 };
  const last = values[values.length - 1]!;
  const m = START_VALUE.exec(last);
  // A `t=` we cannot read is NOT the same as no `t=`. Falling through to 0 would
  // publish a segment that starts at the top of a three-hour VOD and renders
  // exactly like a correct one.
  if (!m) return { error: `unreadable t= value ${JSON.stringify(last)}` };
  return { videoId: id[1]!, startSeconds: Number(m[1]), tCount: values.length };
}

// ── chapters, derived from the description ──────────────────────────────────
//
// RECON ONLY — this produces no field and gates nothing. MatchVideo has no
// `round` and no `tournament`, so the reference's round-harvesting has no
// destination here and is not ported. What survives is the measurement this
// intake was admitted on: the catalogue's offsets against the uploaders' own
// chapter markers, re-run on every pull rather than trusted from the day it was
// first taken. Note only 59 of the 86 VODs carry a chapter list, so the check
// covers ~93% of the records and the rest are unverifiable by this means.
//
// The rule YouTube applies: timestamped lines, at least three, the first at
// 0:00. The last test matters — a description that merely mentions a time is
// not a chapter list.
const CHAPTER_LINE =
  /^\s*(?:\[|\()?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\]|\))?\s*[-–—:|]?\s*(.+?)\s*$/;

interface Chapter {
  start: number;
  title: string;
}

function chaptersOf(description: string): Chapter[] {
  const out: Chapter[] = [];
  for (const line of (description ?? '').split('\n')) {
    const m = CHAPTER_LINE.exec(line);
    if (!m) continue;
    const [, a, b, c, title] = m;
    const start = c ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);
    if (title?.trim()) out.push({ start, title: title.trim() });
  }
  if (out.length < 3 || out[0]!.start !== 0) return [];
  return out.sort((x, y) => x.start - y.start);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// ── the pull ────────────────────────────────────────────────────────────────
await mkdir(RAW_DIR, { recursive: true });

interface PartialCache {
  pages: number[];
  entries: TheaterEntry[];
}

const byTheaterId = new Map<number, TheaterEntry>();
const seenPages = new Set<number>();
if (!FRESH && existsSync(PARTIAL)) {
  const cache = JSON.parse(await readFile(PARTIAL, 'utf8')) as PartialCache;
  for (const p of cache.pages ?? []) seenPages.add(p);
  for (const e of cache.entries ?? []) if (e.id !== undefined) byTheaterId.set(e.id, e);
  console.log(`  resuming: ${seenPages.size} page(s), ${byTheaterId.size} entr(ies) cached`);
}

console.log(`\n▶ Pulling the Replay Theater index (${INDEX.endpoint}, game=${INDEX.slug})…`);
const first = await getPage(1);
const total = Number(first.total_count ?? 0);
const pages = Math.min(Math.ceil(total / INDEX.pageSize), MAX_PAGES);
console.log(`  catalogue reports ${total} match(es) → ${pages} page(s) of ${INDEX.pageSize}`);
for (const e of first.matches ?? []) if (e.id !== undefined) byTheaterId.set(e.id, e);
seenPages.add(1);

for (let page = 2; page <= pages; page++) {
  if (seenPages.has(page)) continue;
  await sleep(INDEX.pacingMs);
  const body = await getPage(page);
  const rows = body.matches ?? [];
  for (const e of rows) if (e.id !== undefined) byTheaterId.set(e.id, e);
  seenPages.add(page);
  if (page % 10 === 0) {
    console.log(`  page ${page}/${pages} — ${byTheaterId.size} entr(ies)`);
    await writeFile(
      PARTIAL,
      JSON.stringify({ pages: [...seenPages], entries: [...byTheaterId.values()] }),
      'utf8',
    );
  }
}
const catalogue = [...byTheaterId.values()];
console.log(`  pulled ${catalogue.length} unique entr(ies)`);

// ── the game gate, PER ENTRY ────────────────────────────────────────────────
// `?game=sf6` is a query someone else answers, and an index is a strictly weaker
// guarantee than a channel: a mistagged submission would arrive looking exactly
// like a real one. Every entry states its own game, so check that instead of the
// query.
const want = INDEX.gameLabel.toUpperCase();
const wrongGame = catalogue.filter((e) => (e.game ?? '').trim().toUpperCase() !== want);
const rightGame = catalogue.filter((e) => (e.game ?? '').trim().toUpperCase() === want);
if (wrongGame.length) {
  console.log(`  ⚠ ${wrongGame.length} entr(ies) rejected — entry.game is not ${INDEX.gameLabel}:`);
  for (const e of wrongGame.slice(0, 10)) {
    console.log(`      #${e.id} game=${JSON.stringify(e.game)} ${e.video_link ?? ''}`);
  }
  if (wrongGame.length > 10) console.log(`      … ${wrongGame.length - 10} more`);
}

// ── scope: tagged tournament matches only ───────────────────────────────────
// The untagged remainder is online ranked play. This repo already carries four
// channels of that; what it is worst at is tournament sets.
const tagged = rightGame.filter((e) => (e.tag ?? '').trim() !== '');
console.log(
  `  ${tagged.length} tagged tournament match(es); ${rightGame.length - tagged.length} untagged (out of scope)`,
);

// ── links ───────────────────────────────────────────────────────────────────
const linked: Array<{ e: TheaterEntry; link: Link }> = [];
const unparseable: Array<{ e: TheaterEntry; why: string }> = [];
for (const e of tagged) {
  const got = parseLink(e.video_link ?? '');
  if ('error' in got) unparseable.push({ e, why: got.error });
  else linked.push({ e, link: got });
}
if (unparseable.length) {
  console.error(`\n✖ ${unparseable.length} tagged entr(ies) have an unusable video link:`);
  for (const u of unparseable.slice(0, 10)) {
    console.error(`    #${u.e.id} ${u.why} — ${JSON.stringify(u.e.video_link)}`);
  }
  console.error('  Refusing rather than guessing — an id and an offset are not approximations.');
  process.exit(1);
}

// ── the same event, submitted twice ─────────────────────────────────────────
//
// A (videoId, startSeconds) pair IS the record id, so two entries sharing one
// would mean two records competing for it and one silently overwriting the
// other. The assert below refuses that outright. But this catalogue has 35 of
// them and they all have ONE cause, which the assert's own error text names as
// the tractable shape: the same event submitted twice under two tag spellings
// ("Team Battle 10vs10 ACS vs TOBLS" and "ACS vs TOBLS 10v10", 35 records each,
// identical players, characters, videoId and offset).
//
// So they are COLLAPSED first, deterministically, and counted — a silent
// collapse is indistinguishable from a parser that lost 35 records. The tie is
// broken on the tag spelling rather than on the catalogue's entry ids, because
// entry ids reflect submission order and would make the surviving copy depend on
// which of two identical rows happened to be typed first.
//
// The assert still runs afterwards on what is left. Anything the collapse cannot
// explain — two genuinely different matches whose links defeat the offset reader
// — still stops the run, which is the case that needs a person.
const byKey = new Map<string, Array<{ e: TheaterEntry; link: Link }>>();
for (const l of linked) {
  const key = `${l.link.videoId}@${l.link.startSeconds}`;
  byKey.set(key, [...(byKey.get(key) ?? []), l]);
}
const deduped: Array<{ e: TheaterEntry; link: Link }> = [];
const collapsedTags = new Map<string, number>();
let collapsed = 0;
const collisions: string[] = [];
for (const [key, group] of byKey) {
  if (group.length === 1) {
    deduped.push(group[0]!);
    continue;
  }
  const sameMatch = group.every(
    (g) =>
      (g.e.p1_name ?? '') === (group[0]!.e.p1_name ?? '') &&
      (g.e.p2_name ?? '') === (group[0]!.e.p2_name ?? '') &&
      (g.e.p1_char ?? '') === (group[0]!.e.p1_char ?? '') &&
      (g.e.p2_char ?? '') === (group[0]!.e.p2_char ?? ''),
  );
  if (sameMatch) {
    const sorted = [...group].sort((a, b) =>
      (a.e.tag ?? '').trim().localeCompare((b.e.tag ?? '').trim()),
    );
    deduped.push(sorted[0]!);
    collapsed += group.length - 1;
    const pair = [...new Set(group.map((g) => (g.e.tag ?? '').trim()))].sort().join('  ||  ');
    collapsedTags.set(pair, (collapsedTags.get(pair) ?? 0) + group.length - 1);
    continue;
  }
  collisions.push(
    [
      `  ${key}`,
      ...group.map(
        (g) => `    #${g.e.id}  ${g.e.p1_name} vs ${g.e.p2_name}  [${(g.e.tag ?? '').trim()}]`,
      ),
    ].join('\n'),
  );
  deduped.push(group[0]!);
}
if (collapsed > 0) {
  console.log(`\n  collapsed ${collapsed} double-submitted entr(ies) — same match, two tags:`);
  for (const [pair, n] of [...collapsedTags].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${n}×  ${pair}`);
  }
}
if (collisions.length) {
  console.error(
    `\n✖ ${collisions.length} (videoId, startSeconds) collision(s) this cannot explain:`,
  );
  console.error(collisions.join('\n'));
  console.error(
    [
      '  That pair IS the record id, so one entry would silently overwrite the other.',
      '  These are not the same match under two tag spellings, which is handled above.',
      '  Two genuinely different matches whose links defeat the offset reader need the',
      '  reader fixed, not the assert loosened.',
    ].join('\n'),
  );
  process.exit(1);
}

// ── join to the VODs ────────────────────────────────────────────────────────
const vodIds = [...new Set(deduped.map((l) => l.link.videoId))];
console.log(`\n▶ Hydrating ${vodIds.length} source VOD(s) from the YouTube API…`);
const vods = await fetchVideoMeta(vodIds);
const missing = vodIds.filter((id) => !vods.has(id));
if (missing.length) {
  console.log(`  ⚠ ${missing.length} VOD(s) did not come back (deleted or private):`);
  for (const id of missing.slice(0, 10)) console.log(`      ${id}`);
}

const chars = (e: TheaterEntry, side: 1 | 2): string[] =>
  ([`p${side}_char`, `p${side}_char2`, `p${side}_char3`, `p${side}_char4`] as const)
    .map((k) => (e as unknown as Record<string, unknown>)[k])
    .filter((c): c is string => typeof c === 'string' && c.trim() !== '')
    .map((c) => c.trim());

const records: TheaterRawRecord[] = [];
for (const { e, link } of deduped) {
  const vod = vods.get(link.videoId);
  if (!vod) continue; // unresolvable VOD, already reported
  const c1 = chars(e, 1);
  const c2 = chars(e, 2);
  records.push({
    id: `${link.videoId}@${link.startSeconds}`,
    channel: 'replayTheater',
    // SYNTHESIZED — the catalogue carries no title. It follows the corpus's
    // dominant ▰ grammar so cards read consistently, and it carries the event
    // tag in the trailing slot because `title` is the engine's search haystack:
    // that placement is what makes "CEOtaku 2024 Pools" and "Bloodsport
    // Tournament #14" findable with no new facet, field or render surface —
    // this repo models no event entity at all. Handles keep their sponsor
    // prefixes; stripping is the parser's job.
    title: `SF6 ▰ ${e.p1_name ?? '?'} (${c1.join('/')}) vs ${e.p2_name ?? '?'} (${c2.join('/')}) ▰ ${(e.tag ?? '').trim()}`,
    description: '',
    // The VOD's real publish time. Deliberately NOT offset by startSeconds: that
    // would shift a record by up to several hours and could cross a day-grained
    // patch boundary, which is the authority season and patch are derived from —
    // and this game's patch table is the platform's densest, 18 windows across
    // four seasons. Sets within one VOD therefore share a timestamp, which is
    // exactly why parse.ts sorts with a tie-break.
    publishedAt: vod.publishedAt,
    // The catalogue publishes no per-match duration and there is nothing honest
    // to derive one from: the gap to the next set includes the downtime between
    // them. 0 means unknown; emit omits the field, and replay-dupes reports these
    // separately because its duration signal is unavailable for them.
    durationSec: 0,
    liveBroadcastContent: 'none',
    theaterId: e.id!,
    videoId: link.videoId,
    startSeconds: link.startSeconds,
    tag: (e.tag ?? '').trim(),
    uploader: vod.uploader,
    players: [(e.p1_name ?? '').trim(), (e.p2_name ?? '').trim()],
    characters: [c1, c2],
  });
}

// Stable, TOTAL order: newest VOD first, then by offset within the VOD, then by
// id. Sets inside one VOD share a publishedAt, so a comparator without the final
// tie-break would be free to return a different permutation per run and a
// re-pull that changed nothing would still produce a diff.
records.sort(
  (a, b) =>
    b.publishedAt.localeCompare(a.publishedAt) ||
    a.startSeconds - b.startSeconds ||
    a.id.localeCompare(b.id),
);

await writeFile(OUT, JSON.stringify(records, null, 1) + '\n', 'utf8');
await writeFile(
  STATS,
  JSON.stringify(
    {
      catalogue: catalogue.length,
      rightGame: rightGame.length,
      tagged: tagged.length,
      collapsed,
      collapsedTags: Object.fromEntries(collapsedTags),
      unresolvableVods: missing.length,
      records: records.length,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
console.log(`\n  → wrote raw/replayTheater.json (${records.length} record(s))`);

// ── reconnaissance ──────────────────────────────────────────────────────────
console.log(`\n${'█'.repeat(72)}`);
console.log('  RECON — nothing below gates anything; it is what the pull learned.');
console.log('█'.repeat(72));

const perVod = new Map<string, number>();
for (const r of records) perVod.set(r.videoId, (perVod.get(r.videoId) ?? 0) + 1);
const shared = records.filter((r) => (perVod.get(r.videoId) ?? 0) > 1).length;
const counts = [...perVod.values()].sort((a, b) => b - a);
console.log(`\n  records / source VODs:                 ${records.length} / ${perVod.size}`);
console.log(
  `  a moment inside a shared VOD:          ${shared} (${pct(shared, records.length)}%), max ${counts[0] ?? 0} per VOD, median ${counts[Math.floor(counts.length / 2)] ?? 0}`,
);
console.log(`  distinct event tags:                   ${new Set(records.map((r) => r.tag)).size}`);

const malformed = deduped.filter((l) => {
  const s = l.e.video_link ?? '';
  if (!s.includes('youtu.be/')) return false;
  const tail = s.split('youtu.be/')[1] ?? '';
  return tail.includes('&t=') && !tail.includes('?');
}).length;
const multiT = deduped.filter((l) => l.link.tCount > 1).length;
console.log(
  `\n  concatenated youtu.be/<id>&t=Ns links: ${malformed} (${pct(malformed, deduped.length)}%)`,
);
console.log(`  links carrying more than one t=:       ${multiT} (last one wins)`);
console.log(
  `  records at offset 0:                   ${records.filter((r) => r.startSeconds === 0).length}`,
);

const dates = records.map((r) => r.publishedAt.slice(0, 10)).sort();
console.log(
  `  VOD publish dates:                     ${dates[0] ?? '—'} → ${dates[dates.length - 1] ?? '—'}`,
);

const occ = new Map<number, number>();
for (const r of records)
  for (const side of r.characters) occ.set(side.length, (occ.get(side.length) ?? 0) + 1);
console.log(
  `  characters per side: ${[...occ.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, n]) => `${k}→${n}`)
    .join(' · ')}`,
);

// ── trust, re-measured every pull ───────────────────────────────────────────
let inChapter = 0;
let exact = 0;
let within30 = 0;
let vsChapters = 0;
let namesAgree = 0;
let chaptered = 0;
for (const [id, meta] of vods) {
  const cs = chaptersOf(meta.description);
  if (cs.length) chaptered++;
  if (!cs.length) continue;
  for (const r of records.filter((x) => x.videoId === id)) {
    let hit: Chapter | undefined;
    for (const c of cs) {
      if (c.start <= r.startSeconds) hit = c;
      else break;
    }
    if (!hit) continue;
    inChapter++;
    const d = r.startSeconds - hit.start;
    if (d === 0) exact++;
    if (Math.abs(d) <= 30) within30++;
    // Condition on the chapter naming a MATCHUP, not on a name having already
    // hit: the looser denominator silently excludes total disagreement, which is
    // the one failure that matters.
    if (/\bvs\.?\b/i.test(hit.title)) {
      vsChapters++;
      const t = norm(hit.title);
      const [p1, p2] = r.players.map(norm);
      if (p1 && p2 && t.includes(p1) && t.includes(p2)) namesAgree++;
    }
  }
}
console.log(`\n  VODs carrying a chapter list: ${chaptered}/${vods.size}`);
console.log(
  `  offsets inside a chapter:     ${inChapter} — ${within30} within 30s (${pct(within30, inChapter)}%), ${exact} exact (${pct(exact, inChapter)}%)`,
);
console.log(
  `  chapters naming a matchup:    ${vsChapters} — both handles agree ${namesAgree} (${pct(namesAgree, vsChapters)}%)`,
);
console.log(`  records with no chapter to check against: ${records.length - inChapter}`);

const uploaders = new Map<string, number>();
for (const r of records) uploaders.set(r.uploader, (uploaders.get(r.uploader) ?? 0) + 1);
console.log(`\n  source VOD uploaders (${uploaders.size}):`);
for (const [u, n] of [...uploaders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`      ${String(n).padStart(4)}  ${u}`);
}

console.log('\n  Next: npm run data:parse');

// Stage 1 for the INDEX intake: pull Replay Theater's tagged Street Fighter 6
// tournament matches, join each to the YouTube metadata of the VOD it points
// into, and dump the result to raw/replayTheater.json.
//
// Run: npm run data:theater   (and now: every morning, from the cron)
//
// THE POSTURE CHANGED ON 2026-08-31, and the old one is worth stating because
// this comment used to argue the opposite. It said: "a third party's uptime and
// goodwill should not become a cron dependency on day one of an integration",
// and it was right — on day one. Four games have since been ingested, the trust
// re-measured on every pull (99.7% handle agreement against the uploaders' own
// chapter markers here, 925 of 928), and the catalogue's operator is a
// collaborator rather than a stranger. replaytheater.app/robots.txt read
// 2026-08-31 is `User-agent: * / Disallow:`; requests carry a contactable
// user-agent and the catalogue's own pacing.
//
// WHAT MAKES IT SAFE IS NOT THE RELATIONSHIP, THOUGH — it is two rules that hold
// even when the goodwill does not:
//
//   1. ADD-ONLY. This intake can only ADD records. A committed record is carried
//      regardless of what the catalogue says today; entries that vanish are
//      COUNTED in report.md, never removed, and the pin only grows.
//   2. THE CRON NEVER DEPENDS ON THIS SUCCEEDING. The step runs LAST and is
//      allowed to fail. On any failure — network, non-200, malformed page, a
//      uniqueness assert — there is simply no dump, parse.ts carries exactly as
//      it does today, and the cron stays green. A bad day upstream costs that
//      day's new entries and nothing else.
//
// AND WHAT MAKES IT AFFORDABLE is the cursor below. A full pull is 311 pages for
// this game alone and 619 across the four; sending that every morning to a
// fellow fan project is not a design. The catalogue orders newest-first, so the
// cursor reads ~3 pages a day instead — 12 requests across the platform.
//
// WHAT IT IS NOT. Replay Theater hosts no video. It is an index: a match is a
// (videoId, startSeconds) pair plus players, characters and an event tag. So a
// record here is a SEGMENT — 1,044 of the 1,065 share a VOD with another — and
// its id is `${videoId}@${startSeconds}`, never a YouTube id.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
/** EVERY entry the cursor saw this run, tagged and untagged, in the catalogue's
 *  own shape. Kept OUT of raw/replayTheater.json on purpose: that file is the
 *  INTAKE and parse.ts builds a record from every row in it, so an untagged row
 *  landing there would publish online ranked play as a tournament match. This
 *  file is the WITNESS — the cross-check reads it and builds nothing. */
const WITNESS = join(RAW_DIR, 'replayTheater.witness.json');
/** The cursor's committed state: the highest catalogue entry id ever seen, so a
 *  run knows where "already seen" starts without re-reading 311 pages. Written
 *  by parse.ts (every data/ write is parse's), read here. */
const CURSOR = join(ROOT, 'data', 'theater-cursor.json');
/** Resume cache for a --fresh full sweep only. The cursor replaced it for the
 *  daily path: two resume mechanisms disagreeing is worse than one, and this one
 *  skipped pages 2..N on any re-pull because it recorded page NUMBERS against a
 *  catalogue that grows at the front. Deleted on every successful run. */
const PARTIAL = join(RAW_DIR, '.replayTheater.partial.json');

const CH = CHANNELS.find((c) => c.id === 'replayTheater');
if (!CH?.index) throw new Error('replayTheater is not registered as an index channel');
const INDEX = CH.index;

// ── flags ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const FRESH = argv.includes('--fresh');
/** THE DAILY PATH. Page from the front and stop once the catalogue stops
 *  offering anything newer than the cursor. `--full` forces the old whole-
 *  catalogue sweep, which is what --fresh has always meant and what a periodic
 *  reconciliation still wants. */
const FULL = argv.includes('--full') || FRESH;
const CURSOR_MODE = !FULL;
/** Two clean pages, not one. The catalogue orders `upload_date DESC, id ASC`, so
 *  a day's submissions can straddle a page boundary and a single clean page is
 *  not proof there is nothing behind it. */
const CLEAN_PAGES_TO_STOP = 2;
/** A hard ceiling on the daily path, so a catalogue-side reordering can never
 *  turn the cron into a 311-page sweep. Measured 2026-08-31: the newest 200
 *  submissions sit within page 5 here (page 10 for 2XKO, the worst of the four),
 *  and a mean day is 10.7 entries — a fifth of ONE page. Ten is ~25x headroom.
 *  Hitting it is reported, not silent: under add-only nothing is lost, only
 *  late, and `npm run data:theater -- --full` reconciles. */
const CURSOR_MAX_PAGES = 10;
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

// CLEAR THE PREVIOUS RUN'S SELF-REPORT BEFORE FETCHING ANYTHING. parse.ts reads
// .replayTheater.stats.json to learn what this pull did — its mode, its page
// count, and the cursor it reached — and a file left over from yesterday would
// answer those questions about the wrong run. Specifically: a pull that dies on
// the first request writes nothing, so parse would find yesterday's stats,
// report "the pull found no new entries" instead of "no pull this run", and
// re-advance the cursor off a number this run never observed.
//
// Invisible in CI, where a fresh checkout has no raw/ at all — which is exactly
// why it has to be done here rather than trusted to the environment. Found by
// running the dead-host control locally on 2026-08-31.
await rm(STATS, { force: true });
await rm(WITNESS, { force: true });

interface PartialCache {
  pages: number[];
  entries: TheaterEntry[];
}

const byTheaterId = new Map<number, TheaterEntry>();
const seenPages = new Set<number>();
if (FULL && !FRESH && existsSync(PARTIAL)) {
  const cache = JSON.parse(await readFile(PARTIAL, 'utf8')) as PartialCache;
  for (const p of cache.pages ?? []) seenPages.add(p);
  for (const e of cache.entries ?? []) if (e.id !== undefined) byTheaterId.set(e.id, e);
  console.log(`  resuming: ${seenPages.size} page(s), ${byTheaterId.size} entr(ies) cached`);
}

// THE CURSOR. The catalogue orders `upload_date DESC, id ASC` — verified across
// page boundaries on 2026-08-31 (page 1 ends 2026-08-25/487156, page 2 begins
// 2026-08-25/487157) — and entry ids increase with submission. So "have I seen
// everything new?" is answerable from the front of the feed alone, and the
// answer is: keep paging until CLEAN_PAGES_TO_STOP consecutive pages offer no
// id above the cursor.
//
// WHY NOT `?since=` OR A REAL CURSOR: there isn't one. Probed 2026-08-31 —
// `since`, `limit`, `per_page`, `sort`, `order` and `after_id` are all accepted
// and silently IGNORED (byte-identical responses). Only `game` and `page` are
// honoured, and `game` is validated (any unrecognised slug returns "Invalid
// game" rather than falling through to the unfiltered catalogue, which is worth
// knowing: the per-entry game gate below is a second line, not the only one).
//
// WHAT THE CURSOR CANNOT SEE, stated rather than hidden: the ordering key is the
// VIDEO's upload date, not the submission's. Someone submitting a 2024 VOD today
// lands deep in the feed, behind the bound, and this run will not reach it.
// Under add-only that is late, never lost — the entry keeps its id, a --full
// sweep collects it, and nothing that is already committed is affected.
const cursorFile = await readFile(CURSOR, 'utf8')
  .then((t) => JSON.parse(t) as Record<string, number>)
  .catch(() => ({}) as Record<string, number>);
const cursorAt = cursorFile[CH.id] ?? 0;

console.log(`\n▶ Pulling the Replay Theater index (${INDEX.endpoint}, game=${INDEX.slug})…`);
const first = await getPage(1);
const total = Number(first.total_count ?? 0);
const fullPages = Math.ceil(total / INDEX.pageSize);
const pages = Math.min(CURSOR_MODE ? CURSOR_MAX_PAGES : fullPages, MAX_PAGES);
console.log(
  CURSOR_MODE
    ? `  catalogue reports ${total} match(es) (${fullPages} page(s) of ${INDEX.pageSize}); cursor at entry id ${cursorAt || '—'}, reading at most ${pages}`
    : `  catalogue reports ${total} match(es) → ${pages} page(s) of ${INDEX.pageSize}`,
);
for (const e of first.matches ?? []) if (e.id !== undefined) byTheaterId.set(e.id, e);
seenPages.add(1);

let cleanRun = (first.matches ?? []).some((e) => (e.id ?? 0) > cursorAt) ? 0 : 1;
let pagesRead = 1;
let stoppedEarly = false;
for (let page = 2; page <= pages; page++) {
  if (CURSOR_MODE && cleanRun >= CLEAN_PAGES_TO_STOP) {
    stoppedEarly = true;
    break;
  }
  if (seenPages.has(page)) continue;
  await sleep(INDEX.pacingMs);
  const body = await getPage(page);
  const rows = body.matches ?? [];
  for (const e of rows) if (e.id !== undefined) byTheaterId.set(e.id, e);
  seenPages.add(page);
  pagesRead++;
  cleanRun = rows.some((e) => (e.id ?? 0) > cursorAt) ? 0 : cleanRun + 1;
  // An empty page is the end of the catalogue, not a clean page to count.
  if (rows.length === 0) {
    stoppedEarly = true;
    break;
  }
  if (!CURSOR_MODE && page % 10 === 0) {
    console.log(`  page ${page}/${pages} — ${byTheaterId.size} entr(ies)`);
    await writeFile(
      PARTIAL,
      JSON.stringify({ pages: [...seenPages], entries: [...byTheaterId.values()] }),
      'utf8',
    );
  }
}
if (CURSOR_MODE && cleanRun >= CLEAN_PAGES_TO_STOP) stoppedEarly = true;
const hitBound = CURSOR_MODE && !stoppedEarly && pagesRead >= pages;
const catalogue = [...byTheaterId.values()];
const maxEntryId = catalogue.reduce((m, e) => Math.max(m, e.id ?? 0), cursorAt);
console.log(
  CURSOR_MODE
    ? `  read ${pagesRead} page(s), ${catalogue.length} entr(ies); ${catalogue.filter((e) => (e.id ?? 0) > cursorAt).length} newer than the cursor → new cursor ${maxEntryId}`
    : `  pulled ${catalogue.length} unique entr(ies)`,
);
if (hitBound) {
  console.log(
    `  ⚠ the cursor hit its ${CURSOR_MAX_PAGES}-page bound without going quiet — entries may be\n` +
      `    unreached this run. Nothing is lost (add-only); run \`npm run data:theater -- --full\`\n` +
      `    to reconcile.`,
  );
}

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

// ── the floor, on a FULL sweep only ─────────────────────────────────────────
// A cursor run's dump is a DELTA and is legitimately tiny, so "materially
// smaller than the pin" means nothing there — parse.ts merges it, and add-only
// does the protecting. A FULL sweep is different: it claims to be the whole
// catalogue, so a collapse in it is a claim that most of the catalogue is gone.
//
// The shape this guards against is not hypothetical. `records` is filtered by
// the per-entry game gate, and the gate compares against a string the catalogue
// controls: the day "Street Fighter 6" is renamed upstream, `rightGame` is 0,
// `records` is 0, and the old code wrote `[]` over a good dump without comment.
// Downstream that reads as n → 0 and trips the collapse guard, so the cron goes
// red for a reason nothing names. Refuse here, where the cause is visible.
if (FULL) {
  const pins = await readFile(join(ROOT, 'data', 'source-pins.json'), 'utf8')
    .then((t) => JSON.parse(t) as Record<string, number>)
    .catch(() => ({}) as Record<string, number>);
  const pinned = pins[CH.id] ?? 0;
  if (pinned > 0 && records.length < pinned * 0.9) {
    console.error(
      [
        `\n✖ A full sweep produced ${records.length} record(s) against a committed pin of ${pinned}.`,
        `  That is a claim that ${pinned - records.length} tournament matches left the catalogue at once.`,
        ``,
        `  The likeliest cause is not deletion. Every entry is checked against`,
        `  gameLabel ${JSON.stringify(INDEX.gameLabel)}, and ${wrongGame.length} of ${catalogue.length} entr(ies) failed that check`,
        `  this run — if the catalogue renamed the game, every row fails and this`,
        `  file would be overwritten with almost nothing.`,
        ``,
        `  Refusing to write. The committed records are untouched and the cron`,
        `  carries them exactly as it does on a day this never ran.`,
        `  If the drop is real: npm run data:theater -- --full --allow-shrink`,
      ].join('\n'),
    );
    if (!argv.includes('--allow-shrink')) process.exit(1);
  }
}

await writeFile(OUT, JSON.stringify(records, null, 1) + '\n', 'utf8');

// ── the witness ─────────────────────────────────────────────────────────────
// EVERY entry the run saw, tagged and untagged, in the catalogue's own shape.
// The untagged remainder is online ranked play and is out of INGESTION scope by
// design — but it is not out of scope as EVIDENCE: measured 2026-08-31, 10,231
// of those rows point at a video this repo has already published from a tracked
// channel, which makes them an independent second reading of our own title
// parser on 44% of the corpus. Written separately from the intake dump so an
// untagged row can never be built into a record: parse.ts builds one record per
// row of raw/replayTheater.json, and nothing but tagged rows goes in there.
await writeFile(
  WITNESS,
  JSON.stringify(
    {
      mode: CURSOR_MODE ? 'cursor' : 'full',
      maxEntryId,
      pagesRead,
      hitBound,
      // BEHIND THE PER-ENTRY GAME GATE, not the raw catalogue. The gate is this
      // intake's only real defence against a response that is not what was asked
      // for, and the witness has to sit behind it too — it feeds a comparison
      // whose whole claim is that it is reading THIS game.
      //
      // Not hypothetical. On 2026-08-31 a `--full` sweep in tokon-replay-database
      // resumed from a partial cache left over from an era when this endpoint
      // returned everything, and wrote 15,286 Street Fighter 6 rows into a
      // 266-entry Tokon witness. The intake was untouched — the gate did its job
      // there — but the witness was 98% another game, and nothing downstream
      // would have said so.
      entries: rightGame,
    },
    null,
    1,
  ) + '\n',
  'utf8',
);

await writeFile(
  STATS,
  JSON.stringify(
    {
      // THE MODE IS LOAD-BEARING, not a diagnostic. parse.ts reads it to decide
      // whether this dump is the whole catalogue or a delta, which decides
      // whether "committed but absent from the dump" means "vanished upstream"
      // or "simply not in the pages we read".
      mode: CURSOR_MODE ? 'cursor' : 'full',
      maxEntryId,
      pagesRead,
      hitBound,
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

// The resume cache existed to make a 311-page sweep restartable, and it recorded
// page NUMBERS against a catalogue that grows at the FRONT — so a second local
// run refetched page 1 and skipped 2..N as "seen", making anything past the
// first 50 new entries permanently invisible until someone remembered --fresh.
// The cursor is the resume mechanism now. Leaving both would be two that
// disagree, so a successful run clears it.
if (existsSync(PARTIAL)) await rm(PARTIAL, { force: true });

console.log(
  `\n  → wrote raw/replayTheater.json (${records.length} record(s)${CURSOR_MODE ? ', a delta' : ''})`,
);
console.log(
  `  → wrote raw/replayTheater.witness.json (${rightGame.length} of ${catalogue.length} catalogue entr(ies), this game)`,
);

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

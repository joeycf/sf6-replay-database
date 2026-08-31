// E2E suite — Playwright-core (same launch mechanics as og.ts) against the
// generated static output. THE GENERICITY AUDIT in executable form: SF6
// exercises charactersPerSide 1, the rank filter ON, co-occurrence OFF, and
// the default terms + /characters/* routes, so every check here is either
// "the gated surface is present with SF6's data" or "the tag-fighter surface
// is ABSENT". Numeric expectations are computed Node-side from the committed
// data files, never hardcoded.
//
// Prereq: npm run generate       Run: npm run test:e2e

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import RANKS from '../data/ranks.json';
import { CHANNELS } from './channels';
import { staleEvidence, tokensOf } from './freshness';
import type {
  CharacterRecord,
  MatchVideo,
  PlayerRecord,
  RawVideoRecord,
  VideoOverride,
} from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.vercel/output/static');

// The base the build was generated under. DETECTED, not assumed: the committed
// default is '/sf6/', but a root-based build (NUXT_APP_BASE_URL=/) is a
// legitimate local preview and the suite must pass against either. nitro's
// static presets nest the whole site under the base inside publicDir, so the
// prerendered index.html marks the base directory.
function detectBase(): string {
  if (existsSync(join(OUT, 'index.html'))) return '';
  for (const name of readdirSync(OUT)) {
    if (existsSync(join(OUT, name, 'index.html'))) return `/${name}`;
  }
  throw new Error(
    `no prerendered index.html under ${OUT} — run \`npm run generate\` before \`npm run test:e2e\``,
  );
}
const BASE = detectBase();

// ── Node-side expectations: the SAME record set the site carries ─────────────
const allVideos = JSON.parse(readFileSync(join(ROOT, 'data/videos.json'), 'utf8')) as MatchVideo[];
const overrides = JSON.parse(readFileSync(join(ROOT, 'data/overrides.json'), 'utf8')) as Record<
  string,
  VideoOverride
>;
const excluded = new Set(
  Object.entries(overrides)
    .filter(([, ov]) => ov.exclude === true)
    .map(([id]) => id),
);
const videos = allVideos.filter((v) => !excluded.has(v.id));
const characters = JSON.parse(
  readFileSync(join(ROOT, 'data/characters.json'), 'utf8'),
) as CharacterRecord[];
const players = JSON.parse(readFileSync(join(ROOT, 'data/players.json'), 'utf8')) as PlayerRecord[];
const stats = JSON.parse(readFileSync(join(ROOT, 'data/stats.json'), 'utf8')) as {
  totals: { replays: number; byPatch: Record<string, number> };
  characterUsage: Record<string, number>;
};
const patchGroups = JSON.parse(readFileSync(join(ROOT, 'data/patchGroups.json'), 'utf8')) as {
  id: string;
  label?: string;
  children?: { id: string; note?: string }[];
}[];
// The patch table as committed. Read as DATA and re-walked below rather than
// imported from scripts/seasons.ts, so the expectations are derived
// independently of the module that produced the artifact under test.
const patchBoundaries = JSON.parse(
  readFileSync(join(ROOT, 'data/patchBoundaries.json'), 'utf8'),
) as { version: string; start: string }[];

const fmt = (n: number) => n.toLocaleString('en-US');
const count = (pred: (v: MatchVideo) => boolean) => videos.filter(pred).length;

// ── source groups (engine v0.5.5), restated from app/app.config.ts ───────────
// The browser renders chips from the config while these lists drive the
// Node-derived expectations — if either side drifts (a token un-grouped, a
// channel added without a group), the chip-click and count assertions below
// disagree and fail. The tournament-era tokens (2026-07-31 intake) are the
// NEW_SOURCES set the dupe gate is scoped to.
const ONLINE_SOURCES = ['highLevel', 'fgcPlace', 'sfReplays', 'kingArenaOnline'];
const TOURNAMENT_SOURCES = [
  'capcomFighters',
  'kingArenaTournament',
  'superFighters',
  'evoEvents',
  'replayTheater',
];
const NEW_SOURCES = new Set(['kingArenaOnline', ...TOURNAMENT_SOURCES]);

// The rank chips the facet actually renders (engine v0.5.0): the canonical
// ascending ladder intersected with the ranks PRESENT in the data, displayed
// highest-first. The engine deliberately stopped rendering the whole ladder —
// a chip that would filter to zero replays is never shown — so asserting
// RANKS.length here would re-assert the pre-v0.5.0 behavior. For SF6 that
// means Legend/Master/Diamond out of a 9-rung ladder: these are top-level
// replay channels and nobody below Diamond appears in them.
const ranksPresent = new Set<string>();
for (const v of videos) for (const s of v.sides) if (s.rank) ranksPresent.add(s.rank);
const rankChipsAsc = RANKS.filter((r) => ranksPresent.has(r));
const rankChipsExpected = [...rankChipsAsc].reverse();

// Season chips: declared groups intersected with seasons that have data. S4 is
// pre-declared (2026-08-03) and must NOT render until replays exist for it.
// Still derived from the SEASON number, which stays correct once patches are
// children: every record of season N carries either `SN` or a child of `SN`,
// so the season-derived present-set equals the engine's visible-parent set.
const seasonsPresent = new Set(videos.map((v) => `S${v.season}`));
const seasonChipsExpected = patchGroups.filter((g) => seasonsPresent.has(g.id));

// ── per-patch expectations, re-derived from the committed boundary table ─────
// The windows are walked here rather than read from an emitted artifact: each
// patch runs until the next one starts, so a video's patch is the last row
// whose start it is on or after. That is the whole derivation, independently
// restated — if scripts/seasons.ts and this disagree, one of them is wrong.
const patchStarts = [...patchBoundaries].sort((a, b) => a.start.localeCompare(b.start));
function patchOf(v: MatchVideo): string {
  let token = `S${v.season}`;
  for (const p of patchStarts) {
    if (v.publishedAt.slice(0, 10) >= p.start) token = p.version;
    else break;
  }
  // an era whose window has closed on a video that a later era owns (or a
  // season override) falls back to the era token, exactly as emit does
  const parent = patchGroups.find((g) => g.children?.some((c) => c.id === token));
  return parent && parent.id === `S${v.season}` ? token : `S${v.season}`;
}
const patchCounts = new Map<string, number>();
for (const v of videos) patchCounts.set(patchOf(v), (patchCounts.get(patchOf(v)) ?? 0) + 1);
/** child tokens that actually have replays, in declared order */
const childChipsExpected = patchGroups
  .flatMap((g) => g.children ?? [])
  .filter((c) => (patchCounts.get(c.id) ?? 0) > 0);

// ── tiny static server over the generated output ─────────────────────────────
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
function serve(): Promise<{ at: (path: string) => string; close: () => void }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    const candidates = [join(OUT, path), join(OUT, path, 'index.html'), join(OUT, '404.html')];
    for (const file of candidates) {
      try {
        const body = readFileSync(file);
        res.writeHead(file.endsWith('404.html') && !path.endsWith('404.html') ? 404 : 200, {
          'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        });
        res.end(body);
        return;
      } catch {
        /* try next */
      }
    }
    res.writeHead(404).end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const origin = `http://127.0.0.1:${addr.port}`;
      // Serve the static ROOT (as Vercel does) and address pages under the
      // base — never re-root the server at the base dir, which would resolve
      // the site's own absolute /<base>/_nuxt/… asset URLs to 404s.
      resolve({ at: (path: string) => `${origin}${BASE}${path}`, close: () => server.close() });
    });
  });
}

// ── minimal expect harness ───────────────────────────────────────────────────
let passed = 0;
const failures: string[] = [];
function expect(cond: boolean, label: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.error(`  ✖ ${label}`);
  }
}

async function resultCount(page: Page): Promise<number> {
  const txt = (await page.locator('[data-testid="result-count"]').first().textContent()) ?? '';
  const m = /([\d,]+)/.exec(txt);
  return m ? Number(m[1]!.replaceAll(',', '')) : -1;
}
const gotoIdle = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: 'networkidle' });
};

/** The commit-guard block lifted out of the real workflow YAML and proven in a
 *  scratch git repo — the guard is shell, so only shell can test it. */
function testCronGuard(): void {
  console.log('\n— cron commit guard (extracted from the real workflow)');
  const wf = readFileSync(join(ROOT, '.github/workflows/data-refresh.yml'), 'utf8').split('\n');
  const start = wf.findIndex((l) => l.includes('git config user.name'));
  expect(start > 0, 'workflow contains the commit guard block');
  const guard = wf
    .slice(start)
    .filter((l) => l.startsWith('          '))
    .map((l) => l.slice(10))
    .filter((l) => l.trim() !== 'git push')
    .join('\n');
  expect(
    guard.includes('git restore --staged --worktree data/report.md'),
    'guard drops a timestamp-only report.md',
  );

  const dir = mkdtempSync(join(tmpdir(), 'sf6-cron-'));
  const sh = (cmd: string) =>
    execSync(cmd, { cwd: dir, encoding: 'utf8', stdio: 'pipe', shell: '/bin/bash' });
  // The guard goes to a FILE and is run as `bash guard.sh`. Passing it via
  // `bash -c "<json-escaped>"` puts it through /bin/sh first, which mangles the
  // embedded newlines and $(…) substitutions.
  const guardPath = join(dir, 'guard.sh');
  const runGuard = () => sh(`bash ${guardPath}`);
  sh('git init -q .');
  sh('git config user.email t@t && git config user.name t');
  const mkdirp = join(dir, 'data');
  execSync(`mkdir -p ${mkdirp}`);
  const write = (p: string, s: string) => writeFileSync(join(dir, p), s);
  for (const f of [
    'videos.json',
    'replays.json',
    'stats.json',
    'players.json',
    'patchGroups.json',
    'patchBoundaries.json',
    'seasonBoundaries.json',
    // in the guard's git add since the tournament intake (parse-regenerated)
    'review-queue.json',
    // the guard's `git add` names it, so the fixture must carry it too
    'summary.json',
    // the carry pin. Rewritten by every rebuilding run — which is now most of
    // them — and absent from
    // the `git add` list a run that DID rewrite it would throw the change away
    // silently — so the workflow names it and this fixture proves it does.
    'source-pins.json',
    // the index cursor. raw/ is gitignored and CI starts from a fresh checkout,
    // so an unstaged cursor resets to 0 every morning and turns every cron run
    // into a bounded sweep that never goes quiet.
    'theater-cursor.json',
  ]) {
    write(`data/${f}`, '[]\n');
  }
  write('data/report.md', '# r\n\n_Generated 2026-01-01T00:00:00.000Z_\n');
  writeFileSync(guardPath, guard);
  sh('git add -A && git commit -q -m base');

  // case A: only the generated timestamp moved → must NOT commit
  write('data/report.md', '# r\n\n_Generated 2026-01-02T00:00:00.000Z_\n');
  const a = runGuard();
  expect(a.includes('No data changes'), 'case A: timestamp-only diff does not commit');
  expect(sh('git rev-list --count HEAD').trim() === '1', 'case A: still one commit');

  // case B: a real data change → must commit, and report.md rides along
  write('data/replays.json', '[{"id":"x"}]\n');
  write('data/report.md', '# r\n\n19495 matches\n\n_Generated 2026-01-03T00:00:00.000Z_\n');
  runGuard();
  expect(sh('git rev-list --count HEAD').trim() === '2', 'case B: real change commits');
  expect(
    sh('git show --stat --name-only HEAD').includes('data/report.md'),
    'case B: report.md ships with the real change',
  );
}

/** Node-side substrate gates: the review queue and the dupe audit, checked
 *  against the committed artifacts before a browser ever launches — a positive
 *  control (un-excluded duplicate, desynced queue) fails within seconds. */
function testSubstrateGates(): void {
  console.log('\n— review queue + dupe audit (substrate)');

  // app.config must declare every token the pipeline can emit — the operative
  // membership check is the group-chip click above; this catches a token
  // dropped from sourceChannels (badge would fall back to the raw id)
  const appConfig = readFileSync(join(ROOT, 'app/app.config.ts'), 'utf8');
  for (const token of [...ONLINE_SOURCES, ...TOURNAMENT_SOURCES]) {
    expect(appConfig.includes(`'${token}'`), `app.config declares source '${token}'`);
  }

  // review queue: schema, exclusion from both artifacts, report sync
  const queue = JSON.parse(readFileSync(join(ROOT, 'data/review-queue.json'), 'utf8')) as {
    id: string;
    kind: string;
    channel: string;
    title: string;
    publishedAt: string;
    durationSec: number;
  }[];
  const KINDS = new Set(['source-classification', 'character-completion']);
  expect(
    queue.every(
      (q) =>
        typeof q.id === 'string' &&
        q.id.length > 0 &&
        KINDS.has(q.kind) &&
        typeof q.title === 'string' &&
        /^\d{4}-\d{2}-\d{2}T/.test(q.publishedAt) &&
        q.durationSec > 0,
    ),
    `review-queue.json schema validates (${queue.length} pending)`,
  );
  const videoIds = new Set(allVideos.map((v) => v.id));
  expect(
    queue.every((q) => !videoIds.has(q.id)),
    'pending review items never reach videos.json',
  );
  const emitted = JSON.parse(readFileSync(join(ROOT, 'data/replays.json'), 'utf8')) as {
    id: string;
  }[];
  const emittedIds = new Set(emitted.map((r) => r.id));
  expect(
    queue.every((q) => !emittedIds.has(q.id)),
    'pending review items never reach replays.json',
  );
  const reportMd = readFileSync(join(ROOT, 'data/report.md'), 'utf8');
  const pending = /Pending review: (\d+)/.exec(reportMd);
  expect(
    pending !== null && Number(pending[1]) === queue.length,
    `report.md pending count matches the queue (${queue.length})`,
  );

  // dupe gate: no unresolved tier-A pair (same players+characters signature,
  // Δduration ≤ 1s) involving a tournament-era record. Scoped deliberately:
  // the pre-existing Online corpus carries known legacy tier-A clusters,
  // report-only by decision (npm run data:replay-dupes lists them) — resolving
  // shipped-vs-shipped data is its own session. A pair with a NEW-source side
  // shipping here means the dedupe pass missed it.
  // MUST stay identical in semantics to scripts/replay-dupes.ts `signature()` —
  // if the two drift, this gate stops checking what the dupe scanner finds.
  const sig = (v: MatchVideo) =>
    v.sides
      .map((s) => `${s.player}|${[...s.characters].sort().join(',')}`)
      .sort()
      .join('~');
  const bySig = new Map<string, MatchVideo[]>();
  for (const v of videos) {
    if (v.durationSec <= 0) continue;
    const k = sig(v);
    (bySig.get(k) ?? bySig.set(k, []).get(k)!).push(v);
  }
  const offenders: string[] = [];
  for (const list of bySig.values()) {
    if (list.length < 2) continue;
    const s = [...list].sort((a, b) => a.durationSec - b.durationSec);
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1]!;
      const b = s[i]!;
      if (
        b.durationSec - a.durationSec <= 1 &&
        (NEW_SOURCES.has(a.channel) || NEW_SOURCES.has(b.channel))
      ) {
        offenders.push(`${a.id}(${a.channel}) ~ ${b.id}(${b.channel})`);
      }
    }
  }
  expect(
    offenders.length === 0,
    `no unresolved tier-A duplicate involves a tournament-era record` +
      (offenders.length
        ? ` — ${offenders.slice(0, 3).join(', ')}${offenders.length > 3 ? ' …' : ''}`
        : ''),
  );
}

/** Node-side gates for SEGMENT records — the ones whose `id` is not a YouTube
 *  id. Every number is COMPUTED from the committed data, never hardcoded, so
 *  these keep meaning the same thing as the catalogue grows and self-skip
 *  entirely if the intake is ever removed. */
function testSegmentGates(): void {
  const segments = videos.filter((v) => v.videoId !== undefined);
  if (segments.length === 0) return;
  console.log(`\n— segment records (${segments.length})`);

  const COMPOSITE = /^([A-Za-z0-9_-]{11})@(\d+)$/;
  const malformed = segments.filter((v) => {
    const m = COMPOSITE.exec(v.id);
    return !m || m[1] !== v.videoId || Number(m[2]) !== (v.startSeconds ?? 0);
  });
  expect(
    malformed.length === 0,
    `every segment id is videoId@startSeconds and agrees with its own fields (${malformed.length} bad)`,
  );

  // A composite id can never equal an 11-character YouTube id — the property the
  // ignore-if-known rule's videoId keying rests on. Assert it rather than
  // trusting the reasoning.
  const wholeIds = new Set(videos.filter((v) => v.videoId === undefined).map((v) => v.id));
  expect(
    segments.filter((v) => wholeIds.has(v.id)).length === 0,
    'no segment id collides with a whole-video record id',
  );

  const perVod = new Map<string, number>();
  for (const v of segments) perVod.set(v.videoId!, (perVod.get(v.videoId!) ?? 0) + 1);
  expect(
    [...perVod.values()].some((n) => n > 1),
    `at least one VOD is shared by several records (max ${Math.max(...perVod.values())})`,
  );
  // The whole point of the intake: these VODs are not in the corpus in their own
  // right. If one ever is, ignore-if-known should have dropped its segments
  // before they got here.
  const alsoARecord = [...perVod.keys()].filter((id) => wholeIds.has(id));
  expect(
    alsoARecord.length === 0,
    `no source VOD is also a record in its own right (${alsoARecord.join(', ') || 'clean'})`,
  );

  // ROUND-TRIP INTO THE EMITTED CONTRACT. videoId must survive INDEPENDENTLY of
  // startSeconds: 0 is falsy, so a combined guard would strip videoId from every
  // offset-zero record — and the engine resolves `videoId ?? id`, which would
  // then be the composite string.
  const emittedById = new Map(
    (
      JSON.parse(readFileSync(join(ROOT, 'data/replays.json'), 'utf8')) as {
        id: string;
        videoId?: string;
        startSeconds?: number;
      }[]
    ).map((r) => [r.id, r]),
  );
  expect(
    segments.every((v) => emittedById.get(v.id)?.videoId === v.videoId),
    'every segment carries videoId into replays.json',
  );
  const atZero = segments.filter((v) => (v.startSeconds ?? 0) === 0).length;
  expect(
    segments.every((v) => {
      const r = emittedById.get(v.id);
      return (v.startSeconds ?? 0) > 0
        ? r?.startSeconds === v.startSeconds
        : r?.startSeconds === undefined;
    }),
    `startSeconds is emitted when non-zero and omitted when zero (the falsy-0 contract, ${atZero} at zero)`,
  );

  // Duration-less records are exactly the index intakes, and the dupe audit
  // knows it — its third pass exists for them. If a fetched channel ever starts
  // emitting 0s durations, that pass silently becomes the wrong tool for them.
  const indexSources = new Set(CHANNELS.filter((c) => c.index).map((c) => c.source));
  const zeroDurOutside = videos.filter(
    (v) => (v.durationSec ?? 0) <= 0 && !indexSources.has(v.channel),
  );
  expect(
    zeroDurOutside.length === 0,
    `only an index intake publishes records with no duration (${zeroDurOutside.length} outside)`,
  );

  // The pin is the carry's ONLY check on a cron run, so a pin that has drifted
  // from the committed corpus is the failure the carry cannot see.
  const pins = JSON.parse(readFileSync(join(ROOT, 'data/source-pins.json'), 'utf8')) as Record<
    string,
    number
  >;
  for (const ch of CHANNELS.filter((c) => c.cronFetchedWithCarry)) {
    const n = videos.filter((v) => v.channel === ch.source).length;
    expect(
      pins[ch.id] === n,
      `source-pins pins ${ch.id} at its committed count (${pins[ch.id]} vs ${n})`,
    );
  }
  // And the cron has to STAGE it, or a run that rewrote it would throw the
  // change away silently. Checked by name, not by count.
  const wf = readFileSync(join(ROOT, '.github/workflows/data-refresh.yml'), 'utf8');
  expect(wf.includes('data/source-pins.json'), 'the refresh workflow stages data/source-pins.json');
}

/** POSITIVE CONTROLS for the stale-raw guard.
 *
 *  A gate that cannot fail is indistinguishable from a gate that passes, and
 *  this one guards against silence: its failure mode is a parse that succeeds
 *  while dropping records. Two earlier versions of it next door were silent on
 *  exactly the failure they were built for, so the predicate is driven here
 *  DIRECTLY, with hand-built arrays, rather than inferred from a pipeline run.
 *
 *  The negatives matter as much as the positive. A guard that fires on a
 *  legitimate prune, or on age alone, is one people learn to pass. */
function testStaleGuard(): void {
  console.log('\n— stale-raw guard (positive controls)');

  const at = (iso: string) => `2026-08-${iso}T00:00:00Z`;
  const upload = (id: string, day: string): RawVideoRecord =>
    ({
      id,
      channel: 'highLevel',
      title: id,
      description: '',
      publishedAt: at(day),
      durationSec: 300,
      liveBroadcastContent: 'none',
    }) as RawVideoRecord;
  const record = (id: string, day: string): MatchVideo =>
    ({
      id,
      channel: 'highLevel',
      title: id,
      publishedAt: at(day),
      durationSec: 300,
      season: 4,
      sides: [
        { player: 'a', handle: 'A', characters: ['ryu'] },
        { player: 'b', handle: 'B', characters: ['ken'] },
      ],
    }) as MatchVideo;

  const dump = [upload('v1', '10'), upload('v2', '11')];
  const committedFresh = [record('v1', '10'), record('v2', '11')];

  // 1. STALE — the corpus holds an upload published after the dump was taken.
  //    This is the 325-record shape this repo shipped without a guard until now.
  expect(
    staleEvidence('highLevel', dump, [...committedFresh, record('v3', '30')]) !== null,
    'refuses a dump the committed corpus proves it predates',
  );

  // 2. FRESH — equal newest. A re-parse after an overrides change must pass.
  expect(
    staleEvidence('highLevel', dump, committedFresh) === null,
    'passes when the dump reaches the newest committed record',
  );

  // 3. AGE ALONE MUST NOT FIRE. Nothing here reads a clock or a filesystem, so a
  //    dump from years ago is fresh if its contents are. This is the property
  //    mtime could not hold: cp, git checkout and a fresh clone all forge mtime.
  expect(
    staleEvidence('highLevel', [upload('v1', '10')], [record('v1', '10')]) === null,
    'stays quiet on an old dump whose channel has published nothing since',
  );

  // 4. A DELETION MUST STAY LEGAL. Committed holds a record the dump no longer
  //    does, but the dump's newest is unchanged — that is the prune this
  //    pipeline exists to publish, not staleness.
  expect(
    staleEvidence('highLevel', dump, [...committedFresh, record('gone', '10')]) === null,
    'stays quiet when an upload was deleted rather than never fetched',
  );

  // 5. SCOPED PER INTAKE. A stale kingArena dump says nothing about highLevel,
  //    and kingArena publishes under TWO tokens — so a guard that matched one
  //    token would read the other channel's records as its own.
  expect(
    staleEvidence('highLevel', dump, [
      ...committedFresh,
      { ...record('ka', '30'), channel: 'kingArenaTournament' } as MatchVideo,
    ]) === null,
    "ignores another intake's records when judging this one",
  );
  expect(
    tokensOf('kingArena').length === 2 && tokensOf('highLevel').length === 1,
    'an intake is judged against every source token it can publish under',
  );
}

async function main(): Promise<void> {
  testSubstrateGates();
  testSegmentGates();
  testStaleGuard();
  const { at, close } = await serve();
  const browser: Browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 960 } })
  ).newPage();

  // ── 1. /health — counts + provisioning paths + the active GameConfig ──────
  console.log('\n— /health');
  await gotoIdle(page, at('/health'));
  const health = ((await page.textContent('body')) ?? '').replace(/\s+/g, ' ');
  expect(
    health.includes(fmt(videos.length)) || health.includes(String(videos.length)),
    `health shows ${videos.length} replays`,
  );
  expect(
    health.includes(String(characters.length)),
    `health shows ${characters.length} characters`,
  );
  expect(health.includes(String(players.length)), `health shows ${players.length} players`);
  expect(
    (health.match(/provided \(bundled\)/g) ?? []).length === 3,
    'registries ×3 provided (bundled)',
  );
  expect(health.includes('client-fetched (server:false)'), 'replays are client-fetched');
  expect(/charactersPerSide\s*1(?!\d)/.test(health), 'config: charactersPerSide 1');
  expect(/filters\.coOccurrence\s*false/.test(health), 'config: coOccurrence false');
  expect(/filters\.rank\s*true/.test(health), 'config: rank true');
  expect(health.includes('Legend'), 'config: ladder listed through Legend');
  expect(health.includes('Rookie'), 'config: ladder starts at Rookie (whole ladder shipped)');

  // ── 2. Browse — grid, gated facets, every always-on facet ─────────────────
  console.log('\n— Browse (/)');
  await gotoIdle(page, at('/'));
  await page.waitForSelector('[data-replay-id]');
  expect((await resultCount(page)) === videos.length, `result count = ${videos.length}`);
  expect(
    (await page.locator('[data-testid="co-occurrence-toggle"]').count()) === 0,
    'co-occurrence filter is ABSENT (1v1)',
  );

  const rankChips = (await page.locator('[data-testid="rank-chip"]').allTextContents()).map((t) =>
    t.trim(),
  );
  expect(
    rankChips.length === rankChipsExpected.length,
    `rank filter PRESENT with the ${rankChipsExpected.length} data-present ranks (ladder has ${RANKS.length})`,
  );
  expect(
    rankChips.join('|') === rankChipsExpected.join('|'),
    `rank chips render highest-first (${rankChipsExpected.join(' → ')})`,
  );

  // A card renders one CharacterBadge per character per side (aria-label = the
  // character's name). That is 2 for an ordinary 1v1 record, and more for a
  // tournament SET where a side counter-picked — so the expectation is computed
  // from the record actually on the card, per this suite's own rule that
  // numbers come from the data and are never hardcoded. A tag fighter would
  // show charactersPerSide × 2 simultaneously; SF6 never does.
  const rosterNames = characters.map((c) => c.name);
  const firstCardId = await page.locator('[data-replay-id]').first().getAttribute('data-replay-id');
  const firstRecord = allVideos.find((v) => v.id === firstCardId);
  expect(firstRecord !== undefined, `first card's id ${firstCardId} is in the substrate`);
  const expectedBadges = firstRecord
    ? firstRecord.sides.reduce((n, s) => n + s.characters.length, 0)
    : 2;
  const firstCardBadges = await page
    .locator('[data-replay-id]')
    .first()
    .evaluate(
      (el, names) =>
        [...el.querySelectorAll('[aria-label]')].filter((n) =>
          names.includes(n.getAttribute('aria-label') ?? ''),
        ).length,
      rosterNames,
    );
  expect(
    firstCardBadges === expectedBadges,
    `card renders one character badge per character per side (expected ${expectedBadges}, got ${firstCardBadges})`,
  );
  expect(
    (await page.locator('[data-replay-id]').first().locator('img[src*="i.ytimg.com"]').count()) ===
      1,
    'thumb derives from the YouTube id (thumb omitted from the whale file)',
  );

  const topChar = Object.entries(stats.characterUsage).sort((a, b) => b[1] - a[1])[0]![0];
  const deepLinks: [string, number, string][] = [
    [
      '/?rank=Legend',
      count((v) => v.sides.some((s) => s.rank === 'Legend')),
      'rank facet (Legend)',
    ],
    [
      '/?rank=Master',
      count((v) => v.sides.some((s) => s.rank === 'Master')),
      'rank facet (Master)',
    ],
    // These mirror the engine's own predicates in utils/filterReplays.ts, which
    // are array-contains on both sides — so a set VOD where a player
    // counter-picked matches on EITHER character they played. That is the
    // honest reading: both matchups occurred.
    [
      `/?c=${topChar}`,
      count((v) => v.sides.some((s) => s.characters.includes(topChar))),
      'character facet',
    ],
    [
      '/?c=ryu,ken&side=1',
      count((v) => ['ryu', 'ken'].every((c) => v.sides.some((s) => s.characters.includes(c)))),
      'c=a,b AND semantics; stray side=1 ignored (1v1)',
    ],
    [
      '/?mu=ryu:ken',
      count(
        (v) =>
          (v.sides[0].characters.includes('ryu') && v.sides[1].characters.includes('ken')) ||
          (v.sides[0].characters.includes('ken') && v.sides[1].characters.includes('ryu')),
      ),
      'matchup facet (opposing sides)',
    ],
    // the era token still selects the whole era — the engine expands a parent
    // to itself plus its children, so pre-migration links keep exact counts
    ['/?patch=S2', count((v) => v.season === 2), 'patch facet (season token)'],
    ['/?patch=2.02', patchCounts.get('2.02') ?? 0, 'patch facet (fine token)'],
    ['/?patch=2.0111', patchCounts.get('2.0111') ?? 0, 'patch facet (4-digit token, unfolded)'],
    [
      '/?patch=S1,2.02',
      count((v) => v.season === 1) + (patchCounts.get('2.02') ?? 0),
      'patch facet (era + foreign child, disjoint union)',
    ],
    // The three PRE-EXISTING tokens resolving identically is the regression
    // guard for sourceGroups: the grouping deliberately leaves the ?src= CSV
    // contract and the filter predicate untouched (engine v0.5.5).
    ['/?src=highLevel', count((v) => v.channel === 'highLevel'), 'source facet'],
    ['/?src=sfReplays', count((v) => v.channel === 'sfReplays'), 'source facet (pre-existing)'],
    [
      '/?src=fgcPlace,sfReplays',
      count((v) => ['fgcPlace', 'sfReplays'].includes(v.channel)),
      'source facet (multi-select OR)',
    ],
    // the four tournament-era tokens, each a working child deep link
    [
      '/?src=kingArenaOnline',
      count((v) => v.channel === 'kingArenaOnline'),
      'source facet (kingArenaOnline)',
    ],
    [
      '/?src=capcomFighters',
      count((v) => v.channel === 'capcomFighters'),
      'source facet (capcomFighters)',
    ],
    [
      '/?src=kingArenaTournament',
      count((v) => v.channel === 'kingArenaTournament'),
      'source facet (kingArenaTournament)',
    ],
    [
      '/?src=superFighters',
      count((v) => v.channel === 'superFighters'),
      'source facet (superFighters)',
    ],
    [
      `/?src=${TOURNAMENT_SOURCES.join(',')}`,
      count((v) => TOURNAMENT_SOURCES.includes(v.channel)),
      'source facet (Tournament group set)',
    ],
    ['/?p=daigo', count((v) => v.sides.some((s) => s.player === 'daigo')), 'player facet'],
    [
      '/?from=2026-07-01',
      count((v) => v.publishedAt.slice(0, 10) >= '2026-07-01'),
      'date facet (from)',
    ],
  ];
  for (const [url, expected, label] of deepLinks) {
    await gotoIdle(page, at(url));
    const got = await resultCount(page);
    expect(got === expected, `${label}: ${url} → ${got} (want ${expected})`);
  }

  // ── 2a-bis. source groups (engine v0.5.5) ─────────────────────────────────
  console.log('\n— source groups (Online / Tournament)');
  const onlineCount = count((v) => ONLINE_SOURCES.includes(v.channel));
  const tournamentCount = count((v) => TOURNAMENT_SOURCES.includes(v.channel));
  // membership exhaustive: every emitted source belongs to exactly one group
  expect(
    onlineCount + tournamentCount === videos.length,
    `groups partition the corpus (${onlineCount} + ${tournamentCount} = ${videos.length})`,
  );
  await gotoIdle(page, at('/'));
  await page.waitForSelector('[data-replay-id]');
  const srcBtns: string[] = (await page.evaluate(
    // string-form: the pipeline tsconfig deliberately has no DOM lib
    `Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim())`,
  )) as string[];
  expect(
    srcBtns.includes('Online') && srcBtns.includes('Tournament'),
    'Online + Tournament group chips render',
  );
  // the card SourceBadge still shows the real channel — spans, not buttons —
  // so the consolidation check is scoped to <button> text (2XKO a3 pattern)
  const channelChipNames = [
    'High Level',
    'The FGC Place',
    'SF Replays',
    'King Arena',
    'Capcom Fighters',
    'King Arena Events',
    'Super Fighters',
    'Tournament VODs',
  ];
  expect(
    channelChipNames.every((n) => !srcBtns.includes(n)),
    'per-channel source chips are consolidated away',
  );
  // clicking the group chip writes the member ids as a ?src= CSV — assert the
  // URL param set AND the filtered count against the restated membership
  await page.locator('button:text-is("Online")').first().click();
  await page.waitForFunction(`new URL(location.href).searchParams.get('src') !== null`);
  const srcParam = await page.evaluate(`new URL(location.href).searchParams.get('src') || ''`);
  expect(
    String(srcParam).split(',').sort().join(',') === [...ONLINE_SOURCES].sort().join(','),
    `Online chip writes the member CSV (got '${srcParam}')`,
  );
  expect((await resultCount(page)) === onlineCount, `Online group filters to ${onlineCount}`);
  console.log('\n— grouped patch facet');
  await gotoIdle(page, at('/'));
  await page.waitForSelector('[data-replay-id]');
  // exact match, not a prefix: `patch-group-S3-expander` shares the prefix
  const seasonChips = await page
    .locator('[data-testid^="patch-group-S"]')
    .evaluateAll(
      (els) =>
        els.filter((e) => /^patch-group-S\d+$/.test(e.getAttribute('data-testid') ?? '')).length,
    );
  expect(
    seasonChips === seasonChipsExpected.length,
    `${seasonChips} season chips render, want ${seasonChipsExpected.length} (declared ${patchGroups.length}; a season with no data shows none)`,
  );
  // Data-gated, not hardcoded: S4 opens 2026-08-03 and the day its first replay
  // lands this flips on its own instead of going stale.
  const s4Expected = seasonChipsExpected.some((g) => g.id === 'S4') ? 1 : 0;
  expect(
    (await page.locator('[data-testid="patch-group-S4"]').count()) === s4Expected,
    `S4 renders ${s4Expected} chip(s) — it has ${patchCounts.get('S4') ?? 0} replays`,
  );
  const s3Label = (await page.locator('[data-testid="patch-group-S3"]').textContent())?.trim();
  expect(
    s3Label?.startsWith('Season 3') === true,
    `season chip is self-describing ("${s3Label}") — parents carry a label, children do not`,
  );

  // every era with children gets an expander; a childless one must not
  for (const g of seasonChipsExpected) {
    const hasKids = (g.children ?? []).some((c) => (patchCounts.get(c.id) ?? 0) > 0);
    const expanders = await page.locator(`[data-testid="patch-group-${g.id}-expander"]`).count();
    expect(
      expanders === (hasKids ? 1 : 0),
      `${g.id} renders ${expanders} expander(s) (${hasKids ? 'has' : 'no'} data-present children)`,
    );
  }

  await page.click('[data-testid="patch-group-S3"]');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('patch') === 'S3');
  expect(
    (await resultCount(page)) === count((v) => v.season === 3),
    'season chip toggles ?patch=S3 with the whole-season count',
  );
  expect(
    (await page.locator('[data-testid="patch-group-S3"]').getAttribute('aria-pressed')) === 'true',
    'selected season reads aria-pressed=true',
  );
  // a parent's count IS the sum of its children — the hierarchy's core promise
  const s3Children = (patchGroups.find((g) => g.id === 'S3')?.children ?? []).map((c) => c.id);
  const s3ChildSum = s3Children.reduce((n, id) => n + (patchCounts.get(id) ?? 0), 0);
  expect(
    s3ChildSum === count((v) => v.season === 3),
    `S3's ${s3Children.length} children sum to ${fmt(s3ChildSum)} = the whole-season count`,
  );

  // ── the child dropdown: chips, counts, tri-state, deep links ──────────────
  await page.click('[data-testid="patch-group-S3-expander"]');
  await page.waitForSelector('[data-testid="patch-group-menu"]');
  const renderedChildren = await page
    .locator('[data-testid^="patch-child-"]')
    .evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid')!.replace('patch-child-', '')),
    );
  const s3Present = childChipsExpected.filter((c) => s3Children.includes(c.id)).map((c) => c.id);
  expect(
    renderedChildren.join(',') === s3Present.join(','),
    `child chips are exactly the data-present patches in declared order (${renderedChildren.join(' ')})`,
  );

  // uncheck one child → parent goes mixed, URL drops the parent token
  const dropped = s3Present[s3Present.length - 1]!;
  await page.click(`[data-testid="patch-child-${dropped}"]`);
  // wait on a condition that is FALSE before the click: the URL was the bare
  // parent token, and a partial selection lists the remaining children instead
  await page.waitForFunction(() => new URL(location.href).searchParams.get('patch') !== 'S3');
  const mixed = await page.locator('[data-testid="patch-group-S3"]').getAttribute('aria-pressed');
  expect(mixed === 'mixed', `a partially selected era reads aria-pressed=mixed (got "${mixed}")`);
  const partial = await resultCount(page);
  expect(
    partial === s3ChildSum - (patchCounts.get(dropped) ?? 0),
    `unchecking ${dropped} drops exactly its ${fmt(patchCounts.get(dropped) ?? 0)} replays (${fmt(partial)})`,
  );
  // re-check it → the URL collapses back to the bare parent token
  await page.click(`[data-testid="patch-child-${dropped}"]`);
  await page.waitForFunction(() => new URL(location.href).searchParams.get('patch') === 'S3');
  expect(
    (await resultCount(page)) === count((v) => v.season === 3),
    're-checking every child collapses the URL back to ?patch=S3',
  );
  expect(
    (await page.locator('[data-testid="patch-group-S3"]').getAttribute('aria-pressed')) === 'true',
    'a fully selected era reads aria-pressed=true again',
  );

  // stats stay ERA-keyed even though replays now carry fine tokens
  expect(
    Object.keys(stats.totals.byPatch).every((k) => /^S\d+$/.test(k)),
    `stats byPatch stays era-keyed (${Object.keys(stats.totals.byPatch).join(',')})`,
  );

  // every emitted token is declared by the hierarchy — no orphan chips
  const declared = new Set(
    patchGroups.flatMap((g) => [g.id, ...(g.children ?? []).map((c) => c.id)]),
  );
  const emitted = new Set(
    (JSON.parse(readFileSync(join(ROOT, 'data/replays.json'), 'utf8')) as { patch?: string }[]).map(
      (r) => r.patch!,
    ),
  );
  expect(
    [...emitted].every((t) => declared.has(t)),
    `every emitted patch token is declared in patchGroups (${emitted.size} distinct)`,
  );
  // ids unique across parents AND children — the engine documents this as a
  // MUST and validates nothing
  const allIds = patchGroups.flatMap((g) => [g.id, ...(g.children ?? []).map((c) => c.id)]);
  expect(
    new Set(allIds).size === allIds.length,
    `patchGroups ids are unique across parents and children (${allIds.length})`,
  );

  // date→patch is derived from the DATE, never the version prefix: SF6's 1.x
  // line spans S1 and S2, and 2.00 lands mid-S3
  const midS3 = videos.filter((v) => v.publishedAt >= '2025-08-05' && v.publishedAt < '2025-10-15');
  expect(
    midS3.length > 0 && midS3.every((v) => v.season === 3 && patchOf(v) === '2.00'),
    `all ${fmt(midS3.length)} replays in 2.00's window are season 3 (2.x began mid-season)`,
  );
  const lateS1 = videos.filter(
    (v) => v.publishedAt >= '2024-02-27' && v.publishedAt < '2024-05-22',
  );
  expect(
    lateS1.length > 0 && lateS1.every((v) => v.season === 1 && patchOf(v) === '1.04'),
    `all ${fmt(lateS1.length)} replays in 1.04's window are season 1 (1.x spans S1–S2)`,
  );

  // ── 3. modal + shareable ?v= ──────────────────────────────────────────────
  console.log('\n— modal');
  await gotoIdle(page, at('/'));
  await page.waitForSelector('[data-replay-id]');
  await page.locator('[data-replay-id]').first().click();
  await page.waitForSelector('[role="dialog"][aria-modal="true"]');
  expect(new URL(page.url()).searchParams.has('v'), 'modal state lives in ?v= (shareable)');
  const dialogText = ((await page.locator('[role="dialog"]').textContent()) ?? '').replace(
    /\s+/g,
    ' ',
  );
  // Now that patches are children, patchTokenParts() resolves a replay's token
  // to "era · patch" and the meta line reads e.g. "S3 · 2.0301". It prints the
  // era's raw ID, never the chip's "Season 3" label — patchTokenParts() looks
  // up ids only. That is an engine limitation, not an SF6 one, and it is
  // deliberately NOT worked around here (never game-branch).
  expect(
    /\bS[1-4] · \d+\.\d{2,4}\b/.test(dialogText),
    `modal meta line reads "era · patch" for a fine token`,
  );
  await page.keyboard.press('Escape');
  // the router update is async — wait for it rather than sampling immediately
  await page
    .waitForFunction(() => !new URL(location.href).searchParams.has('v'), undefined, {
      timeout: 5000,
    })
    .catch(() => {});
  expect(!new URL(page.url()).searchParams.has('v'), 'Escape closes the modal');

  // ── 3a. segment playback ──────────────────────────────────────────────────
  // A segment record is the only kind whose id is not a YouTube id, so every URL
  // the engine builds for it goes through `videoId ?? id`. Three things have to
  // hold and each fails silently otherwise: the composite id has to survive the
  // ?v= round trip (lookup is string equality, so a percent-encoding asymmetry
  // just never opens the modal), the thumb has to derive from videoId (a
  // composite id 404s and @error hides it behind the placeholder), and the embed
  // has to carry the offset (or every card opens a three-hour VOD at 0:00).
  //
  // A SAMPLE, not one record: one per source VOD up to a cap, plus the two
  // shapes most likely to break — the offset-0 case, whose startSeconds is
  // omitted as falsy, and the largest offset. Computed, so it grows with the
  // catalogue.
  const segRecords = videos.filter((v) => v.videoId !== undefined);
  if (segRecords.length > 0) {
    console.log('\n— segment playback');
    // The MIDDLE record of each VOD, not the first: ids sort with "@0" ahead of
    // every other offset, so taking the first would make every per-VOD pick a
    // zero-offset record and the t= assertion below would never run on the shape
    // it exists for.
    const byVod = new Map<string, MatchVideo[]>();
    for (const v of segRecords) byVod.set(v.videoId!, [...(byVod.get(v.videoId!) ?? []), v]);
    const perVod = [...byVod.values()].map((list) => {
      const sorted = [...list].sort((a, b) => (a.startSeconds ?? 0) - (b.startSeconds ?? 0));
      return sorted[Math.floor(sorted.length / 2)]!;
    });
    const sample = [
      ...perVod.slice(0, 5),
      ...segRecords.filter((r) => (r.startSeconds ?? 0) === 0).slice(0, 1),
      ...[...segRecords].sort((a, b) => (b.startSeconds ?? 0) - (a.startSeconds ?? 0)).slice(0, 1),
    ].filter((v, i, arr) => arr.findIndex((x) => x.id === v.id) === i);

    for (const seg of sample) {
      const secs = seg.startSeconds ?? 0;
      await gotoIdle(page, at(`/?v=${encodeURIComponent(seg.id)}`));
      await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 10_000 });
      const shown = (await page.evaluate(`(() => {
        const d = document.querySelector('[role="dialog"]');
        if (!d) return null;
        const a = [...d.querySelectorAll('a')].find((x) => /youtube\\.com\\/watch/.test(x.href));
        const f = d.querySelector('iframe');
        const i = d.querySelector('img');
        return { watch: a ? a.href : '', iframe: f ? f.src : '', img: i ? i.src : '' };
      })()`)) as { watch: string; iframe: string; img: string } | null;
      expect(shown !== null, `?v=${seg.id} opens the modal for a segment record`);
      if (!shown) continue;
      // The embed is lazy (LiteYouTube renders a facade until clicked), so an
      // absent iframe is not a failure — one pointing at the wrong video is.
      if (shown.iframe) {
        expect(
          shown.iframe.includes(`/embed/${seg.videoId}`) &&
            (secs === 0 || shown.iframe.includes(`start=${secs}`)),
          `the embed loads ${seg.videoId} at start=${secs}`,
        );
      }
      expect(
        shown.watch.includes(seg.videoId!),
        `the watch link points at the VOD (${seg.videoId})`,
      );
      // A zero offset is the whole video and its record omits startSeconds, so
      // the correct link has NO t= at all. Asserting its absence is the half that
      // matters: "t=undefineds" still opens the video and still looks right in a
      // screenshot.
      expect(
        secs > 0 ? shown.watch.includes(`t=${secs}s`) : !/[?&]t=/.test(shown.watch),
        secs > 0
          ? `the watch link carries the offset (t=${secs}s)`
          : 'a zero-offset record links to the VOD with no t= at all',
      );
      expect(
        !shown.img.includes('@'),
        'the derived thumbnail uses videoId, never the composite id',
      );
    }
    // and reachable by BROWSING, not only by deep link.
    await gotoIdle(page, at('/?src=replayTheater'));
    await page.waitForSelector('[data-replay-id]');
    const firstSeg = await page.evaluate(
      `document.querySelector('[data-replay-id]')?.getAttribute('data-replay-id') || ''`,
    );
    expect(
      String(firstSeg).includes('@'),
      `the Tournament VODs source filter lists segment records (first: ${firstSeg})`,
    );
    console.log(`  … ${sample.length} segment record(s) checked, spread across source VODs`);
  }

  // ── 4. stats — duo-only surfaces stay hidden ──────────────────────────────
  console.log('\n— /stats');
  await gotoIdle(page, at('/stats'));
  expect(
    (await page.locator('[data-testid="synergy-matrix"]').count()) === 0,
    'synergy matrix ABSENT (duo-only)',
  );
  expect(
    (await page.locator('[data-testid="pairing-bars"]').count()) === 0,
    'pairing bars ABSENT (duo-only)',
  );

  // ── 5. roster + entity pages, and the prerender proof ─────────────────────
  console.log('\n— roster / character / player');
  await gotoIdle(page, at('/characters'));
  expect(
    (await page.locator('main a[href*="/characters/"]').count()) >= characters.length,
    `roster grid links all ${characters.length} characters`,
  );
  await gotoIdle(page, at('/characters/ryu'));
  expect(((await page.textContent('h1')) ?? '').includes('Ryu'), 'character page renders Ryu');
  const rawCharHtml = readFileSync(join(OUT, BASE, 'characters/ryu/index.html'), 'utf8');
  expect(
    rawCharHtml.includes(`${fmt(stats.characterUsage.ryu!)} appearances`),
    'PRERENDERED title carries the data-derived count (registries provided at build)',
  );
  // ComboForge cross-link (engine v0.11.0). Their character ids are not ours —
  // ryu derives, aki does NOT ('sf6-a-k-i') — so the override is pinned here as
  // well as gated in the engine, the same way the BMC URL is pinned downstream.
  expect(
    rawCharHtml.includes('https://comboforge.gg/browse?gameId=sf6&amp;characterId=sf6-ryu'),
    'ComboForge band deep-links Ryu',
  );
  expect(
    readFileSync(join(OUT, BASE, 'characters/aki/index.html'), 'utf8').includes(
      'characterId=sf6-a-k-i',
    ),
    'ComboForge band uses the A.K.I. id override, not the derived one',
  );

  // ComboForge nav item + leaving-site dialog (engine v0.12.0). The nav link is
  // a REAL <a href> — the interstitial is a click handler, not a replacement —
  // so the raw url must survive into the prerendered HTML for crawlers.
  const navCombos = page.locator('[data-testid="nav-combos"]');
  expect((await navCombos.count()) > 0, 'nav carries the Combos item');
  expect(
    (await navCombos.first().getAttribute('href')) === 'https://comboforge.gg/browse?gameId=sf6',
    'nav Combos points at this game on ComboForge',
  );
  const urlBeforeCombos = page.url();
  await navCombos.first().click();
  await page.waitForSelector('[data-testid="leaving-site-dialog"]', { timeout: 5000 });
  expect(page.url() === urlBeforeCombos, 'clicking Combos shows the dialog instead of navigating');
  expect(
    ((await page.textContent('[data-testid="leaving-site-dialog"]')) ?? '').includes('ComboForge'),
    'the dialog names the partner',
  );
  expect(
    (await page.getAttribute('[data-testid="leaving-site-continue"]', 'href')) ===
      'https://comboforge.gg/browse?gameId=sf6',
    'the dialog continues to the same url the link carried',
  );
  await page.click('text=Stay here');
  await page.waitForSelector('[data-testid="leaving-site-dialog"]', {
    state: 'detached',
    timeout: 5000,
  });
  expect(page.url() === urlBeforeCombos, '"Stay here" closes it and stays put');
  const samplePlayer = players.find((p) => p.featured)?.id ?? players[0]!.id;
  await gotoIdle(page, at(`/players/${samplePlayer}`));
  expect(
    ((await page.textContent('h1')) ?? '').length > 0,
    `player page renders (${samplePlayer})`,
  );

  // ── 6. theme, on the BUILT output ─────────────────────────────────────────
  console.log('\n— theme (built bundle)');
  await gotoIdle(page, at('/'));
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const h1 = document.querySelector('header a, header [role="img"], header svg');
    return {
      primary: cs.getPropertyValue('--color-primary').trim(),
      secondary: cs.getPropertyValue('--color-secondary').trim(),
      bg: cs.getPropertyValue('--color-bg').trim(),
      display: cs.getPropertyValue('--font-display').trim(),
      ui: cs.getPropertyValue('--font-ui').trim(),
      accentRyu: cs.getPropertyValue('--accent-ryu').trim(),
      bodyFont: getComputedStyle(document.body).fontFamily,
      headerText: (h1?.textContent ?? document.title).replace(/\s+/g, ' '),
    };
  });
  expect(
    tokens.primary.toLowerCase() === '#ff7d00',
    `--color-primary is SF6 orange (${tokens.primary})`,
  );
  expect(
    tokens.secondary.toLowerCase() === '#9be64a',
    `--color-secondary is Drive-paint green (${tokens.secondary})`,
  );
  expect(tokens.bg.toLowerCase() === '#141009', `--color-bg is asphalt (${tokens.bg})`);
  expect(
    tokens.display.includes('Big Shoulders'),
    `--font-display is Big Shoulders (${tokens.display})`,
  );
  expect(tokens.ui.includes('Public Sans'), `--font-ui is Public Sans (${tokens.ui})`);
  expect(tokens.bodyFont.includes('Public Sans'), 'body actually renders in Public Sans');
  expect(
    tokens.accentRyu.toLowerCase() === '#e8dfc8',
    `roster accent injected from app.config (${tokens.accentRyu})`,
  );
  expect(/SF6\s*\/\s*REPLAY/i.test(tokens.headerText), 'wordmark reads SF6 / REPLAY');

  // mechanism tripwire: an UNCOMPILED @theme block in any built stylesheet is
  // exactly how the 2XKO Phase-4 regression shipped — invisible in dev,
  // umbrella-themed in production.
  const cssDir = join(OUT, BASE, '_nuxt');
  const rawTheme = readdirSync(cssDir)
    .filter((f) => f.endsWith('.css'))
    .filter((f) => /@theme[\s{]/.test(readFileSync(join(cssDir, f), 'utf8')));
  expect(
    rawTheme.length === 0,
    `no raw @theme at-rule in the built CSS${rawTheme.length ? `: ${rawTheme.join(', ')}` : ''}`,
  );

  // the self-hosted faces are real files under the base, not CDN links
  const fontFiles = readdirSync(cssDir).filter((f) => /\.woff2?$/.test(f));
  expect(fontFiles.length > 0, `@fontsource faces emitted as hashed assets (${fontFiles.length})`);

  // ── 7. subpath artifacts (placement IS the assertion) ─────────────────────
  console.log('\n— subpath artifacts');
  const sitemap = readFileSync(join(OUT, BASE, 'sitemap.xml'), 'utf8');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  expect(locs.length > 0, `sitemap under the base carries ${locs.length} <loc>s`);
  expect(new Set(locs).size === locs.length, 'sitemap <loc>s are deduped');
  if (BASE) {
    expect(
      locs.every((l) => new URL(l).pathname.startsWith(`${BASE}/`) || new URL(l).pathname === BASE),
      `every <loc> is prefixed with ${BASE}`,
    );
  }
  expect(sitemap.includes('/characters/ryu'), 'sitemap carries character routes');
  // Exact-path, not substring: a real player is called "Healthy Vegetables",
  // so /players/healthy-vegetables contains the substring "/health".
  expect(
    !locs.some((l) => new URL(l).pathname.replace(/\/$/, '').endsWith('/health')),
    'sitemap excludes /health',
  );
  expect(existsSync(join(OUT, BASE, 'robots.txt')), 'robots.txt emitted under the base');
  expect(
    readFileSync(join(OUT, '404.html'), 'utf8').includes('No data at this route'),
    'designed 404 shipped at the STATIC ROOT (Vercel ignores the base for 404s)',
  );
  const manifest = JSON.parse(readFileSync(join(OUT, BASE, 'manifest.webmanifest'), 'utf8')) as {
    name: string;
    theme_color: string;
  };
  expect(
    manifest.name.includes('Street Fighter 6') && manifest.theme_color === '#FF7D00',
    'manifest carries SF6 identity',
  );

  // ── summary.json: the apex selector's payload (Phase 6) ───────────────────
  // Three checks emit itself cannot make, because emit can only compare the
  // payload against numbers it just derived:
  //  1. it is IN THE BUILD — the nuxt.config build:before copy is otherwise
  //     ungated (nothing in this app reads summary.json), so dropping it would
  //     pass this whole suite and 404 the selector's fetch in production;
  //  2. `updated` recomputed from the substrate HERE — the only assertion that
  //     can distinguish the newest replay's date from a BUILD timestamp, which
  //     would rewrite the file every day and defeat the cron's commit guard.
  //     The double-emit hash gate can't: two runs on the same day agree;
  //  3. identity matches the GameConfig this build actually rendered.
  const summaryPath = join(OUT, BASE, 'data/summary.json');
  expect(existsSync(summaryPath), 'summary.json shipped under the base in the generated output');
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
    game: string;
    name: string;
    replays: number;
    players: number;
    characters: number;
    updated: string;
  };
  const newestReplay = videos.reduce((max, v) => (v.publishedAt > max ? v.publishedAt : max), '');
  expect(
    summary.updated === newestReplay.slice(0, 10),
    `summary.updated is the NEWEST REPLAY's date, not a build stamp (${summary.updated} vs ${newestReplay.slice(0, 10)})`,
  );
  expect(
    summary.replays === videos.length &&
      summary.characters === characters.length &&
      summary.players === players.length,
    `summary counts match the substrate (${summary.replays}/${summary.characters}/${summary.players} vs ${videos.length}/${characters.length}/${players.length})`,
  );
  expect(
    manifest.name === `${summary.name} Replay Database` && summary.game === 'sf6',
    `summary identity agrees with the rendered GameConfig (game=${summary.game}, name=${summary.name})`,
  );

  // ── 8. payload measurement (reported, not asserted) ───────────────────────
  console.log('\n— payload');
  const fresh = await (
    await browser.newContext({ viewport: { width: 1440, height: 960 } })
  ).newPage();
  const freshTransfers: { url: string; size: number }[] = [];
  fresh.on('response', async (res) => {
    try {
      freshTransfers.push({ url: res.url(), size: (await res.body()).length });
    } catch {
      /* ignore */
    }
  });
  await gotoIdle(fresh, at('/'));
  await fresh.waitForSelector('[data-replay-id]');
  await fresh.waitForTimeout(500);
  const whale = freshTransfers.filter((t) => t.url.includes('/data/replays.json'));
  const shell = freshTransfers.filter((t) => !t.url.includes('/data/replays.json'));
  const sum = (xs: { size: number }[]) => xs.reduce((n, x) => n + x.size, 0);
  const mb = (n: number) => (n / 1048576).toFixed(2);
  const replaysBytes = readFileSync(join(ROOT, 'data/replays.json')).length;
  const videosBytes = readFileSync(join(ROOT, 'data/videos.json')).length;
  console.log(`    committed data/videos.json       ${mb(videosBytes)} MB`);
  console.log(`    committed data/replays.json      ${mb(replaysBytes)} MB`);
  console.log(
    `    first load — shell (${String(shell.length).padStart(3)} reqs)   ${mb(sum(shell))} MB`,
  );
  console.log(`    first load — replays.json ×${whale.length}      ${mb(sum(whale))} MB`);
  console.log(`    first load — TOTAL               ${mb(sum(freshTransfers))} MB`);
  expect(sum(whale) > 0, 'browse fetches replays.json client-side (server:false)');
  // Engine-side finding, recorded rather than worked around: useReplays() is a
  // keyed useAsyncData, but every component that calls it re-triggers the fetch
  // on mount, so the whale is pulled once PER CONSUMER. On SF6 that is 5 × 6 MB
  // on a single browse load. It affects every game on the platform, so the fix
  // belongs in the engine (memoize the fetch / supply getCachedData), not here.
  // This assertion documents the current number so the day it improves, it fails
  // and someone updates it deliberately.
  console.log(
    whale.length > 1
      ? `    ⚠ replays.json fetched ${whale.length}× on one load — engine useReplays() dedupe gap`
      : '    replays.json fetched once',
  );
  expect(
    !readFileSync(join(OUT, BASE, 'index.html'), 'utf8').includes('"sides"'),
    'the whale is NOT inlined into the prerendered HTML',
  );
  await fresh.close();

  // ── 9. emit determinism ───────────────────────────────────────────────────
  console.log('\n— emit determinism');
  const files = [
    'data/replays.json',
    'data/stats.json',
    'data/patchGroups.json',
    'data/patchBoundaries.json',
    // content-derived, so it must NOT move between runs — a build timestamp
    // here would commit (and deploy) on every zero-new-video day
    'data/summary.json',
  ];
  const hash = (p: string) =>
    createHash('sha256')
      .update(readFileSync(join(ROOT, p)))
      .digest('hex');
  const before = files.map(hash);
  execSync('npm run data:emit', { cwd: ROOT, stdio: 'pipe' });
  const after = files.map(hash);
  expect(
    files.every((_, i) => before[i] === after[i]),
    'double-emit: replays/stats/patchGroups/patchBoundaries/summary byte-stable',
  );

  // ── observability wiring ──────────────────────────────────────────────────
  // The gate that DID NOT EXIST when the subpath cutover silently killed
  // analytics for ~10 days (found 2026-07-27; engine PLAN Phase-7 retro). The
  // cutover battery checked themes, canonicals, sitemaps and redirects, but
  // nothing ever asserted a beacon resolves, so both SDKs 404'd into the void
  // and every dashboard read zero.
  //
  // Two failure modes, both visible only on the BUILT output:
  //   1. the per-project obfuscated path Vercel bakes into the bundle
  //      ("/c9920e40736946a9/script.js") — exists only on this project's own
  //      host, 404s the moment the shell proxies the page onto the apex;
  //   2. the base-STRIPPED path both SDK wrappers report — /sf6/stats arriving
  //      as /stats, colliding with 2XKO's and Tekken's /stats in the dashboard.
  //
  // The endpoints 404 locally (a static dir has no /view) and that is fine:
  // what is gated here is the SHAPE — which URL is asked for, and what path is
  // reported. That a proxied beacon actually LANDS is a property of Vercel's
  // routing, gated in the shell's verify-cutover.mjs against a real deployment.
  console.log('\n— observability');
  {
    const octx = await browser.newContext();
    const opage = await octx.newPage();
    const asked: string[] = [];
    opage.on('request', (r) => {
      const p = new URL(r.url()).pathname;
      if (/insights|vitals/.test(p)) asked.push(p);
    });

    await gotoIdle(opage, at('/stats'));
    // both SDKs attach on idle, after networkidle has already resolved
    await opage.waitForTimeout(4000);

    const srcs = (await opage.evaluate(
      `[...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))`,
    )) as string[];
    const observability = srcs.filter((s) => /insights|vitals/.test(s));

    // must match app.config.ts game.observability.insights AND the matching
    // rewrite in the shell's vercel.json — all three move together
    expect(
      observability.includes('/sf6-insights/script.js'),
      `web analytics script src is /sf6-insights/script.js (got ${JSON.stringify(observability)})`,
    );
    // Speed Insights stays on the stable path on purpose: single-project on
    // Hobby, so its beacons must reach whichever project has it enabled
    expect(
      observability.includes('/_vercel/speed-insights/script.js'),
      `speed insights script src is /_vercel/speed-insights/script.js (got ${JSON.stringify(observability)})`,
    );
    // THE REGRESSION ITSELF: a 16-hex baked path means the explicit endpoints
    // stopped winning over VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG
    const baked = [...observability, ...asked].filter((s) => /^\/[0-9a-f]{16}\//.test(s));
    expect(baked.length === 0, `no baked per-project hash path (got ${JSON.stringify(baked)})`);
    const stray = asked.filter(
      (p) => !p.startsWith('/sf6-insights/') && !p.startsWith('/_vercel/speed-insights/'),
    );
    expect(
      stray.length === 0,
      `no insights request outside the configured prefixes (got ${JSON.stringify(stray)})`,
    );

    // the reported pageview must carry the base. The script 404s here, so the
    // queue never drains and window.vaq still holds what WOULD be sent.
    const queued = (await opage.evaluate(`JSON.stringify(window.vaq ?? [])`)) as string;
    const pageviews = (JSON.parse(queued) as [string, { route?: string; path?: string }][]).filter(
      ([kind]) => kind === 'pageview',
    );
    expect(pageviews.length > 0, `a pageview is queued (window.vaq = ${queued})`);
    const reported = pageviews[0]?.[1] ?? {};
    expect(
      reported.path === `${BASE}/stats`,
      `reported path carries the base (expected ${BASE}/stats, got ${reported.path})`,
    );
    expect(
      reported.route === `${BASE}/stats`,
      `reported route carries the base (expected ${BASE}/stats, got ${reported.route})`,
    );

    await octx.close();
  }

  await browser.close();
  close();

  // ── 10. the cron commit guard (shell, so tested as shell) ─────────────────
  testCronGuard();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.error('\nFailures:');
    for (const f of failures) console.error(`  ✖ ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('✖ e2e failed:', err);
  process.exit(1);
});

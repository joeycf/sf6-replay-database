// The SF6 balance-season and patch boundary authority — the single place a
// replay's era AND its patch are decided, and the only input to Replay.patch.
//
// The two tables live in one module on purpose. They are not independent: an
// era opens ON a patch, so `SEASONS[n].start` must equal the date of the first
// patch nested under it, and a validator that cannot see both tables cannot
// enforce that. (Tekken and 2XKO split theirs across scripts/patches.ts +
// data/patchBoundaries.json and pay for it — Tekken ended up with two
// `seasonForDate` implementations that iterate in opposite directions.)
//
// WHY SEASONS, NOT "YEARS". Capcom and the community name the annual
// all-character balance passes Seasons: EventHubs shipped "Street Fighter 6
// Season 2 and Akuma update patch notes" (2024-05-22) and "Street Fighter 6
// Season 3 and Elena update patch notes" (2025-06-03). "Year N" is the
// separate DLC Character Pass and it is OFFSET from the balance calendar — the
// Year 3 pass opens with Sagat on 2025-08-05, two months after Season 3
// started. Anchoring on the balance overhaul is what a meta database wants
// (it is the patch that changes how the game plays), and calling it a Season
// is what everyone reading the site already calls it.
//
// WHY DATE-DERIVATION IS ACCURATE. Capcom expires Fighting Ground replay data
// on update, so a replay captured after a patch was played on that patch;
// capture date ⇒ played season. Only upload lag blurs a boundary week.
//
// WHY THERE IS NO LABEL-GRACE / CONFLICT COUNTER. Tekken cross-checks its date
// table against explicit "SEASON N" tokens in titles/descriptions and counts
// the disagreements. The SF6 build recon read all 22,210 uploads across the
// three tracked channels: NOT ONE labels a season or year, anywhere. A grace
// window and a conflict counter would be dead code that can only ever read
// zero, so they are deliberately absent — and `confirmed` below is what
// replaces them as the cross-check.

import type { PatchBoundary, PatchWindow, SeasonBoundary } from '../types/index';

/** SF6 launched 2023-06-02 (v1.00). Uploads before this are pre-launch/beta. */
export const LAUNCH = '2023-06-02';

/**
 * Boundaries anchor on the ANNUAL ALL-CHARACTER BALANCE OVERHAUL, never on the
 * internal major version and never on the DLC pass. "major = season" is a trap
 * here: the 1.x line spans Seasons 1-2 and 2.x begins mid-Season-3 (Sagat,
 * 2025-08-05).
 *
 * `confirmed: false` means "Capcom announced the date, the landing is not yet
 * verified". Season 4 was explicitly held back from Ingrid's 2026-05-28 patch
 * (which shipped throw-interaction changes and bug fixes only) and moved to
 * Yasmine's 2026-08-03 update. Once that date arrives, scripts/expiries.ts
 * fails loud until a human confirms it landed — or edits the date.
 */
export const SEASONS: SeasonBoundary[] = [
  { season: 1, start: LAUNCH, end: '2024-05-22', confirmed: true, note: 'Launch' },
  { season: 2, start: '2024-05-22', end: '2025-06-03', confirmed: true, note: 'Akuma' },
  { season: 3, start: '2025-06-03', end: '2026-08-03', confirmed: true, note: 'Elena' },
  // Confirmed 2026-08-03: the Season 4 update landed on its announced date.
  // Maintenance ran Aug 2 20:00 PDT → Aug 3 00:00 PDT (Aug 3 03:00–07:00 UTC),
  // shipping Yasmine plus balance changes to all 30 prior characters. Capcom
  // did not slip it, so the pre-declared boundary stands as authored.
  { season: 4, start: '2026-08-03', end: null, confirmed: true, note: 'Yasmine' },
];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Hard-fail validations — a bad boundary table silently misfiles thousands of
 *  replays, so every rule exits rather than warns. */
export function validateSeasons(seasons: SeasonBoundary[] = SEASONS): void {
  const fail = (msg: string): never => {
    console.error(`✖ seasons: ${msg}`);
    process.exit(1);
  };

  if (seasons.length === 0) fail('the table is empty');
  if (seasons[0]!.start !== LAUNCH) fail(`season 1 must start at launch (${LAUNCH})`);

  let prev: SeasonBoundary | null = null;
  for (const s of seasons) {
    if (!ISO_DAY.test(s.start)) fail(`S${s.season} start "${s.start}" is not an ISO day`);
    if (s.end !== null && !ISO_DAY.test(s.end))
      fail(`S${s.season} end "${s.end}" is not an ISO day`);
    if (prev) {
      if (s.season !== prev.season + 1)
        fail(`season numbers must be consecutive (got ${s.season} after ${prev.season})`);
      if (s.start <= prev.start)
        fail(`S${s.season} start ${s.start} is not after S${prev.season} start ${prev.start}`);
      // windows are contiguous: each season ends exactly where the next begins
      if (prev.end !== s.start)
        fail(`S${prev.season} end ${prev.end} must equal S${s.season} start ${s.start}`);
    }
    prev = s;
  }
  if (prev!.end !== null) fail(`the last season (S${prev!.season}) must be open-ended (end: null)`);
}

/** The season a capture date falls in. Dates before launch return 0, which the
 *  parser treats as the `pre-launch` miss rather than a season. */
export function seasonForDate(iso: string, seasons: SeasonBoundary[] = SEASONS): number {
  const day = iso.slice(0, 10);
  if (day < LAUNCH) return 0;
  for (const s of seasons) {
    if (day >= s.start && (s.end === null || day < s.end)) return s.season;
  }
  return 0;
}

/** The era token written to Replay.patch when no patch window claims a date. */
export const seasonToken = (season: number): string => `S${season}`;

/**
 * VERSION SCHEME — settled once, from primary sources; do not re-litigate.
 *
 * `version` is the SuperCombo wiki's `gameversion` string VERBATIM, taken from
 * its Cargo table `SF6_Versions` (the page states: "Version IDs and release
 * dates were taken from the PC/Steam release"). All 17 rows below were checked
 * against that table live, plus `Special:AllPages` for the Version/ prefix,
 * which returns exactly these 17 pages and no others.
 *
 * WHY WE DO NOT FOLD LIKE TEKKEN. Tekken's tokens are Bandai's `X.YY.ZZ` and
 * it folds the trailing `.ZZ` hotfix segment into `X.YY` via `includes`.
 * Capcom's full form is `X.YYZZ.RRR` — the dot falls AFTER ZZ, so `YYZZ` is
 * ONE atomic field and `2.01` (= 2.0100.000) and `2.0111` (= 2.0111.000) are
 * that field at two values: siblings, not parent and child. Folding at ZZ
 * would be Tekken folding `1.01` and `1.02` into `1.0`. It would also mint
 * `2.03` for the Ingrid patch — a token that denotes build 2.0300.000, which
 * never shipped and appears in no source. Both siblings' tables carry the same
 * standing rule: NEVER invent a version to fill a sequence gap.
 *
 * WHAT DOES FOLD. Capcom ships builds the wiki does not page, and those fold
 * into whichever row's date window contains them — recorded in `includes` so
 * they are declared rather than silently absorbed. Two exist today, both
 * verified from primary sources rather than the wiki. `1.0100.001` and
 * `1.0300.001` are NOT among them: those are the first public build of their
 * line (one page, one date, no earlier `.000` release), exactly like the
 * `.01`/`.04` first releases wavu lists for Tekken.
 *
 * The table is an explicit hardcoded list and stays one. Version numbers do
 * not imply eras here (the `1.x` line spans S1 AND S2; `2.00` lands mid-S3),
 * and an all-character balance pass does not imply a new era either — 1.08 and
 * 2.02 are both roster-wide and both mid-season.
 */
export const PATCHES: PatchBoundary[] = [
  { version: '1.00', start: '2023-06-02', note: 'Launch' },
  { version: '1.01', start: '2023-07-24', note: 'Rashid' },
  { version: '1.02', start: '2023-09-27', note: 'A.K.I.' },
  { version: '1.03', start: '2023-12-01', note: 'Costume 3' },
  { version: '1.04', start: '2024-02-27', note: 'Ed' },
  { version: '1.05', start: '2024-05-22', note: 'Akuma — all-character balance' },
  { version: '1.06', start: '2024-06-26', note: 'M. Bison' },
  { version: '1.07', start: '2024-09-24', note: 'Terry' },
  { version: '1.08', start: '2024-12-02', note: 'all-character balance' },
  { version: '1.09', start: '2025-02-05', note: 'Mai' },
  { version: '1.10', start: '2025-06-03', note: 'Elena — all-character balance' },
  { version: '2.00', start: '2025-08-05', note: 'Sagat' },
  { version: '2.01', start: '2025-10-15', note: 'C. Viper' },
  { version: '2.0111', start: '2025-12-16', note: 'Elena / Mai / Sagat fixes' },
  {
    version: '2.02',
    start: '2026-03-17',
    // Capcom's own Steam news feed (appid 1364780) carries exactly one
    // build-numbered post: "Hot Fix：Ver. 2.0201.000", 2026-04-01 — inside
    // this window, and paged nowhere on the wiki.
    includes: ['2.0201.000 (Apr 1 hot fix)'],
    note: 'Alex — all-character balance',
  },
  { version: '2.0202', start: '2026-04-15', note: 'JP / M. Bison fixes' },
  {
    version: '2.0301',
    start: '2026-05-28',
    // 2026-07-02 shipped a real battle change (time now stops for projectiles
    // while the screen is darkened) plus the Yasmine Arrives Fighting Pass, so
    // it expired replays — but Capcom gave it no version id and the wiki gives
    // it no row, so it folds here rather than being minted a token.
    includes: ['Jul 2 update'],
    note: 'Ingrid',
  },
  // Season 4's opener. `2.0401` is the wiki's gameversion string verbatim —
  // NOT folded to 2.04 (which would denote a build that never shipped) and not
  // invented: `npm run data:versions` named it from the SuperCombo Cargo API
  // before this row existed. Its start EQUALS SEASONS[3].start, which is the
  // "an era opens ON its first patch" invariant validatePatches() enforces.
  { version: '2.0401', start: '2026-08-03', note: 'Yasmine — all-character balance' },
];

/** X.YY or X.YYZZ. Length-independent, so a two-digit major still validates. */
const VERSION_SHAPE = /^\d+\.\d{2}(?:\d{2})?$/;
/** the un-elided form: 2.0100 must be written 2.01, as the source writes it */
const UNELIDED = /\.\d{2}00$/;
/** a patch token must never look like an era token, or the facet collapses */
const ERA_TOKEN = /^S\d+$/i;

/**
 * Hard-fail validations for the patch table and its agreement with the season
 * table. Same posture as validateSeasons: a bad row silently misfiles
 * thousands of replays, so every rule exits rather than warns.
 */
export function validatePatches(
  patches: PatchBoundary[] = PATCHES,
  seasons: SeasonBoundary[] = SEASONS,
): void {
  const errors: string[] = [];

  // the full version set is built BEFORE the loop, so an `includes` entry that
  // collides with a LATER row is caught too (both siblings grow `seen` as they
  // walk and miss exactly that case)
  const versions = new Set(patches.map((p) => p.version));
  const seen = new Set<string>();
  const folded = new Set<string>();

  for (const p of patches) {
    if (!ISO_DAY.test(p.start)) errors.push(`${p.version}: start "${p.start}" is not an ISO day`);
    if (ERA_TOKEN.test(p.version)) errors.push(`${p.version}: collides with an era token`);
    if (!VERSION_SHAPE.test(p.version) || UNELIDED.test(p.version)) {
      errors.push(
        `${p.version}: not an SF6 version id — expected X.YY or X.YYZZ as the wiki spells it (2.0100 is written 2.01)`,
      );
    }
    if (seen.has(p.version)) errors.push(`${p.version}: duplicate version`);
    seen.add(p.version);
    for (const inc of p.includes ?? []) {
      if (versions.has(inc)) errors.push(`${p.version}: includes "${inc}", which is its own row`);
      if (folded.has(inc)) errors.push(`${p.version}: includes "${inc}" twice over`);
      folded.add(inc);
    }
  }

  for (let i = 1; i < patches.length; i++) {
    if (patches[i]!.start <= patches[i - 1]!.start) {
      errors.push(
        `${patches[i]!.version}: starts ${patches[i]!.start}, not after ${patches[i - 1]!.version} (${patches[i - 1]!.start}) — author in release order`,
      );
    }
  }

  // every patch nests under exactly one declared era, BY DATE — never by
  // version prefix, which is the trap this game is built to fall into
  for (const p of patches) {
    if (seasonForDate(p.start, seasons) === 0) {
      errors.push(`${p.version}: start ${p.start} is outside every season window`);
    }
  }

  // the two tables cannot drift: an era opens ON its first patch
  for (const s of seasons) {
    const first = patches.find((p) => seasonForDate(p.start, seasons) === s.season);
    if (!first) continue;
    if (first.start !== s.start) {
      errors.push(
        `S${s.season} opens ${s.start} but its first patch ${first.version} starts ${first.start}`,
      );
    }
  }

  if (errors.length > 0) {
    console.error(`✖ ${errors.length} error(s) in the patch table:`);
    for (const e of errors) console.error(`  • ${e}`);
    process.exit(1);
  }
}

/** Patches with their computed windows and resolved eras. Windows are never
 *  authored: each ends where the next patch of the same era begins, else at
 *  the era's end, else open. */
export function patchWindows(
  patches: PatchBoundary[] = PATCHES,
  seasons: SeasonBoundary[] = SEASONS,
): PatchWindow[] {
  const out: PatchWindow[] = patches.map((p) => ({
    ...p,
    season: seasonForDate(p.start, seasons),
    end: null,
  }));
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    out[i]!.end =
      next && next.season === out[i]!.season
        ? next.start
        : (seasons.find((s) => s.season === out[i]!.season)?.end ?? null);
  }
  return out;
}

/** The patch live on a capture date, or null when none claims it — which is
 *  how a season that has opened but shipped no patch yet (S4 today) keeps its
 *  replays on the bare era token. */
export function patchForDate(iso: string, windows: PatchWindow[] = patchWindows()) {
  const day = iso.slice(0, 10);
  for (const w of windows) {
    if (day >= w.start && (w.end === null || day < w.end)) return w;
  }
  return null;
}

/**
 * GameConfig.patchGroups for the engine's grouped patch facet (v0.6.0).
 *
 * Parents are the season tokens carrying self-describing labels, so the
 * engine's default "Patch" facet heading reads correctly with no `terms`
 * override. The siblings solve the same problem differently: 2XKO renames the
 * heading to "Season" via `terms` and lets its parents render as bare `S1`;
 * Tekken sets neither and accepts bare `S1` under "Patch". Children are the
 * patch tokens in release order and deliberately carry NO label: the token IS
 * the display string, so a label would just repeat it.
 *
 * A season with no patches yet emits no `children` key at all and the engine
 * renders it as a plain chip with no expander — and hides it entirely while it
 * has no replays. That is S4 today.
 */
export function buildPatchGroups(
  seasons: SeasonBoundary[] = SEASONS,
  patches: PatchBoundary[] = PATCHES,
) {
  const windows = patchWindows(patches, seasons);
  return seasons.map((s) => {
    const children = windows
      .filter((w) => w.season === s.season)
      .map((w) => ({ id: w.version, ...(w.note ? { note: w.note } : {}) }));
    return {
      id: seasonToken(s.season),
      label: `Season ${s.season}`,
      ...(s.note ? { note: s.note } : {}),
      ...(children.length ? { children } : {}),
    };
  });
}

// ── standalone `--check` ─────────────────────────────────────────────────────
// Both validators are pure and offline, but `tsc --noEmit` only TYPE-checks —
// it never runs them, so the era/patch cross-validation would otherwise only
// fire during an emit. This entry puts it in the typecheck path (see
// package.json), where a table edit is caught before anything is derived.
const isMain = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isMain && process.argv.includes('--check')) {
  validateSeasons();
  validatePatches();
  const windows = patchWindows();
  console.log(
    `✓ ${SEASONS.length} seasons, ${PATCHES.length} patches — ` +
      `${windows.filter((w) => w.end === null).length} open window(s), ` +
      `eras open on ${SEASONS.filter((s) => PATCHES.some((p) => p.start === s.start)).length}/${SEASONS.length} first children`,
  );
}

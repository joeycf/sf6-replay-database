// The SF6 balance-season boundary authority — the single place a replay's era
// is decided, and the only input to Replay.patch.
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

import type { SeasonBoundary } from '../types/index';

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
  { season: 4, start: '2026-08-03', end: null, confirmed: false, note: 'Yasmine' },
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
export function seasonForDate(iso: string): number {
  const day = iso.slice(0, 10);
  if (day < LAUNCH) return 0;
  for (const s of SEASONS) {
    if (day >= s.start && (s.end === null || day < s.end)) return s.season;
  }
  return 0;
}

/** The era token written to Replay.patch. */
export const seasonToken = (season: number): string => `S${season}`;

/**
 * GameConfig.patchGroups for the engine's grouped patch facet (v0.6.0).
 * Parents are the season tokens carrying self-describing labels, so the
 * engine's default "Patch" facet heading reads correctly with no `terms`
 * override. No children: SF6's within-season patches are not named anywhere in
 * the tracked corpus, and a parent with no children renders as a plain chip.
 */
export function buildPatchGroups(seasons: SeasonBoundary[] = SEASONS) {
  return seasons.map((s) => ({
    id: seasonToken(s.season),
    label: `Season ${s.season}`,
    ...(s.note ? { note: s.note } : {}),
  }));
}

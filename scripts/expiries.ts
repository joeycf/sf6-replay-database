// Self-expiring gates: the things this repo knows will come due on a date, so
// the data tells you rather than you having to remember.
//
// Three jobs come due on one date (2026-08-03), and they are one event:
//   1. Yasmine becomes playable — she must join the roster.
//   2. Season 4 starts — its boundary must be confirmed (or corrected).
//   3. Season 4's opening PATCH must be added to the table in seasons.ts.
//
// The third exists because S4 is the only era with no children: replays fall
// back to the bare `S4` token until Capcom ships the patch and the wiki pages
// its version. That fallback is correct and invisible, which is exactly why it
// needs a gate — nothing else would ever complain about it.
//
// ─── THE SEVERITY DESIGN — READ BEFORE "FIXING" ANYTHING HERE ────────────────
//
//   scripts/characters.ts  (manual roster run)  → process.exit(1)
//   scripts/parse.ts       (daily cron path)    → NEVER exits; prints a FAILURE
//                                                 banner and writes an
//                                                 "## ⚠ ACTION REQUIRED" block
//                                                 at the top of data/report.md
//   .github/workflows/…    (daily cron)         → a FINAL step, AFTER commit and
//                                                 push, that exits 1
//
// A hard exit in parse.ts would fail `npm run data:build` and stop the daily
// refresh entirely. That is strictly worse than the misfiling it warns about:
// the data stays overwhelmingly correct, only the newest replays risk landing
// in the wrong season, and halting ingestion fixes nothing while losing
// everything. So the daily path stays soft and the WORKFLOW goes red after the
// data is safely pushed — refresh keeps running, the run is visibly red, and
// the standard Actions failure mail arrives.
//
// A red workflow and the exit(1) in the roster script are therefore the DESIGN,
// not a bug. Clear them by doing the work — add the character, confirm or
// correct the boundary date — never by deleting the check.
//
// Second-order property worth preserving: report.md's commit guard drops the
// file when the only diff is its "_Generated_" timestamp. An ACTION REQUIRED
// block is real content, so the day it first appears the guard lets it through
// and the signal reaches git (and the deployed site) even on a no-change day.

import { SEASONS } from './seasons';
import type { Expiry } from '../types/index';

/**
 * Characters that exist on Capcom's official site but are not yet playable.
 * The roster scraper skips them (and says so in its run output) until their
 * release date arrives — at which point this entry becomes a due expiry.
 *
 * Capcom publishes a character's page and art ahead of release, so the site
 * index runs ahead of the playable roster: it listed 31 characters while 30
 * were playable when this repo was built.
 */
export const UNRELEASED: { id: string; releases: string; note?: string }[] = [
  { id: 'yasmine', releases: '2026-08-03', note: 'first Year 4 character' },
];

const today = (): string => new Date().toISOString().slice(0, 10);

/** Everything whose date has now passed. Empty is the happy path. */
export function dueExpiries(asOf: string = today()): Expiry[] {
  const due: Expiry[] = [];

  for (const u of UNRELEASED) {
    if (asOf >= u.releases) {
      due.push({
        kind: 'unreleased-character',
        id: u.id,
        date: u.releases,
        action:
          `${u.id} is now playable. Add --char-${u.id} to design/handoff/tokens.css ` +
          `(accent from Claude Design — contrast ≥4.5:1 on --color-surface and a hue ` +
          `≥8-12° off its roster neighbours), add the same hex to accents in ` +
          `app/app.config.ts, drop the entry from UNRELEASED in scripts/expiries.ts, ` +
          `then run \`npm run data:characters\`.`,
      });
    }
  }

  for (const s of SEASONS) {
    if (!s.confirmed && asOf >= s.start) {
      due.push({
        kind: 'unconfirmed-season',
        id: `S${s.season}`,
        date: s.start,
        action:
          `Season ${s.season} was scheduled for ${s.start} and is still unconfirmed. ` +
          `THREE jobs, all in scripts/seasons.ts: (1) verify the balance patch ` +
          `actually landed that day — if it did, set confirmed: true on the SEASONS ` +
          `row; if Capcom slipped it, correct \`start\` (and the previous season's ` +
          `\`end\`). (2) Add the opening patch to PATCHES with the version id the ` +
          `SuperCombo wiki gives it — verbatim, never folded or invented; ` +
          `\`npm run data:versions\` will name it. Its \`start\` must EQUAL the season ` +
          `start, which \`npm run typecheck\` enforces. (3) Re-run ` +
          `\`npm run data:emit\`. Until the patch row exists, S${s.season} replays ` +
          `carry the bare era token — correct, but coarser than every other season. ` +
          `Nothing else cross-checks the boundary date; the tracked channels carry ` +
          `no season labels.`,
      });
    }
  }

  return due;
}

/** Human-facing block, reused by the console banner and report.md. */
export function formatExpiries(due: Expiry[]): string {
  return due.map((e) => `- **${e.id}** (${e.kind}, due ${e.date})\n  ${e.action}`).join('\n\n');
}

// Standalone `--check`: the workflow's final step. Exits 1 when anything is
// due, which is what turns the cron run red — deliberately, and only after the
// data has already been committed and pushed by the preceding step.
const isMain = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isMain && process.argv.includes('--check')) {
  const due = dueExpiries();
  if (due.length === 0) {
    console.log('✓ no expiries due');
  } else {
    console.error(`\n✖ ${due.length} expiry/expiries due — see the action(s) below.\n`);
    console.error(formatExpiries(due));
    console.error('\nThis step is meant to fail. Do the work; do not delete the check.\n');
    process.exit(1);
  }
}

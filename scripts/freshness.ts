// THE STALE-RAW GUARD, as a pure predicate.
//
// WHY IT EXISTS. raw/ is gitignored, so it is local-only and the daily cron
// never writes it — the cron fetches and parses remotely, in one process, and
// commits the result. A local raw/ is therefore routinely OLDER than the
// committed data/, and `npm run data:parse` on its own publishes whatever that
// stale dump can reproduce and silently drops the rest.
//
// THE COLLAPSE GUARD CANNOT CATCH THIS, and tuning it is not the answer. It
// needs >20 records AND >10% from ONE channel; staleness arrives as a handful
// spread across all seven and slips under both thresholds by construction.
// Measured in this repo on 2026-08-30: a raw/ taken 2026-08-10 is missing 325
// committed ids, and the worst-hit channel loses 134 of 8,717 — 1.5%, a seventh
// of the threshold. Two different failures, two guards.
//
// THE TEST READS ONLY DATA, and that is the whole design. Two proxies were tried
// next door and both leaked:
//
//  · A 24-hour wall-clock window on mtime. On 2026-08-29 a dump one day old
//    wrote 435 records over a committed 455 — inside the tolerance, so the guard
//    stayed silent. Tightening the number only moves the leak: no fixed window
//    is right for a corpus the cron rewrites daily and a human refetches on no
//    schedule.
//  · The window removed but mtime kept, compared against the newest committed
//    publishedAt. A sound relation that still failed, because mtime is not a
//    record of when a dump was FETCHED: a `cp`, a fresh clone, or a gates run
//    that restores raw/ all stamp a months-old dump as new. Caught live on
//    2026-08-30, when a 13-hour-old dump wrote 523 over a committed 536.
//
// So: a dump cannot contain an upload published after it was taken. If the
// committed corpus holds a record for this intake NEWER than the newest upload
// anywhere in its dump, that record cannot have come from this dump and parsing
// would drop it. Both sides are publish timestamps written by YouTube and
// carried inside the files themselves, so cp, git checkout and a fresh clone
// cannot forge either one.
//
// What that buys:
//  · fires at ANY age — a dump taken two minutes before the cron's is caught,
//    where a 24-hour window never would be.
//  · never fires on age alone — a months-old dump for a channel that has
//    published nothing since is fresh, and re-parsing in the same session is
//    always allowed, because the committed corpus can only hold what this dump
//    produced.
//  · a DELETED upload stays legal — committed holds it, the dump does not, but
//    the dump's newest is unchanged. That is the prune the pipeline exists to
//    publish and the guard must not block it.
//
// SCOPED PER INTAKE, because a stale kingArena dump says nothing about
// highLevel. This repo has no `intake` field on MatchVideo — a channel's records
// carry the SourceId they published under, and kingArena publishes under two —
// so the tokens come from CHANNELS rather than from the record.
//
// A PURE PREDICATE, deliberately. scripts/parse.ts has top-level awaits and
// calls process.exit, so it cannot be imported; a guard that lives inside it can
// only ever be controlled by running the whole pipeline. Here, scripts/e2e.ts
// drives it with hand-built arrays and proves all four of its behaviours in
// milliseconds.

import { CHANNELS } from './channels';
import type { ChannelKey, MatchVideo, RawVideoRecord, SourceId } from '../types/index';

/** What a stale dump looks like, when it is one: the newest upload the dump
 *  holds, and the committed record that proves the dump predates it. */
export interface StaleEvidence {
  newestInDump: string;
  committedId: string;
  committedAt: string;
}

/** Every Replay.source token an intake can publish under. kingArena emits two. */
export function tokensOf(key: ChannelKey): SourceId[] {
  const cfg = CHANNELS.find((c) => c.id === key);
  if (!cfg) return [];
  return [cfg.source, cfg.eventSource].filter((t): t is SourceId => t !== undefined);
}

/** null when the dump is fresh (or cannot be judged); the evidence when it is
 *  provably stale. Judging is impossible, and must not be guessed at, when the
 *  dump is empty or the intake has nothing committed yet — a first run. */
export function staleEvidence(
  key: ChannelKey,
  dump: RawVideoRecord[],
  committed: MatchVideo[],
): StaleEvidence | null {
  let newestInDump = '';
  for (const r of dump) if (r.publishedAt > newestInDump) newestInDump = r.publishedAt;
  if (!newestInDump) return null; // empty dump: the caller already refuses that

  const tokens = new Set(tokensOf(key));
  let newest: MatchVideo | undefined;
  for (const v of committed) {
    if (!tokens.has(v.channel)) continue;
    if (!newest || v.publishedAt > newest.publishedAt) newest = v;
  }
  if (!newest) return null; // nothing committed for this intake yet
  if (newest.publishedAt <= newestInDump) return null;

  return { newestInDump, committedId: newest.id, committedAt: newest.publishedAt };
}

/** The refusal, as text. Kept beside the predicate so the two cannot drift. */
export function formatStaleRefusal(key: ChannelKey, e: StaleEvidence): string {
  return [
    `✖ raw/${key}.json is stale: the committed corpus holds an upload it cannot contain.`,
    ``,
    `  newest upload in the dump   ${e.newestInDump}`,
    `  newest committed record     ${e.committedAt}  ${e.committedId}`,
    ``,
    `  A dump cannot contain an upload published after it was taken, so parsing`,
    `  now would drop that record and every one like it — and the next run would`,
    `  treat the smaller archive as the new baseline.`,
    ``,
    `  Refresh first:  npm run data:catchup   (fetch and parse, always together)`,
    `  Or override:    npm run data:parse -- --allow-stale`,
  ].join('\n');
}

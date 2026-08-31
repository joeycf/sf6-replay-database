/**
 * THE MAINTENANCE RITUAL, AS ONE COMMAND.
 *
 * Run: npm run data:catchup [-- --no-extract] [-- --limit N]
 *
 * WHY THIS EXISTS. raw/ is gitignored, so it is local and the daily cron never
 * writes it — the cron fetches and parses remotely, in one process, and commits
 * the result. A local raw/ is therefore routinely OLDER than the committed
 * data/, and running `data:parse` on its own publishes whatever that stale dump
 * can reproduce and silently drops the rest.
 *
 * Measured here on 2026-08-30, before the guard existed: a bare parse against a
 * three-week-old raw/ wrote 22,909 records over a committed 23,234 and exited 0.
 * The 325 were only visible because someone compared the counts.
 *
 * The stale-raw guard in scripts/freshness.ts now refuses that run outright,
 * which is the half that stops the loss. This is the other half: there is no
 * longer a plausible reason to type `data:parse` alone, so the guard stays a
 * backstop rather than a thing you learn to override. Pairing fetch with parse
 * in one command is what makes the ordering unhittable by accident.
 *
 * WHAT IT WILL NOT DO. It never publishes a character nobody checked. Extraction
 * runs `--dry`: reads and frames are persisted for /dev/source-review and
 * data/overrides.json is left alone. Resolving a queued record stays a human
 * decision, because the extractor's own threshold is a prudence margin for
 * footage nobody has looked at, not a filter for known errors.
 *
 * It also does not run `data:theater`. That intake is local-first and
 * deliberately outside any cadence — a third party's uptime should not become a
 * dependency of the routine that keeps this corpus current.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MatchVideo, ReviewQueueItem } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const argv = process.argv.slice(2);
const NO_EXTRACT = argv.includes('--no-extract');
const LIMIT = argv[argv.indexOf('--limit') + 1];

/** Roughly what one video costs end to end — download, frame grab, read. Used
 *  only to print an ETA before a long run. */
const MINUTES_PER_VIDEO = 4;

const read = <T>(p: string): T => JSON.parse(readFileSync(join(DATA, p), 'utf8')) as T;

function step(label: string, cmd: string, args: string[]): void {
  console.log(`\n\x1b[1m── ${label}\x1b[0m`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    console.error(`\n✗ ${label} failed (exit ${r.status ?? 'signal'}) — stopping here.`);
    console.error('  Nothing downstream ran, so data/ is whatever the last good step left.');
    process.exit(r.status ?? 1);
  }
}

// ── 1 + 2: fetch THEN parse, always together ─────────────────────────────────
step('fetch — refresh raw/ from YouTube', 'npm', ['run', 'data:fetch']);
step('parse — rebuild the substrate and the queue', 'npm', ['run', 'data:parse']);

// ── 3: read footage for anything queued, without publishing it ───────────────
const queue = read<ReviewQueueItem[]>('review-queue.json');
const completion = queue.filter((q) => q.kind === 'character-completion');

if (NO_EXTRACT) {
  console.log(`\n── extract — SKIPPED (--no-extract); ${completion.length} record(s) queued`);
} else if (completion.length === 0) {
  console.log('\n── extract — nothing to do: no character-completion items are queued');
} else {
  const n = LIMIT ? Math.min(Number(LIMIT), completion.length) : completion.length;
  console.log(
    `\n── extract — ${completion.length} queued record(s)${LIMIT ? ` (limited to ${LIMIT})` : ''}, ` +
      `about ${((n * MINUTES_PER_VIDEO) / 60).toFixed(1)}h at ~${MINUTES_PER_VIDEO} min each.`,
  );
  console.log('   Local-only and resumable. Ctrl-C is safe: each video flushes as it finishes.');
  step('extract — read the HUD, persist reads, publish nothing', 'npm', [
    'run',
    'data:extract',
    '--',
    '--dry',
    ...(LIMIT ? ['--limit', LIMIT] : []),
  ]);
}

// ── 4: say exactly what is left, and what only a person can do ───────────────
const videos = read<MatchVideo[]>('videos.json');
const after = read<ReviewQueueItem[]>('review-queue.json');

console.log(`\n\x1b[1m════ what still needs you ════\x1b[0m`);
console.log(`  corpus        ${videos.length.toLocaleString('en-US')} records`);

if (after.length === 0) {
  console.log('  review queue  empty — nothing is waiting on a person');
} else {
  const oldest = Math.max(
    ...after.map((q) => Math.floor((Date.now() - Date.parse(q.publishedAt)) / 86_400_000)),
  );
  const kinds = new Map<string, number>();
  for (const q of after) kinds.set(q.kind, (kinds.get(q.kind) ?? 0) + 1);
  console.log(
    `  review queue  ${after.length} record(s) — NEVER published, needs a verdict` +
      `  ·  oldest ${oldest} day(s) old`,
  );
  console.log(`                ${[...kinds].map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  console.log('\n  → npm run dev, then /dev/source-review');
  console.log('    The reader supplies a candidate; the verdict is yours. Nothing');
  console.log('    here is auto-published.');
}

// Stage 2b: resolve `character-completion` review items by reading the footage.
//
// @EvoEvents states players, game and round in its titles but never a
// character, so parse.ts queues each match-shaped upload instead of counting it
// as a miss. This reads the two nameplates SF6 prints in the HUD's top corners
// in tournament mode and writes the same verdict shape a human would, tagged
// `resolvedBy: 'extractor'` with its confidence.
//
// AT OR ABOVE AUTO_ACCEPT it resolves; below, the item stays in the queue for
// /dev/source-review. Measured 81/81 exact against hand labels on the Evo
// corpus (scripts/spike/README.md) — but the threshold is a prudence margin for
// footage nobody has checked, not a filter for known errors, so the low-
// confidence path is the point rather than a formality.
//
// LOCAL ONLY, never in CI. It downloads one-second video windows, and datacenter
// IPs are routinely blocked (2XKO learned this the hard way and its daily Action
// never runs yt-dlp either). The cron queues; this resolves; the human arbitrates.
//
// Run: npm run data:extract -- [--limit N] [--ids a,b] [--dry] [--frames N]
//      then `npm run data:parse` to fold the verdicts into the substrate.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { grabFrames, pruneClips } from './hud-frames';
import {
  AUTO_ACCEPT,
  SIDES,
  foldSide,
  loadRoster,
  makeWorker,
  readFrame,
  samplePlan,
} from './hud-read';
import type { FrameRead, SideResult } from './hud-read';
import type { ReviewQueueItem, VideoOverride } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  return i === -1 ? undefined : argv[i + 1];
};
const onlyIds = flag('--ids')
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const limit = Number(flag('--limit') ?? 0);
const nFrames = Number(flag('--frames') ?? 9);
const dry = argv.includes('--dry');

const read = <T>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), 'utf8')) as T;

const queue = read<ReviewQueueItem[]>('data/review-queue.json').filter(
  (q) => q.kind === 'character-completion',
);
let work = onlyIds ? queue.filter((q) => onlyIds.includes(q.id)) : queue;
if (limit > 0) work = work.slice(0, limit);

if (!work.length) {
  console.log(
    `Nothing to do — ${queue.length} character-completion item(s) in the queue` +
      `${onlyIds ? ' (none matched --ids)' : ''}.`,
  );
  process.exit(0);
}

console.log(`${work.length} item(s) · ${nFrames} frames each · auto-accept ≥ ${AUTO_ACCEPT}`);

const roster = await loadRoster();
const worker = await makeWorker();
const overrides = read<Record<string, VideoOverride>>('data/overrides.json');

let resolved = 0;
let deferred = 0;

for (const [i, item] of work.entries()) {
  const frames = await grabFrames(item.id, samplePlan(item.durationSec, nFrames));
  const reads: Record<string, FrameRead[]> = { p1: [], p2: [] };
  for (const f of frames) {
    for (const side of SIDES) reads[side]!.push(await readFrame(worker, f, side, roster));
  }
  pruneClips(item.id);

  const p1 = foldSide(reads.p1!);
  const p2 = foldSide(reads.p2!);
  const confidence = Math.min(p1.confidence, p2.confidence);
  const ok = p1.characters.length > 0 && p2.characters.length > 0 && confidence >= AUTO_ACCEPT;

  const show = (s: SideResult) => `${s.characters.join('+') || '—'} ${s.confidence.toFixed(2)}`;
  console.log(
    `  [${i + 1}/${work.length}] ${item.id}  ${show(p1)}  vs  ${show(p2)}  → ` +
      `${ok ? 'RESOLVE' : 'review'}`,
  );

  if (!ok) {
    deferred++;
    continue;
  }
  resolved++;
  // The handles come from the QUEUE, not from the extractor: the title already
  // stated them, and parse.ts canonicalised them against players.json so a
  // verdict cannot mint a second page for an existing player.
  const handles = item.handles ?? ['', ''];
  overrides[item.id] = {
    ...overrides[item.id],
    '//': `character-completion: read from footage [data:extract ${new Date().toISOString().slice(0, 10)}]`,
    sides: [0, 1].map((n) => ({
      player: slug(handles[n]!),
      handle: handles[n]!.trim(),
      characters: (n === 0 ? p1 : p2).characters,
    })) as VideoOverride['sides'],
    resolvedBy: 'extractor',
    confidence,
  } as VideoOverride;
}

await worker.terminate();

if (!dry && resolved > 0) {
  writeFileSync(join(DATA, 'overrides.json'), serialize(overrides), 'utf8');
}
console.log(
  `\n✔ ${resolved} resolved${dry ? ' (DRY — nothing written)' : ' → data/overrides.json'}, ` +
    `${deferred} left for /dev/source-review.` +
    (resolved && !dry ? ' Next: npm run data:parse' : ''),
);

/** parse.ts's identity rule, restated (pipeline modules never enter the Nuxt graph). */
function slug(handle: string): string {
  return handle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** data/overrides.json stores non-ASCII escaped; writing it literally would
 *  reformat ~200 unrelated lines on every run. Same shape as the review POST. */
function serialize(value: unknown): string {
  return (
    JSON.stringify(value, null, 2).replace(
      /[\u0080-\uffff]/g,
      (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
    ) + '\n'
  );
}

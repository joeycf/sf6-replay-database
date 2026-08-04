// SPIKE A3: load the Evo corpus into data/review-queue.json as
// character-completion items, so /dev/source-review becomes the labelling tool.
//
// WRITES A COMMITTED FILE, DELIBERATELY LEFT UNCOMMITTED. The review UI's GET
// reads data/review-queue.json from the repo and its POST 404s any id that is
// not in that file, so a scratchpad copy cannot drive it. The file is currently
// "[]" and parse.ts regenerates it wholesale every run, so `git restore
// data/review-queue.json` (or any data:parse) puts it back.
//
// The VERDICTS a labelling session produces land in data/overrides.json, which
// is committed and carries 193 real entries. Snapshot them with
// scripts/spike/snapshot-labels.ts before restoring anything.
//
// Run: tsx scripts/spike/queue-evo.ts [--limit N] [--clear]

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = join(ROOT, 'data');
const CACHE = join(ROOT, 'cache', 'evo');

const argv = process.argv.slice(2);
const limit = Number(argv[argv.indexOf('--limit') + 1] ?? 0);
const clear = argv.includes('--clear');

const readJson = async <T>(p: string): Promise<T> => JSON.parse(await readFile(p, 'utf8')) as T;

if (clear) {
  await writeFile(join(DATA, 'review-queue.json'), '[]\n', 'utf8');
  console.log('✔ data/review-queue.json reset to []');
  process.exit(0);
}

interface CorpusItem {
  id: string;
  title: string;
  publishedAt: string;
  durationSec: number;
  event: string;
  round: string | null;
  handles: [string, string];
}
interface PlayerRecord {
  id: string;
  handle: string;
}

const corpus = await readJson<CorpusItem[]>(join(CACHE, 'corpus.json'));
const players = await readJson<PlayerRecord[]>(join(DATA, 'players.json'));

// ── player identity ──────────────────────────────────────────────────────────
// parse.ts keys player identity on the handle with ALL non-alphanumerics
// removed, so "MenaRD"/"Mena RD" and "EndingWalker"/"Ending Walker" collapse to
// one page (scripts/parse.ts, `idKey`). The review POST route does NOT do this
// — it slugs whatever handle the form contains — so a verdict typed with Evo's
// spelling can mint a SECOND page for a player the corpus already has. Fix it
// at the source: pre-fill the form with the corpus's own spelling whenever the
// key matches, and only fall back to Evo's when the player is genuinely new.
const idKey = (handle: string): string => handle.toLowerCase().replace(/[^a-z0-9]+/g, '');
const canonical = new Map<string, string>();
for (const p of players) canonical.set(idKey(p.handle), p.handle);

const resolved = (h: string): string => canonical.get(idKey(h)) ?? h;

let novel = 0;
const items = (limit > 0 ? corpus.slice(0, limit) : corpus).map((c) => {
  const handles: [string, string] = [resolved(c.handles[0]), resolved(c.handles[1])];
  for (const h of c.handles) if (!canonical.has(idKey(h))) novel++;
  return {
    id: c.id,
    kind: 'character-completion' as const,
    // Evo is not yet a ChannelKey — Part B adds it. The queue's channel field
    // only drives the source-classification token list, which a sides verdict
    // does not use, so the intake name is honest and harmless here.
    channel: 'evoEvents',
    title: c.title,
    publishedAt: c.publishedAt,
    durationSec: c.durationSec,
    handles,
  };
});

await writeFile(join(DATA, 'review-queue.json'), JSON.stringify(items, null, 2) + '\n', 'utf8');

const known = items.length * 2 - novel;
console.log(`✔ data/review-queue.json — ${items.length} character-completion items`);
console.log(
  `  handles: ${known}/${items.length * 2} matched an existing players.json identity, ${novel} new`,
);
console.log('  UNCOMMITTED ON PURPOSE — restore with: git restore data/review-queue.json');

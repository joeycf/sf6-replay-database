// SPIKE → REGRESSION TEST: is the side resolvable from the footage?
//
// THE DEFECT THIS MEASURES. `foldSide` reads characters by SCREEN position and
// the queue supplies handles in TITLE order, and complete-characters.ts glued
// those together positionally. Measured over this repo's own 81 labelled VODs,
// Evo's title names the LEFT player second on 10 of 78 decidable records
// (12.8%) — "Punk vs Big Bird" has Big Bird on the left, "Nemo vs Momochi" has
// Momochi. Every one of those would ship with the right characters attached to
// the wrong players, invisible to any confidence signal because the character
// reads are perfect.
//
// The 81 records already committed are NOT affected: every one was hand-paired
// by a reviewer against the footage. The defect was latent in the automated
// path, waiting for the first VOD it resolved.
//
// This file CALLS the production `resolveSide` rather than reimplementing it,
// so a passing score here is evidence about shipped code. (This repo already
// carries the opposite hazard elsewhere: parse.ts's `footageTitle` and
// spike/evo-corpus.ts's `parseEvoTitle` are two independent implementations of
// one algorithm, and neither tests the other.)
//
// Run: tsx scripts/spike/handle-probe.ts [--limit N]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CACHE } from '../hud-frames';
import { makeHandleWorker, resolveSide } from '../hud-read';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const limit = Number(process.argv[process.argv.indexOf('--limit') + 1] ?? 0);

const readJson = <T>(p: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  } catch {
    return fallback;
  }
};

interface CorpusItem {
  id: string;
  handles: [string, string];
}
interface Extraction {
  id: string;
  p1: { characters: string[] };
  p2: { characters: string[] };
}
interface Override {
  sides?: { handle: string; characters: string[] }[];
}

const corpus = readJson<CorpusItem[]>(join(CACHE, 'corpus.json'), []);
const extracted = readJson<Extraction[]>(join(CACHE, 'extracted.json'), []);
const overrides = readJson<Record<string, Override>>(join(ROOT, 'data/overrides.json'), {});
const extById = new Map(extracted.map((e) => [e.id, e]));

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const setKey = (xs: string[]) => [...new Set(xs)].sort().join(',');

const worker = await makeHandleWorker();

let decided = 0;
let correct = 0;
let undecided = 0;
let titleReversed = 0;
const wrong: string[] = [];

const work = limit > 0 ? corpus.slice(0, limit) : corpus;
for (const c of work) {
  const dir = join(CACHE, 'frames', c.id);
  if (!existsSync(dir)) continue;
  const ov = overrides[c.id];
  const ext = extById.get(c.id);
  if (!ov?.sides || ov.sides.length !== 2 || !ext) continue;

  // Ground truth for ORIENTATION, from the hand verdicts: which labelled side
  // owns the characters the extractor saw on the left? Mirrors carry no signal.
  if (setKey(ext.p1.characters) === setKey(ext.p2.characters)) continue;
  const leftSide = ov.sides.find((s) => setKey(s.characters) === setKey(ext.p1.characters));
  const rightSide = ov.sides.find((s) => setKey(s.characters) === setKey(ext.p2.characters));
  if (!leftSide || !rightSide || leftSide === rightSide) continue;
  const trueLeftIsFirst = norm(leftSide.handle) === norm(c.handles[0]);
  if (!trueLeftIsFirst && norm(leftSide.handle) !== norm(c.handles[1])) continue;
  if (!trueLeftIsFirst) titleReversed++;

  const frames = readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .sort()
    .map((f) => join(dir, f));

  const r = await resolveSide(worker, frames, c.handles);
  if (!r.decided) {
    undecided++;
    console.log(`  ? ${c.id}  undecided   ${c.handles.join(' vs ')}`);
    continue;
  }
  decided++;
  if (r.leftIsFirst === trueLeftIsFirst) correct++;
  else {
    wrong.push(c.id);
    console.log(`  ✖ ${c.id}  wrong side (votes ${r.votes})  ${c.handles.join(' vs ')}`);
  }
}

await worker.terminate();

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
const total = decided + undecided;
console.log('\n── resolving the side from the HUD handle ────────────────');
console.log(
  `  title order was REVERSED on   ${titleReversed}/${total}   ${pct(titleReversed, total)}`,
);
console.log(`  decided                       ${decided}/${total}   ${pct(decided, total)}`);
console.log(`  correct when decided          ${correct}/${decided}   ${pct(correct, decided)}`);
console.log(`  undecided (must NOT auto-accept) ${undecided}`);
if (wrong.length) console.log(`  wrong: ${wrong.join(', ')}`);

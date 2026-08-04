// SPIKE A5: score the extractor against the hand-labelled ground truth.
//
// Reads the SNAPSHOT (cache/evo/ground-truth.json), not data/overrides.json, so
// the measurement never depends on the working tree staying dirty.
//
// SCORING UNIT: the SET of characters a side played across the set. A label of
// [ed, elena] and a prediction of [elena, ed] agree — order is presentational
// (first-appearance), the claim is the set. The headline is BOTH-SIDES-EXACT:
// one wrong side is a wrong replay, so per-side accuracy flatters the thing
// that actually matters.
//
// The prediction is the union `foldSide` emits, read straight off
// extracted.json — this file no longer re-derives it, so the rule for what
// counts as played (a contiguous run of sampled frames) lives in exactly one
// place. Sides where a too-thin read was dropped are marked `shaky` by the
// fold, which halves their confidence and so costs them auto-accept.
//
// Run: tsx scripts/spike/accuracy.ts

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { CACHE } from '../hud-frames';
import type { Extraction } from './extract-chars';

interface Side {
  player: string;
  handle: string;
  characters: string[];
}
type Label = { sides: Side[]; note?: string; at: string };

const readJson = async <T>(p: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(p, 'utf8')) as T;
  } catch {
    return fallback;
  }
};

const truth = await readJson<Record<string, Label>>(join(CACHE, 'ground-truth.json'), {});
const extracted = await readJson<Extraction[]>(join(CACHE, 'extracted.json'), []);
const byId = new Map(extracted.map((e) => [e.id, e]));

const setKey = (xs: string[]) => [...new Set(xs)].sort().join(',');

const scored = Object.entries(truth)
  .filter(([id]) => byId.has(id))
  .map(([id, label]) => {
    const e = byId.get(id)!;
    return {
      id,
      event: e.event,
      want: [label.sides[0]!.characters ?? [], label.sides[1]!.characters ?? []] as [
        string[],
        string[],
      ],
      got: [e.p1.characters, e.p2.characters] as [string[], string[]],
      conf: [e.p1.confidence, e.p2.confidence] as [number, number],
      shaky: [e.p1.shaky, e.p2.shaky] as [boolean, boolean],
      dropped: [e.p1.dropped, e.p2.dropped] as [
        Extraction['p1']['dropped'],
        Extraction['p1']['dropped'],
      ],
    };
  });

if (!scored.length) {
  console.error(
    `✖ nothing to score — ${Object.keys(truth).length} labels, ${extracted.length} extractions, 0 overlap.\n` +
      '  Label some items at /dev/source-review, then run scripts/spike/snapshot-labels.ts.',
  );
  process.exit(1);
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
const sideOk = (s: (typeof scored)[number], i: 0 | 1) => setKey(s.got[i]) === setKey(s.want[i]);
const bothOk = (s: (typeof scored)[number]) => sideOk(s, 0) && sideOk(s, 1);

// ── headline ────────────────────────────────────────────────────────────────
const sideHits = scored.flatMap((s) => [sideOk(s, 0), sideOk(s, 1)]);
const bothHits = scored.filter(bothOk);

console.log(`\n── scored against ${scored.length} hand-labelled videos ──────────`);
console.log(
  `  both-sides-exact   ${String(bothHits.length).padStart(3)}/${scored.length}   ${pct(bothHits.length, scored.length)}`,
);
console.log(
  `  per-side           ${String(sideHits.filter(Boolean).length).padStart(3)}/${sideHits.length}   ${pct(sideHits.filter(Boolean).length, sideHits.length)}`,
);

// ── the multi-character subset, reported separately ─────────────────────────
// This is the population the union design exists for; it is the number that
// says whether the design earned its keep.
const multiScored = scored.filter((s) => s.want[0].length > 1 || s.want[1].length > 1);
const singleScored = scored.filter((s) => s.want[0].length === 1 && s.want[1].length === 1);
console.log('\n── by label shape ────────────────────────────────────────');
console.log(
  `  single-character sides   ${String(singleScored.filter(bothOk).length).padStart(3)}/${singleScored.length}   ${pct(singleScored.filter(bothOk).length, singleScored.length)}`,
);
console.log(
  `  a side played 2+         ${String(multiScored.filter(bothOk).length).padStart(3)}/${multiScored.length}   ${pct(multiScored.filter(bothOk).length, multiScored.length)}`,
);

// ── how the misses fail ─────────────────────────────────────────────────────
let missedChar = 0; // label has a character the union lacks
let extraChar = 0; // union has a character the label lacks
for (const s of scored) {
  for (const i of [0, 1] as const) {
    if (sideOk(s, i)) continue;
    const want = new Set(s.want[i]);
    const got = new Set(s.got[i]);
    if ([...want].some((c) => !got.has(c))) missedChar++;
    if ([...got].some((c) => !want.has(c))) extraChar++;
  }
}
console.log(
  `\n── the ${sideHits.filter((h) => !h).length} missed sides ────────────────────────────`,
);
console.log(`  missed a character the label has   ${missedChar}`);
console.log(`  invented one the label lacks       ${extraChar}`);
console.log(
  `  sides with a too-thin read dropped ${scored.filter((s) => s.shaky[0] || s.shaky[1]).length}`,
);

// ── the threshold curve ─────────────────────────────────────────────────────
console.log('\n── auto-accept threshold sweep ───────────────────────────');
console.log('  thresh   accepted   precision   corpus coverage');
let best: { t: number; coverage: number } | null = null;
const corpusUnion = extracted.map((e) => [e.p1.confidence, e.p2.confidence]);
for (const t of [0.01, 0.25, 0.5, 0.75, 0.9, 1.0]) {
  const accepted = scored.filter((s) => s.conf[0] >= t && s.conf[1] >= t);
  const correct = accepted.filter(bothOk);
  const precision = accepted.length ? correct.length / accepted.length : 1;
  const corpusAccepted = corpusUnion.filter((c) => c[0]! >= t && c[1]! >= t).length;
  console.log(
    `  ${t.toFixed(2)}     ${String(accepted.length).padStart(3)}/${scored.length}     ` +
      `${pct(correct.length, accepted.length).padStart(6)}      ${pct(corpusAccepted, extracted.length).padStart(6)} (${corpusAccepted}/${extracted.length})`,
  );
  if (precision >= 0.95 && (!best || corpusAccepted / extracted.length > best.coverage)) {
    best = { t, coverage: corpusAccepted / extracted.length };
  }
}
console.log(
  best
    ? `\n  ⇒ lowest threshold holding ≥95% precision: ${best.t.toFixed(2)} — ` +
        `${(100 * best.coverage).toFixed(1)}% of the corpus auto-resolves, the rest routes to review`
    : '\n  ⇒ NO threshold reaches 95% precision on this labelled set',
);

// ── cost ────────────────────────────────────────────────────────────────────
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const secs = extracted.map((e) => e.cost.sec);
const bytes = extracted.map((e) => e.cost.bytes);
console.log('\n── cost ──────────────────────────────────────────────────');
console.log(
  `  ${(sum(secs) / secs.length).toFixed(0)}s and ${(sum(bytes) / bytes.length / 1e6).toFixed(1)}MB per video` +
    ` · ${(sum(secs) / 60).toFixed(0)} min and ${(sum(bytes) / 1e9).toFixed(2)} GB for ${extracted.length}`,
);

// ── every disagreement, for eyeballing ──────────────────────────────────────
const misses = scored.filter((s) => !bothOk(s));
if (misses.length) {
  console.log(`\n── disagreements (${misses.length}) ────────────────────────────`);
  for (const s of misses) {
    for (const i of [0, 1] as const) {
      if (sideOk(s, i)) continue;
      console.log(
        `  ${s.id} p${i + 1}  want [${s.want[i].join(', ')}]  got [${s.got[i].join(', ')}]` +
          `  conf ${s.conf[i].toFixed(2)}${s.shaky[i] ? '  (thin read dropped)' : ''}`,
      );
    }
  }
}

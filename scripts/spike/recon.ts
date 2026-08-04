// SPIKE A2: frame recon — the gate that picks the reader.
//
// The original spec assumed SF6 renders both character names on the health bars
// and that OCR-ing that strip is the job. That is doubtful: SF6's in-match
// nameplate carries the PLAYER's name, and Evo runs its own broadcast overlay
// on top. So before any harness gets written, pull real frames spread across
// three VODs from three different Evo years and LOOK at them.
//
// Three years on purpose: Evo re-skins its overlay between events, so an
// extractor tuned on 2026 that silently fails on 2023 would only show up at
// the accuracy table. Better to meet that now.
//
// Run: tsx scripts/spike/recon.ts

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { CACHE, grabFrames, stamp } from '../hud-frames';

interface CorpusItem {
  id: string;
  title: string;
  durationSec: number;
  event: string;
  handles: [string, string];
}

const corpus = JSON.parse(await readFile(join(CACHE, 'corpus.json'), 'utf8')) as CorpusItem[];

// One grand final from each of three eras, chosen for overlay spread.
const PICKS = ['OrkgI7fa_Ag', 'idevgWCTI3U', 'G-Ay72dPL-E'];

// Spread wide, and deliberately include the first seconds: if character
// identity is only stated on a versus/loading screen, it lives near a game
// boundary, not at 20/40/60/80% of the runtime.
const FRACTIONS = [0.01, 0.04, 0.1, 0.2, 0.32, 0.45, 0.58, 0.7, 0.82, 0.93];

for (const id of PICKS) {
  const v = corpus.find((c) => c.id === id);
  if (!v) {
    console.error(`✖ ${id} not in corpus.json`);
    continue;
  }
  const secs = FRACTIONS.map((f) => Math.round(v.durationSec * f));
  console.log(`\n── ${v.event}: ${v.handles[0]} vs ${v.handles[1]} (${id}, ${v.durationSec}s)`);
  console.log(`   sampling ${secs.join(', ')}`);
  const t0 = Date.now();
  const got = await grabFrames(id, secs);
  console.log(
    `   ✔ ${got.length}/${secs.length} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  const missing = secs.filter((s) => !got.some((p) => p.endsWith(`${stamp(s)}.png`)));
  if (missing.length) console.log(`   ✖ missing: ${missing.join(', ')}`);
}

console.log(`\nFrames under ${join(CACHE, 'frames')}/<id>/`);

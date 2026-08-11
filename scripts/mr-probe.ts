// READ THE MASTER RATE OFF THE HUD — the same-footage signal this repo lacked.
//
// WHY. `replay-dupes.ts` groups records by a side-agnostic players+characters
// signature and then separates them by duration alone. 2XKO's copy of that
// scanner corroborates with a thumbnail dHash; this one has nothing, so its
// only evidence that two records are the same FOOTAGE is that their integer
// durations sit within a second of each other. That is weak in exactly the case
// that matters: two games of the same ranked set, between the same players on
// the same characters, routinely run within a second of each other — and the
// signature deliberately sorts the sides (so it catches re-uploads with the
// player names swapped), which means it also groups games where the sides
// genuinely swapped between rounds of a set.
//
// MR IS THE DISCRIMINATOR. Master Rate is re-scored after every ranked match,
// so two uploads of the SAME match carry the same MR pair, and two different
// matches between the same players cannot. It is a property of the footage, not
// of the upload, so it survives re-encoding, re-titling and channel branding —
// which is precisely what duration and thumbnails do not.
//
// Recon (2026-08-10, cluster 001 of the legacy tier-A set), against a verdict a
// human had already reached from the VS screens alone:
//   YxI9VMQw8ZI  fgcPlace  2024-05-04  ->  1815 / 1892
//   Y_HEh1-LNuM  fgcPlace  2024-05-21  ->  2036 / 2085
//   YwXCD0F_q0w  sfReplays 2024-05-21  ->  2036 / 2085
// The last two are the duplicate; the first is a different match. The scanner
// had proposed keeping the FIRST and dropping the other two — i.e. deleting a
// real match and keeping the odd one out.
//
// THE CROP WAS MEASURED, NOT ASSUMED (engine README, "Extraction conventions").
// The MR line sits under the health bars at y ~9.4% of frame height, left plate
// left-aligned from x ~1.8% and right plate from x ~93%. The boxes stop short of
// the PC/platform badge on the inner edge, the same way the character-nameplate
// crop in hud-read.ts stops short of the Capcom hexagon.
//
// MR IS NOT ON SCREEN BEFORE THE MATCH STARTS. Measured: nothing readable at
// 6s (intro/loading), clean reads at 14s, 25s and 40s. The probe therefore
// samples mid-early and retries at other offsets rather than trusting one.
//
//   npm run data:mr-probe                 probe every record in the tier-A set
//   npm run data:mr-probe -- --ids a,b,c  probe specific ids
//   npm run data:mr-probe -- --limit 40   stop after N records (recon runs)
//   npm run data:mr-probe -- --matched    second pass, see below

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { createWorker, type Worker } from 'tesseract.js';

import { grabFrame } from './hud-frames';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'cache', 'dupes');
const STORE = join(OUT, 'mr-probe.json');

/** Normalised [left, top, width, height], measured on 1280x720 frames. */
export const MR_REGIONS = {
  p1: [0.018, 0.094, 0.056, 0.028],
  p2: [0.93, 0.094, 0.056, 0.028],
} as const;

/** Sampled in this order until a frame yields both plates. Cheap-and-likely
 *  first, then deeper.
 *
 *  6s is deliberately absent: the match has not started and the HUD is not up.
 *  The DEEP offsets matter more than they look — the median record here is 626s
 *  because these uploads are compilations of a whole session, not single
 *  matches, so a record whose first minute is an intro, a replay or a menu is
 *  perfectly readable three minutes in. The first pass sampled only the opening
 *  62s and left 53 of 383 records undecided for that reason alone. */
const OFFSETS = [26, 40, 16, 62, 150, 300, 450, 210];
/** The glyphs are near-white over whatever stage the match is on, so the one
 *  threshold that separates them moves with the background — same finding as
 *  the nameplate reader, same remedy. */
const THRESHOLDS = [140, 170, 200];
const UPSCALE = 6;

export interface MrRead {
  p1: string | null;
  p2: string | null;
  /** votes for the winning value, out of THRESHOLDS.length, per side */
  votes: [number, number];
  at: number | null;
  decided: boolean;
}

async function prep(file: string, region: readonly number[], th: number): Promise<Buffer> {
  const m = await sharp(file).metadata();
  const W = m.width ?? 1280;
  const H = m.height ?? 720;
  return sharp(file)
    .extract({
      left: Math.round(region[0]! * W),
      top: Math.round(region[1]! * H),
      width: Math.round(region[2]! * W),
      height: Math.round(region[3]! * H),
    })
    .resize({ width: Math.round(region[2]! * W * UPSCALE), kernel: 'lanczos3' })
    .greyscale()
    .threshold(th)
    .negate()
    .png()
    .toBuffer();
}

const winner = (votes: string[]): { value: string | null; n: number } => {
  const tally: Record<string, number> = {};
  for (const v of votes) tally[v] = (tally[v] ?? 0) + 1;
  const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  return best ? { value: best[0], n: best[1] } : { value: null, n: 0 };
};

async function readFrame(worker: Worker, file: string): Promise<Omit<MrRead, 'at' | 'decided'>> {
  const out: Record<'p1' | 'p2', string[]> = { p1: [], p2: [] };
  for (const side of ['p1', 'p2'] as const) {
    for (const th of THRESHOLDS) {
      const { data } = await worker.recognize(await prep(file, MR_REGIONS[side], th));
      const t = data.text.replace(/\s+/g, '');
      // EXACTLY four digits, in range. MR exists only at Master and above, which
      // starts at 1500, so it is always four digits — and accepting three lets a
      // clipped glyph through as a confident answer. Caught in the smoke test:
      // a leading "2" cropped off 2036 and "036" won a majority vote.
      const n = t.match(/(\d{4})MR/)?.[1] ?? t.match(/(\d{4})/)?.[1];
      if (n && Number(n) >= 1000 && Number(n) <= 4000) out[side].push(n);
    }
  }
  const a = winner(out.p1);
  const b = winner(out.p2);
  return { p1: a.value, p2: b.value, votes: [a.n, b.n] };
}

/** Probe one record. A read counts as DECIDED only when both plates were read
 *  and each won a strict majority of its threshold passes — the `decided` gate
 *  from the engine's extraction contract: an undecided side is a coin-flip
 *  dressed as a verdict, and it must never auto-accept. */
export async function probeRecord(worker: Worker, id: string): Promise<MrRead> {
  const need = Math.floor(THRESHOLDS.length / 2) + 1;
  let best: MrRead = { p1: null, p2: null, votes: [0, 0], at: null, decided: false };
  for (const sec of OFFSETS) {
    const frame = await grabFrame(id, sec);
    if (!frame) continue;
    const r = await readFrame(worker, frame);
    const decided = !!r.p1 && !!r.p2 && r.votes[0] >= need && r.votes[1] >= need;
    if (decided) return { ...r, at: sec, decided: true };
    if ((r.p1 ? 1 : 0) + (r.p2 ? 1 : 0) > (best.p1 ? 1 : 0) + (best.p2 ? 1 : 0))
      best = { ...r, at: sec, decided: false };
  }
  return best;
}

/** THE SECOND PASS (`--matched`).
 *
 *  The first pass stops at whichever offset first yields a decided read, so two
 *  records of one cluster are often read at different points of the video. For a
 *  session compilation that is not a fair comparison: MR changes match to match,
 *  so a difference between 26s of one record and 40s of another proves nothing.
 *
 *  This pass re-reads every member of an affected cluster on ONE COMMON
 *  schedule and unions the results, so `mr-verdicts.ts` can compare sets. Sets
 *  rather than single values because two uploads of one session may carry
 *  different lead-ins — "same value at the same wall-clock second" is too strict
 *  a test for sameness, while "the sets intersect" is exactly right.
 *
 *  Only clusters that currently look DIFFERENT with MIXED offsets are re-read:
 *  agreement is already hard to fake, and a cluster read wholly at one offset is
 *  already a fair comparison. Measured: 50 such clusters, all 50 held as
 *  different — the confound was real to worry about and absent in fact. */
const COMMON_SCHEDULE = [45, 150, 300];

async function matchedPass(worker: Worker): Promise<void> {
  const clustersPath = join(OUT, 'review-clusters.json');
  const store: Record<string, MrRead> = existsSync(STORE)
    ? (JSON.parse(readFileSync(STORE, 'utf8')) as Record<string, MrRead>)
    : {};
  const clusters = JSON.parse(readFileSync(clustersPath, 'utf8')) as {
    n: number;
    ids: string[];
    members: { id: string; durationSec: number }[];
  }[];
  const outPath = join(OUT, 'mr-matched.json');
  const out: Record<string, Record<string, string[]>> = existsSync(outPath)
    ? (JSON.parse(readFileSync(outPath, 'utf8')) as Record<string, Record<string, string[]>>)
    : {};

  const pairOf = (id: string) => (store[id]?.decided ? `${store[id]!.p1}/${store[id]!.p2}` : null);
  const targets = clusters.filter((c) => {
    if (!c.ids.every((id) => pairOf(id))) return false;
    if (new Set(c.ids.map(pairOf)).size === 1) return false;
    return new Set(c.ids.map((id) => store[id]!.at)).size > 1;
  });

  console.log(`matched pass — ${targets.length} mixed-offset clusters\n`);
  let held = 0;
  let flipped = 0;
  for (const [i, c] of targets.entries()) {
    if (out[String(c.n)]) continue;
    const dur = Math.min(...c.members.map((m) => m.durationSec));
    const offs = COMMON_SCHEDULE.filter((s) => s < dur - 20);
    const sets: Record<string, string[]> = {};
    for (const id of c.ids) {
      const s = new Set<string>();
      const seed = pairOf(id);
      if (seed) s.add(seed);
      for (const sec of offs) {
        const frame = await grabFrame(id, sec);
        if (!frame) continue;
        const r = await readFrame(worker, frame);
        const need = Math.floor(THRESHOLDS.length / 2) + 1;
        if (r.p1 && r.p2 && r.votes[0] >= need && r.votes[1] >= need) s.add(`${r.p1}/${r.p2}`);
      }
      sets[id] = [...s];
    }
    out[String(c.n)] = sets;
    const arrs = c.ids.map((id) => sets[id]!);
    const shared = arrs[0]!.filter((v) => arrs.every((a) => a.includes(v)));
    if (shared.length) flipped++;
    else held++;
    console.log(
      `  [${i + 1}/${targets.length}] #${String(c.n).padStart(3)} ${shared.length ? 'FLIPS -> duplicate' : 'holds: different'}`,
    );
    if ((i + 1) % 6 === 0) writeFileSync(outPath, JSON.stringify(out, null, 2));
  }
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nheld-different ${held} · flipped to duplicate ${flipped}`);
  console.log(`→ ${outPath}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n: string) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  if (argv.includes('--matched')) {
    const w = await createWorker('eng');
    await w.setParameters({
      tessedit_char_whitelist: '0123456789MR',
      tessedit_pageseg_mode: '7' as never,
    });
    await matchedPass(w);
    await w.terminate();
    return;
  }

  mkdirSync(OUT, { recursive: true });
  const store: Record<string, MrRead> = existsSync(STORE)
    ? (JSON.parse(readFileSync(STORE, 'utf8')) as Record<string, MrRead>)
    : {};

  let ids: string[];
  const explicit = arg('--ids');
  if (explicit) {
    ids = explicit.split(',').map((s) => s.trim());
  } else {
    const clustersPath = join(OUT, 'review-clusters.json');
    if (!existsSync(clustersPath)) {
      console.error('✖ cache/dupes/review-clusters.json missing — run data:replay-dupes first.');
      process.exit(1);
    }
    const clusters = JSON.parse(readFileSync(clustersPath, 'utf8')) as { ids: string[] }[];
    ids = [...new Set(clusters.flatMap((c) => c.ids))];
  }

  // Resumable: a decided read is never re-probed. This run costs one video
  // download per record, so losing progress to a crash is expensive.
  const todo = ids.filter((id) => !store[id]?.decided);
  const limit = Number(arg('--limit')) || todo.length;
  const work = todo.slice(0, limit);

  console.log(
    `MR probe — ${ids.length} records, ${todo.length} outstanding, probing ${work.length}`,
  );
  console.log(`  regions p1 ${JSON.stringify(MR_REGIONS.p1)}  p2 ${JSON.stringify(MR_REGIONS.p2)}`);
  console.log(`  offsets ${OFFSETS.join('s, ')}s · thresholds ${THRESHOLDS.join('/')}\n`);

  const worker = await createWorker('eng');
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789MR',
    tessedit_pageseg_mode: '7' as never,
  });

  let decided = 0;
  for (const [i, id] of work.entries()) {
    const r = await probeRecord(worker, id);
    store[id] = r;
    if (r.decided) decided++;
    console.log(
      `  [${String(i + 1).padStart(3)}/${work.length}] ${id}  ` +
        (r.decided
          ? `${r.p1} / ${r.p2}  @${r.at}s`
          : `UNDECIDED (${r.p1 ?? '—'} / ${r.p2 ?? '—'})`),
    );
    if ((i + 1) % 10 === 0) writeFileSync(STORE, JSON.stringify(store, null, 2));
  }
  writeFileSync(STORE, JSON.stringify(store, null, 2));
  await worker.terminate();

  console.log(
    `\ndecided ${decided}/${work.length} this run · store now ${Object.keys(store).length}`,
  );
  console.log(`→ ${STORE}`);
}

// Run ONLY when invoked directly. This file also exports MR_REGIONS and
// probeRecord, and a bare `main()` here meant that merely importing either one
// launched a full 383-record probe as a side effect — which is exactly what
// happened the first time the validator imported the crop constants.
if (process.argv[1] && /mr-probe\.ts$/.test(process.argv[1])) main();

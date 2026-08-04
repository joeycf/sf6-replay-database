// SPIKE: read the two character nameplates off one SF6 tournament frame.
//
// WHAT THE RECON FOUND (cache/evo/frames, Evo 2023 / France 2025 / 2026):
// SF6 in offline/tournament mode puts the CHARACTER name — not the player's
// CFN handle — in the top corners, left-aligned from x≈11 and right-aligned to
// x≈1270 at 720p, with "Player 1"/"Player 2" beneath. The layout is byte-stable
// across all three Evo years sampled, which is what makes a fixed crop viable.
//
// WHY OCR AND NOT TEMPLATE MATCHING (the 2XKO fuses.ts approach): templates
// need at least one labelled example per class, and 81 VODs do not cover all 31
// characters — the tail (Ingrid, Yasmine, Alex, Elena…) would be permanently
// unidentifiable, and so would any character Capcom ships after the templates
// were built. OCR reads a name it has never seen and hands it to the alias
// table that already exists in data/characters.json.
//
// WHY AN ENSEMBLE OF THRESHOLDS: the glyphs are near-white over the character's
// own animated splash art, so the one threshold that separates them moves with
// the background. Measured on the recon frames, no single threshold read all
// eight nameplates, but every nameplate was read correctly by at least one —
// so read at several, match each, and vote. Tesseract's own confidence number
// is NOT usable as the signal here (it returned 0 on a perfectly correct
// "LUKE" and 95 on a wrong "AYU"); agreement and edit distance are.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import sharp from 'sharp';
import { createWorker, type Worker } from 'tesseract.js';

import { buildAliasMatcher, loadCharacters } from './roster';
import { CACHE } from './hud-frames';

export const REGIONS = {
  p1: [0.0016, 0.0167, 0.1, 0.0361],
  p2: [0.8984, 0.0167, 0.1, 0.0361],
} as const;

export type Side = keyof typeof REGIONS;
export const SIDES: Side[] = ['p1', 'p2'];

const THRESHOLDS = [170, 190, 210, 230];
const UPSCALE = 4;

/** Crop one nameplate and reduce it to black glyphs on white. The box stops
 *  short of the SF6 HUD's Capcom hexagon badge — a glyph-shaped "C" at a fixed
 *  offset that otherwise lands in every read as "C BLANKA" / "KEN C". */
async function prep(file: string, region: readonly number[], threshold: number): Promise<Buffer> {
  const meta = await sharp(file).metadata();
  const W = meta.width ?? 1280;
  const H = meta.height ?? 720;
  return sharp(file)
    .extract({
      left: Math.round(region[0]! * W),
      top: Math.round(region[1]! * H),
      width: Math.round(region[2]! * W),
      height: Math.round(region[3]! * H),
    })
    .resize({ width: Math.round(region[2]! * W * UPSCALE), kernel: 'lanczos3' })
    .greyscale()
    .threshold(threshold)
    .negate()
    .png()
    .toBuffer();
}

// ── fuzzy alias matching ─────────────────────────────────────────────────────
/** Optimal string alignment distance (Damerau without unrestricted transposes),
 *  the same measure 2XKO's parse.ts uses for its low-confidence champion pass. */
function osa(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2]! + 1);
      }
      cur[j] = v;
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[n]!;
}

export interface Roster {
  /** alias (lowercased) → character id */
  aliases: { alias: string; id: string }[];
  exact: (text: string) => string | null;
  ids: Set<string>;
}

export async function loadRoster(): Promise<Roster> {
  const characters = await loadCharacters();
  const matcher = buildAliasMatcher(characters);
  const aliases = characters.flatMap((c) =>
    (c.extra?.aliases ?? [c.name.toLowerCase()]).map((alias) => ({ alias, id: c.id })),
  );
  return { aliases, exact: (t) => matcher.one(t), ids: new Set(characters.map((c) => c.id)) };
}

export interface Match {
  id: string;
  /** 0 = exact alias hit; higher = looser fuzzy hit */
  dist: number;
}

/** Resolve one OCR string to a roster id. Exact alias first (the existing
 *  longest-alias-first matcher), then edit distance with a length-scaled budget
 *  — a 2-letter read like "ED" gets no slack, "M. BISON" gets three. */
export function matchRead(raw: string, roster: Roster): Match | null {
  const text = raw
    .toLowerCase()
    .replace(/[^a-z. -]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 2) return null;

  const hit = roster.exact(text);
  if (hit) return { id: hit, dist: 0 };

  // Length-scaled edit budget — but a 2-character target gets NO slack. "Ed"
  // and "JP" are the shortest names on the roster, and at distance 1 literally
  // any two-letter OCR artefact matches one of them ("EB", "ET", "ER", "JR"…).
  // Measured: 3 of the 4 single-frame phantom characters in the first corpus
  // pass were `ed`, on videos whose real character was read 6-7 times. Short
  // names are noise magnets, so they must be read exactly or not at all.
  const budget = text.length <= 2 ? 0 : text.length <= 3 ? 1 : text.length <= 6 ? 2 : 3;
  let best: Match | null = null;
  let runnerUp = Infinity;
  for (const { alias, id } of roster.aliases) {
    const d = osa(text, alias);
    if (d < (best?.dist ?? Infinity)) {
      if (best && best.id !== id) runnerUp = best.dist;
      best = { id, dist: d };
    } else if (d < runnerUp && best && id !== best.id) {
      runnerUp = d;
    }
  }
  if (!best || best.dist > budget) return null;
  // an ambiguous read (two roster names equally close) is worse than no read
  if (runnerUp === best.dist) return null;
  return best;
}

// ── per-frame read ───────────────────────────────────────────────────────────
export interface FrameRead {
  frame: string;
  side: Side;
  /** winning id across the threshold ensemble, or null when nothing matched */
  id: string | null;
  /** how many of the thresholds agreed on it */
  votes: number;
  of: number;
  /** best (lowest) edit distance among the agreeing reads */
  dist: number;
  /** raw OCR strings, kept for the failure report */
  raw: string[];
}

export async function readFrame(
  worker: Worker,
  file: string,
  side: Side,
  roster: Roster,
): Promise<FrameRead> {
  const raw: string[] = [];
  const tally = new Map<string, { votes: number; dist: number }>();
  for (const th of THRESHOLDS) {
    const png = await prep(file, REGIONS[side], th);
    const { data } = await worker.recognize(png);
    const text = data.text.replace(/\s+/g, ' ').trim();
    raw.push(text);
    const m = matchRead(text, roster);
    if (!m) continue;
    const cur = tally.get(m.id);
    if (cur) {
      cur.votes++;
      cur.dist = Math.min(cur.dist, m.dist);
    } else {
      tally.set(m.id, { votes: 1, dist: m.dist });
    }
  }
  let id: string | null = null;
  let votes = 0;
  let dist = 99;
  for (const [k, v] of tally) {
    if (v.votes > votes || (v.votes === votes && v.dist < dist)) {
      id = k;
      votes = v.votes;
      dist = v.dist;
    }
  }
  return { frame: file, side, id, votes, of: THRESHOLDS.length, dist, raw };
}

// ── per-video fold ───────────────────────────────────────────────────────────
export interface Member {
  char: string;
  /** frames that read it */
  frames: number;
  /** longest run of CONSECUTIVE sampled frames that read it */
  run: number;
  /** index of the first frame that read it — the ordering key */
  firstAt: number;
  /** mean edit distance of those reads (0 = exact alias hits) */
  dist: number;
  confidence: number;
}

export interface SideResult {
  /** every character this side played, first-appearance order. The record holds
   *  what the footage holds: a set VOD is several games and a player may
   *  counter-pick between them. A 1v1 match is simply the length-1 case. */
  characters: string[];
  confidence: number;
  members: Member[];
  /** reads rejected as too thin to be evidence, kept so they stay visible */
  dropped: { char: string; frames: number }[];
  /** frames that produced a usable read */
  read: number;
  /** frames sampled */
  sampled: number;
  /** something was dropped — the side is not trusted even if what remains is */
  shaky: boolean;
}

/** A member needs a run of at least this many CONSECUTIVE sampled frames. */
const MIN_RUN = 2;

/** Sides at or above this auto-resolve; below it a human confirms.
 *
 *  Locked at 0.90 from the measured curve over all 81 hand-labelled Evo VODs
 *  (2026-08-04). On that corpus the extractor scored 81/81 both-sides-exact, so
 *  precision is 100% at EVERY threshold and this number cannot be tuned against
 *  known errors — it is a prudence margin for unseen footage, not a filter for
 *  observed ones. 0.90 was the knee while errors still existed (98.7% precision
 *  vs 97.5% at 0.75) and it costs only 2 videos of review across the corpus;
 *  1.00 would send 11 for no measured gain.
 *
 *  What it CANNOT do: rescue a confidently-wrong read. The worst error of the
 *  first pass sat at confidence 1.00, and no threshold would have caught it —
 *  that one was fixed at the reader (a missing alias), not the gate. */
export const AUTO_ACCEPT = 0.9;

/** Fold one side's frame reads (in timestamp order) into an ordered union.
 *
 *  CONTIGUITY, NOT SHARE. The obvious agreement metric — a character's share of
 *  the frames that read anything — is actively wrong for a union: on a set where
 *  a player went Ed then DeeJay, a correct `ed` holds only 2 of 7 reading frames
 *  and would score 0.29. What actually separates a real game segment from a
 *  misread is that the segment is CONSECUTIVE: real play occupies a contiguous
 *  stretch of the timeline, noise is isolated.
 *
 *    member_c = min(1, run_c / MIN_RUN) × (1 - meanDist_c / 3)
 *    coverage = min(1, read / 4)      ← a side legible in 2 of 9 frames is a
 *                                       guess however unanimous those 2 were
 *    side     = min over members × coverage
 *
 *  `min` over members, not mean: a union is only as trustworthy as its weakest
 *  character. There is deliberately no forced-zero rule any more — a detected
 *  character change is now representable, so it is data rather than a defect. */
export function foldSide(reads: FrameRead[]): SideResult {
  const sampled = reads.length;
  const usable = reads.filter((r) => r.id);

  const tally = new Map<string, { frames: number; dist: number[]; firstAt: number; run: number }>();
  let prev: string | null = null;
  let runLen = 0;
  for (const [i, r] of reads.entries()) {
    // A blank frame is NEUTRAL — absence of evidence, not evidence of absence —
    // so it must not break a run. Tournament VODs cut to crowd shots, replays
    // and player cams constantly, and those frames read nothing. Counting them
    // as breaks cost a real character on tc63r5L5K3M, whose p2 sequence reads
    // "· ed · ed · deejay deejay deejay deejay": Fuudo plainly played Ed then
    // switched, but the single blank between the two Ed frames split them into
    // two runs of 1 and the union dropped Ed entirely. Runs are therefore
    // measured over the subsequence of frames that read SOMETHING.
    if (!r.id) continue;
    runLen = r.id === prev ? runLen + 1 : 1;
    prev = r.id;
    const t = tally.get(r.id) ?? { frames: 0, dist: [], firstAt: i, run: 0 };
    t.frames++;
    t.dist.push(r.dist);
    t.run = Math.max(t.run, runLen);
    tally.set(r.id, t);
  }

  const coverage = Math.min(1, usable.length / 4);
  const all = [...tally.entries()]
    .map(([char, t]) => {
      const dist = t.dist.reduce((a, b) => a + b, 0) / t.dist.length;
      return {
        char,
        frames: t.frames,
        run: t.run,
        firstAt: t.firstAt,
        dist: Number(dist.toFixed(2)),
        confidence: Number((Math.min(1, t.run / MIN_RUN) * Math.max(0, 1 - dist / 3)).toFixed(3)),
      };
    })
    .sort((a, b) => a.firstAt - b.firstAt);

  const members = all.filter((m) => m.run >= MIN_RUN);
  const dropped = all
    .filter((m) => m.run < MIN_RUN)
    .map((m) => ({ char: m.char, frames: m.frames }));

  const confidence = members.length
    ? Number((Math.min(...members.map((m) => m.confidence)) * coverage).toFixed(3))
    : 0;

  return {
    characters: members.map((m) => m.char),
    confidence: dropped.length ? Number((confidence / 2).toFixed(3)) : confidence,
    members,
    dropped,
    read: usable.length,
    sampled,
    shaky: dropped.length > 0,
  };
}

export async function makeWorker(): Promise<Worker> {
  // logger/errorHandler silence tesseract.js's progress chatter; debug_file
  // silences the engine's own per-call statistics dump ("SD= 0.00 / Bottom=…"),
  // which it prints for every blank crop — i.e. for every non-gameplay frame,
  // which is a large share of a tournament VOD.
  // cachePath keeps the ~20MB eng.traineddata inside the gitignored spike cache
  // instead of tesseract.js's default, which is the process cwd — i.e. the repo
  // root, where it shows up as a stray untracked file.
  const worker = await createWorker('eng', undefined, {
    logger: () => {},
    errorHandler: () => {},
    cachePath: CACHE,
  });
  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.- ',
    tessedit_pageseg_mode: '7' as never, // single text line
    debug_file: '/dev/null',
  });
  return worker;
}

/** Sampling plan for a match VOD. Deliberately not the spec's flat
 *  20/40/60/80%: a bracket set is several games plus walk-ons, replays and
 *  crowd cuts, so spread wider and take more of them — non-gameplay frames
 *  simply read as nothing and cost only their share of the vote. */
export function samplePlan(durationSec: number, n = 9): number[] {
  const lo = 0.08;
  const hi = 0.94;
  return Array.from({ length: n }, (_, i) =>
    Math.round(durationSec * (lo + ((hi - lo) * i) / (n - 1))),
  );
}

export const readJson = async <T>(p: string): Promise<T> =>
  JSON.parse(await readFile(p, 'utf8')) as T;
export { join };

// SPIKE A2b: does OCR actually read the SF6 tournament nameplate?
//
// The recon established WHERE the character name is (top-left / top-right
// corners, identical across Evo 2023/2025/2026, fixed all-caps HUD font,
// left-aligned from x≈11 and right-aligned to x≈1270 at 720p). This probe
// establishes WHETHER it can be read, and with which preprocessing.
//
// The glyphs are near-white with a dark outline over a VARYING background (the
// character's own splash art, animated). So the preprocessing that matters is
// the one that throws the background away: threshold hard on luminance, keep
// only the near-white pixels, invert to black-on-white for tesseract.
//
// Run: tsx scripts/spike/ocr-probe.ts

import { join } from 'node:path';

import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

import { CACHE } from '../hud-frames';

// Normalized [x, y, w, h] — resolution-independent, same convention as
// 2xko-replay-database/data/fuse-regions.json.
//
// Measured off real frames at 720p: the name is left-aligned from x≈11 on P1
// and right-aligned to x≈1270 on P2, both spanning y≈19-31. The boxes stop
// short of x≈139 / start after x≈1142 to keep the SF6 HUD's Capcom hexagon
// badge OUT — it is a glyph-shaped "C" at a fixed offset beside each nameplate,
// and including it makes tesseract read "C BLANKA" / "KEN C" every single time.
export const REGIONS = {
  p1: [0.0016, 0.0167, 0.1, 0.0361],
  p2: [0.8984, 0.0167, 0.1, 0.0361],
} as const;

const UPSCALE = 4;

/** Crop one nameplate and reduce it to black glyphs on white. */
export async function prep(
  file: string,
  region: readonly number[],
  threshold: number,
): Promise<Buffer> {
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
    .negate() // tesseract wants dark text on light
    .png()
    .toBuffer();
}

const worker = await createWorker('eng');
await worker.setParameters({
  tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.- ',
  tessedit_pageseg_mode: '7' as never, // single text line
});

const SAMPLES: { id: string; frame: string; truth: [string, string] }[] = [
  { id: 'G-Ay72dPL-E', frame: '000340', truth: ['M. BISON', 'BLANKA'] },
  { id: 'OrkgI7fa_Ag', frame: '000628', truth: ['KEN', 'LUKE'] },
  { id: 'OrkgI7fa_Ag', frame: '000977', truth: ['KEN', 'BLANKA'] },
  { id: 'idevgWCTI3U', frame: '000475', truth: ['ED', 'RYU'] },
];

const letters = (s: string) => s.replace(/[^A-Z]/g, '');

console.log('threshold sweep — expected → ocr read\n');
for (const th of [140, 170, 190, 210, 230]) {
  let hits = 0;
  let total = 0;
  const lines: string[] = [];
  for (const s of SAMPLES) {
    for (const [i, side] of (['p1', 'p2'] as const).entries()) {
      const png = await prep(join(CACHE, 'frames', s.id, `${s.frame}.png`), REGIONS[side], th);
      const { data } = await worker.recognize(png);
      const read = data.text.replace(/\s+/g, ' ').trim();
      const want = s.truth[i]!;
      const ok = letters(read) === letters(want);
      if (ok) hits++;
      total++;
      lines.push(
        `    ${ok ? '✔' : '✖'} ${want.padEnd(10)} → "${read}"  (conf ${Math.round(data.confidence)})`,
      );
    }
  }
  console.log(`  threshold ${th}: ${hits}/${total}`);
  for (const l of lines) console.log(l);
  console.log('');
}

await worker.terminate();

// Leave two preprocessed crops on disk to eyeball.
await sharp(await prep(join(CACHE, 'frames', 'G-Ay72dPL-E', '000340.png'), REGIONS.p1, 190)).toFile(
  join(CACHE, 'crops', 'prep-p1-190.png'),
);
await sharp(await prep(join(CACHE, 'frames', 'idevgWCTI3U', '000475.png'), REGIONS.p2, 190)).toFile(
  join(CACHE, 'crops', 'prep-p2-190.png'),
);
console.log('wrote cache/evo/crops/prep-p{1,2}-190.png');

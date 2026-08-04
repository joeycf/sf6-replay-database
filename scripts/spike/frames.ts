// SPIKE: download tiny sections of a YouTube VOD and cut one PNG from each.
//
// Ported from 2xko-replay-database/scripts/fuses.ts `ensureFrames`, keeping the
// parts of it that were learned the hard way there:
//   · --js-runtimes node — YouTube's n-challenge needs yt-dlp's EJS solver and
//     only Deno is enabled by default; this host solves via its own Node.
//   · SSL_CERT_FILE — the static ffmpeg build that serves --download-sections
//     has no CA bundle of its own and exits 251 without it.
//   · sleep after EVERY attempt, failures included. 2XKO's comment: a backlog
//     that retried instantly "fed the throttle spiral that produced the
//     'unavailable' pile in the first place".
//   · bot-check stderr → exit 2, so a dead session aborts loudly instead of
//     grinding through the corpus turning every video into a silent failure.
//
// Unlike 2XKO (which pulls one contiguous 0-12s clip) this samples SEPARATE
// one-second windows spread across the match, because what identifies an SF6
// character on screen is not guaranteed to sit in the first 12 seconds.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE = join(ROOT, 'cache', 'evo');
const COOKIES = process.env.EVO_COOKIES ?? join(CACHE, 'cookies.txt');

// static ffmpeg TLS (see header)
if (!process.env.SSL_CERT_FILE) process.env.SSL_CERT_FILE = '/etc/ssl/certs/ca-certificates.crt';

const SLEEP_MIN = Number(process.env.EVO_SLEEP_MIN ?? 1);
const SLEEP_MAX = Number(process.env.EVO_SLEEP_MAX ?? 3);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cookieArgs = (): string[] => (existsSync(COOKIES) ? ['--cookies', COOKIES] : []);

/** Seconds → the "07m03s"-ish label used in filenames and logs. */
export const stamp = (sec: number): string => String(Math.round(sec)).padStart(6, '0');

/** Download one ~1s window and cut a single PNG. Returns the PNG path, or null
 *  when the download or the cut failed (caller records and moves on). */
export async function grabFrame(id: string, sec: number): Promise<string | null> {
  const dir = join(CACHE, 'frames', id);
  const png = join(dir, `${stamp(sec)}.png`);
  if (existsSync(png)) return png;

  mkdirSync(dir, { recursive: true });
  const clipDir = join(CACHE, 'clips', id);
  mkdirSync(clipDir, { recursive: true });
  const clipStem = join(clipDir, stamp(sec));

  let clip = readdirSync(clipDir)
    .filter((f) => f.startsWith(`${stamp(sec)}.`))
    .map((f) => join(clipDir, f))[0];

  if (!clip) {
    const r = spawnSync(
      'yt-dlp',
      [
        ...cookieArgs(),
        '--js-runtimes',
        'node',
        '--quiet',
        '--no-warnings',
        '--download-sections',
        `*${Math.max(0, Math.floor(sec))}-${Math.max(1, Math.floor(sec) + 1)}`,
        '-f',
        'bv*[height<=720]/bv*',
        '-o',
        `${clipStem}.%(ext)s`,
        `https://www.youtube.com/watch?v=${id}`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], env: process.env, timeout: 180_000 },
    );
    // pace EVERY attempt, failures included
    await sleep((SLEEP_MIN + Math.random() * (SLEEP_MAX - SLEEP_MIN)) * 1000);

    if (r.status !== 0) {
      const err = String(r.stderr ?? '').slice(0, 400);
      if (/confirm you.re not a bot|sign in to confirm/i.test(err)) {
        console.error(
          '\n✖ YouTube bot-check hit — the session cookies are stale.\n' +
            `  Re-export youtube.com cookies (Netscape format) over ${COOKIES}\n` +
            '  or point EVO_COOKIES at a fresh export, then re-run.',
        );
        process.exit(2);
      }
      return null;
    }
    clip = readdirSync(clipDir)
      .filter((f) => f.startsWith(`${stamp(sec)}.`))
      .map((f) => join(clipDir, f))[0];
    if (!clip) return null;
  }

  try {
    execFileSync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-i', clip, '-frames:v', '1', '-y', png],
      { env: process.env, timeout: 120_000 },
    );
  } catch {
    return null;
  }
  return existsSync(png) ? png : null;
}

/** Grab a whole set of timestamps for one video, sequentially. */
export async function grabFrames(id: string, secs: number[]): Promise<string[]> {
  const out: string[] = [];
  for (const s of secs) {
    const p = await grabFrame(id, s);
    if (p) out.push(p);
  }
  return out;
}

/** Drop the (large) downloaded clips once frames are cut; frames are ~1% the size. */
export function pruneClips(id: string): void {
  const d = join(CACHE, 'clips', id);
  if (existsSync(d)) rmSync(d, { recursive: true, force: true });
}

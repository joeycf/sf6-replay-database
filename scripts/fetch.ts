// Stage 1: fetch every upload from the tracked SF6 channels via the YouTube Data
// API v3, dump raw metadata to raw/<channel>.json, and print a reconnaissance
// report. The API key is LOCAL-ONLY (never on Vercel — the site builds from
// committed JSON).
//
// Run: npm run data:fetch   (tsx --env-file-if-exists=.env scripts/fetch.ts)
//
// The API client itself lives in scripts/youtube.ts, so a caller that is not a
// YouTube channel can hydrate arbitrary video ids without importing this file —
// which reads the key and runs its fetch loop at the top level, and so would
// exit the importing process on a missing key and then fetch seven channels.
//
// FETCHED_CHANNELS, not CHANNELS: an index intake has no uploads playlist to
// page, and its dump is built by scripts/fetch-theater.ts instead.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FETCHED_CHANNELS } from './channels';
import { fetchVideoMeta, listUploadIds, requireApiKey } from './youtube';
import type { ChannelConfig, RawVideoRecord } from '../types/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RAW_DIR = join(ROOT, 'raw');

requireApiKey('data:fetch');

async function fetchChannel(ch: ChannelConfig): Promise<RawVideoRecord[]> {
  // 1) every videoId from the uploads playlist (50/page)
  const ids = await listUploadIds(ch.uploadsPlaylist!);

  // 2) hydrate in chunks of 50 (title/description/duration/views)
  let chunk = 0;
  const metas = await fetchVideoMeta(ids, (done, total) => {
    if (chunk++ % 20 === 19) console.log(`  …${ch.id}: ${done}/${total}`);
  });

  const records: RawVideoRecord[] = [];
  for (const v of metas.values()) {
    records.push({
      id: v.id,
      channel: ch.id,
      title: v.title,
      description: v.description,
      publishedAt: v.publishedAt,
      durationSec: v.durationSec,
      ...(v.viewCount !== undefined ? { viewCount: v.viewCount } : {}),
      liveBroadcastContent: v.liveBroadcastContent,
      ...(v.tags ? { tags: v.tags } : {}),
    });
  }
  return records;
}

// ── main ─────────────────────────────────────────────────────────────────────
await mkdir(RAW_DIR, { recursive: true });
console.log(`Fetching ${FETCHED_CHANNELS.length} channels…`);
for (const ch of FETCHED_CHANNELS) {
  const t0 = Date.now();
  const records = await fetchChannel(ch);
  records.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  await writeFile(join(RAW_DIR, `${ch.id}.json`), JSON.stringify(records, null, 1) + '\n', 'utf8');
  const dates = records.map((r) => r.publishedAt.slice(0, 10));
  console.log(
    `✔ ${ch.id} (${ch.name}): ${records.length} uploads, ${dates[dates.length - 1] ?? '—'} → ${dates[0] ?? '—'} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
  );
}
console.log('Done. Next: npm run data:parse');

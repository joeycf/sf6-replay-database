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

import { FETCHED_CHANNELS, FROZEN_CHANNELS } from './channels';
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
for (const ch of FROZEN_CHANNELS) {
  console.log(
    `  ↷ ${ch.id} (${ch.name}) FROZEN since ${ch.frozen!.since} — ${ch.frozen!.records} record(s) carried, not fetched`,
  );
}
for (const ch of FETCHED_CHANNELS) {
  const t0 = Date.now();
  let records: RawVideoRecord[];
  try {
    records = await fetchChannel(ch);
  } catch (e) {
    // A CHANNEL CAN BE DELETED, AND THE WHOLE RUN USED TO DIE WITH IT.
    //
    // There was no per-channel handling here at all: youtube.ts throws on a
    // non-retryable 4xx, nothing between it and the top-level await catches,
    // and the workflow step has no continue-on-error — so when King Arena's
    // account went on 2026-09-18, the other seven channels stopped refreshing
    // too and the cron stayed red for six days. The raw API dump it printed
    // named a playlist id and nothing a reader could act on.
    //
    // This does not swallow the failure: the run still exits non-zero, because
    // a channel that vanishes is a fact about the archive and not a bad
    // morning. What it adds is the remedy, by name, in the error itself.
    const msg = e instanceof Error ? e.message : String(e);
    if (/playlistNotFound|HTTP 404/.test(msg)) {
      console.error(
        [
          ``,
          `✖ ${ch.id} (${ch.name}): its uploads playlist is GONE (404).`,
          `  The channel has been deleted, renamed, or made private. Check it:`,
          `    https://www.youtube.com/channel/${ch.channelId}`,
          ``,
          `  If it is gone for good, FREEZE it rather than deleting its records —`,
          `  they were parsed from real matches. In scripts/channels.ts set:`,
          ``,
          `    frozen: { since: '<today>', reason: '<what happened>', records: <committed count> }`,
          ``,
          `  and, if its VIDEOS are gone too (check videos.list over its ids, not a`,
          `  sample), add the unplayable block so every carried record says so.`,
          `  parse then carries them against that pin and fetch skips the channel.`,
          ``,
        ].join('\n'),
      );
    }
    throw e;
  }
  records.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  await writeFile(join(RAW_DIR, `${ch.id}.json`), JSON.stringify(records, null, 1) + '\n', 'utf8');
  const dates = records.map((r) => r.publishedAt.slice(0, 10));
  console.log(
    `✔ ${ch.id} (${ch.name}): ${records.length} uploads, ${dates[dates.length - 1] ?? '—'} → ${dates[0] ?? '—'} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
  );
}
console.log('Done. Next: npm run data:parse');

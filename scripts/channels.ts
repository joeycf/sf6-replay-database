// The tracked Street Fighter 6 replay channels — the bespoke half of the
// pipeline's intake (PLAN §5). Selection criteria from the build recon
// (2026-07, full history of all three channels, 22,210 uploads read): dense
// daily uploads of full match VODs and structurally parseable
// "PLAYER (Character) vs PLAYER (Character)" titles.
//
// `id` is the intake key (raw/<id>.json + the report row); `source` is the
// public Replay.source contract (mirrored in app.config.ts sourceChannels;
// badge styling is index-based: 0 = filled primary, 1 = secondary outline,
// 2+ = warning outline). They are 1:1 here — unlike Tekken, no SF6 source
// aggregates several channels, because tournament footage is published INSIDE
// these same channels rather than on a dedicated event-organizer channel.
//
// uploadsPlaylist is pinned (UU + channelId.slice(2)) rather than resolved
// live: it saves a quota unit per channel per run, and the channel id is
// stable where a handle can be changed by its owner.

import type { ChannelConfig } from '../types/index';

export const CHANNELS: ChannelConfig[] = [
  {
    // @SF6HighLevelReplays — the flagship. The cleanest corpus on the
    // platform: 5,706 uploads, 100% SF6, 100% structurally parseable, and
    // 99.7% carry a ladder rank per side in the description
    // ("Haitani (Legend rank Chun-Li) and Yoshikibi (Legend rank Cammy)").
    // It is the rank filter's data source, hence index 0.
    id: 'highLevel',
    source: 'highLevel',
    name: 'High Level',
    channelId: 'UCi5rlUH3C4BzDB5-fRJ8hHg',
    uploadsPlaylist: 'UUi5rlUH3C4BzDB5-fRJ8hHg',
  },
  {
    // @TheFGCplace — the highest-volume archive (9,649 uploads back to 2022).
    // Despite the general-FGC name it is a Street Fighter channel in practice:
    // the non-SF6 remainder is 990 Street Fighter V uploads (plus 2 KOF), all
    // excluded by the is-SF6 title predicate in parse.ts. 99.1% parseable;
    // 54% carry a description rank, always "Legend Rank".
    id: 'fgcPlace',
    source: 'fgcPlace',
    name: 'The FGC Place',
    channelId: 'UCx2dkBZglt1xlVMbzb63uCQ',
    uploadsPlaylist: 'UUx2dkBZglt1xlVMbzb63uCQ',
  },
  {
    // @streetfighterreplays41 — 6,855 uploads, 85.4% SF6 (the rest is 969 SF5
    // plus 29 unmarked). Titles are parseable at 92.5%; descriptions restate
    // the title as "P1:"/"P2:" lines and essentially never state a ladder rank
    // (0.2%), so most of its sides ship rank-less — which is fine, rank is
    // optional per side. It also carries the most tournament footage
    // (CPT qualifiers, "GRAND FINAL"), mixed in with the ranked uploads.
    id: 'sfReplays',
    source: 'sfReplays',
    name: 'SF Replays',
    channelId: 'UCZAqv0MYoVxGYuJRTWbIEFw',
    uploadsPlaylist: 'UUZAqv0MYoVxGYuJRTWbIEFw',
  },
];

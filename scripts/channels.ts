// The tracked Street Fighter 6 replay channels — the bespoke half of the
// pipeline's intake (PLAN §5). Selection criteria from the build recon
// (2026-07, full history of all three channels, 22,210 uploads read) and the
// tournament recon (2026-07-31, 13,247 uploads read across four candidate
// channels): dense uploads of full match VODs and structurally parseable
// "PLAYER (Character) vs PLAYER (Character)" titles.
//
// `id` is the intake key (raw/<id>.json + the report row); `source` is the
// public Replay.source contract (mirrored in app.config.ts sourceChannels;
// badge styling is index-based: 0 = filled primary, 1 = secondary outline,
// 2+ = warning outline). The original three are 1:1; the tournament-era intake
// breaks that — kingArena publishes BOTH online sets and event footage, so it
// declares an `eventSource` and parse.ts classifies per video (conflicts go to
// data/review-queue.json). The Online/Tournament grouping the site renders is
// app.config.ts `sourceGroups` — purely presentational, never in data or URLs.
//
// ORDER IS THE DEDUPE PRECEDENCE: scripts/replay-dupes.ts breaks duplicate
// clusters by this list (flatMapped over [source, eventSource]) — shipped
// incumbents first, then the tournament channels in the user's priority order
// (CapcomFighters > Evo > TheKingArena > superfighters-jkm: first-party
// archive, then the event's own uploads, then the re-uploaders). Reordering
// entries changes which copy of a re-uploaded match survives.
//
// NOT the same order as app.config.ts sourceChannels, which is APPEND-ONLY
// because badge styling is index-based — inserting there recolours shipped
// badges. The two lists answer different questions and are allowed to differ.
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
  {
    // @CapcomFighters — Capcom's first-party esports channel (7,979 uploads
    // back to 2012), the CPT/World Warrior/Capcom Cup archive. Recon
    // (2026-07-31): 1,796 uploads post-launch, 1,025 of them single matches in
    // clean "Dual Kevin (Rashid) vs. JAK (Juri) - Grand Final - …" form. The
    // trap that hid them: the SF6 marker lives in the DESCRIPTION on every one
    // of the 1,025 (and in the title on none), so the original title-only
    // is-SF6 gate scored this channel 0 — hence sf6Signal. The pre-launch date
    // gate keeps the channel's decade of SFV/SF4 CPT history out; the rest of
    // the modern uploads are stream VODs, Top-8 compilations and #shorts,
    // structurally excluded by the vs-title and shorts gates. No ladder ranks
    // anywhere (offline footage) — sides ship rank-less, which rank? allows.
    id: 'capcomFighters',
    source: 'capcomFighters',
    name: 'Capcom Fighters',
    channelId: 'UCPGuorlvarThSlwJpyTHOmQ',
    uploadsPlaylist: 'UUPGuorlvarThSlwJpyTHOmQ',
    sf6Signal: 'titleOrDescription',
  },
  {
    // @EvoEvents — Evo's own channel, 2,748 uploads. The one channel here whose
    // titles never name a character: "Evo 2026: MenaRD vs Shigematsu | Street
    // Fighter 6 | Grand Final" gives players, game and round and nothing else,
    // which is why it sat untracked until a way to read the footage existed.
    // 81 of its uploads are single SF6 matches (Evo 2023 → 2026, 8 events);
    // the rest are stream VODs, Top-8 compilations, best-ofs and intros, all
    // excluded by the versus-shape gate.
    //
    // hence charactersFromFootage: a match-shaped upload here is not a parse
    // failure, it is a character-completion item. SF6 prints the character name
    // in the HUD's top corners in tournament mode, and scripts/spike/ reads it
    // (81/81 exact against hand labels — see scripts/spike/README.md).
    //
    // Placed directly after CapcomFighters on purpose: this list is the dedupe
    // precedence. Evo loses to Capcom's first-party CPT archive, but beats the
    // re-uploaders below — for an Evo match, Evo's own upload is the rights
    // holder's copy. Measured at intake: 3 actionable duplicates, all against
    // kingArenaTournament, all now resolved in Evo's favour.
    id: 'evoEvents',
    source: 'evoEvents',
    name: 'Evo',
    channelId: 'UCWI626ZNdqM5tOlctPUTW2g',
    uploadsPlaylist: 'UUWI626ZNdqM5tOlctPUTW2g',
    sf6Signal: 'titleOrDescription',
    charactersFromFootage: true,
  },
  {
    // @TheKingArena — 2,333 uploads since 2025-01, 95%+ SF6, 94% parseable.
    // The complication: it publishes BOTH kinds of footage — online high-level
    // sets in the original channels' style AND event footage (CPT, Esports
    // World Cup, EVO, local weeklies). One physical channel, two sources:
    // parse.ts classifies per video ("High-Level" or no event signal →
    // kingArenaOnline; an event signal → kingArenaTournament; BOTH signals →
    // review queue for a human verdict). Recon split: 1,373 / 745 / 38.
    // Also the platform's flagship self-re-uploader: 152 of its videos are
    // byte-identical re-posts of its own earlier uploads (identical title,
    // second-exact duration, months apart) — data:replay-dupes exists largely
    // because of this channel.
    id: 'kingArena',
    source: 'kingArenaOnline',
    eventSource: 'kingArenaTournament',
    name: 'King Arena',
    channelId: 'UCcHkQjsuUAVYZD5IE-a8gaw',
    uploadsPlaylist: 'UUcHkQjsuUAVYZD5IE-a8gaw',
    sf6Signal: 'titleOrDescription',
  },
  {
    // @superfighters-jkm — small (190 uploads since 2025-02) but pure event
    // footage: EVO, BAM, Topanga, Blink Respawn, SF League Japan. 95 parseable
    // matches. Its handful of no-signal titles are still tournament footage
    // (verified by eye in the recon), so unlike kingArena it publishes under
    // ONE source with no classifier. Lowest dedupe priority — it re-uploads
    // matches the bigger channels also carry.
    id: 'superFighters',
    source: 'superFighters',
    name: 'Super Fighters',
    channelId: 'UCvOOnA96PF6Ac1Yx0kH4OxQ',
    uploadsPlaylist: 'UUvOOnA96PF6Ac1Yx0kH4OxQ',
    sf6Signal: 'titleOrDescription',
  },
];

// @EvoEvents was evaluated and rejected in the 2026-07-31 tournament recon for
// exactly one reason — 0 parseable, because no title names a character — and is
// tracked from 2026-08-04 now that the footage can be read (see its entry
// above). Tekken hit the same wall on the same channel and its verdict still
// stands there; that repo needs the extractor ported before it can revisit.
//
// No other candidate channel is pending. If one is ever added, the bar the
// recon used was: dense uploads of full match VODs, and titles that are either
// structurally parseable or resolvable from the footage.

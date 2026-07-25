// Pipeline-track types (plain node/tsx code — never enters the Nuxt graph, so
// the engine contract is restated where emitted shapes must mirror it, exactly
// like the Tekken and 2XKO pipelines do).

/** The Replay.source contract: doubles as GameConfig.sourceChannels[].id
 *  (badge/filter). SF6 tracks three channels and each is its own source —
 *  unlike Tekken, no source aggregates several channels, because tournament
 *  footage here is mixed INSIDE the same channels rather than published on a
 *  dedicated event-organizer channel. */
export type SourceId = 'highLevel' | 'fgcPlace' | 'sfReplays';

/** Per-YouTube-channel intake key: names raw/<key>.json and the coverage
 *  report's rows. 1:1 with SourceId today; kept as a separate type so a future
 *  aggregating source doesn't require a schema change. */
export type ChannelKey = SourceId;

export interface ChannelConfig {
  /** Raw-dump key / report row (unique per YouTube channel). */
  id: ChannelKey;
  /** The source this channel's replays are published under. */
  source: SourceId;
  /** Display name (mirrors app/app.config.ts sourceChannels[].name). */
  name: string;
  /** YouTube channel id. */
  channelId: string;
  /** The channel's uploads playlist (UU + channelId.slice(2), pinned). */
  uploadsPlaylist: string;
}

/** One upload as fetched from the YouTube Data API (raw/<id>.json). */
export interface RawVideoRecord {
  id: string;
  /** Intake channel, NOT the source — parse maps it via CHANNELS. */
  channel: ChannelKey;
  title: string;
  description: string;
  publishedAt: string; // ISO
  /** ISO8601 duration decoded to seconds; 0 = live/upcoming/unknown. */
  durationSec: number;
  viewCount?: number;
  /** 'none' for normal VODs; 'live'/'upcoming' are excluded by parse. */
  liveBroadcastContent: string;
  tags?: string[];
}

/** One parsed side: exactly one pilot + one character (SF6 is 1v1). */
export interface MatchSide {
  /** Player id (slug of handle). */
  player: string;
  /** Display handle, nicest casing seen (descriptions beat ALL-CAPS titles). */
  handle: string;
  /** Roster character id (data/characters.json). */
  character: string;
  /** Ladder rank, normalized to a GameConfig.ranks entry. Absent when the
   *  source didn't state one — which is most of the corpus outside the
   *  High Level channel. Divisions collapse to their tier and Master
   *  sub-tiers/MR values collapse to 'Master' (see scripts/roster.ts). */
  rank?: string;
}

/** The committed parse substrate (data/videos.json): only structurally parsed
 *  matches enter it; misses are reported, not stored. */
export interface MatchVideo {
  id: string;
  /** Resolved source (Replay.source), not the intake channel. */
  channel: SourceId;
  title: string;
  publishedAt: string;
  durationSec: number;
  viewCount?: number;
  /** SF6 balance season, resolved purely from the date boundaries
   *  (data/seasonBoundaries.json). Emitted as Replay.patch = `S${season}`.
   *
   *  There is deliberately no fine `patchVersion` field: SF6's within-season
   *  patches are not named in any tracked channel's titles or descriptions,
   *  and the grouped patch facet reads correctly with season parents alone.
   *  Adding children later means adding the field and a patch boundary table —
   *  it does not require migrating anything already emitted, because the era
   *  token is the engine's documented fallback for "season known, patch
   *  unknown". */
  season: number;
  sides: [MatchSide, MatchSide];
}

/** data/players.json entry (mirrors the engine's Player). */
export interface PlayerRecord {
  id: string;
  handle: string;
  featured?: boolean;
  extra?: { aliases?: string[] };
}

/** data/characters.json entry (mirrors the engine's Character). `aliases` is
 *  the well-known search/parse key; the other extra keys ("full name",
 *  "japanese") render on the character page's generic key/value strip. */
export interface CharacterRecord {
  id: string;
  name: string;
  imgPortrait: string;
  imgSplash?: string;
  accent: string;
  extra?: { aliases: string[]; [k: string]: unknown };
}

/** Per-video manual corrections (data/overrides.json): exclude stray uploads
 *  or patch a bad parse. Applied by parse.ts AND the standalone emit. */
export type VideoOverride = Partial<Pick<MatchVideo, 'season' | 'sides'>> & {
  exclude?: boolean;
};

/** One SF6 balance season (scripts/seasons.ts is the authority; parse.ts
 *  persists the resolved windows to data/seasonBoundaries.json).
 *
 *  `confirmed` is the cross-check that replaces Tekken's label-conflict
 *  counter: none of the tracked SF6 channels label seasons in titles or
 *  descriptions, so there is no independent signal to arbitrate a wrong date.
 *  A row whose start date has arrived while still `confirmed: false` is a due
 *  expiry (scripts/expiries.ts) and fails loud until a human confirms the
 *  patch landed on that date — or corrects it. */
export interface SeasonBoundary {
  season: number;
  start: string; // ISO date, inclusive
  end: string | null; // exclusive; null = open (current season)
  /** false = date announced by Capcom but the landing is unverified. */
  confirmed: boolean;
  /** short community-facing hint (the DLC character the patch shipped with) */
  note?: string;
}

/** A time-bomb that has gone off: something the data can tell us is due,
 *  rather than something a human has to remember. See scripts/expiries.ts. */
export interface Expiry {
  kind: 'unreleased-character' | 'unconfirmed-season';
  /** roster id, or `S${n}` for a season row */
  id: string;
  /** the ISO date that has now passed */
  date: string;
  /** what a human must do to clear it */
  action: string;
}

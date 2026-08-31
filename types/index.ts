// Pipeline-track types (plain node/tsx code — never enters the Nuxt graph, so
// the engine contract is restated where emitted shapes must mirror it, exactly
// like the Tekken and 2XKO pipelines do).

/** The Replay.source contract: doubles as GameConfig.sourceChannels[].id
 *  (badge/filter). The three original channels are each their own source; the
 *  tournament-era intake (2026-07) breaks the 1:1 — @TheKingArena publishes
 *  BOTH kinds of footage, so one physical channel emits under two tokens
 *  ('kingArenaOnline' / 'kingArenaTournament'), split per-video by the title
 *  classifier in parse.ts. The Online/Tournament grouping itself lives only in
 *  app.config.ts sourceGroups — group ids never appear in data or URLs. */
export type SourceId =
  | 'highLevel'
  | 'fgcPlace'
  | 'sfReplays'
  | 'kingArenaOnline'
  | 'capcomFighters'
  | 'kingArenaTournament'
  | 'superFighters'
  | 'evoEvents'
  | 'replayTheater';

/** Per-YouTube-channel intake key: names raw/<key>.json and the coverage
 *  report's rows. No longer 1:1 with SourceId ('kingArena' feeds two sources) —
 *  the separate type this repo kept "for a future aggregating source" is now
 *  load-bearing. */
export type ChannelKey =
  | 'highLevel'
  | 'fgcPlace'
  | 'sfReplays'
  | 'capcomFighters'
  | 'kingArena'
  | 'superFighters'
  | 'evoEvents'
  | 'replayTheater';

export interface ChannelConfig {
  /** Raw-dump key / report row (unique per YouTube channel). */
  id: ChannelKey;
  /** The source this channel's replays publish under by default. */
  source: SourceId;
  /** Second source this channel can publish under (KingArena). When set,
   *  parse.ts classifies each video by title signals: event-signal titles
   *  publish here, signal CONFLICTS go to data/review-queue.json until a human
   *  verdict (`channel` or `exclude`) lands in data/overrides.json. */
  eventSource?: SourceId;
  /** Display name (mirrors app/app.config.ts sourceChannels[].name). */
  name: string;
  /** YouTube channel id. Absent on an INDEX intake: there is no channel. */
  channelId?: string;
  /** The channel's uploads playlist (UU + channelId.slice(2), pinned). Absent on
   *  an INDEX intake, which is why scripts/fetch.ts iterates FETCHED_CHANNELS. */
  uploadsPlaylist?: string;
  /** Where the is-SF6 game marker may appear. The original three stay 'title'
   *  (their descriptions are SEO soup naming both SF5 and SF6); the
   *  tournament-era channels write the marker in descriptions — measured
   *  1,025/1,025 CapcomFighters match uploads have it there and 0 in the
   *  title. Default: 'title'. */
  sf6Signal?: 'title' | 'titleOrDescription';
  /** This channel's titles name the players but never the characters, so a
   *  match-shaped upload is queued for character-completion instead of counted
   *  as a parse miss. Only @EvoEvents sets it; without the flag every other
   *  channel's genuine char-unresolved misses would flood the review queue. */
  charactersFromFootage?: boolean;
  /** This intake is a third-party INDEX, not a YouTube channel. Its dump is
   *  built by scripts/fetch-theater.ts, its records are not built by a title
   *  parse, and data:fetch skips it. Mutually exclusive with channelId. */
  index?: ChannelIndex;
  /**
   * LOCAL-FIRST: deliberately not part of the daily cron.
   *
   * raw/ is gitignored and the cron fetches remotely into a fresh checkout, so
   * a source only ever fetched by hand has no dump there. Without this flag
   * parse would exit (missing dump) or, worse, drop every one of its records.
   * So when the dump is ABSENT its committed records are CARRIED; when it is
   * PRESENT they are rebuilt.
   *
   * The carry needs a count pin, because data/videos.json is both its source
   * and its target — one bad run would poison the next run's baseline silently.
   * It lives in data/source-pins.json rather than a constant here, because a
   * local-first source GROWS and hand-editing a number every refresh is
   * friction that teaches people to skip the check.
   */
  localFirst?: boolean;
}

/**
 * An INDEX source: a third-party catalogue that points AT video rather than
 * hosting it. Its entries are (videoId, startSeconds) pairs plus players,
 * characters and an event tag, so a record here is a SEGMENT of a longform VOD
 * and several records share one video. There is no channel, no uploads
 * playlist, and no title to gate.
 */
export interface ChannelIndex {
  /** Catalogue endpoint, paged with &page=N. */
  endpoint: string;
  /** The index's own token for this game, used as the ?game= query. */
  slug: string;
  /** What an ENTRY calls this game. Checked per entry — a query filter is one
   *  someone else answers, and a mistagged submission arrives looking exactly
   *  like a real one. */
  gameLabel: string;
  /** Entries per page. Theirs, not ours — the API ignores per_page/limit. */
  pageSize: number;
  /** Milliseconds between requests: politeness, not rate-limit avoidance. */
  pacingMs: number;
}

/** data/source-pins.json — the carry pin for every localFirst intake, keyed by
 *  ChannelKey. Written by a rebuild, hard-asserted by every carry. */
export type SourcePins = Partial<Record<ChannelKey, number>>;

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

/** One parsed side: one pilot, and every character they played.
 *
 *  SF6 is 1v1, so a single MATCH has one character per side and `characters`
 *  holds exactly one — which is every record the six title-parsed channels
 *  produce. A tournament SET is several games, and players counter-pick between
 *  them: measured on @EvoEvents, 17 of 81 single-match VODs have a side that
 *  changed character mid-set. Those record the ordered union of everyone that
 *  side played, first appearance first, because that is what the footage
 *  contains. WHICH game the switch happened in is deliberately not modelled.
 *
 *  This is NOT the tag-fighter axis: `charactersPerSide` stays 1 and the engine's
 *  duo panels stay hidden, because it describes simultaneous characters, not a
 *  sequential set history. The engine renders, filters and links a multi-entry
 *  side natively (2XKO's duos already ship through the same contract). */
export interface MatchSide {
  /** Player id (slug of handle). */
  player: string;
  /** Display handle, nicest casing seen (descriptions beat ALL-CAPS titles). */
  handle: string;
  /** Roster character ids (data/characters.json), 1..N, first-appearance order. */
  characters: string[];
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
   *  (data/seasonBoundaries.json). The season is the PARENT of the emitted
   *  `Replay.patch` token, and the token itself when no patch window claims
   *  the date (see scripts/emit.ts).
   *
   *  There is deliberately no stored `patchVersion` field. Tekken and 2XKO
   *  store one because their parsers ARBITRATE: a season label read out of a
   *  title can contradict the date, and the substrate has to record which won.
   *  SF6 has nothing to arbitrate — not one of the 22,212 tracked uploads
   *  names a season or a patch — so the fine token is a pure function of
   *  `publishedAt` against the patch table, derived at emit time. Storing it
   *  would be a second copy of a date lookup that can never disagree with the
   *  first, and `data/videos.json` would have to be rebuilt to change it. */
  season: number;
  /** The YouTube id, when `id` is not it. A record is not required to be a whole
   *  video: an INDEX intake publishes many records per VOD, so their ids are
   *  `${videoId}@${startSeconds}` and the YouTube id lives here. Every
   *  YouTube-shaped URL the engine builds resolves `videoId ?? id`. */
  videoId?: string;
  /** Where this record's footage starts inside `videoId`, in seconds. Absent
   *  (or 0) means the whole video. */
  startSeconds?: number;
  sides: [MatchSide, MatchSide];
}

/**
 * One record in raw/replayTheater.json — an index entry already joined to its
 * VOD's YouTube metadata. Extends RawVideoRecord so the dump reads like any
 * other, but the fields below are what the record is actually BUILT from:
 * nothing here is recovered by parsing the title, which the fetcher synthesized
 * from these same fields.
 */
export interface TheaterRawRecord extends RawVideoRecord {
  /** `${videoId}@${startSeconds}` — the record id, not a YouTube id. */
  id: string;
  /** The catalogue's own entry id. Provenance, and the fetch resume key. */
  theaterId: number;
  /** The YouTube id this segment lives inside. */
  videoId: string;
  /** Offset into videoId, in seconds. */
  startSeconds: number;
  /** The catalogue's event tag. Non-empty by construction — an untagged entry
   *  is online ranked play and never reaches the dump. */
  tag: string;
  /** The VOD's own uploader, for the report. The source VODs belong to
   *  seventeen different organisers, so this is per record, not per intake. */
  uploader: string;
  /** [side0, side1] handles, exactly as the catalogue spells them — sponsor
   *  prefixes intact, for the parser to strip. */
  players: [string, string];
  /** [side0, side1] character names, exactly as the catalogue spells them. SF6
   *  is 1v1 so a side is normally one long, but the catalogue carries four
   *  columns and a tournament set can counter-pick — MatchSide.characters is
   *  already an ordered union, so a longer side needs no schema change. */
  characters: [string[], string[]];
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
 *  or duplicates, patch a bad parse, or resolve a review-queue item. Applied by
 *  parse.ts AND the standalone emit. `channel` is the source-classification
 *  verdict (beats the KingArena title classifier); a complete `sides` pair on
 *  an id the title parser MISSED is the character-completion verdict — parse
 *  builds the record from raw + override (the hand-authored path). Free-form
 *  provenance keys ("//", dupeOf) are tolerated at the JSON boundary. */
export type VideoOverride = Partial<Pick<MatchVideo, 'season' | 'sides' | 'channel'>> & {
  exclude?: boolean;
  /** Who resolved a character-completion item. Absent on hand-authored entries
   *  predating the extractor; 'extractor' marks a machine resolution, which
   *  only happens at or above its auto-accept confidence. */
  resolvedBy?: 'extractor' | 'human';
  /** The extractor's confidence when it resolved this (0..1). */
  confidence?: number;
  /** Signed vote margin from reading the HUD's player plates to decide which
   *  side each handle sat on (scripts/hud-read.ts `resolveSide`). Recorded
   *  because attribution is the half of a footage-read record that no
   *  confidence number covers: the characters can be perfect while the players
   *  are swapped. Positive = the title's first-named player was on the left. */
  sideVotes?: number;
};

/** One pending item in data/review-queue.json — parseable footage the pipeline
 *  refuses to auto-publish. REGENERATED by every parse run (derived state:
 *  resolutions live solely in overrides.json, so the queue self-clears as
 *  verdicts land and survives daily runs untouched). Pending items never reach
 *  videos.json or replays.json; report.md counts them.
 *
 *  Kinds: 'source-classification' — a KingArena title carrying BOTH the
 *  high-level and an event signal (verdict: `channel` or `exclude` override);
 *  'character-completion' — match-shaped footage whose characters no text
 *  states (verdict: a complete `sides` override). The second kind is empty at
 *  launch; the schema and the /dev/source-review UI already speak it so Evo
 *  hand-fills or a future vision pass can feed it without a schema change. */
export interface ReviewQueueItem {
  id: string;
  kind: 'source-classification' | 'character-completion';
  /** Intake channel the video came from (raw/<key>.json). */
  channel: ChannelKey;
  title: string;
  publishedAt: string;
  durationSec: number;
  /** The conflicting title fragments that queued it (source-classification). */
  signals?: { online: string; event: string };
  /** The handles the title DID state, canonicalised against players.json
   *  (character-completion). Pre-fills the review form so a reviewer answers
   *  only the characters, and — more importantly — stops a verdict minting a
   *  second player page under a different spelling of an existing player. */
  handles?: [string, string];
}

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

/** One released SF6 patch (scripts/seasons.ts holds the table; emit.ts mirrors
 *  it to data/patchBoundaries.json).
 *
 *  `version` is the SuperCombo wiki's `gameversion` string VERBATIM — the
 *  PC/Steam version id, which is what `Replay.patch` carries and what
 *  `?patch=` puts in the URL. Never re-spell it, never fold it, never invent
 *  one to fill a gap. See the VERSION SCHEME note in scripts/seasons.ts. */
export interface PatchBoundary {
  /** e.g. '1.10', '2.0111' — unique, and never an era token */
  version: string;
  /** ISO release day, inclusive. The window's end is computed, never authored. */
  start: string;
  /** Builds Capcom shipped inside this patch's window that the wiki does not
   *  page separately, recorded so they are declared rather than silently
   *  absorbed. Free-form (2XKO's carries "Nov 4 hotfix"), documentation-only —
   *  read by the validator, never by the derivation. */
  includes?: string[];
  /** short community-facing hint (DLC character or headline change), surfaced
   *  as muted text beside the child in the patch dropdown */
  note?: string;
}

/** A patch plus its computed window and resolved era. */
export interface PatchWindow extends PatchBoundary {
  /** exclusive end: the next patch's start within the era, else the era's end,
   *  else null (open). Computed by scripts/seasons.ts, never authored. */
  end: string | null;
  season: number;
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

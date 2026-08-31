// Stage 2: parse raw/<channel>.json into the committed substrate
// (data/videos.json), derive the player registry (data/players.json), persist
// the season windows, write the coverage report, then emit the generic schema
// (scripts/emit.ts).
//
// Title contract (all six tracked channels share the core):
//   PLAYER_A (CharacterA) vs PLAYER_B (CharacterB)
// wrapped in channel branding ("SF6 <delim> … <delim>" on the original three,
// "… - Grand Final - World Warrior 2026" on the tournament-era channels). The
// paren often carries a LEADERBOARD POSITION rather than a bare character
// ("#3 Ranked Guile"). That is a per-character world ranking, NOT a ladder
// rank; it is stripped before matching and never becomes Side.rank.
//
// LADDER RANKS come from the DESCRIPTIONS, which write them as
// "<League> rank <Character>":
//   "Haitani (Legend rank Chun-Li) and Yoshikibi (Legend rank Cammy)"
// Never scan a title for ladder words — this corpus contains handles like
// "KUNG FU MASTER" and "Oil King", and a loose scan would invent ranks.
//
// Run: npm run data:parse   (pure: no network, no API key)

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyOverrides, emitGeneric } from './emit';
import { CHANNELS, stripTheaterSponsor } from './channels';
import { dueExpiries, formatExpiries } from './expiries';
import { formatStaleRefusal, staleEvidence } from './freshness';
import { LAUNCH, SEASONS, seasonForDate, validateSeasons } from './seasons';
import { idKey, resolveKey, slug } from './players';
import { buildAliasMatcher, extractRank, loadCharacters, stripLeaderboard } from './roster';
import type {
  ChannelConfig,
  ChannelKey,
  MatchSide,
  MatchVideo,
  PlayerRecord,
  RawVideoRecord,
  ReviewQueueItem,
  SourcePins,
  TheaterRawRecord,
  VideoOverride,
} from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

validateSeasons();

// Curated famous-pro list (marks Player.featured when present in the data —
// harmless for ids that never appear). Slugs verified against the real corpus.
const FEATURED = new Set([
  'daigo',
  'tokido',
  'itazan',
  'bonchan',
  'kazunoko',
  'punk',
  'menard',
  'nemo',
  'fuudo',
  'mago',
  'kawano',
  'xiaohai',
  'dogura',
  'angrybird',
  'problem-x',
  'snake-eyez',
  'nuckledu',
  'chris-wong',
  'ending-walker',
  'big-bird',
  'gachikun',
  'haitani',
  'moke',
  'blaz',
  'go1',
  'xian',
  'sako',
  'idom',
  'broski',
  'nephew',
  'oil-king',
  'mister-crimson',
  'valmaster',
  'higuchi',
  'yhc-mochi',
  'kobayan',
  'leshar',
  'kakeru',
  'shuto',
  'hotdog29',
]);

// ── handle identity ──────────────────────────────────────────────────────────
// The primitives and the curated merge table live in scripts/players.ts, so the
// audit (npm run data:player-dupes) can reach them — this file cannot be
// imported. `resolveKey` is `idKey` plus HANDLE_ALIASES, which is empty today:
// nothing in this corpus has yet needed a merge idKey could not already make.
const isUpper = (s: string) => s === s.toUpperCase() && s !== s.toLowerCase();

// ── the is-SF6 predicate ─────────────────────────────────────────────────────
// Two of the original channels carry a Street Fighter V back-catalogue (990 on
// @TheFGCplace, 969 on @streetfighterreplays41). Every SF6 upload on those
// three marks the game in the TITLE, so they gate on the title alone — their
// descriptions and tags are SEO soup naming both games. The tournament-era
// channels invert this: CapcomFighters writes the marker in the description on
// 1,025/1,025 match uploads and in the title on 0, so ChannelConfig.sf6Signal
// widens the gate to titleOrDescription per channel. Widening is safe there
// because those channels post-date SF6 (kingArena/superFighters) or lose their
// pre-SF6 history to the pre-launch date gate (capcomFighters).
const SF6_RE = /\bSF6\b|STREET\s*FIGHTER\s*6|スト6/i;
const isSf6 = (r: RawVideoRecord, cfg: ChannelConfig): boolean =>
  SF6_RE.test(r.title) || (cfg.sf6Signal === 'titleOrDescription' && SF6_RE.test(r.description));

// ── the KingArena source classifier ──────────────────────────────────────────
// @TheKingArena publishes online high-level sets AND event footage on one
// channel, so its videos split across two sources by title signals:
//   - HIGH_LEVEL_RE, or NO event signal → kingArenaOnline (the channel's own
//     labelling convention: online sets are either branded "High-Level" or
//     carry no venue at all)
//   - an event signal → kingArenaTournament
//   - BOTH signals → data/review-queue.json ("Blink Respawn CPT … High-Level
//     Match" — a human resolves via overrides.json channel/exclude; recon
//     measured 38 of 2,156)
// EVENT_RE is corpus-derived (every event/bracket word observed across the
// 2,333-upload recon), not aspirational. A new tournament brand the list
// doesn't know defaults to Online — wrong but visible (the video still ships,
// the report's classifier line moves) and fixable by extending the list or by
// a one-line override.
const HIGH_LEVEL_RE = /high[\s-]*level/i;
const EVENT_RE = new RegExp(
  [
    'capcom\\s*cup',
    'capcom\\s*pro\\s*tour',
    '\\bCPT\\b',
    '\\bEVO\\b',
    'evo\\s*japan',
    'esports\\s*world\\s*cup',
    '\\bEWC\\b',
    'world\\s*warrior',
    'battle\\s*arena',
    '\\bBAM\\s*\\d',
    'topanga',
    'street\\s*fighter\\s*league',
    '\\bSFL\\b',
    'blink\\s*respawn',
    'esports\\s*spotlight',
    'league\\s*japan',
    'lunes\\s*gramer',
    'grand\\s*final',
    'winners?\\s*(?:final|semi|quarter)',
    'losers?\\s*(?:final|semi|quarter)',
    'top\\s*(?:8|16|24|32|48|64|96)\\b',
    'group\\s*stage',
    'pools?\\b',
    'qualifier',
    'playoffs?',
    'gamers8',
    'red\\s*bull',
    'kumite',
    'dreamhack',
    'combo\\s*breaker',
    '\\bceo\\b',
    'frosty',
    'first\\s*attack',
    'ultimate\\s*fighting\\s*arena',
    '\\bUFA\\b',
    'tournament',
    'championship',
    'invitational',
    '\\bmasters\\b',
    '\\bLCQ\\b',
    'exhibition',
    'showmatch',
    'money\\s*match',
  ].join('|'),
  'i',
);

// ── title parsing ────────────────────────────────────────────────────────────
const VS_RE = /(.+?)\(([^()]{1,60})\)\s*(?:vs\.?|versus)\s*(.+?)\(([^()]{1,60})\)/iu;
// channel-brand segment delimiters seen in the tracked channels' titles
// (▰ = High Level, 🤜🤛 = The FGC Place, 🔥 = SF Replays)
const SEG_RE = /[▰🔥⚡•▶►|🤜🤛]+/u;

function cleanHandle(raw: string): string | null {
  let t = raw.split(SEG_RE).pop() ?? '';
  t = t.split(/\s[-–—]\s/).pop() ?? '';
  t = t
    .replace(/^[\s,.:;–—-]+/u, '')
    .replace(/[\s,.:;–—-]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length > 40) return null;
  return t;
}

// ── footage-title parsing (charactersFromFootage channels) ───────────────────
// @EvoEvents states players, game and round but never a character, in three
// grammars across 2023→2026, all delimited by "|":
//   "Evo 2023: Street Fighter 6 Winners Semifinals | Kakeru vs AngryBird"
//   "Evo 2025: Street Fighter 6 | Kakeru vs Fuudo | Winners Semifinals"
//   "Evo 2026: Shigematsu vs MenaRD | Street Fighter 6 | Winners Final"
// Rather than three regexes that rot when Evo reshuffles the segments again,
// split on "|" and take the ONE segment carrying a versus — the players always
// sit inside a single segment, the game name and round always in others.
//
// The versus shape alone excludes every stream VOD, bracket compilation,
// best-of and intro on the channel, so NOT_A_MATCH stays narrow: it only needs
// the non-matches that ALSO carry a versus. In particular it must never test
// "Top \d+" — Evo writes the round as "Top 24" / "Losers Top 8", and filtering
// on that eats six real single matches.
const FOOTAGE_VS = /\s+(?:vs\.?|versus)\s+/i;
const NOT_A_MATCH_RE =
  /\bOG\s*Hunt\b|watch\s*party|\bbest\s*of\b|\bintro\b|dev\s*panel|road\s+to\s+evo|matches\s+you\s+missed|\brecap\b|highlights?/i;
/** A bracket set runs 5–25 min. Longer versus-titled uploads are exhibitions
 *  and showcases (a 62-minute Daigo vs MenaRD FT10) where a player can change
 *  character freely between many games — a different problem, left alone. */
const MAX_SET_SEC = 30 * 60;

function footageTitle(title: string): [string, string] | null {
  if (NOT_A_MATCH_RE.test(title)) return null;
  const segs = title
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segs.length < 2) return null;
  // the "Evo Japan 2026:" event prefix rides on whichever segment is first,
  // which differs by grammar, so strip it wherever it appears
  const noEvent = (s: string) => {
    const i = s.indexOf(':');
    return i === -1 ? s : s.slice(i + 1).trim();
  };
  const withVs = segs.filter((s) => FOOTAGE_VS.test(noEvent(s)));
  if (withVs.length !== 1) return null;
  const parts = noEvent(withVs[0]!).split(FOOTAGE_VS);
  if (parts.length !== 2) return null;
  const a = parts[0]!.trim();
  const b = parts[1]!.trim();
  if (!a || !b || a.length > 40 || b.length > 40) return null;
  return [a, b];
}

interface TitleSides {
  handles: [string, string];
  parens: [string, string];
}
function parseTitle(title: string): TitleSides | null {
  const m = VS_RE.exec(title);
  if (!m) return null;
  const a = cleanHandle(m[1]!);
  const b = cleanHandle(m[3]!);
  if (!a || !b) return null;
  return { handles: [a, b], parens: [m[2]!, m[4]!] };
}

// ── description side pass (ladder ranks + nicer handle casing) ───────────────
// The connector varies by channel: High Level writes "A (…) and B (…)",
// The FGC Place writes "A (…) versus B (…)".
const DESC_RE =
  /([^():\n!]{1,50}?)\s*\(([^()\n]{1,90})\)\s*(?:versus|vs\.?|and)\s*([^():\n!]{1,50}?)\s*\(([^()\n]{1,90})\)/iu;

interface DescSide {
  handle: string;
  character: string | null;
  rank?: string;
}
function parseDescSides(
  description: string,
  matcher: ReturnType<typeof buildAliasMatcher>,
): [DescSide, DescSide] | null {
  const m = DESC_RE.exec(description);
  if (!m) return null;
  const side = (name: string, paren: string): DescSide => {
    const rank = extractRank(paren);
    return {
      handle: name.replace(/\s+/g, ' ').trim(),
      character: matcher.one(stripLeaderboard(paren)),
      ...(rank ? { rank } : {}),
    };
  };
  return [side(m[1]!, m[2]!), side(m[3]!, m[4]!)];
}

// ── main ─────────────────────────────────────────────────────────────────────
const characters = await loadCharacters();
const matcher = buildAliasMatcher(characters);

const CHANNEL_OF = new Map(CHANNELS.map((c) => [c.id, c]));

const readJson = async <T>(p: string): Promise<T> => JSON.parse(await readFile(p, 'utf8')) as T;

/** The committed catalogue, read once, as the stale-raw guard's baseline.
 *  Absent is a legitimate first run; anything else — a truncated file, a bad
 *  merge — must NOT be read as an empty corpus, because that hands every guard
 *  below a baseline of zero and makes total loss the one case that passes. */
const committed: MatchVideo[] = await readJson<MatchVideo[]>(join(DATA, 'videos.json'))
  .then((v) => {
    if (!Array.isArray(v)) throw new Error('data/videos.json is not an array');
    return v;
  })
  .catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return [] as MatchVideo[];
    console.error(
      `✖ data/videos.json is unreadable (${e.message}) — refusing to treat it as empty.`,
    );
    process.exit(1);
  });

const ALLOW_STALE = process.argv.includes('--allow-stale');
const raws: RawVideoRecord[] = [];
/** The index intake's dump, when this run has one. Kept OUT of `raws` because
 *  its records are not built by a title parse — see buildTheaterRecords. */
let theaterRaw: TheaterRawRecord[] = [];
/** Local-first intakes with no dump on this run, so their committed records are
 *  carried instead of rebuilt. On the daily cron this is all of them, every
 *  time: raw/ is gitignored and the cron never fetches them. */
const carriedLocalFirst: ChannelKey[] = [];
for (const ch of CHANNELS) {
  const path = join(ROOT, 'raw', `${ch.id}.json`);
  let dump: RawVideoRecord[];
  try {
    dump = await readJson<RawVideoRecord[]>(path);
  } catch {
    // A LOCAL-FIRST intake legitimately has no dump here. That is the normal
    // state on the cron, not an error: carry its committed records. Requiring
    // the dump would break the daily build; parsing without it would delete
    // every one of its records.
    if (ch.localFirst) {
      carriedLocalFirst.push(ch.id);
      continue;
    }
    console.error(`✖ ${path} missing/unreadable — run \`npm run data:catchup\` first.`);
    process.exit(1);
  }
  if (ch.index) {
    // Structured at source: handles, characters, event tag and a start offset
    // are separate fields, so there is no title to parse.
    //
    // AND EXEMPT FROM THE STALE-RAW GUARD, which is load-bearing rather than a
    // concession. That guard asks whether a dump could have produced the
    // committed corpus; for an index intake the answer is governed by a third
    // party's catalogue, not by when we last fetched. An event withdrawn from
    // the catalogue would read as staleness and refuse every run thereafter,
    // which is how a guard becomes a flag people learn to pass. Its protection
    // is the count pin below, which is strictly stronger: the pin demands an
    // exact number where the guard only demands "not older".
    theaterRaw = dump as TheaterRawRecord[];
    continue;
  }
  // ── the stale-raw guard (scripts/freshness.ts) ────────────────────────────
  // Per intake, and it reads only publishedAt on both sides. See that file for
  // why neither a wall-clock window nor an mtime survives contact with a repo
  // whose cron rewrites data/ daily and whose raw/ a human refetches by hand.
  const stale = staleEvidence(ch.id, dump, committed);
  if (stale) {
    if (!ALLOW_STALE) {
      console.error(formatStaleRefusal(ch.id, stale));
      process.exit(1);
    }
    // --allow-stale says why it is proceeding. A silent override is how a run
    // that meant to accept a prune becomes indistinguishable from one that
    // forgot to fetch.
    console.warn(
      `⚠ --allow-stale: parsing raw/${ch.id}.json anyway. Its newest upload is ` +
        `${stale.newestInDump}, but ${stale.committedId} is committed at ${stale.committedAt}. ` +
        `That record and any like it will be dropped.`,
    );
  }
  raws.push(...dump);
}
const overrides = await readJson<Record<string, VideoOverride>>(join(DATA, 'overrides.json')).catch(
  () => ({}) as Record<string, VideoOverride>,
);

type MissReason =
  | 'not-sf6'
  | 'live-or-upcoming'
  | 'shorts'
  | 'short-duration'
  | 'pre-launch'
  | 'no-vs-title'
  | 'char-unresolved'
  | 'bad-handle';
const misses: { id: string; channel: string; reason: MissReason; title: string }[] = [];
// match-shaped uploads on a charactersFromFootage channel, awaiting a character
// verdict. Held aside rather than queued in place because the queue wants the
// CANONICAL handle spelling, and that is only known once bestSpelling is built
// from the whole parsed corpus below.
const footagePending: { raw: RawVideoRecord; handles: [string, string] }[] = [];
// misses stay reachable by id so the character-completion path below can build
// a record from raw + a hand-authored overrides.json sides pair.
const missedById = new Map<string, RawVideoRecord>();
const miss = (r: RawVideoRecord, reason: MissReason) => {
  misses.push({ id: r.id, channel: r.channel, reason, title: r.title });
  missedById.set(r.id, r);
};

interface Candidate {
  raw: RawVideoRecord;
  handles: [string, string];
  chars: [string, string];
  ranks: [string | undefined, string | undefined];
  descHandles: [string | undefined, string | undefined];
}
const candidates: Candidate[] = [];

for (const r of raws) {
  if (!isSf6(r, CHANNEL_OF.get(r.channel)!)) {
    miss(r, 'not-sf6');
    continue;
  }
  if (r.liveBroadcastContent !== 'none' || r.durationSec === 0) {
    miss(r, 'live-or-upcoming');
    continue;
  }
  if (/#shorts?\b/i.test(r.title)) {
    miss(r, 'shorts');
    continue;
  }
  if (r.durationSec < 120) {
    miss(r, 'short-duration');
    continue;
  }
  if (r.publishedAt.slice(0, 10) < LAUNCH) {
    miss(r, 'pre-launch');
    continue;
  }
  const t = parseTitle(r.title);
  if (!t) {
    // A channel whose titles never name a character (charactersFromFootage):
    // a match-shaped upload is not a parse failure, it is a completion item.
    // It still goes through miss() — that is what puts it in missedById, which
    // is what lets an overrides.json sides entry build the record later — but
    // it is filtered out of the reported misses below.
    const cfg = CHANNEL_OF.get(r.channel)!;
    if (cfg.charactersFromFootage && r.durationSec <= MAX_SET_SEC) {
      const handles = footageTitle(r.title);
      const ov = overrides[r.id];
      if (handles && !ov?.sides && ov?.exclude !== true) {
        footagePending.push({ raw: r, handles });
      }
    }
    miss(r, 'no-vs-title');
    continue;
  }
  const charA = matcher.one(stripLeaderboard(t.parens[0]));
  const charB = matcher.one(stripLeaderboard(t.parens[1]));
  if (!charA || !charB) {
    miss(r, 'char-unresolved');
    continue;
  }
  if (!slug(t.handles[0]) || !slug(t.handles[1])) {
    miss(r, 'bad-handle');
    continue;
  }

  // description pass: ladder ranks + nicer casing, aligned to the title sides
  let ranks: Candidate['ranks'] = [undefined, undefined];
  let descHandles: Candidate['descHandles'] = [undefined, undefined];
  const desc = parseDescSides(r.description, matcher);
  if (desc) {
    const [d0, d1] = desc;
    let order: [DescSide, DescSide] | null = null;
    if (d0.character === charA && d1.character === charB) {
      // mirror matchups (charA === charB) are order-ambiguous by character
      // alone — require a handle correspondence before trusting the order
      order = charA !== charB || idKey(d0.handle) === idKey(t.handles[0]) ? [d0, d1] : null;
      if (!order && idKey(d1.handle) === idKey(t.handles[0])) order = [d1, d0];
    } else if (d0.character === charB && d1.character === charA) {
      order = [d1, d0];
    }
    if (order) {
      ranks = [order[0].rank, order[1].rank];
      descHandles = [
        idKey(order[0].handle) === idKey(t.handles[0]) ? order[0].handle : undefined,
        idKey(order[1].handle) === idKey(t.handles[1]) ? order[1].handle : undefined,
      ];
    }
  }

  candidates.push({ raw: r, handles: t.handles, chars: [charA, charB], ranks, descHandles });
}

// ── player registry: one identity per key, best spelling wins the id ────────
// Description mixed-case outweighs ALL-CAPS titles 1000×; frequency is the
// tiebreak. The winning spelling supplies BOTH the display handle and the
// hyphenated public id, so /players/ending-walker beats /players/endingwalker
// purely because the sources write it that way more often.
/** Entries ignored because this repo has already ruled on their video. */
const theaterSkippedKnown: { videoId: string; tag: string; where: string }[] = [];
/** Character strings the roster does not know. Surfaced, never guessed. */
const theaterResidue: { id: string; raw: string }[] = [];

const casing = new Map<string, Map<string, number>>(); // identity key → spelling → weight
function noteHandle(key: string, variant: string, weight: number) {
  const m = casing.get(key) ?? new Map<string, number>();
  m.set(variant, (m.get(variant) ?? 0) + weight);
  casing.set(key, m);
}

for (const c of candidates) {
  for (let i = 0; i < 2; i++) {
    const handle = c.handles[i]!;
    noteHandle(resolveKey(handle), handle, 1);
    const dh = c.descHandles[i];
    if (dh && !isUpper(dh)) noteHandle(resolveKey(handle), dh, 1000); // desc casing wins
  }
}

/**
 * THE INDEX INTAKE IS ASSEMBLED HERE, BEFORE THE ELECTION, and votes into the
 * same tally. That ordering is the whole of its player identity.
 *
 * Its records could be built anywhere — nothing in them depends on the title
 * parse. But the registry elects one spelling per identity from `casing`, and an
 * intake that arrives after the election cannot merge its own spellings: the
 * catalogue writes "MENA RD" where this corpus elected "MenaRD", and a bare
 * slug() on the catalogue's string would mint /players/mena-rd beside the real
 * page. Measured: 753 of its 2,130 sides resolve onto a player already here.
 *
 * It votes from the ASSEMBLED RECORD rather than the catalogue string, which is
 * what makes the carry sound. A vote cast inside the builder cannot be re-cast
 * on a run that has no dump, so the same record would resolve differently
 * depending on whether raw/ happened to be present. From `s.handle` it is
 * symmetric: a rebuild votes the catalogue's spelling, a carry votes the
 * spelling that same catalogue's vote elected last time, and re-electing a
 * winner is a fixpoint.
 */
const theaterBuilt = new Map<ChannelKey, MatchVideo[]>();
for (const ch of CHANNELS.filter((c) => c.localFirst)) {
  const rs = carriedLocalFirst.includes(ch.id)
    ? committed.filter((v) => v.channel === ch.source)
    : buildTheaterRecords(ch, theaterRaw);
  theaterBuilt.set(ch.id, rs);
  for (const v of rs)
    for (const side of v.sides) noteHandle(resolveKey(side.handle), side.handle, 1);
}

const bestSpelling = new Map<string, string>(); // identity key → chosen handle
for (const [key, variants] of casing) {
  bestSpelling.set(key, [...variants.entries()].sort((a, b) => b[1] - a[1])[0]![0]);
}
const idOf = (handle: string): string => slug(bestSpelling.get(resolveKey(handle)) ?? handle);

const videos: MatchVideo[] = [];
const reviewQueue: ReviewQueueItem[] = [];

// Footage-completion items, now that canonical spellings exist. Pre-filling the
// handle with the corpus's own spelling is what stops a verdict minting a second
// player page for someone already in players.json — the review POST slugs
// whatever the form contains and does not run parse.ts's identity merge.
const footagePendingIds = new Set(footagePending.map((p) => p.raw.id));
for (const { raw, handles } of footagePending) {
  reviewQueue.push({
    id: raw.id,
    kind: 'character-completion',
    channel: raw.channel,
    title: raw.title,
    publishedAt: raw.publishedAt,
    durationSec: raw.durationSec,
    handles: [
      bestSpelling.get(resolveKey(handles[0])) ?? handles[0],
      bestSpelling.get(resolveKey(handles[1])) ?? handles[1],
    ],
  });
}
// per-channel classifier tally for the report (only eventSource channels)
const classifierSplit = new Map<
  string,
  { online: number; event: number; pending: number; resolved: number }
>();

for (const c of candidates) {
  const cfg = CHANNEL_OF.get(c.raw.channel)!;
  let source = cfg.source;
  if (cfg.eventSource) {
    const tally = classifierSplit.get(cfg.id) ?? { online: 0, event: 0, pending: 0, resolved: 0 };
    classifierSplit.set(cfg.id, tally);
    const online = HIGH_LEVEL_RE.exec(c.raw.title);
    const event = EVENT_RE.exec(c.raw.title);
    const ov = overrides[c.raw.id];
    const resolved = ov?.channel !== undefined || ov?.exclude === true;
    if (online && event) {
      if (!resolved) {
        // both signals — a human decides. Pending items never reach
        // videos.json/replays.json; they wait in data/review-queue.json and
        // this branch re-queues them every run until a verdict lands.
        tally.pending++;
        reviewQueue.push({
          id: c.raw.id,
          kind: 'source-classification',
          channel: c.raw.channel,
          title: c.raw.title,
          publishedAt: c.raw.publishedAt,
          durationSec: c.raw.durationSec,
          signals: { online: online[0], event: event[0] },
        });
        continue;
      }
      // verdict exists — applyOverrides applies it (the one application
      // point for every override field); classifier stands down
      tally.resolved++;
    } else if (event) {
      source = cfg.eventSource;
      tally.event++;
    } else {
      tally.online++;
    }
  }
  const sides = c.chars.map((character, i) => {
    const handle = c.handles[i]!;
    const key = resolveKey(handle);
    return {
      player: idOf(handle),
      handle: bestSpelling.get(key) ?? handle,
      // title-parsed channels state exactly one character per side; only the
      // footage extractor ever produces a longer list
      characters: [character],
      ...(c.ranks[i] ? { rank: c.ranks[i] } : {}),
    } as MatchSide;
  }) as [MatchSide, MatchSide];
  videos.push({
    id: c.raw.id,
    channel: source,
    title: c.raw.title,
    publishedAt: c.raw.publishedAt,
    durationSec: c.raw.durationSec,
    ...(c.raw.viewCount !== undefined ? { viewCount: c.raw.viewCount } : {}),
    season: seasonForDate(c.raw.publishedAt),
    sides,
  });
}

function buildTheaterRecords(ch: ChannelConfig, dump: TheaterRawRecord[]): MatchVideo[] {
  // ── ignore-if-known, and it runs FIRST ────────────────────────────────────
  // If this repo has already ruled on a video IN ANY CAPACITY, the catalogue
  // entry is ignored. Not merged, not preferred — ignored. The predicate is
  // known-ANYWHERE rather than merely in-records, because an id excluded as
  // wrong-game or dropped as a duplicate must not re-enter through a side door;
  // that verdict is the whole point of overrides.json.
  //
  // It keys on the VIDEO id, not the record id. A composite id can never equal
  // an 11-character YouTube id, so comparing record ids would match nothing and
  // the rule would silently never fire.
  //
  // `raws` is the widest arm and the one that matters here: it holds every
  // upload the tracked channels ever made, PRE-GATE, so a longform VOD this repo
  // fetched and could not parse still counts as ruled-on. Measured cost on the
  // first ingest: 91 of 1,156 — 8 videos already carrying an overrides verdict
  // and 3 fetched but never parsed. Higher than the sibling repos', because this
  // one tracks Capcom's own CPT archive and the catalogue indexes some of the
  // same events.
  const knownAnywhere = new Map<string, string>();
  const note = (id: string, where: string) => {
    if (!knownAnywhere.has(id)) knownAnywhere.set(id, where);
  };
  for (const r of raws) note(r.id, `raw/${r.channel}.json`);
  for (const v of committed) note(v.id, 'videos.json');
  for (const [id, ov] of Object.entries(overrides)) {
    note(id, ov.exclude === true ? 'overrides.json (excluded)' : 'overrides.json');
  }

  const kept: TheaterRawRecord[] = [];
  for (const r of dump) {
    const where = knownAnywhere.get(r.videoId);
    if (where) theaterSkippedKnown.push({ videoId: r.videoId, tag: r.tag, where });
    else kept.push(r);
  }

  // ── duplicate ids across intakes ──────────────────────────────────────────
  // Structurally impossible today — every index id contains "@" and no other
  // intake's does — which is exactly why it is worth asserting. Ids are the
  // primary key of videos.json and overrides.json, so a collision does not error
  // downstream: one record silently replaces the other.
  const byId = new Map<string, string>();
  for (const r of raws) byId.set(r.id, `raw/${r.channel}.json`);
  for (const v of committed) if (v.channel !== ch.source) byId.set(v.id, 'videos.json');
  const collisions: string[] = [];
  const seenHere = new Set<string>();
  for (const r of kept) {
    const other = byId.get(r.id);
    if (other) collisions.push(`  ${r.id}: ${ch.id} vs ${other}`);
    if (seenHere.has(r.id)) collisions.push(`  ${r.id}: ${ch.id} vs ${ch.id}`);
    seenHere.add(r.id);
  }
  if (collisions.length > 0) {
    console.error(
      [`✖ ${collisions.length} record id(s) claimed by two intakes — nothing written:`]
        .concat(collisions.slice(0, 20))
        .join('\n'),
    );
    process.exit(1);
  }

  // TRUST TIER. Third-party curation is weaker provenance than either of the
  // other two construction paths, so it takes the STRICTER of their gates:
  // characters resolve on an EXACT alias only — never through `matcher.one()`,
  // whose job is to read prose out of a title — and an unresolved token is
  // dropped to residue rather than guessed. The catalogue writes display names,
  // so the roster id is deliberately NOT a key: ids are ours.
  const byAlias = new Map<string, string>();
  for (const c of characters) {
    byAlias.set(c.name.trim().toLowerCase(), c.id);
    for (const a of c.extra?.aliases ?? []) byAlias.set(a.trim().toLowerCase(), c.id);
  }

  const out: MatchVideo[] = [];
  for (const r of kept) {
    // The same pre-launch floor every fetched channel gets. An index intake
    // never enters the title-parse path, so without this it would have no floor
    // at all rather than the global one.
    if (r.publishedAt.slice(0, 10) < LAUNCH) continue;

    const sides: MatchSide[] = [];
    for (let i = 0; i < 2; i++) {
      // Sponsor prefix STRIPPED, never split: "|" is not a duo delimiter here.
      // No org-prefix strip follows it — this repo has none (scripts/players.ts).
      const handle = stripTheaterSponsor(r.players[i] ?? '');
      const ids: string[] = [];
      const unresolved: string[] = [];
      for (const tok of r.characters[i] ?? []) {
        const id = byAlias.get(tok.trim().toLowerCase());
        if (id === undefined) unresolved.push(tok);
        else if (!ids.includes(id)) ids.push(id);
      }
      if (unresolved.length) theaterResidue.push({ id: r.id, raw: unresolved.join(', ') });
      sides.push({ player: slug(handle), handle, characters: ids });
    }

    // A side with no character is the one state emit hard-fails on. Catch it
    // here so it reads as a countable miss on this intake rather than a crash
    // three stages later. Same for a handle that slugs to nothing.
    if (sides.some((s) => s.characters.length === 0 || !s.handle || !s.player)) continue;

    out.push({
      id: r.id,
      channel: ch.source,
      title: r.title,
      publishedAt: r.publishedAt,
      durationSec: r.durationSec,
      season: seasonForDate(r.publishedAt),
      videoId: r.videoId,
      startSeconds: r.startSeconds,
      sides: [sides[0]!, sides[1]!] as [MatchSide, MatchSide],
    });
  }
  return out;
}

// ── character-completion: hand-authored records for footage the title parser
// missed (review-queue kind 2, empty at launch). An overrides.json entry with a
// complete sides pair on a MISSED id is authoritative — the record is built
// from raw + override with the parse gates bypassed by design (2XKO's
// manual-videos semantics: "authoritative, never parsed, never a parse
// failure"). Ids that parsed normally take their sides override through
// applyOverrides instead, and ids absent from raw/ can't be completed at all —
// a record needs the upload's own metadata.
const completedIds = new Set<string>();
for (const [id, ov] of Object.entries(overrides)) {
  if (!ov.sides || ov.exclude) continue;
  const r = missedById.get(id);
  if (!r) continue;
  completedIds.add(id);
  videos.push({
    id,
    channel: ov.channel ?? CHANNEL_OF.get(r.channel)!.source,
    title: r.title,
    publishedAt: r.publishedAt,
    durationSec: r.durationSec,
    ...(r.viewCount !== undefined ? { viewCount: r.viewCount } : {}),
    season: seasonForDate(r.publishedAt),
    sides: ov.sides,
  });
}
// A completed id is not a miss (the override built its record), and neither is
// one sitting in the review queue awaiting a character verdict — that is
// pending work, counted by "Pending review", not coverage the parser lost.
const reportedMisses = misses.filter(
  (m) => !completedIds.has(m.id) && !footagePendingIds.has(m.id),
);

// ── the index intake: rebuild from a dump, or carry ─────────────────────────
//
// A THIRD CONSTRUCTION PATH, beside the title parse and the footage verdict.
// The catalogue arrives structured — handles, characters, event tag and offset
// are separate fields — so there is no title to parse. The title these records
// carry was SYNTHESIZED by the fetcher from those same fields.
//
// LOCAL-FIRST. On a cron run there is no dump and the committed records are
// CARRIED; on a local run that fetched, they are REBUILT. Both must publish
// identical bytes from identical inputs, which they do because applyOverrides
// below is the only curation step and it runs over the assembled array either
// way.
// Its sides take their ids from the election above, exactly as the title-parsed
// path does — the builder left the catalogue's own spelling in place precisely
// so it could be voted on rather than trusted.
//
// The records go into the same array by the same route, so the collapse guard
// below sees n → n on a carry rather than n → 0, which is why this repo needs no
// local-first exclusion in that guard: it tallies PARSED against COMMITTED, and
// a carried record is parsed for that purpose.
for (const [, rs] of theaterBuilt) {
  for (const v of rs) {
    videos.push({
      ...v,
      sides: v.sides.map((side) => ({
        ...side,
        player: idOf(side.handle),
        handle: bestSpelling.get(resolveKey(side.handle)) ?? side.handle,
      })) as [MatchSide, MatchSide],
    });
  }
}

videos.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id));
reviewQueue.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id));

const records = applyOverrides(videos, overrides);

// ── the carry pin (data/source-pins.json) ───────────────────────────────────
// data/videos.json is both the source and the target of the carry, so one bad
// run would poison the next run's baseline permanently and silently. Asserted
// on a carry, written on a rebuild: a rebuild has the dump in front of it and is
// the authority on the count; a carry has only yesterday's file.
//
// The assertion is unconditional for a carried intake — NOT guarded on "carried
// something", which would make total loss the one case that passes.
//
// COUNTED AFTER applyOverrides, on both sides. The reference asserts the
// pre-override count and writes the post-override one, which agrees only while
// no override touches the intake — the first exclusion on a carried record would
// mismatch the pin on every run thereafter, with nothing wrong.
const sourcePins: SourcePins = await readJson<SourcePins>(join(DATA, 'source-pins.json')).catch(
  () => ({}) as SourcePins,
);
/** What the last pull learned about itself, when this run has its dump. The
 *  collapsed entries are gone from the dump by the time parse sees it, so this
 *  is the only way report.md can state the collapse instead of absorbing it. */
const theaterStats = await readJson<{
  tagged: number;
  collapsed: number;
  collapsedTags: Record<string, number>;
  unresolvableVods: number;
}>(join(ROOT, 'raw', '.replayTheater.stats.json')).catch(() => null);
for (const key of carriedLocalFirst) {
  const cfg = CHANNEL_OF.get(key)!;
  const got = records.filter((v) => v.channel === cfg.source).length;
  const want = sourcePins[key];
  if (want === undefined) {
    console.error(
      `✖ ${key} carried ${got} record(s) but data/source-pins.json has no pin for it.\n` +
        `  "No expectation" is the exact state the pin exists to prevent.\n` +
        `  Run \`npm run data:theater\` then \`npm run data:parse\` to rebuild and pin.`,
    );
    process.exit(1);
  }
  if (got !== want) {
    console.error(
      `✖ source pin mismatch on ${key}: carried ${got}, pinned ${want}.\n` +
        `  data/videos.json is both the source and the target of this carry, so drift\n` +
        `  compounds: the next run would treat ${got} as the new baseline.\n` +
        `  If deliberate, rebuild with \`npm run data:theater\` and commit the new pin.`,
    );
    process.exit(1);
  }
}

// ── channel-collapse guard ────────────────────────────────────────────────────
// A tracked channel can vanish between refreshes — deleted, renamed, made
// private, or REBRANDED to another game with its back catalogue unlisted. The
// last of those actually happened: 2XKO's "Pro Replays" channel became "MARVEL
// TOKON Pro Replays" on 2026-08-07, its 1,317 uploads left the uploads playlist
// while still existing and still playing, and the cron published a catalogue
// 24% smaller — then treated it as the new baseline. Nothing stopped it.
//
// PARSED vs COMMITTED, not raw vs committed. 2XKO gates multi-game channels at
// FETCH, so its raw dump is already this-game-only and raw is a fair proxy for
// what will publish. This repo gates at PARSE, so raw holds every upload the
// channel ever made — telly is 12,427 raw against 7,516 committed — and a raw
// comparison would measure the game filter rather than the loss. Parsed records
// are what actually reach the site, so that is what is compared.
//
// TWO THRESHOLDS, BOTH REQUIRED. A percentage alone punishes a small channel for
// ordinary churn; an absolute alone misses a large channel bleeding slowly.
// Runs after `records` is final and before the first write, so a fired guard
// costs nothing and leaves the committed data intact.
const COLLAPSE_PCT = 0.1; // >10% of the committed count
const COLLAPSE_ABS = 20; // AND >20 records
{
  const allowIdx = process.argv.indexOf('--allow-collapse');
  const allowed = new Set(
    allowIdx === -1 ? [] : (process.argv[allowIdx + 1] ?? '').split(',').map((x) => x.trim()),
  );
  // The same `committed` the stale-raw guard used — read once at the top, where
  // an unreadable file is refused rather than silently becoming an empty corpus.
  if (committed.length > 0) {
    const tally = (rs: typeof records): Map<string, number> => {
      const m = new Map<string, number>();
      for (const v of rs) {
        const k = v.channel;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return m;
    };
    const before = tally(committed);
    const now = tally(records);
    const collapsed: string[] = [];
    for (const ch of CHANNELS) {
      // A channel's committed records may carry more than one token (a source
      // plus an eventSource), so sum every token this channel can produce.
      const tokens = [ch.source, (ch as { eventSource?: string }).eventSource].filter(
        Boolean,
      ) as string[];
      const was = tokens.reduce((n, t) => n + (before.get(t) ?? 0), 0);
      if (was === 0) continue; // a new channel has no history to fall from
      const is = tokens.reduce((n, t) => n + (now.get(t) ?? 0), 0);
      const lost = was - is;
      if (lost > COLLAPSE_ABS && lost / was > COLLAPSE_PCT) {
        collapsed.push(
          `  ${ch.id}: ${was} → ${is}  (lost ${lost}, ${((lost / was) * 100).toFixed(1)}%)` +
            (allowed.has(ch.id) ? '  [allowed]' : ''),
        );
      }
    }
    const blocking = collapsed.filter((l) => !l.endsWith('[allowed]'));
    if (collapsed.length > 0) console.error('Channel collapse detected:\n' + collapsed.join('\n'));
    if (blocking.length > 0) {
      console.error(
        [
          ``,
          `✖ Refusing to write: a channel lost more than ${COLLAPSE_ABS} records AND more than`,
          `  ${COLLAPSE_PCT * 100}% of its committed count. Publishing this would bake the loss in,`,
          `  and the next run would treat the smaller number as the new normal.`,
          `  Check the channel before overriding — it may have been renamed, made private,`,
          `  or rebranded to another game (2XKO lost 1,317 records that way on 2026-08-07).`,
          ``,
          `  Accept the prune:  npm run data:parse -- --allow-collapse ${blocking.map((l) => l.trim().split(':')[0]).join(',')}`,
        ].join('\n'),
      );
      process.exit(1);
    }
  }
}

const seen = new Map<string, string>(); // id → handle
for (const v of records) for (const s of v.sides) seen.set(s.player, s.handle);
const players: PlayerRecord[] = [...seen.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, handle]) => ({ id, handle, ...(FEATURED.has(id) ? { featured: true } : {}) }));

// ── the carry pin, rewritten by a rebuild ───────────────────────────────────
// From the FINAL count — exclusions and all — so the number the next carrying
// run checks against is the number actually published.
const rebuiltLocalFirst = CHANNELS.filter((c) => c.localFirst && !carriedLocalFirst.includes(c.id));
if (rebuiltLocalFirst.length > 0) {
  const next: SourcePins = { ...sourcePins };
  for (const ch of rebuiltLocalFirst) {
    next[ch.id] = records.filter((v) => v.channel === ch.source).length;
  }
  const ordered = Object.fromEntries(
    Object.entries(next).sort(([a], [b]) => a.localeCompare(b)),
  ) as SourcePins;
  await writeFile(join(DATA, 'source-pins.json'), JSON.stringify(ordered, null, 2) + '\n', 'utf8');
}

// ── write artifacts ──────────────────────────────────────────────────────────
await writeFile(join(DATA, 'videos.json'), JSON.stringify(records, null, 1) + '\n', 'utf8');
await writeFile(join(DATA, 'players.json'), JSON.stringify(players, null, 2) + '\n', 'utf8');
await writeFile(
  join(DATA, 'seasonBoundaries.json'),
  JSON.stringify(SEASONS, null, 2) + '\n',
  'utf8',
);
// Derived state, regenerated wholesale every run: resolutions live solely in
// overrides.json, so a resolved item simply stops being generated. Committed
// (and in the cron's git add) so the pending set is visible history and the
// /dev/source-review UI reads real substrate.
await writeFile(
  join(DATA, 'review-queue.json'),
  JSON.stringify(reviewQueue, null, 2) + '\n',
  'utf8',
);

// ── report ───────────────────────────────────────────────────────────────────
// An index intake is read OUTSIDE `raws`, and its record ids are composite, so
// neither arm of the original derivation can see it: `raws.filter` finds no
// uploads and `channelOf` — a map built from raws — returns undefined for every
// composite id, scoring all of them as belonging to no channel. The row would
// read 0 on the very run that rebuilt it, and the table would stop summing to
// the headline. Counted explicitly instead, off the record's own source token.
const channelOf = new Map(raws.map((r) => [r.id, r.channel]));
const isFrom = (v: MatchVideo, cfg: ChannelConfig) =>
  cfg.index ? v.channel === cfg.source : channelOf.get(v.id) === cfg.id;
const byChannel = (cfg: ChannelConfig) => ({
  raw: cfg.index ? theaterRaw.length : raws.filter((r) => r.channel === cfg.id).length,
  sf6: cfg.index
    ? theaterRaw.length
    : raws.filter((r) => r.channel === cfg.id && isSf6(r, cfg)).length,
  parsed: records.filter((v) => isFrom(v, cfg)).length,
  ranked: records
    .filter((v) => isFrom(v, cfg))
    .reduce((n, v) => n + v.sides.filter((s) => s.rank).length, 0),
});
const theaterCount = records.filter((v) =>
  CHANNELS.some((c) => c.index && c.source === v.channel),
).length;
const rankSides = records.reduce((n, v) => n + v.sides.filter((s) => s.rank).length, 0);
const rankDist = records.reduce<Record<string, number>>((acc, v) => {
  for (const s of v.sides) if (s.rank) acc[s.rank] = (acc[s.rank] ?? 0) + 1;
  return acc;
}, {});
const seasonDist = records.reduce<Record<string, number>>((acc, v) => {
  acc[`S${v.season}`] = (acc[`S${v.season}`] ?? 0) + 1;
  return acc;
}, {});
const reasonCounts = reportedMisses.reduce<Record<string, number>>((acc, m) => {
  acc[m.reason] = (acc[m.reason] ?? 0) + 1;
  return acc;
}, {});

// The SOFT half of the self-expiring gates (scripts/expiries.ts). This path is
// the daily cron's, so it must NEVER exit: failing here would stop the data
// refresh entirely, which is worse than the misfiling it warns about. The
// workflow's final step turns the run red AFTER the data is committed and
// pushed. Do not "fix" this by making it throw.
const due = dueExpiries();
const actionRequired =
  due.length > 0 ? ['## ⚠ ACTION REQUIRED', '', formatExpiries(due), '', '---', ''].join('\n') : '';

const report = [
  actionRequired,
  '# SF6 pipeline report',
  '',
  // `raws` and the channel count exclude the index intake by construction — it
  // is read outside `raws` and it is not a channel. Both are named so the
  // headline and the table sum to the same thing.
  `**${records.length} matches** parsed from ${raws.length} uploads across ` +
    `${CHANNELS.filter((c) => !c.index).length} channels` +
    (theaterCount > 0 ? `, plus ${theaterCount} from 1 index` : '') +
    ` · ` +
    `${players.length} players · ranked sides ${rankSides}/${records.length * 2} ` +
    `(${((rankSides / (records.length * 2)) * 100).toFixed(1)}%)`,
  '',
  '| channel | source | uploads | is-SF6 | parsed | of SF6 | ranked sides |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ...CHANNELS.map((ch) => {
    const s = byChannel(ch);
    const src = ch.eventSource ? `${ch.source} / ${ch.eventSource}` : ch.source;
    // A CARRIED intake has no dump at all this run, by design. A bare
    // "0 | 0 | 1065 | 0.0%" row would read as a channel that died.
    const carried = carriedLocalFirst.includes(ch.id);
    const mark = ch.index ? (carried ? ' _(carried)_' : ' _(index)_') : '';
    if (carried) return `| ${ch.id}${mark} | ${src} | — | — | ${s.parsed} | — | ${s.ranked} |`;
    return (
      `| ${ch.id}${mark} | ${src} | ${s.raw} | ${s.sf6} | ${s.parsed} | ` +
      `${((s.parsed / Math.max(1, s.sf6)) * 100).toFixed(1)}% | ${s.ranked} |`
    );
  }),
  '',
  ...(CHANNELS.some((c) => c.localFirst)
    ? [
        '### Local-first intakes',
        '',
        "Deliberately outside the daily cron: a third party's uptime is not a cron",
        'dependency. Refreshed by hand, and carried from the committed catalogue on every',
        'run without a dump — which is every cron run.',
        '',
        '| intake | records | pin | this run |',
        '| --- | ---: | ---: | --- |',
        ...CHANNELS.filter((c) => c.localFirst).map((ch) => {
          const n = records.filter((v) => v.channel === ch.source).length;
          const carried = carriedLocalFirst.includes(ch.id);
          const mode = carried ? 'carried (no dump)' : 'rebuilt from a local dump';
          // On a rebuild the pin is rewritten from this same count below, so read
          // the count rather than the stale in-memory value loaded before it.
          const pin = carried ? (sourcePins[ch.id] ?? '—') : n;
          return `| \`${ch.id}\` | ${n} | ${pin} | ${mode} |`;
        }),
        '',
        // A CARRY measures none of this — the dump it would have measured is
        // absent by design. Saying so beats printing 0, which reads as "checked,
        // found nothing" when the truth is "not checked this run".
        ...(carriedLocalFirst.includes('replayTheater')
          ? [
              '_Carried from the committed catalogue, so the intake counts below were not_',
              '_measured this run. Re-run `npm run data:theater` to refresh them._',
              '',
            ]
          : [
              theaterStats
                ? `Entries **collapsed as double-submitted**: **${theaterStats.collapsed}** of ${theaterStats.tagged} tagged` +
                  (Object.keys(theaterStats.collapsedTags).length
                    ? ` — ${Object.entries(theaterStats.collapsedTags)
                        .sort((a, b) => b[1] - a[1])
                        .map(([pair, n]) => `${n}× \`${pair}\``)
                        .join(' · ')}`
                    : '') +
                  '. The same match submitted twice under two tag spellings; one copy kept, chosen on the tag so the survivor does not depend on submission order.'
                : '_Collapse count unavailable: raw/.replayTheater.stats.json is missing._',
              '',
              theaterSkippedKnown.length > 0
                ? `Entries **skipped as already-known**: **${theaterSkippedKnown.length}** of ${
                    theaterSkippedKnown.length +
                    records.filter((v) => v.channel === 'replayTheater').length
                  }. An id this repo has already ruled on, in any capacity, does not re-enter through a side door. ` +
                  `By arm: ${Object.entries(
                    theaterSkippedKnown.reduce<Record<string, number>>((acc, r) => {
                      acc[r.where] = (acc[r.where] ?? 0) + 1;
                      return acc;
                    }, {}),
                  )
                    .sort((a, b) => b[1] - a[1])
                    .map(([w, n]) => `${w} ${n}`)
                    .join(' · ')}.`
                : '_Entries skipped as already-known: **0**. The catalogue indexes no video this repo has fetched, published or ruled on._',
              '',
              ...(theaterResidue.length > 0
                ? [
                    `⚠ **${theaterResidue.length}** side(s) carried a character string that resolves to no roster id. Dropped to residue, never guessed:`,
                    '',
                    ...theaterResidue.slice(0, 20).map((r) => `- \`${r.id}\` — ${r.raw}`),
                    '',
                  ]
                : ['_Character strings resolving to no roster id: **0**._', '']),
            ]),
      ]
    : []),
  ...[...classifierSplit.entries()].map(
    ([id, t]) =>
      `${id} classifier: online ${t.online} · tournament ${t.event} · ` +
      `resolved by hand ${t.resolved} · pending ${t.pending}`,
  ),
  '',
  `Pending review: ${reviewQueue.length} (data/review-queue.json)`,
  '',
  `Seasons: ${Object.entries(seasonDist)
    .sort()
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ')}`,
  '',
  `Rank distribution (side appearances): ${
    Object.entries(rankDist)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ') || 'none'
  }`,
  '',
  `Misses by reason: ${
    Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ') || 'none'
  }`,
  '',
  '## Sample misses (first 30 that are not shorts/live/not-sf6)',
  '',
  ...reportedMisses
    .filter((m) => !['shorts', 'live-or-upcoming', 'not-sf6'].includes(m.reason))
    .slice(0, 30)
    .map((m) => `- \`${m.id}\` [${m.channel}] ${m.reason}: ${m.title.slice(0, 110)}`),
  '',
  `_Generated ${new Date().toISOString()}_`,
  '',
].join('\n');
await writeFile(join(DATA, 'report.md'), report, 'utf8');

if (due.length > 0) {
  console.error('\n' + '='.repeat(72));
  console.error(`FAILURE SIGNAL — ${due.length} expiry/expiries due (data still written)`);
  console.error('='.repeat(72));
  console.error(formatExpiries(due));
  console.error('='.repeat(72) + '\n');
}

console.log(
  `✔ Parsed ${records.length}/${raws.length} uploads → data/videos.json ` +
    `(misses: ${reportedMisses.length}; pending review: ${reviewQueue.length}; see data/report.md)`,
);
console.log(
  `  seasons ${Object.entries(seasonDist)
    .sort()
    .map(([k, n]) => `${k}:${n}`)
    .join(' ')} · ranked sides ${rankSides} · players ${players.length}`,
);

// ── emit the generic schema (same code path as `npm run data:emit`) ──────────
await emitGeneric(records, characters, players);

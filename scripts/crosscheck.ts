// THE SECOND WITNESS, as a pure predicate.
//
// WHAT THIS MEASURES, and why it is worth a file. Replay Theater's catalogue is
// mostly NOT tournament footage: 14,309 of its 15,500 Street Fighter 6 entries
// carry no event tag, and those are online ranked play. They are out of
// INGESTION scope by design — this repo already tracks four channels of exactly
// that, and what it was worst at was tournament sets, which is the whole reason
// the index intake exists.
//
// But out of ingestion scope is not out of scope as EVIDENCE. Measured
// 2026-08-31: 10,231 of those untagged rows point at a video THIS REPO HAS
// ALREADY PUBLISHED from a tracked channel — 44% of the corpus. Each one is an
// independent human reading of the same match: a stranger typed the two handles
// and the two characters into a form, and our parser read them out of the
// uploader's title. Neither saw the other.
//
// That makes this the first continuous accuracy measurement of our own title
// parsers against something that is not us. Every other number in report.md is
// the pipeline grading its own homework.
//
// IT PRODUCES NO FIELD AND OVERWRITES NOTHING. A disagreement is routed to the
// review queue with both claims side by side; it never edits a record, never
// outranks a confident parse, and never outranks a human override. RT is a
// witness, not an authority — the same posture the intake already takes when it
// resolves characters on an exact alias only and drops the rest to residue.
//
// THE THIRD OUTCOME IS THE POINT. agree / disagree is not enough, because a
// witness that CANNOT REPRESENT the answer is not disagreeing with it. The
// catalogue's schema is lossier than ours in ways that differ per game — it caps
// a 2XKO side at two champions and cannot express a within-set counter-pick, and
// its Tekken vocabulary has no Armor King at all (318 rows where it writes
// "King" for both) — so scoring those as disagreements would route hundreds of
// CORRECT records to review on day one, and, worse, would make agreement
// unreachable for exactly the rows a resolver would want to fix. Anything the
// catalogue could not have said is counted as `cannotWitness` and reported
// separately.
//
// EXACT ALIAS, NEVER FUZZY. The catalogue writes display names ("M. Bison",
// "C. Viper", "E. Honda") and this repo stores ids ("bison", "viper", "honda").
// Resolving those through the roster's own alias table is not a nicety: a naive
// lowercase-and-strip comparison reports 1,236 disagreements here, of which
// 1,236 are that spelling difference and 0 are real. The alias table takes the
// same population to 8. Never reach for the title parser's fuzzy ladder here —
// its job is to read prose out of a sentence, and a witness that guesses is not
// a witness.

import type { MatchVideo } from '../types/index';

/** One catalogue entry, exactly as the catalogue publishes it. Everything is
 *  nullable: this is someone else's schema and we do not get to assume. */
export interface WitnessEntry {
  id?: number;
  game?: string | null;
  video_link?: string | null;
  tag?: string | null;
  p1_name?: string | null;
  p2_name?: string | null;
  p1_char?: string | null;
  p1_char2?: string | null;
  p1_char3?: string | null;
  p1_char4?: string | null;
  p2_char?: string | null;
  p2_char2?: string | null;
  p2_char3?: string | null;
  p2_char4?: string | null;
}

export interface WitnessFile {
  mode?: 'cursor' | 'full';
  maxEntryId?: number;
  pagesRead?: number;
  hitBound?: boolean;
  entries?: WitnessEntry[];
}

/** One row the cross-check could not settle, carrying BOTH claims. This is what
 *  reaches the review queue — never a rewritten record. */
export interface Disagreement {
  videoId: string;
  field: 'players' | 'characters';
  /** 0 or 1, in our record's side order. Absent for a whole-record player miss. */
  side?: number;
  ours: string[];
  theirs: string[];
  title: string;
}

export interface CrossCheckResult {
  /** Videos where exactly one catalogue entry lines up with one of our
   *  whole-video records. A video the catalogue has cut into several segments is
   *  excluded: those are the intake's own territory and there is no 1:1 claim to
   *  compare against. */
  compared: number;
  /** Catalogue entries that pointed at a video we do not hold. Not a failure —
   *  it is most of the catalogue — but the denominator of "reach". */
  unmatched: number;
  /** Videos we hold that the catalogue indexes as several segments. */
  segmented: number;
  players: { both: number; one: number; neither: number; flipped: number };
  characters: {
    sides: number;
    agree: number;
    subset: number;
    disagree: number;
    cannotWitness: number;
  };
  disagreements: Disagreement[];
}

/** The YouTube id inside a catalogue link. The catalogue's submission form
 *  concatenates rather than builds — `https://youtu.be/<id>&t=554s` is a PATH
 *  with no query string — so this matches the id SHAPE explicitly and refuses
 *  anything else rather than guessing. Same regex the intake uses. */
const VIDEO_ID =
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/(?:live|shorts|embed)\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/;

const charsOf = (e: WitnessEntry, side: 1 | 2): string[] =>
  ([`p${side}_char`, `p${side}_char2`, `p${side}_char3`, `p${side}_char4`] as const)
    .map((k) => (e as unknown as Record<string, unknown>)[k])
    .filter((c): c is string => typeof c === 'string' && c.trim() !== '')
    .map((c) => c.trim());

const setEq = (a: string[], b: string[]): boolean => {
  const A = new Set(a);
  const B = new Set(b);
  return A.size === B.size && [...A].every((x) => B.has(x));
};
const subsetOf = (a: string[], b: string[]): boolean => a.every((x) => b.includes(x));

/**
 * @param witness      every entry the pull saw, tagged and untagged
 * @param committed    our published records
 * @param byAlias      the roster's exact-alias table: display name → roster id
 * @param resolveKey   the repo's player identity key (sponsor-stripped upstream)
 * @param stripSponsor the catalogue's own handle cleanup, applied to its strings
 * @param sideCap      how many characters the CATALOGUE can express per side (4
 *                     columns, but a game whose sides can exceed that has rows
 *                     the catalogue structurally cannot witness)
 */
export function crossCheck(
  witness: WitnessFile,
  committed: MatchVideo[],
  byAlias: Map<string, string>,
  resolveKey: (h: string) => string,
  stripSponsor: (h: string) => string,
  sideCap = 4,
): CrossCheckResult {
  // Only WHOLE-VIDEO records are comparable. Our index-intake records are
  // `${videoId}@${startSeconds}` segments built FROM this catalogue, so checking
  // them against it would be checking it against itself.
  const ours = new Map<string, MatchVideo>();
  for (const v of committed) if (!v.id.includes('@')) ours.set(v.id, v);

  const byVideo = new Map<string, WitnessEntry[]>();
  for (const e of witness.entries ?? []) {
    const m = VIDEO_ID.exec(e.video_link ?? '');
    if (!m) continue;
    byVideo.set(m[1]!, [...(byVideo.get(m[1]!) ?? []), e]);
  }

  const r: CrossCheckResult = {
    compared: 0,
    unmatched: 0,
    segmented: 0,
    players: { both: 0, one: 0, neither: 0, flipped: 0 },
    characters: { sides: 0, agree: 0, subset: 0, disagree: 0, cannotWitness: 0 },
    disagreements: [],
  };

  for (const [videoId, entries] of byVideo) {
    const mine = ours.get(videoId);
    if (!mine) {
      r.unmatched++;
      continue;
    }
    // The catalogue cut this VOD into segments. Our record is the whole video,
    // so there is no single claim to compare — and these are the intake's own
    // rows anyway.
    if (entries.length > 1) {
      r.segmented++;
      continue;
    }
    const e = entries[0]!;
    r.compared++;

    const theirSides = ([1, 2] as const).map((n) => ({
      players: String(e[`p${n}_name`] ?? '')
        .split(/\s*[/&+]\s*|\s+-\s+/)
        .map((x) => resolveKey(stripSponsor(x)))
        .filter(Boolean),
      chars: charsOf(e, n),
    }));
    const ourSides = mine.sides.map((s) => ({
      players: [resolveKey(s.handle)],
      chars: s.characters,
    }));

    // ORIENTATION. The catalogue's p1/p2 is the submitter's reading of the
    // screen and ours is the title's; they agree ~99.9% of the time here but not
    // always, and comparing characters across a swapped pair would manufacture
    // two disagreements out of none. Aligned on the handles, which is the field
    // the two sources agree on most.
    const score = (a: typeof ourSides, b: typeof theirSides) =>
      a.reduce((n, s, i) => n + (s.players.some((p) => b[i]!.players.includes(p)) ? 1 : 0), 0);
    const flipped = score(ourSides, [theirSides[1]!, theirSides[0]!]) > score(ourSides, theirSides);
    const theirs = flipped ? [theirSides[1]!, theirSides[0]!] : theirSides;
    if (flipped) r.players.flipped++;

    const hits = ourSides.reduce(
      (n, s, i) => n + (s.players.some((p) => theirs[i]!.players.includes(p)) ? 1 : 0),
      0,
    );
    if (hits === 2) r.players.both++;
    else if (hits === 1) r.players.one++;
    else {
      r.players.neither++;
      r.disagreements.push({
        videoId,
        field: 'players',
        ours: ourSides.flatMap((s) => s.players),
        theirs: theirs.flatMap((s) => s.players),
        title: mine.title,
      });
    }

    for (let i = 0; i < 2; i++) {
      r.characters.sides++;
      const mineChars = ourSides[i]!.chars;
      // EXACT ALIAS ONLY. A catalogue string the roster does not know is not a
      // disagreement — it is a witness we cannot read, and guessing at it is how
      // a second witness becomes a second parser.
      const raw = theirs[i]!.chars;
      const resolved = raw.map((c) => byAlias.get(c.toLowerCase()));
      if (raw.length === 0 || resolved.some((x) => x === undefined)) {
        r.characters.cannotWitness++;
        continue;
      }
      // THE SCHEMA CEILING. The catalogue carries `sideCap` character columns.
      // A side of ours that is longer than that is not something it declined to
      // report; it is something it could not have said.
      if (mineChars.length > sideCap) {
        r.characters.cannotWitness++;
        continue;
      }
      const theirChars = resolved as string[];
      if (setEq(mineChars, theirChars)) r.characters.agree++;
      else if (subsetOf(mineChars, theirChars) || subsetOf(theirChars, mineChars))
        r.characters.subset++;
      else {
        r.characters.disagree++;
        r.disagreements.push({
          videoId,
          field: 'characters',
          side: i,
          ours: mineChars,
          theirs: theirChars,
          title: mine.title,
        });
      }
    }
  }
  return r;
}

const pct = (n: number, total: number) =>
  total === 0 ? '—' : `${((n / total) * 100).toFixed(2)}%`;

/** The report.md block. Frozen per run: every number is computed from this run's
 *  witness and this run's records, and nothing is carried between runs. */
export function formatCrossCheck(r: CrossCheckResult, mode: string | undefined): string[] {
  if (r.compared === 0) return [];
  const c = r.characters;
  return [
    '## Replay Theater cross-check',
    '',
    `An independent reading of **${r.compared}** of our own records, from the catalogue's`,
    'UNTAGGED entries — online replays it indexes that we also parse from a tracked',
    'channel. Neither side saw the other, so this is the only accuracy number here the',
    'pipeline did not produce about itself. It changes nothing: a disagreement is',
    'recorded in data/theater-disagreements.json with both claims, never written into',
    'a record. The catalogue does not outrank a confident parse and never outranks a',
    'human override.',
    '',
    `_Measured this run against a ${mode ?? 'partial'} pull. ${r.unmatched} catalogue entr(ies) point at videos_`,
    `_we do not hold; ${r.segmented} are VODs the catalogue segments, which the intake owns._`,
    '',
    '| field | population | agree | partial | disagree | cannot witness |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    `| players (both handles) | ${r.compared} | ${r.players.both} (${pct(r.players.both, r.compared)}) | ${r.players.one} | ${r.players.neither} | — |`,
    `| characters (per side) | ${c.sides} | ${c.agree} (${pct(c.agree, c.sides)}) | ${c.subset} | ${c.disagree} (${pct(c.disagree, c.sides)}) | ${c.cannotWitness} |`,
    '',
    `Side order differed on **${r.players.flipped}** record(s); the comparison realigns on the`,
    'handles before reading characters, so a swapped pair is not counted twice as a',
    'character disagreement.',
    '',
    ...(r.disagreements.length
      ? [
          `**${r.disagreements.length} disagreement(s)** — both claims, ours first:`,
          '',
          ...r.disagreements
            .slice(0, 25)
            .map(
              (d) =>
                `- \`${d.videoId}\`${d.side !== undefined ? ` side ${d.side}` : ''} ${d.field}: ` +
                `**${d.ours.join(', ') || '(none)'}** vs catalogue **${d.theirs.join(', ') || '(none)'}** — ${d.title.slice(0, 70)}`,
            ),
          ...(r.disagreements.length > 25 ? [`- … ${r.disagreements.length - 25} more`] : []),
          '',
        ]
      : ['No disagreements this run.', '']),
  ];
}

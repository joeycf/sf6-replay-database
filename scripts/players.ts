// PLAYER IDENTITY — the primitives, and the one curated table that overrides
// them. Imported by scripts/parse.ts (which resolves the registry) and by
// scripts/player-dupes.ts (which audits it). It lives here rather than in
// parse.ts because parse.ts has top-level awaits and calls process.exit, so
// nothing can import it.
//
// SF6's channels do NOT prefix handles with esports org tags — verified across
// all 20,000+ parseable titles: not one known FGC org (FLY, PXG, RB, MOUZ,
// FALCONS, ZETA, CAG, …) appears in handle position. The frequent leading
// tokens are all integral parts of names: "Oil King", "Big Bird", "Problem X",
// "Ending Walker", "YHC Mochi", "SNB Johnny", "801 Strider", "PR Balrog".
// Tekken's stripOrgPrefix is therefore deliberately ABSENT here — porting it
// would fragment real players rather than merge sponsored ones.
//
// What DOES fragment this corpus is punctuation and spacing: the same player
// is written "Ending Walker" (333 sides) and "EndingWalker" (296), "Problem X"
// (434) and "ProblemX" (230), "MenaRD" and "Mena RD", "Big Bird" and "BIGBIRD".
// Identity is therefore keyed on the handle with ALL non-alphanumerics removed,
// while the public id keeps the readable hyphenated form of whichever spelling
// the sources use most. Two spellings of one player collapse to one page; two
// genuinely different players cannot collide, because differing alphanumerics
// produce differing keys.

/** Identity key: the handle reduced to its alphanumerics. Two spellings that
 *  differ only in spacing or punctuation share one. */
export const idKey = (handle: string): string => handle.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The public id: the readable hyphenated form. */
export const slug = (handle: string): string =>
  handle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * HAND-CURATED MERGES, for the identities `idKey` cannot reach on its own.
 *
 * idKey collapses the whole spacing-and-punctuation class automatically. What it
 * cannot reach is anything where the ALPHANUMERICS differ: a dropped letter, a
 * leet spelling ("K1NG" / "KING"), a trailing tag, an abbreviated first word.
 * Those are the only thing this table is for.
 *
 * `npm run data:player-dupes` finds candidates and prints a paste-ready
 * fragment. IT NEVER MERGES ANYTHING ITSELF, and that asymmetry is deliberate:
 * a wrong replay merge loses one video, but a wrong PLAYER merge rewrites a real
 * person's page to hold matches they did not play, and the page looks entirely
 * normal afterwards. Every row here is a human verdict.
 *
 * Key is the DROPPED spelling's idKey; value is the surviving handle. Empty is
 * the correct resting state — this corpus has needed no merge idKey could not
 * already make.
 */
export const HANDLE_ALIASES = new Map<string, string>([]);

/**
 * DECLARED DISTINCT: pairs the audit keeps proposing that a human has ruled are
 * two different people. Without this the same rejected candidate is re-printed
 * on every run, which is how a report becomes noise you skim.
 *
 * Keyed on the SURVIVING spelling's idKey.
 */
export const DISTINCT_KEYS = new Set<string>([]);

/** The identity key a handle resolves to, curated merges applied. */
export const resolveKey = (handle: string): string => {
  const k = idKey(handle);
  const alias = HANDLE_ALIASES.get(k);
  return alias === undefined ? k : idKey(alias);
};

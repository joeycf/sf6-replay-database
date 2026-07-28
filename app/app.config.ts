import patchGroups from '../data/patchGroups.json';
import ranks from '../data/ranks.json';
import type { GameConfig } from '@engine/types';

/**
 * The Street Fighter 6 GameConfig — merged OVER the engine's neutral default
 * (PLAN §4a). Everything game-shaped the engine renders comes from here via
 * useGame(); the visual skin lives separately in app/assets/theme.css.
 *
 * The genericity knobs, deliberately:
 * - charactersPerSide 1 → single portrait per side, duo/synergy panels hide.
 * - filters.coOccurrence false → the "same side" filter never renders.
 * - filters.rank true + the 9-rank ladder (data/ranks.json, the same file the
 *   pipeline validates against) → the rank facet renders in ladder order. The
 *   engine only shows chips a rank actually has data for, so in practice this
 *   renders Legend / Master / Diamond: these are top-level replay channels and
 *   almost every player in them sits at the top of the ladder.
 * - terms / characterRouteSegment / Side.players: UNSET. SF6 genuinely says
 *   "characters", ships at /characters/*, and has one player per side — the
 *   engine defaults are correct, so we exercise them (STACK §7).
 *
 * On the era noun: SF6's balance eras are SEASONS, not Years. Capcom and the
 * community name the annual all-character balance passes "Season 2" (Akuma,
 * 2024-05-22) and "Season 3" (Elena, 2025-06-03). "Year N" is the separate DLC
 * Character Pass and is offset by ~2 months (the Year 3 pass opens with Sagat,
 * 2025-08-05), so labelling a June-2025 boundary "Year 3" would put the label
 * and the boundary in open disagreement. Season tokens + self-describing
 * patchGroups labels mean the engine's default "Patch" facet heading reads
 * correctly with no terms override and no engine change.
 *
 * Accents are transcribed from design/handoff/tokens.css (--char-*), the
 * design system's source of truth — scripts/characters.ts reads the same file
 * when enriching data/characters.json, so config and data can't drift.
 */
export default defineAppConfig({
  game: {
    id: 'sf6',
    slug: 'sf6',
    name: 'Street Fighter 6',
    // Renders verbatim as the wordmark ("SF6/REPLAY") and the manifest
    // short_name. The official brand is "Street Fighter 6"; SF6 is the
    // universal short form the channels themselves use.
    shortName: 'SF6',
    rightsHolder: 'Capcom',
    baseURL: '/sf6', // behind the shell at replaydatabase.com/sf6
    siteUrl: 'https://replaydatabase.com',
    charactersPerSide: 1,
    filters: {
      coOccurrence: false, // tag-fighter filter — not an SF6 concept
      rank: true, // the ladder filter, options in ladder order
    },
    ranks,
    // SF6 ships no GameStatsPanels override, so the stats page's
    // `beside-timeline` anchor is empty — give the meta-over-time bump chart
    // the whole row and, with the room, plot the top 8 characters.
    stats: {
      metaTimelineTopN: 8,
      metaTimelineFullWidth: true,
    },
    accents: {
      // Launch roster (18)
      ryu: '#E8DFC8',
      luke: '#58AAFF',
      jamie: '#4FCB7D',
      chunli: '#7B93FF',
      guile: '#A9B93F',
      kimberly: '#FF5FB8',
      juri: '#B77DFF',
      ken: '#FFB03D',
      blanka: '#8FE036',
      dhalsim: '#E39A3B',
      honda: '#928DF6',
      deejay: '#F2DC50',
      manon: '#F2AECB',
      marisa: '#D68F55',
      jp: '#46B7A8',
      zangief: '#E34E54',
      lily: '#4EC9E6',
      cammy: '#7CE3C3',
      // Year 1 pass
      rashid: '#3ED69E',
      aki: '#C06BF2',
      ed: '#B4A4F5',
      akuma: '#C1657E',
      // Year 2 pass
      bison: '#B956E2',
      terry: '#FF5748',
      mai: '#FF7E8C',
      elena: '#E08CE8',
      // Year 3 pass
      sagat: '#E5C05C',
      viper: '#A8D8FF',
      alex: '#6FBF44',
      ingrid: '#FFE9A3',
    },
    // Order matters: SourceBadge styles by index (0 = filled primary,
    // 1 = secondary outline, 2+ = warning outline). Ids mirror
    // scripts/channels.ts `source` — the pipeline's Replay.source contract.
    // Ordered by corpus quality as measured in the build recon: highLevel is
    // 100% SF6 / 100% parseable / 99.7% ranked, fgcPlace 99.1% / 54%,
    // sfReplays 92.5% / 0.2%. APPEND only — inserting would recolour the
    // existing badges.
    //
    // No sourceGroups: Tekken collapses 4 channels into 2 chips, but with 3
    // channels and no separate tournament source there is nothing to
    // consolidate. Tournament footage is mixed INSIDE these channels rather
    // than living on its own, so an Online/Tournament split would need a
    // title-keyword classifier rather than a channel grouping.
    sourceChannels: [
      { id: 'highLevel', name: 'High Level' },
      { id: 'fgcPlace', name: 'The FGC Place' },
      { id: 'sfReplays', name: 'SF Replays' },
    ],
    // Season→patch hierarchy for the grouped patch facet (engine v0.6.0).
    // PIPELINE-EMITTED (scripts/emit.ts → data/patchGroups.json) from the same
    // boundary authority that derives every replay's patch token, so the UI
    // hierarchy and the data can never drift. Parents are the season tokens
    // (S1..S4) carrying self-describing "Season N" labels — the engine's
    // default facet heading is "Patch", so unlabelled "S1" chips would read
    // wrong. The siblings differ: 2XKO renames the heading via `terms` instead
    // of labelling, and Tekken does neither and lives with bare "S1" chips
    // under "Patch". Children are Capcom's version ids exactly as the SuperCombo
    // wiki spells them, and carry no label because the token IS the display
    // string. S4 has no children until its opening patch ships.
    patchGroups,
    fonts: {
      display: 'Big Shoulders Display',
      ui: 'Public Sans',
      mono: 'JetBrains Mono',
    },
    manifest: {
      themeColor: '#FF7D00',
      backgroundColor: '#141009',
    },
    ogImage: '/og-default.png',
  } satisfies GameConfig,
});

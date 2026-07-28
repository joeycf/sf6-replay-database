# SF6 Replay Database

The Street Fighter 6 game app for the [Replay Database](https://replaydatabase.com)
platform: a thin consumer of the [`replay-engine`](https://github.com/joeycf/replay-engine)
Nuxt layer plus the bespoke SF6 data pipeline (fetch/parse YouTube replay uploads,
Capcom roster scrape). Lives at **`replaydatabase.com/sf6`**.

Almost nothing about the UI is in this repo. The engine renders everything;
this repo supplies **data**, **config**, and **a skin**.

## The genericity knobs, deliberately

| knob                    | SF6                                | why                                                               |
| ----------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| `charactersPerSide`     | `1`                                | one fighter per side; every duo/synergy panel self-hides          |
| `filters.coOccurrence`  | `false`                            | "same side" is a tag-fighter concept                              |
| `filters.rank`          | `true` + a 9-rung ladder           | SF6 has a League ladder, and the descriptions state it            |
| `terms`                 | **unset**                          | SF6 genuinely says "characters" — the engine defaults are correct |
| `characterRouteSegment` | **unset**                          | the roster lives at `/characters/*`                               |
| `sourceGroups`          | **unset**                          | only three channels; nothing to consolidate                       |
| `patchGroups`           | season parents + 17 patch children | see "Seasons, not Years" below                                    |

> Platform: [replaydatabase.com](https://replaydatabase.com) ·
> [engine](https://github.com/joeycf/replay-engine) ·
> [shell](https://github.com/joeycf/replay-database-shell) ·
> [Tekken](https://github.com/joeycf/tekken-replay-database) ·
> [2XKO](https://github.com/joeycf/2xko-replay-database)

## Architecture

```
YouTube Data API v3
   │  scripts/fetch.ts      ──→ raw/<channel>.json           (gitignored, ~34 MB)
   ▼
scripts/parse.ts            ──→ data/videos.json             (substrate, committed)
   ├ scripts/channels.ts       (intake config)
   ├ scripts/roster.ts         (alias matcher + rank extraction)
   ├ scripts/seasons.ts        (the season + patch boundary authority)
   ├ scripts/expiries.ts       (the self-expiring gates)
   └ scripts/emit.ts (tail)    ──→ data/replays.json, stats.json, patchGroups.json, summary.json
                               ──→ data/patchBoundaries.json
                               ──→ data/players.json, seasonBoundaries.json, report.md

scripts/characters.ts       ──→ public/img/characters/*.webp, data/characters.json
scripts/og.ts               ──→ public/og-default.png
scripts/versions.ts         wiki cross-check for the patch table
scripts/e2e.ts              the audit suite
```

**Two schemas, deliberately.** `data/videos.json` keeps everything the parser
learned (intake channel, handles, per-side rank, season). `data/replays.json`
carries only what the engine's types declare. The engine never learns anything
SF6-shaped.

**Two-tier loading.** `characters`/`players`/`stats` are _provided_ to the engine
at build time (`app/plugins/registries.ts`), so prerendered HTML carries real
counts. `replays.json` is _fetched client-side_ so the 6 MB whale never enters
the prerendered payload.

## Setup

```bash
npm install
cp .env.example .env        # add YT_API_KEY
npm run data:build          # fetch + parse + emit
npm run generate            # → .vercel/output/static/sf6
```

`ENGINE_PATH=../replay-engine` in `.env` develops against a local engine
checkout; leave it unset (as every deploy does) to resolve the pinned
`github:joeycf/replay-engine#v0.6.2` tag. `NUXT_APP_BASE_URL` overrides the
committed `/sf6/` base — but the committed default **is** production truth.

## Scripts

| script                    | what                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| `npm run data:fetch`      | every upload from the 3 tracked channels → `raw/`                         |
| `npm run data:parse`      | parse → substrate + registry + report, then emit                          |
| `npm run data:build`      | fetch + parse                                                             |
| `npm run data:emit`       | re-derive the generic artifacts from the committed substrate (no network) |
| `npm run data:characters` | rescrape the roster + art (`--force` re-downloads)                        |
| `npm run data:expiries`   | `--check` the self-expiring gates; exits 1 when something is due          |
| `npm run data:versions`   | cross-check the patch table against the SuperCombo wiki (network)         |
| `npm run test:e2e`        | the full audit suite against `.vercel/output/static`                      |
| `npm run typecheck`       | app track (`vue-tsc`) + pipeline track (`tsc`) + the era/patch validators |

## Seasons, not Years

SF6's balance eras are **Seasons**. Capcom and the community name the annual
all-character balance passes "Season 2" (Akuma, 2024-05-22) and "Season 3"
(Elena, 2025-06-03). "Year N" is the separate **DLC Character Pass**, and it is
offset by about two months — the Year 3 pass opens with Sagat on 2025-08-05,
two months after Season 3 started. Anchoring on the balance overhaul is what a
meta database wants; calling it a Season is what the audience already calls it.

Boundaries live in `scripts/seasons.ts` and are the _only_ input to
`Replay.patch`. They anchor on the annual overhaul, never on the internal
version number — "major = season" is a trap here, since the 1.x line spans
Seasons 1–2 and 2.x begins mid-Season-3. An all-character balance pass does not
imply a new season either: 1.08 and 2.02 are both roster-wide and both
mid-season. The table is an explicit hardcoded list for exactly that reason.

There is **no label-grace window and no conflict counter** (Tekken has both).
The build recon read all 22,212 uploads across the three channels: not one
labels a season or a year, anywhere. A grace window would be dead code that can
only ever read zero. `confirmed` replaces it as the cross-check — see below.

## Patches under seasons

`Replay.patch` carries the **patch** token (`2.0301`), not the era token. The
season is its parent in the grouped facet, so a chip toggles the whole era, the
dropdown filters one patch, and `?patch=S3` still returns every S3 replay —
the engine expands a parent selection to itself plus its children, so links
that predate the patch layer keep their exact counts.

`PATCHES` sits beside `SEASONS` in `scripts/seasons.ts` because the two tables
are not independent: **an era opens ON a patch**, so `SEASONS[n].start` must
equal the date of the first patch nested under it, and a validator that cannot
see both tables cannot enforce that. `npm run typecheck` runs both validators.

Version ids are the SuperCombo wiki's `gameversion` strings **verbatim** — the
PC/Steam ids. Capcom's full form is `X.YYZZ.RRR`; the dot falls after `ZZ`, so
`2.01` (2.0100.000) and `2.0111` (2.0111.000) are one field at two values —
siblings, not parent and child. **Do not fold them the way Tekken folds its
`X.YY.ZZ` hotfixes**: that would merge two separately dated balance patches and
mint `2.03` for the Ingrid update, a token that denotes a build which never
shipped. Never invent a version to fill a sequence gap.

What does fold: builds Capcom ships that the wiki does not page. Two exist
(`2.0201.000`, and the 2026-07-02 battle change that got no version id at all);
both are recorded in the owning row's `includes` so they are declared rather
than silently absorbed. `npm run data:versions` diffs the table against the
wiki's Cargo API and is the only check that can catch an invented-but-
well-formed token — the offline validators cannot.

## The self-expiring gates

Three jobs this repo knows will come due, all on **2026-08-03**: Yasmine
becomes playable, Season 4 starts, and Season 4's opening patch must join the
table. Rather than relying on anyone to remember, `scripts/expiries.ts` makes
the data say so.

| where                                       | when something is due                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `scripts/characters.ts` (manual roster run) | **`exit 1`** — blocks roster work, which is exactly the work that is due                                   |
| `scripts/parse.ts` (daily cron path)        | **never exits** — prints a FAILURE banner and writes `## ⚠ ACTION REQUIRED` at the top of `data/report.md` |
| `.github/workflows/data-refresh.yml`        | a **final step, after commit and push**, that exits 1 so the run goes red                                  |

**A hard exit in `parse.ts` would stop the daily refresh entirely**, which is
strictly worse than the misfiling it warns about: the data stays overwhelmingly
correct, only the newest replays risk landing in the wrong season, and halting
ingestion fixes nothing while losing everything. So the daily path stays soft
and the _workflow_ goes red **after** the data is safely pushed.

> **The red workflow and the `exit 1` are the design, not a bug.** Clear them by
> doing the work below — never by deleting the check.

## New-character runbook

Fires when `data:characters` or the daily workflow starts complaining.

1. Get the accent from Claude Design — **do not invent one**. It must clear
   4.5:1 on `--color-surface` and sit ≥8–12° of hue off its roster neighbours.
   (Yasmine reads pinkish-purple, which is crowded next to `--char-juri`,
   `--char-bison`, `--char-elena` and `--char-aki`.)
2. Add `--char-<id>` to `design/handoff/tokens.css` and the same hex to
   `accents` in `app/app.config.ts`. A roster id with no token **fails loudly**
   rather than shipping an unstyled character.
3. Remove the entry from `UNRELEASED` in `scripts/expiries.ts`.
4. If Capcom's slug differs from our id (they use JP-canonical names —
   `gouki_akuma`, `vega_mbison`, `cviper`, `ehonda`), add it to `SLUG_TO_ID` in
   `scripts/characters.ts`.
5. `npm run data:characters` — the roster is rediscovered live, so the new
   character is picked up automatically; art is downloaded and optimized.
6. `npm run data:parse` and check `data/report.md`: a spike in
   `char-unresolved` means titles name a character the registry doesn't know.
7. Commit + push (redeploys).

## Season-boundary runbook

Fires when a season's `start` date arrives while it is still `confirmed: false`.

1. Verify the balance patch actually landed that day.
2. If it did: set `confirmed: true` on the `SEASONS` row in `scripts/seasons.ts`.
3. If Capcom slipped it: correct `start` **and** the previous season's `end`
   (the validator enforces contiguous windows).
4. Add the opening patch to `PATCHES` — `npm run data:versions` names it and
   its date. Use the wiki's version id verbatim; its `start` must **equal** the
   season start, which `npm run typecheck` enforces. Until that row exists the
   new season's replays carry the bare era token: correct, but coarser than
   every other season, and nothing else would ever complain about it.
5. `npm run data:emit`.
6. When a _new_ season is announced, append a `SEASONS` row with
   `confirmed: false` and its announced date, and set the previous season's
   `end` to match.

Nothing else cross-checks these dates — the channels carry no season labels — so
the gate stays hot until a human asserts the fact.

## Patch-table runbook

Fires when `npm run data:versions` reports drift, or when a patch ships.

1. Add the row to `PATCHES` in `scripts/seasons.ts`, in release order, with the
   wiki's `gameversion` verbatim and a short `note` (the DLC character or the
   headline change; a pure maintenance patch legitimately has none).
2. If Capcom shipped a build the wiki does not page, add it to the owning row's
   `includes` instead of giving it a row of its own — it has no token to use.
3. `npm run data:emit`, then check the `patches:` line in its output.

The window is never authored: each patch runs until the next one starts, then
to the era boundary.

## The parser

**Sources.** Three channels (`scripts/channels.ts`), each its own
`Replay.source`. Unlike Tekken, no source aggregates several channels:
tournament footage here is published _inside_ the same channels rather than on
a dedicated event-organizer channel.

**Is-SF6.** Two of the three carry a Street Fighter V back-catalogue, so every
record passes a title-marker test (`SF6` / `STREET FIGHTER 6` / `スト6`) first.
Tags are SEO soup on these channels and name both games; they are not a signal.

**Characters** are matched longest-alias-first with overlap suppression, so
"Dee Jay" beats "Ed" and "M. Bison" beats "Bison". The paren frequently carries
a leaderboard position (`#3 Ranked Guile`) — that is a per-character world
ranking, **not** a ladder rank; it is stripped before matching.

**Ranks** come from the _descriptions_, which write `<League> rank <Character>`.
Never scan a title for ladder words: this corpus contains handles like
"KUNG FU MASTER" and "Oil King", and a loose scan would invent ranks.
Divisions collapse to their league; Master sub-tiers and MR values collapse to
`Master`.

**Player identity** is keyed on the handle with all non-alphanumerics removed.
SF6's channels do **not** use esports org prefixes — verified across every
parseable title, not one known org (FLY, PXG, RB, MOUZ, FALCONS, ZETA, …)
appears in handle position, and the frequent leading tokens are integral parts
of names ("Oil King", "Big Bird", "Problem X", "YHC Mochi", "801 Strider").
Tekken's `stripOrgPrefix` is therefore deliberately absent — porting it would
_fragment_ real players. What genuinely fragments this corpus is spacing:
"Ending Walker" and "EndingWalker", "Problem X" and "ProblemX", "MenaRD" and
"Mena RD". Those collapse to one page, and the public id keeps the readable
hyphenated form of whichever spelling the sources use most.

**`data/overrides.json`** is honored last, by parse _and_ by standalone emit
_and_ by the e2e expectations, so a correction never means editing
`videos.json` in place — the next refresh would erase it.

## Vercel

| setting                | value                                               |
| ---------------------- | --------------------------------------------------- |
| Build command          | `npm run generate` (from `vercel.json`)             |
| Output                 | `.vercel/output/static`                             |
| `NUXT_PUBLIC_SITE_URL` | `https://replaydatabase.com` (Production + Preview) |
| `NUXT_APP_BASE_URL`    | `/sf6/` (Production + Preview)                      |

The production alias must stay **publicly reachable** — the shell's rewrite
depends on it. **Never add host-based redirects on this project**: the shell
proxies those hosts, so a host redirect is a proxy loop.

## Daily data refresh

`.github/workflows/data-refresh.yml` runs at **07:17 UTC** (the third stagger
slot, after 2XKO's 06:17 and Tekken's 06:47) and on `workflow_dispatch`. It
needs `YT_API_KEY` in the repo's Actions secrets. A diff that is only
`report.md`'s `_Generated_` timestamp does not commit, so a no-change day
produces no deploy.

## Things worth knowing

- **This repo is deliberately small.** `app/` holds three files; everything else
  is the engine layer.
- **The engine defaults are load-bearing, not laziness.** `terms` and
  `characterRouteSegment` are unset because they are already right, which is how
  the platform proves they are generic.
- **The theme must stay in `:root`, never `@theme`.** An app stylesheet does not
  pass through the engine's Tailwind root compile, so an `@theme` block ships raw
  and the browser drops it — invisible in `nuxt dev`, umbrella-themed in
  production. The e2e carries a tripwire for exactly this.
- **`@fontsource` import specifiers are extensionless** — the packages are not
  uniform, and `big-shoulders-display` has no `./*.css` export.
- **The design tokens are the source of truth for accents.** `characters.ts`
  reads the same `--char-*` block `app.config.ts` mirrors, so they cannot drift.
- **`thumb` is never emitted.** `Replay.id` is a YouTube id and the engine
  derives the thumbnail, which keeps ~1 MB out of the whale file.
- **Zero-secret static deploy.** Vercel builds from committed JSON and never
  sees an API key.

---

Street Fighter 6 is a trademark of Capcom. This is an unofficial fan project
with no affiliation to or endorsement by Capcom.

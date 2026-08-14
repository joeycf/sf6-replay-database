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
| `sourceGroups`          | Online / Tournament                | 7 tokens from 6 channels; kingArena splits per-video (classifier) |
| `patchGroups`           | season parents + 18 patch children | see "Seasons, not Years" below                                    |

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
`github:joeycf/replay-engine#v0.7.0` tag. `NUXT_APP_BASE_URL` overrides the
committed `/sf6/` base — but the committed default **is** production truth.

## Scripts

| script                      | what                                                                      |
| --------------------------- | ------------------------------------------------------------------------- |
| `npm run data:fetch`        | every upload from the 6 tracked channels → `raw/`                         |
| `npm run data:parse`        | parse → substrate + registry + report, then emit                          |
| `npm run data:build`        | fetch + parse                                                             |
| `npm run data:emit`         | re-derive the generic artifacts from the committed substrate (no network) |
| `npm run data:extract`      | resolve queued character-completion items from the footage (LOCAL only)   |
| `npm run data:characters`   | rescrape the roster + art (`--force` re-downloads)                        |
| `npm run data:expiries`     | `--check` the self-expiring gates; exits 1 when something is due          |
| `npm run data:versions`     | cross-check the patch table against the SuperCombo wiki (network)         |
| `npm run data:replay-dupes` | audit duplicate matches → paste-ready `overrides.json` fragment           |
| `npm run data:mr-probe`     | read Master Rate off each record's HUD — the same-footage signal (LOCAL)  |
| `npm run data:mr-verdicts`  | turn MR reads into per-record keep/drop for the dupe clusters             |
| `npm run test:e2e`          | the full audit suite against `.vercel/output/static`                      |
| `npm run typecheck`         | app track (`vue-tsc`) + pipeline track (`tsc`) + the era/patch validators |

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

**Sources.** Six channels (`scripts/channels.ts`) emitting seven
`Replay.source` tokens, consolidated to **Online / Tournament** filter chips
via `sourceGroups` (engine v0.5.5 — the per-video badge keeps the real channel,
and every per-channel `?src=` deep link still works). The original three plus
`kingArenaOnline` are Online; `capcomFighters`, `kingArenaTournament` and
`superFighters` are Tournament. @TheKingArena is one physical channel emitting
under **two** tokens: `parse.ts` classifies each video by title signals
("High-Level" or no event signal → online; an event signal → tournament), and a
title carrying **both** signals goes to `data/review-queue.json` — pending
items never reach the site — until a human verdict lands in `overrides.json`
via the dev-only `/dev/source-review` page (`nuxt dev` only; 404 in builds).
Tournament sides carry no ladder ranks, so overall rank coverage is lower than
the Online corpus — honest nulls, `rank` is optional per side. @EvoEvents is
the odd one out: its titles name the players but never a character, so its
records are completed from the footage HUD rather than parsed
(`charactersFromFootage` in `scripts/channels.ts`; `npm run data:extract`;
method and accuracy in `scripts/spike/README.md`).

**A side lists every character it played.** `Side.characters` is a list, not a
single value. SF6 is 1v1 and `charactersPerSide` stays 1, so an ordinary match
names one per side — but a tournament SET is several games and players
counter-pick between them (17 of the 81 Evo records). Those list every
character that side used, in first-appearance order. The engine renders,
filters and links them natively; the duo/synergy panels stay hidden, because
that axis is about SIMULTANEOUS characters, which SF6 never has.

**Curation — reading a character-completion item.** `/dev/source-review` shows
one HUD strip per sampled moment of the VOD, oldest first; SF6 prints the
character name in the top corners in tournament mode, so a side's characters
read straight down the column. Record **every** character a side played, in the
order they first appear — a tournament set is several games and players
counter-pick between them (measured: 17 of 81 Evo VODs). One caveat the strips
cannot settle by themselves: a character appearing **only** in the first or
last strips, never beside a mid-set read, may be footage bleeding in from the
adjacent set on the stream — verify it belongs to this match before recording
it.

**Duplicates.** Tournament footage overlaps — the same match gets captured by
an online channel and uploaded by event channels, and @TheKingArena re-posts
its own videos wholesale. `npm run data:replay-dupes` audits the corpus
(players+characters signature, duration-exactness tiers) and prints a
paste-ready `overrides.json` fragment; a human applies it. Kept records are
chosen by channel priority (the `CHANNELS` order — shipped incumbents first,
then CapcomFighters > KingArena > SuperFighters). Legacy duplicate pairs
entirely inside the pre-tournament corpus are report-only. The e2e fails on
any unresolved tier-A pair involving a tournament-era record.

**Duration is not evidence of same footage. MR is.** Duration-exactness is
strong on the tournament corpus and weak on the legacy one: legacy uploads are
whole-session compilations — median 626s, against 2-4 minutes for a single
first-to-2 — so two different sessions between the same players on the same
characters land within a second of each other routinely. And because
`signature()` sorts the sides (deliberately, to catch re-uploads with the player
names swapped) it also groups games where the sides swapped between rounds of
one set.

`npm run data:mr-probe` closes that gap, the way 2XKO's copy of this scanner
uses a thumbnail hash. It reads each record's **Master Rate** off the HUD. MR is
re-scored after every ranked match, so it is a property of the FOOTAGE and
survives re-encoding, re-titling and channel branding: same session, same MR.
`npm run data:mr-verdicts` turns those reads into per-record keep/drop.

Measured across the whole legacy tier-A set (2026-08-10): the scanner proposed
dropping **196** records; MR showed **118 of them were different matches**, and
only **50** were genuine duplicates. In one 3-way cluster the scanner proposed
keeping the odd match out and dropping the real duplicate pair. **Never apply
`--include-legacy` on duration alone** — the scanner now says so at runtime.

The gate is asymmetric on purpose: a record is dropped only on positive evidence
that another is the same session. A false "different" leaves a duplicate in the
archive; a false "same" deletes a match that exists nowhere else. Unread means
keep, and the cluster goes to a human — the `decided` rule from the engine's
extraction contract, applied to dedupe.

**Is-SF6.** Two of the original three carry a Street Fighter V back-catalogue,
so every record passes a title-marker test (`SF6` / `STREET FIGHTER 6` /
`スト6`) first. Tags are SEO soup on these channels and name both games; they
are not a signal. The tournament-era channels put the marker in the
_description_ (1,025/1,025 CapcomFighters match uploads, 0 in titles), so
`ChannelConfig.sf6Signal` widens the gate to `titleOrDescription` per channel —
safe there because those channels post-date SF6 or lose their pre-SF6 history
to the launch-date gate.

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

`vercel.json` carries one **path** redirect, `/` → `/sf6`. The build nests every
route under `app.baseURL`, so this project's own root holds nothing but
`404.html` — which is what the Vercel dashboard's Visit link used to land on. Two
constraints keep it safe, and both are easy to "improve" into an outage:

- The destination stays **relative**. An absolute `https://replaydatabase.com/sf6`
  would fire on every **preview** deployment too, bouncing a reviewer off the
  preview they meant to inspect and onto production.
- It stays a **path** redirect, never a host one — see above.

It cannot disturb the shell, which only ever requests `/sf6` and `/sf6/*` at this
child, never `/`.

### Analytics

Both SDKs are Vercel-native, inert outside production, and inject nothing into
the prerendered HTML — they attach client-side:

- **Web Analytics** — reports to **this project**, via
  `observability.insights: '/sf6-insights'` in `app/app.config.ts`.
- **Speed Insights** — reports to the **shell's** project at `sampleRate 0.5`.
  Not per-game on purpose: Speed Insights is single-project on Hobby.

The wiring lives in the engine (`app/plugins/vercel-observability.client.ts`);
this repo configures only the endpoint. That one line is **paired with a rewrite
in the shell's `vercel.json`** — `/sf6-insights/:path*` →
`https://sf6-replay-database.vercel.app/_vercel/insights/:path*`. Change one
without the other and every beacon 404s, silently.

That is not hypothetical: the Phase-5 subpath cutover killed analytics outright
for ~10 days. Vercel bakes a per-project obfuscated script path into each build,
and proxied onto the apex it 404s, so both SDKs reported **nothing** — dropped,
not misattributed. `npm run test:e2e` now gates the wiring, and the shell's
`verify:cutover` gates that it resolves through the apex.

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

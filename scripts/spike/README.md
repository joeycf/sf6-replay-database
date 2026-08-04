# Evo visual character extraction — the spike

`@EvoEvents` is the one channel `scripts/channels.ts` evaluated and deliberately
did **not** track. Its titles name the players, the game and the bracket round,
but never the characters — "Evo 2026: MenaRD vs Shigematsu | Street Fighter 6 |
Grand Final" — and `emit.ts` hard-fails a side without one. The information
exists only in the footage. Tekken hit the same wall on the same channel and
recorded the same verdict.

This directory measures whether that information can be read off the video.
**It can: 81/81 videos exact against hand-labelled ground truth.**

## The corpus

| gate                                                              | remaining |
| ----------------------------------------------------------------- | --------- |
| all uploads                                                       | 2,748     |
| SF6-marked (title or description)                                 | 150       |
| not live / not #shorts / ≥120s / post-launch                      | 144       |
| **match-shaped** (a versus title, minus streams and compilations) | **81**    |

81 single-match VODs, 910 minutes, across 8 events from Evo 2023 to Evo 2026.
`evo-corpus.ts` derives this and caches it; the filter reuses `parse.ts`'s own
predicates so a number here means the same thing as a number in `report.md`.

One filter trap worth remembering: `Top \d+` cannot be used as a
compilation marker. Evo writes the bracket round as "Top 24" / "Top 96" /
"Losers Top 8", so filtering on it eats six real single matches. The versus
shape already excludes every stream and compilation on its own.

## What the footage actually shows

SF6 in **tournament mode** prints the CHARACTER name in the top two corners —
left-aligned from x≈11, right-aligned to x≈1270 at 720p — with "Player 1" /
"Player 2" beneath. Not the CFN handle, which is what the in-game HUD shows
online. The layout is pixel-identical across Evo 2023, France 2025 and 2026,
which is what makes a fixed crop viable at all.

The crop stops short of the Capcom hexagon badge beside each nameplate: it is a
glyph-shaped "C" at a fixed offset, and including it makes tesseract read
"C BLANKA" / "KEN C" every single time.

## Why OCR and not template matching

2XKO's `scripts/fuses.ts` solves a similar problem with dHash template matching
and no OCR, and porting it was the obvious move. It was the wrong one: templates
need at least one labelled example per class, and **only 21 of the 31 characters
appear anywhere in these 81 videos**. Alex, Honda, Ingrid, Kimberly, Lily,
Manon, Marisa, Terry, Viper and Yasmine never show up — nor would any character
Capcom ships after the templates were built. OCR reads a name it has never seen
and hands it to the alias table that already exists in `data/characters.json`.

Reading is an ensemble: four luminance thresholds per crop, each fuzzy-matched
to the roster, then voted. No single threshold reads every nameplate — the
glyphs sit over the character's own animated splash art, so the separating
threshold moves with the background — but every nameplate is read by at least
one. Tesseract's own confidence is **not** usable as a signal here: it returned
0 on a perfectly correct "LUKE" and 95 on a wrong "AYU".

## A side holds every character it played

19.8% of these VODs contain a mid-set character switch, and the reads are
unanimous with sharp temporal boundaries: MenaRD went M.Bison → Blanka at the
Evo 2026 grand-finals reset; Leshar went Ed → Elena → Ed at France 2025. That
is a truth about tournament sets, not an extraction failure — so a side records
the **ordered union** of every character it played, first-appearance order.
Which game the switch happened in is deliberately not modelled.

Confidence is built on **contiguity**, not vote share. Share is actively wrong
for a union: a correct `ed` that occupies the first two frames of a seven-frame
set holds only 29% of them. What separates a real game segment from a misread is
that the segment is _consecutive_. A blank frame is neutral and does not break a
run — tournament VODs cut to crowd shots constantly, and counting those as
breaks split one real Ed segment into two rejected fragments.

## The measurement

Ground truth: all 81 hand-labelled through `/dev/source-review`, characters
never pre-filled so the labels stay blind to the extractor.

|                                 |                                        |
| ------------------------------- | -------------------------------------- |
| **Both-sides-exact**            | **81/81 · 100%**                       |
| Per-side                        | 162/162 · 100%                         |
| Sides that played 2+ characters | 17/17 · 100%                           |
| Sides that read nothing         | 0                                      |
| Confidence                      | 150/162 sides at 1.00; none below 0.50 |

**Read this with its limits.** 81 videos is a small corpus, and the labels were
read off the same HUD strips the extractor reads, so agreement partly reflects a
shared source rather than fully independent verification. The two cases where
machine and human disagreed were adjudicated against the actual video, and both
resolved in the extractor's favour — but that is two, not eighty-one.

Four fixes got from the first pass (96.3%) to 100%, each surfaced by a different
signal rather than by tuning:

1. **A missing alias.** Evo _Japan_ runs a Japanese-UI HUD where M. Bison's
   nameplate reads **VEGA**. Seven of nine frames read nothing.
2. **Short names are noise magnets.** `ed` is two letters; at edit distance 1
   any two-letter artefact matches it. Three of four phantom characters were
   `ed`. Reads of ≤2 characters now require an exact alias hit.
3. **Nine samples is too few to judge a single frame.** Four videos had a
   character in exactly one frame. Re-sampling just those at ~20 frames proved
   `cammy` real and recovered a `juri` the first pass had missed entirely.
4. **Blank frames were breaking runs** (above).

## Auto-accept threshold: 0.90

| threshold | precision | coverage  | videos to review |
| --------- | --------- | --------- | ---------------- |
| ≤ 0.50    | 100%      | 100%      | 0                |
| 0.75      | 100%      | 98.8%     | 1                |
| **0.90**  | **100%**  | **97.5%** | **2**            |
| 1.00      | 100%      | 86.4%     | 11               |

With no errors left in the labelled set, precision is 100% everywhere and the
threshold cannot be tuned against observed mistakes — 0.90 is a prudence margin
for unseen footage. It was the knee while errors still existed, and it costs two
videos of review. What a threshold cannot do is rescue a confidently-wrong read:
the worst error of the first pass sat at confidence 1.00 and was fixed at the
reader, not the gate.

## Cost, and the ToS position

First acquisition is **119.5s and 22.3 MB per video** — 161 minutes and 1.81 GB
for the corpus, almost all of it download and politeness sleeps. Re-folding from
cached frames is **1s per video** (93s for all 81), which is why per-frame reads
are now persisted: changing the fold or fixing an alias no longer costs a
re-read.

Downloading segments sits outside YouTube's ToS. The scale here is a few
one-second windows per VOD for a fan archive, and the same platform already does
this at 5,391 videos in the 2XKO repo — but it is a judgement call the operator
makes, not the tool. Downloads are cookie-authenticated (cookieless hits a
bot-check immediately), paced with a sleep after **every** attempt including
failures, and abort loudly on a bot-check rather than grinding. Across ~810
downloads: zero 403s, 429s or bot-checks.

GitHub Actions is **not** a viable host for this — 2XKO's README records that
datacenter IPs are routinely blocked, so its own daily Action never runs
yt-dlp. The design is local-first: the cron queues new VODs as pending, a local
run resolves them, low confidence stays for a human.

## Running it

```bash
tsx scripts/spike/evo-corpus.ts          # enumerate + gate the corpus (needs YT_API_KEY)
tsx scripts/spike/extract-chars.ts       # download frames + read them (resumable)
tsx scripts/spike/extract-chars.ts --force   # re-fold from cached frames, no downloads
tsx scripts/spike/queue-evo.ts           # load the corpus into data/review-queue.json
tsx scripts/spike/snapshot-labels.ts     # protect hand labels → cache/evo/ground-truth.json
tsx scripts/spike/accuracy.ts            # score the extractor against them
tsx scripts/spike/inspect.ts <id> <p1|p2>    # per-frame reads for one side
```

Everything lands in the gitignored `cache/evo/`. `queue-evo.ts` writes the
committed `data/review-queue.json` — restore it with `git restore` or any
`data:parse` when a labelling session ends, or the e2e gate that ties the queue
to `report.md`'s pending count will fail.

**Hand labels are the expensive artifact.** They live in `data/overrides.json`
as uncommitted working-tree edits; run `snapshot-labels.ts` after every session,
and `--restore` to put them back if the file is ever reverted.

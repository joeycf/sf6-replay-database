## ⚠ ACTION REQUIRED

- **yasmine** (unreleased-character, due 2026-08-03)
  yasmine is now playable. Add --char-yasmine to design/handoff/tokens.css (accent from Claude Design — contrast ≥4.5:1 on --color-surface and a hue ≥8-12° off its roster neighbours), add the same hex to accents in app/app.config.ts, drop the entry from UNRELEASED in scripts/expiries.ts, then run `npm run data:characters`.

- **S4** (unconfirmed-season, due 2026-08-03)
  Season 4 was scheduled for 2026-08-03 and is still unconfirmed. THREE jobs, all in scripts/seasons.ts: (1) verify the balance patch actually landed that day — if it did, set confirmed: true on the SEASONS row; if Capcom slipped it, correct `start` (and the previous season's `end`). (2) Add the opening patch to PATCHES with the version id the SuperCombo wiki gives it — verbatim, never folded or invented; `npm run data:versions` will name it. Its `start` must EQUAL the season start, which `npm run typecheck` enforces. (3) Re-run `npm run data:emit`. Until the patch row exists, S4 replays carry the bare era token — correct, but coarser than every other season. Nothing else cross-checks the boundary date; the tracked channels carry no season labels.

---

# SF6 pipeline report

**22739 matches** parsed from 32816 uploads across 6 channels · 1925 players · ranked sides 20775/45478 (45.7%)

| channel | source | uploads | is-SF6 | parsed | of SF6 | ranked sides |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| highLevel | highLevel | 5732 | 5732 | 5715 | 99.7% | 11028 |
| fgcPlace | fgcPlace | 9707 | 8715 | 8543 | 98.0% | 9747 |
| sfReplays | sfReplays | 6910 | 5912 | 5369 | 90.8% | 0 |
| capcomFighters | capcomFighters | 7979 | 1585 | 1022 | 64.5% | 0 |
| kingArena | kingArenaOnline / kingArenaTournament | 2354 | 2339 | 2022 | 86.4% | 0 |
| superFighters | superFighters | 134 | 133 | 68 | 51.1% | 0 |

kingArena classifier: online 1391 · tournament 746 · resolved by hand 38 · pending 0

Pending review: 0 (data/review-queue.json)

Seasons: S1 5370 · S2 7820 · S3 9545 · S4 4

Rank distribution (side appearances): Legend 18390 · Master 2371 · Diamond 14

Misses by reason: not-sf6 8400 · no-vs-title 993 · char-unresolved 167 · shorts 138 · short-duration 102 · pre-launch 93 · bad-handle 27 · live-or-upcoming 1

## Sample misses (first 30 that are not shorts/live/not-sf6)

- `ghYikMW_714` [highLevel] char-unresolved: SF6 ▰ KAKERU (Yasmine) vs KUMAGAI (C.Viper) ▰ Street Fighter 6 Gameplay
- `319W9HjMwk0` [highLevel] char-unresolved: SF6 ▰ KAZUNOKO (Yasmine) vs YAS (Yasmine) ▰ Street Fighter 6 Gameplay
- `_IJvF_UGlJM` [highLevel] char-unresolved: SF6 ▰ LESHAR (#1 Ranked Akuma) vs BAROU BOGARD (BLAZ?) (Terry) ▰ High Level Gameplay
- `5Ur7wSD7zcA` [highLevel] char-unresolved: SF6 ▰ AKUTAGAWA (#1 Ranked Manon / Terry) vs KAZUNOKO (#1 Ranked C.Viper) ▰ High Level Gameplay
- `54tKxbIBICE` [highLevel] char-unresolved: SF6 ▰ BONCHAN (Sagat / Akuma) vs YHC-MOCHI (#1 Ranked Dhalsim) ▰ High Level Gameplay
- `T4Itiuc-xOU` [highLevel] bad-handle: SF6 ▰ BONCHAN (#1 Ranked Sagat) vs ネコと和解せよ (A.K.I.) ▰ High Level Gameplay
- `w45GpYB54yI` [highLevel] char-unresolved: SF6 ▰ MENARD (Blanka) vs LESHAR (Ed / Terry) ▰ High Level Gameplay
- `tmSEePY_yT4` [highLevel] char-unresolved: SF6 ▰ MENARD (Blanka) vs HOTDOG (M.Bison / Dee Jay) ▰ High Level Gameplay
- `fZwECvlvUtc` [highLevel] char-unresolved: SF6 ▰ HIKARU (#1 Ranked A.K.I.) vs DOGURA (#1 Ranked Elena / M.Bison) ▰ High Level Gameplay
- `ylTUxq2YO8s` [highLevel] char-unresolved: SF6 ▰ PUNK (Elena) vs NEPHEW (Mai / Juri) ▰ High Level Gameplay
- `i8Fme98-pCo` [highLevel] char-unresolved: SF6 ▰ BLAZ (#1 Ranked Ryu) vs KAZUNOKO (Cammy/Mai) ▰ High Level Gameplay
- `V2oNIKAjl5s` [highLevel] char-unresolved: SF6 ▰ XIAOHAI (Mai/Akuma) vs TOKIDO (Ken) ▰ High Level Gameplay
- `iVV7LjtCa5U` [highLevel] char-unresolved: SF6 ▰ PUNK (Cammy) vs NEPHEW (Mai / Juri) ▰ High Level Gameplay
- `4Cgq3Mgsk0g` [highLevel] bad-handle: SF6 ▰ MOKE (Chun-Li) vs ネコと和解せよ (A.K.I.) ▰ High Level Gameplay
- `cdaJjRoR-Mc` [highLevel] bad-handle: SF6 ▰ NARUO (#1 Ranked Jamie) vs ネコと和解せよ (A.K.I.) ▰ High Level Gameplay
- `QqyUfr1Pfqs` [highLevel] char-unresolved: SF6 ▰ XIAOHAI (M.Bison) vs MENARD (Blanka/Luke) ▰ High Level Gameplay
- `CzqtVUFUCK0` [highLevel] char-unresolved: SF6 ▰ PUNK (M.Bison) vs PR BALROG (Blanka/Juri) ▰ High Level Gameplay
- `FKibVyO2BtM` [fgcPlace] char-unresolved: SF6 🤜 KAZUNOKO (#1 Ranked Yasmine) vs TANTAN MEN (#3 Ranked Jamie) 🤛 SF6 DLC: Yasmine day 1
- `mFASvysGy5s` [fgcPlace] char-unresolved: SF6 🤜 YAS (Yasmine) vs KAZUNOKO (Yasmine) 🤛 SF6 DLC: Yasmine day 1
- `eMLvLdMIkcs` [fgcPlace] no-vs-title: SF6 🤜 KAKERU (Ingrid) 🤛 Street Fighter 6 DLC: Ingrid Day 1 gameplay
- `ii9OdjTfwgg` [fgcPlace] char-unresolved: SF6 🤜 LESHAR (#1 Ranked Akuma) vs ARMPEROR (#2 Ranked Ken / Ryu) 🤛 SF6 High Level Gameplay
- `iV4FeYUvf_w` [fgcPlace] char-unresolved: SF6 🤜 SHUTO (#2 Ranked Ryu / Akuma) vs HINAO (#2 Ranked Sagat / Ryu) 🤛 SF6 High Level Gameplay
- `xhYXVRy-ii0` [fgcPlace] char-unresolved: SF6 🤜 SHUTO (#9 Ranked M. Bison / Ryu) vs KAWANO (#5 Ranked Akuma) 🤛 SF6 High Level Gameplay
- `NgOIwfkqkl4` [fgcPlace] char-unresolved: SF6 🤜 KAZUNOKO (Jamie / C. Viper) vs YANGMIAN (#7 Ranked Terry) 🤛 SF6 High Level Gameplay
- `AZeJuZnh0_Q` [fgcPlace] no-vs-title: SF6 🤜 KAKERU (JP) 🤛 SF6 High Level Gameplay with Input History + Frame Data
- `HAv03DZyYvE` [fgcPlace] no-vs-title: SF6 🤜 KOBAYAN (#5 Ranked Zangief)  🤛 SF6 High Level Gameplay with Input History + Frame Data
- `wOZOal6KlmE` [fgcPlace] char-unresolved: SF6 🤜 Bonchan (#1 Ranked Sagat) vs NL (Ryu / Akuma) 🤛 SF6 High Level Gameplay
- `2KBYuKyoeTI` [fgcPlace] char-unresolved: SF6 🤜 Tokido (JP) vs Hinao (Terry / Ryu) 🤛 Street Fighter 6 High Level Gameplay
- `1W90e_ae6VM` [fgcPlace] no-vs-title: SF6 ▰ LATIF (C. Viper) ▰ Street Fighter 6 High Level Gameplay
- `W2OVkfTiT1c` [fgcPlace] no-vs-title: SF6 ▰ HIKARU (C. Viper) ▰ Street Fighter 6 C. Viper Day One

_Generated 2026-08-03T10:56:07.008Z_

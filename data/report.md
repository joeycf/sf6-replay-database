
# SF6 pipeline report

**24425 matches** parsed from 36347 uploads across 7 channels, plus 1065 from 1 index · 2341 players · ranked sides 21381/48850 (43.8%)

| channel | source | uploads | is-SF6 | parsed | of SF6 | ranked sides |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| highLevel | highLevel | 5834 | 5834 | 5819 | 99.7% | 11224 |
| fgcPlace | fgcPlace | 9935 | 8943 | 8758 | 97.9% | 10157 |
| sfReplays | sfReplays | 7104 | 6105 | 5523 | 90.5% | 0 |
| capcomFighters | capcomFighters | 8051 | 1657 | 1035 | 62.5% | 0 |
| evoEvents | evoEvents | 2764 | 154 | 81 | 52.6% | 0 |
| kingArena | kingArenaOnline / kingArenaTournament | 2502 | 2487 | 2075 | 83.4% | 0 |
| superFighters | superFighters | 157 | 156 | 69 | 44.2% | 0 |
| replayTheater _(carried)_ | replayTheater | — | — | 1065 | — | 0 |

### Index intakes

Fetched by the daily cron since 2026-09-02, and ADD-ONLY: a committed record is
carried whether or not the catalogue still lists it, so this count can only rise.
The cron does not depend on the pull succeeding — on any failure there is no dump,
the committed records are carried, and the run stays green.

| intake | records | pin | this run | pages | new | not in this pull |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| `replayTheater` | 1065 | 1065 | carried (pull found no new tournament entries) | — | — | — |

_The pull ran and found no new tournament entries, so the committed_
_catalogue was carried unchanged._
_The cursor still advanced — a quiet day is the ordinary case here,_
_not a failed one._

kingArena classifier: online 1403 · tournament 791 · resolved by hand 38 · pending 0

Pending review: 0 (data/review-queue.json)

Seasons: S1 6225 · S2 8025 · S3 9574 · S4 601

Rank distribution (side appearances): Legend 18960 · Master 2407 · Diamond 14

Misses by reason: not-sf6 11011 · no-vs-title 1170 · shorts 184 · char-unresolved 166 · short-duration 118 · pre-launch 93 · bad-handle 27 · live-or-upcoming 4

## Replay Theater cross-check

An independent reading of **10242** of our own records, from the catalogue's
UNTAGGED entries — online replays it indexes that we also parse from a tracked
channel. Neither side saw the other, so this is the only accuracy number here the
pipeline did not produce about itself. It changes nothing: a disagreement is
recorded in data/theater-disagreements.json with both claims, never written into
a record. The catalogue does not outrank a confident parse and never outranks a
human override.

_Measured on the last full sweep, at catalogue entry 488158. 3968 catalogue video(s) are ones_
_we do not hold; 0 are VODs the catalogue segments, which the intake owns._

| field | population | agree | partial | disagree | cannot witness |
| --- | ---: | ---: | ---: | ---: | ---: |
| players (both handles) | 10242 | 10234 (99.92%) | 8 | 0 | — |
| characters (per side) | 20484 | 20477 (99.97%) | 0 | 7 (0.03%) | 0 |

Side order differed on **6** record(s); the comparison realigns on the
handles before reading characters, so a swapped pair is not counted twice as a
character disagreement.

**7 disagreement(s)** — both claims, ours first:

- `b01K6Wa4frw` side 1 characters: **guile** vs catalogue **alex** — SF6 🤜 HOTDOG (#6 Ranked Ingrid) vs RAINPRO (#2 Ranked Guile) 🤛 SF6 H
- `RL9SGBeZOKY` side 1 characters: **jp** vs catalogue **sagat** — SF6 🤜 Tokido (#5 Ranked JP) vs DingChunQiu (#4 Ranked JP) 🤛 SF6 High
- `bzZHNuTILXg` side 1 characters: **sagat** vs catalogue **zangief** — SF6 ▰ DAIGO (#1 Ranked Akuma) vs NARUO (Sagat) ft. KOBAYAN (Zangief) ▰
- `iEnFA_Wffco` side 1 characters: **chunli** vs catalogue **zangief** — SF6 ▰ NARUO (Sagat) vs MOKE (Chun-Li) ▰ High Level Gameplay
- `z7HBGS7BnEQ` side 1 characters: **mai** vs catalogue **chunli** — SF6 🔥 RYUKICHI (Ken) vs MOKE (Mai) 🔥 Street Fighter 6 High Level Gam
- `SPfYssZSehc` side 1 characters: **marisa** vs catalogue **zangief** — SF6 🔥 Angrybird (Ken) vs Itazan (Marisa) 🔥 Street Fighter 6
- `Tax1cqHXuWo` side 1 characters: **juri** vs catalogue **cammy** — SF6 🔥 Daigo (Ken) vs Mago (Juri) 🔥 Street Fighter 6

## Sample misses (first 30 that are not shorts/live/not-sf6)

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
- `XVbwDKpGMoU` [fgcPlace] no-vs-title: SF6 ▰ PUNK (C. Viper) ▰ Street Fighter 6 C. Viper Day One
- `OietG9sXcAc` [fgcPlace] no-vs-title: SF6 ▰ KAKERU (C. Viper) ▰ Street Fighter 6 C. Viper Day One
- `-C8xn378TZw` [fgcPlace] no-vs-title: SF6 ▰ TOKIDO (JP) vs High Ranked Players ▰ Street Fighter 6 High Level Gameplay
- `sg3bURkZTnI` [fgcPlace] no-vs-title: SF6 ▰ BONCHAN (#1 Ranked Sagat) vs High Ranked Players ▰ Street Fighter 6 High Level Gameplay

_Generated 2026-09-05T11:20:12.406Z_

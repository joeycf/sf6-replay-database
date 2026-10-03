
# SF6 pipeline report

**24876 matches** parsed from 34418 uploads across 7 channels, plus 1065 from 1 index · 2345 players · ranked sides 21842/49752 (43.9%)

| channel | source | uploads | is-SF6 | parsed | of SF6 | ranked sides |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| highLevel | highLevel | 5879 | 5879 | 5864 | 99.7% | 11314 |
| fgcPlace | fgcPlace | 10132 | 9140 | 8955 | 98.0% | 10528 |
| sfReplays | sfReplays | 7267 | 6268 | 5684 | 90.7% | 0 |
| capcomFighters | capcomFighters | 8198 | 1804 | 1143 | 63.4% | 0 |
| evoEvents | evoEvents | 2776 | 155 | 81 | 52.3% | 0 |
| kingArena _(frozen — channel deleted, footage gone)_ | kingArenaOnline / kingArenaTournament | — | — | 2030 | — | 0 |
| superFighters | superFighters | 166 | 165 | 54 | 32.7% | 0 |
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


Pending review: 0 (data/review-queue.json)

Seasons: S1 6225 · S2 8022 · S3 9545 · S4 1084

Rank distribution (side appearances): Legend 19408 · Master 2420 · Diamond 14

Misses by reason: not-sf6 11007 · no-vs-title 1011 · shorts 214 · char-unresolved 123 · short-duration 100 · pre-launch 93 · bad-handle 27 · live-or-upcoming 3

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

## Tournament placements — Liquipedia Tier 1–2, CC BY-SA 3.0

246 events with placements read; 179 of 2345 registry players carry a title (232 wins). 26 placed names are not in the registry yet — they are featured the day a replay of theirs is ingested, unless listed below as needing a human.

**Titled:** `menard` 11W/3R · `punk` 7W/7R · `ending-walker` 5W/5R · `big-bird` 7W/1R · `dual-kevin` 4W/4R · `kakeru` 5W/3R · `kusanagi` 3W/5R · `nephew` 3W/5R · `noahtheprodigy` 4W/4R · `angrybird` 4W/3R · `caba` 5W/2R · `dingchunqiu` 3W/4R · `mister-crimson` 5W/2R · `nuckledu` 5W/2R · `xiaohai` 5W/2R · `chris-wong` 1W/5R · `gachikun` 5W/1R · `leshar` 5W/1R · `lugabo` 4W/2R · `problem-x` 1W/5R · `uriel-velorio` 3W/3R · `blaz` 2W/3R · `higuchi` 2W/3R · `hurricane` 2W/3R · `notpedro` 1W/4R · `tokido` 4W/1R · `vxbao` 3W/2R · `bravery` 1W/3R · `brayan-job` 3W/1R · `bryan-d` 1W/3R · `fuudo` 4W/0R · `gama` 0W/4R · `idom` 2W/2R · `jabhim` 4W/0R · `shine` 2W/2R · `takamura` 2W/2R · `xian` 4W/0R · `zhen` 1W/3R · `akainu` 1W/2R · `armperor` 1W/2R · `craime` 1W/2R · `hinao` 2W/1R · `hotdog29` 2W/1R · `juicyjoe` 2W/1R · `justakid` 2W/1R · `kilzyou` 1W/2R · `kintyo` 2W/1R · `kobayan` 3W/0R · `moke` 1W/2R · `nychrisg` 1W/2R · `oil-king` 2W/1R · `phenom` 2W/1R · `sahara` 2W/1R · `sayff` 2W/1R · `shaka22` 2W/1R · `si-anik` 2W/1R · `travis-styles` 2W/1R · `uma` 2W/1R · `zangief-bolado` 1W/2R · `arma` 1W/1R · `bloo` 1W/1R · `bonchan` 1W/1R · `booce` 0W/2R · `broski` 1W/1R · `chris-tatarian` 1W/1R · `cosa` 0W/2R · `crossover` 1W/1R · `deiver` 2W/0R · `destroygodz` 1W/1R · `dookie` 1W/1R · `fluxwavez` 0W/2R · `freeser` 0W/2R · `garnet` 1W/1R · `gghalibel` 2W/0R · `go1` 1W/1R · `hibiki` 0W/2R · `itazan` 1W/1R · `joe-umerogan` 1W/1R · `jojotaro` 1W/1R · `juninho-ras` 2W/0R · `kawano` 1W/1R · `krown` 0W/2R · `kyuki` 1W/1R · `latif` 2W/0R · `marktheshark` 0W/2R · `micky` 0W/2R · `momochi` 0W/2R · `orarin` 2W/0R · `rainpro` 1W/1R · `rikemansbarnet` 1W/1R · `rof` 2W/0R · `ryukichi` 0W/2R · `s4ltykid` 1W/1R · `samoel` 1W/1R · `seo` 0W/2R · `snake-eyez` 1W/1R · `torimeshi` 0W/2R · `yamaguchi` 1W/1R · `abood-bboy` 0W/1R · `ajax-fidelity` 1W/0R · `akira` 1W/0R · `akutagawa` 0W/1R · `alphen` 0W/1R · `anunnaki` 0W/1R · `b3llz` 0W/1R · `baadshah-miya` 0W/1R · `bananaken` 0W/1R · `beslem` 0W/1R · `brandon` 0W/1R · `brian-f` 1W/0R · `brolynho` 1W/0R · `dakcorgi` 1W/0R · `despairking` 1W/0R · `dragon-legend` 0W/1R · `elchakotay` 1W/0R · `exe` 0W/1R · `fandroid` 0W/1R · `flashmetroid` 0W/1R · `gtr` 0W/1R · `gutsboom` 0W/1R · `hamad` 0W/1R · `hamood` 0W/1R · `harumi` 1W/0R · `hikaru` 0W/1R · `iamchuan` 0W/1R · `imstilldadaddy` 0W/1R · `jaccy` 0W/1R · `jiewa` 1W/0R · `joey` 0W/1R · `kami` 0W/1R · `kayne` 1W/0R · `kazunoko` 0W/1R · `keoma` 0W/1R · `kingsvega` 0W/1R · `libbro` 0W/1R · `limestone` 1W/0R · `lionheart` 0W/1R · `mikex` 1W/0R · `mimam` 0W/1R · `mindrpg` 0W/1R · `mysticsmash` 1W/0R · `naji` 0W/1R · `namikazeextm` 1W/0R · `narikun` 1W/0R · `nerotheboxer` 1W/0R · `otani` 0W/1R · `owaechan` 0W/1R · `popi` 0W/1R · `pugera` 0W/1R · `qiuqiu` 1W/0R · `raihan` 1W/0R · `railgun` 0W/1R · `randumb` 0W/1R · `ren` 0W/1R · `reynald` 0W/1R · `riddles` 1W/0R · `ronaldinhobr` 0W/1R · `salvatore` 1W/0R · `semy28` 0W/1R · `shakz` 1W/0R · `shigematsu` 0W/1R · `shuto` 1W/0R · `slice` 0W/1R · `sole` 1W/0R · `solvng` 1W/0R · `sonicfox` 1W/0R · `stealth` 1W/0R · `surini` 0W/1R · `tachikawa` 0W/1R · `tako956402` 0W/1R · `tomoecunha` 0W/1R · `valmaster` 1W/0R · `vegapatch` 0W/1R · `wfalcon` 0W/1R · `xerna` 1W/0R · `xiaozhai` 0W/1R · `yhc-mochi` 0W/1R · `yonangel` 1W/0R · `zjz` 1W/0R

**Need a human** (data/tournament-aliases.json — an id, or `null` to ignore):

- `JB` (page JB) — too-short: under three alphanumerics — add an alias row to confirm; 3 title(s), latest CPT 2024 World Warrior: US-Canada West Regional Final
- `Jr.` (page Jr.) — too-short: under three alphanumerics — add an alias row to confirm; 1 title(s), latest Topanga Championship 6 Open Qualifier Finals
- `NL` (page NL) — too-short: under three alphanumerics — add an alias row to confirm; 3 title(s), latest CEO 2025

**Weak matches** (short display-name key — confirm or `null` them):

- `Bloo` → `bloo` via name
- `cosa` → `cosa` via name
- `Krown` → `krown` via name
- `Libbro` → `libbro` via name
- `Ren` → `ren` via name
- `UMA` → `uma` via name
- `Zhen` → `zhen` via name

**Waiting for footage** (23): DARK, Darkdes, DARLAN, Deadeye ⁽ⁿᵒ ᵖᵃᵍᵉ⁾, Dudesickle06 ⁽ⁿᵒ ᵖᵃᵍᵉ⁾, GranTODAKAI.EX, ITK, Leeito94 ⁽ⁿᵒ ᵖᵃᵍᵉ⁾, M.Lizard, Maximof, MEA_MB ⁽ⁿᵒ ᵖᵃᵍᵉ⁾, Myrken, Nate Banks ⁽ⁿᵒ ᵖᵃᵍᵉ⁾, og_killakam ⁽ⁿᵒ ᵖᵃᵍᵉ⁾, Plaster King, RB, Shadoken, Shimiso ⁽ⁿᵒ ᵖᵃᵍᵉ⁾, SICKLE ⁽ⁿᵒ ᵖᵃᵍᵉ⁾, Taloobreaker, Tashi, Tw_aze, White-AshX

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

_Generated 2026-10-03T12:35:52.091Z_

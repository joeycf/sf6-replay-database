// Scan data/videos.json for records that are the SAME MATCH appearing twice —
// re-uploaded across channels or re-posted within one. Read-only: nothing here
// edits data/. The report footer prints a paste-ready overrides.json fragment;
// a human approves and applies it (audit-not-automatic, 2XKO's rationale
// verbatim: the daily cron is unattended, and a fuzzy matcher that silently
// drops a committed record is the exact failure class we must not build).
//
// Why this exists: the tournament-era intake (2026-07-31) overlaps the
// original corpus — the same real-world match gets captured by an online
// channel AND uploaded by an event channel — and @TheKingArena re-posts its
// own videos wholesale (identical title, second-exact duration, months apart:
// 152 measured in the intake recon).
//
// Matching key: players + characters — per side `player|character`, sides
// sorted, the pair joined. Side-agnostic on purpose: channels disagree about
// which player is "left". Player ids are already cross-channel canonical
// (parse.ts collapses spelling variants via idKey), so the key is strictly
// stronger than 2XKO's slugified display names.
//
// Same-footage signal: DURATION EXACTNESS, absolute seconds (never a
// percentage — re-encode drift is a fixed cost). Within an identical
// players+characters signature an integer-second collision is near-impossible
// by chance; 2XKO validated the same rule on 23 known cross-channel pairs.
// No thumbnail dHash here (2XKO needed it to break intra-channel exact-duration
// coincidences); this corpus's intra-channel duplicates are IDENTICAL-TITLE
// re-posts, so the title serves as the cheap corroborator and is reported per
// pair. Bias stays toward false negatives: a surviving duplicate is one wrong
// count, fixable later; a wrongly dropped record is silent and permanent.
//
// Tiers:
//   A  Δdur ≤ 1s   — actionable (proposed for exclusion)
//   B  Δdur ≤ 2s   — actionable only with --min-tier B
//   C  Δdur ≤ 90s  — REPORTED, never proposed (you want to see the ambiguity)
//
// decide() precedence — first rule that fires picks the KEEP side:
//   1. hand-authored override (dropping it would strand committed work)
//   2. channel priority = scripts/channels.ts order, flatMapped over
//      [source, eventSource]: the three shipped incumbents first, then the
//      user's tournament priority (capcomFighters > kingArena > superFighters)
//   3. earlier upload   4. longer cut   5. id
//
// LEGACY pairs (both sides in the pre-tournament sources) are always reported
// and never proposed unless --include-legacy: resolving shipped-vs-shipped
// duplicates is its own session with its own eyeballing.
//
// Usage: npm run data:replay-dupes [-- --min-tier A|B] [--include-legacy]
//                                  [--emit-overrides] [--json]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHANNELS } from './channels';
import type { MatchVideo, VideoOverride } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'cache', 'dupes');

const flag = (name: string): boolean => process.argv.includes(name);
const argOf = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const minTier = (argOf('--min-tier') ?? 'A').toUpperCase();
if (!['A', 'B'].includes(minTier)) {
  console.error(`✖ --min-tier must be A or B (got '${minTier}')`);
  process.exit(1);
}
const includeLegacy = flag('--include-legacy');

// channels.ts order IS the precedence (documented there); flatMap covers
// kingArena's two tokens
const PRIORITY = new Map(
  CHANNELS.flatMap((c) => (c.eventSource ? [c.source, c.eventSource] : [c.source])).map(
    (s, i) => [s as string, i] as const,
  ),
);
// The pre-tournament shipped corpus: pairs entirely inside it are legacy.
const LEGACY_SOURCES = new Set<string>(['highLevel', 'fgcPlace', 'sfReplays']);

const videos = JSON.parse(readFileSync(join(ROOT, 'data', 'videos.json'), 'utf8')) as MatchVideo[];
const overrides = JSON.parse(readFileSync(join(ROOT, 'data', 'overrides.json'), 'utf8')) as Record<
  string,
  VideoOverride
>;
// Rule 1 protects RECONSTRUCTION work only — a hand-authored sides pair whose
// drop would orphan real curation. A channel/season verdict is a routing
// decision, not work: it must NOT shield its record from dedupe, or a queue
// verdict on a tournament newcomer would out-rank a shipped incumbent
// (observed on the FUNDA winners-final pair, 2026-07-31).
const protectedOverride = (id: string): boolean => overrides[id]?.sides !== undefined;
const hasOverride = (id: string): boolean => overrides[id] != null;

/** Side-agnostic players+characters key. Player ids are parse.ts-canonical.
 *  A side's characters are SORTED into the key, not left in first-appearance
 *  order: two uploads of the same set can sample it differently and disagree
 *  about which character showed up first, but they are still the same match. */
function signature(v: MatchVideo): string {
  return v.sides
    .map((s) => `${s.player}|${[...s.characters].sort().join(',')}`)
    .sort()
    .join(' ~ ');
}

type Tier = 'A' | 'B' | 'C';
interface Pair {
  a: MatchVideo;
  b: MatchVideo;
  durDelta: number;
}
interface Row {
  tier: Tier;
  scope: 'legacy' | 'intra' | 'cross';
  keep: MatchVideo;
  drop: MatchVideo;
  rule: string;
  durDelta: number;
  sameTitle: boolean;
  flags: string[];
}

// ── candidate generation: group by signature, pair within the 90s window ─────
const pairs: Pair[] = [];
{
  const groups = new Map<string, MatchVideo[]>();
  for (const v of videos) {
    if ((v.durationSec ?? 0) <= 0) continue; // unknown-duration sentinel
    const sig = signature(v);
    (groups.get(sig) ?? groups.set(sig, []).get(sig)!).push(v);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const s = [...list].sort((p, q) => p.durationSec - q.durationSec);
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length; j++) {
        const delta = s[j]!.durationSec - s[i]!.durationSec;
        if (delta > 90) break; // sorted — nothing further is in-window
        pairs.push({ a: s[i]!, b: s[j]!, durDelta: delta });
      }
    }
  }
}

const tierOf = (p: Pair): Tier => (p.durDelta <= 1 ? 'A' : p.durDelta <= 2 ? 'B' : 'C');

/** Ordered precedence; first rule that fires picks the KEEP side. */
function decide(
  a: MatchVideo,
  b: MatchVideo,
): { keep: MatchVideo; drop: MatchVideo; rule: string } {
  const mk = (keep: MatchVideo, drop: MatchVideo, rule: string) => ({ keep, drop, rule });
  const oa = protectedOverride(a.id);
  const ob = protectedOverride(b.id);
  if (oa !== ob)
    return oa ? mk(a, b, 'hand-authored-override') : mk(b, a, 'hand-authored-override');
  const pa = PRIORITY.get(a.channel) ?? 99;
  const pb = PRIORITY.get(b.channel) ?? 99;
  if (pa !== pb) return pa < pb ? mk(a, b, 'channel-priority') : mk(b, a, 'channel-priority');
  if (a.publishedAt !== b.publishedAt)
    return a.publishedAt < b.publishedAt ? mk(a, b, 'earlier-upload') : mk(b, a, 'earlier-upload');
  if (a.durationSec !== b.durationSec)
    return a.durationSec > b.durationSec ? mk(a, b, 'longer-cut') : mk(b, a, 'longer-cut');
  return a.id < b.id ? mk(a, b, 'id-tiebreak') : mk(b, a, 'id-tiebreak');
}

const rows: Row[] = [];
for (const p of pairs) {
  const tier = tierOf(p);
  const { keep, drop, rule } = decide(p.a, p.b);
  const legacy = LEGACY_SOURCES.has(p.a.channel) && LEGACY_SOURCES.has(p.b.channel);
  const flags: string[] = [];
  if (legacy && !includeLegacy) flags.push('legacy-report-only');
  if (hasOverride(drop.id)) flags.push('drop-has-override'); // route to manual edit
  rows.push({
    tier,
    scope: legacy ? 'legacy' : p.a.channel === p.b.channel ? 'intra' : 'cross',
    keep,
    drop,
    rule,
    durDelta: p.durDelta,
    sameTitle: p.a.title.trim().toLowerCase() === p.b.title.trim().toLowerCase(),
    flags,
  });
}

// strongest first: tier, then exactness, then same-title corroboration
const TIER_ORDER: Tier[] = ['A', 'B', 'C'];
const visible = [...rows].sort(
  (x, y) =>
    TIER_ORDER.indexOf(x.tier) - TIER_ORDER.indexOf(y.tier) ||
    x.durDelta - y.durDelta ||
    Number(y.sameTitle) - Number(x.sameTitle),
);

// Proposed for exclusion: actionable tier, not blocked, DEDUPED by drop id
// (n-way clusters list one record as the drop in several pairs — without the
// dedupe the fragment would emit a duplicate JSON key).
const ACTIONABLE: Tier[] = minTier === 'A' ? ['A'] : ['A', 'B'];
const BLOCKING = ['legacy-report-only', 'drop-has-override'];
const actionable = [
  ...new Map(
    visible
      .filter((r) => ACTIONABLE.includes(r.tier) && !r.flags.some((f) => BLOCKING.includes(f)))
      .map((r) => [r.drop.id, r] as const),
  ).values(),
];

// Resolve each cluster to its ULTIMATE survivor: pairwise keeps can themselves
// be drops in a 3+ cluster; follow pointers (total order under decide() — no
// cycles) until a record that is not itself excluded.
const excludedIds = new Set(actionable.map((r) => r.drop.id));
const keepOf = new Map<string, string>();
for (const r of visible) if (!keepOf.has(r.drop.id)) keepOf.set(r.drop.id, r.keep.id);
const survivorOf = (dropId: string): string => {
  let cur = keepOf.get(dropId) ?? dropId;
  const seen = new Set([dropId]);
  while (excludedIds.has(cur) && keepOf.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = keepOf.get(cur)!;
  }
  return cur;
};

const byId = new Map(videos.map((v) => [v.id, v]));
const today = new Date().toISOString().slice(0, 10);
const fragment = (): string =>
  actionable
    .map((r) => {
      const survivor = survivorOf(r.drop.id);
      const sChannel = byId.get(survivor)?.channel ?? '?';
      return [
        `  ${JSON.stringify(r.drop.id)}: {`,
        `    "//": "duplicate of ${survivor} (${sChannel}) — Δdur ${r.durDelta}s, ` +
          `${r.sameTitle ? 'identical title' : 'differing titles'} ` +
          `[tier ${r.tier}, data:replay-dupes ${today}]",`,
        `    "dupeOf": ${JSON.stringify(survivor)},`,
        `    "exclude": true`,
        `  }`,
      ].join('\n');
    })
    .join(',\n');

// ── report ───────────────────────────────────────────────────────────────────
const count = (pred: (r: Row) => boolean) => rows.filter(pred).length;
const summary = [
  `pairs in the 90s window: ${rows.length} across ${new Set(rows.flatMap((r) => [r.keep.id, r.drop.id])).size} records`,
  ...TIER_ORDER.map(
    (t) =>
      `  tier ${t}: ${count((r) => r.tier === t)} ` +
      `(legacy ${count((r) => r.tier === t && r.scope === 'legacy')} · ` +
      `intra ${count((r) => r.tier === t && r.scope === 'intra')} · ` +
      `cross ${count((r) => r.tier === t && r.scope === 'cross')})`,
  ),
  `proposed exclusions (tier ${ACTIONABLE.join('+')}, non-legacy${includeLegacy ? ' + legacy' : ''}): ${actionable.length}`,
];

const md = [
  '# replay-dupes report',
  '',
  `_Generated ${new Date().toISOString()} · min-tier ${minTier} · include-legacy ${includeLegacy}_`,
  '',
  ...summary.map((l) => `- ${l.trim()}`),
  '',
  '## Pairs (strongest first)',
  '',
  '| tier | scope | Δs | title | rule | keep | drop | flags |',
  '| --- | --- | ---: | --- | --- | --- | --- | --- |',
  ...visible.map(
    (r) =>
      `| ${r.tier} | ${r.scope} | ${r.durDelta} | ${r.sameTitle ? 'same' : 'diff'} | ${r.rule} ` +
      `| \`${r.keep.id}\` ${r.keep.channel} | \`${r.drop.id}\` ${r.drop.channel} | ${r.flags.join(' ') || '—'} |`,
  ),
  '',
  '## Kept ← dropped (proposed)',
  '',
  ...actionable.map((r) => {
    const survivor = survivorOf(r.drop.id);
    const s = byId.get(survivor);
    return [
      `- KEEP \`${survivor}\` [${s?.channel}] ${s?.title.slice(0, 100)}`,
      `  DROP \`${r.drop.id}\` [${r.drop.channel}] ${r.drop.title.slice(0, 100)}`,
    ].join('\n');
  }),
  '',
  '## To apply',
  '',
  '1. Paste the fragment below into `data/overrides.json` (or run with `--emit-overrides`).',
  '2. `npm run data:parse` — excluded ids never reach `videos.json`; stats and players re-derive.',
  '3. Confirm the record count dropped by exactly the number of entries added.',
  '',
  'Reversal: delete the entry and re-parse — the source of truth is still raw/,',
  'and these channels are fetched daily, so the record returns on the next build.',
  '',
  '```json',
  fragment(),
  '```',
  '',
].join('\n');

mkdirSync(CACHE, { recursive: true });
writeFileSync(join(CACHE, 'replay-dupes.md'), md, 'utf8');
writeFileSync(
  join(CACHE, 'replay-dupes.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      minTier,
      includeLegacy,
      rows: visible.map((r) => ({
        tier: r.tier,
        scope: r.scope,
        durDelta: r.durDelta,
        sameTitle: r.sameTitle,
        rule: r.rule,
        keep: r.keep.id,
        drop: r.drop.id,
        flags: r.flags,
      })),
      proposed: actionable.map((r) => ({ drop: r.drop.id, keep: survivorOf(r.drop.id) })),
    },
    null,
    2,
  ) + '\n',
  'utf8',
);

console.log(summary.join('\n'));
console.log(`\nreport → cache/dupes/replay-dupes.md (+ .json)`);
if (flag('--json')) console.log(JSON.stringify({ proposed: actionable.length }));
if (flag('--emit-overrides')) {
  console.log('\n── paste into data/overrides.json ──');
  console.log(fragment());
}

// TURN MR READS INTO PER-RECORD KEEP/DROP VERDICTS.
//
// `replay-dupes.ts` proposes dropping every record in a tier-A cluster but one.
// That proposal rests on duration alone, and duration is weak here: these
// records are session compilations (median 626s, against 2-4 minutes for a
// single first-to-2), so two different sessions between the same players on the
// same characters land within a second of each other routinely. Worse, the
// scanner's signature sorts the sides — deliberately, to catch re-uploads with
// the player names swapped — so it also groups games where the sides genuinely
// swapped between rounds.
//
// MR settles it. Master Rate is re-scored after every ranked match, so it is a
// property of the FOOTAGE: same session -> same MR, and it survives re-encoding,
// re-titling and channel branding. See scripts/mr-probe.ts for the reader.
//
// THE POLICY IS DELIBERATELY ASYMMETRIC. A record is dropped only on positive
// evidence that another record is the same session. Everything else is kept:
//   agree      -> duplicate, drop all but one
//   differ     -> different sessions, keep every record (the scanner was wrong)
//   undecided  -> unread, keep, and route the cluster to a human
// A false "differ" leaves a duplicate in the archive. A false "agree" deletes a
// match that never existed anywhere else. Those costs are not symmetric, so the
// gate is not symmetric either — the `decided` rule from the engine's
// extraction contract, applied to dedupe.
//
// EVIDENCE IS A SET, NOT A VALUE. A compilation's MR changes mid-video, and two
// uploads of one session may carry different lead-ins, so "equal at the same
// wall-clock second" is too strict a test for sameness. Each record therefore
// accumulates every MR pair read from it, and two records are the same session
// iff their sets INTERSECT. Where the first pass read a cluster's members at
// different offsets, a second pass re-reads all of them on a common schedule
// (cache/dupes/mr-matched.json) and those reads join the sets.
//
// Grouping is the connected components of that intersect relation, so a
// three-way cluster can split into "these two are one session, that one is
// not" — which is the shape a human found first, by eye, on cluster 001.
//
//   npm run data:mr-verdicts            write cache/dupes/mr-verdicts.json + .md

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'cache', 'dupes');

interface Member {
  id: string;
  title: string;
  channel: string;
  durationSec: number;
  dur: string;
  published: string;
  keep: boolean;
}
interface Cluster {
  n: number;
  ids: string[];
  size: number;
  maxDelta: number;
  anySameTitle: boolean;
  members: Member[];
}
interface MrRead {
  p1: string | null;
  p2: string | null;
  at: number | null;
  decided: boolean;
}

export type Verdict = 'duplicate' | 'partial' | 'different' | 'human';

export interface ClusterVerdict {
  n: number;
  verdict: Verdict;
  /** ids this pass would exclude */
  drop: string[];
  /** id each dropped record is a duplicate OF */
  dupeOf: Record<string, string>;
  /** id -> MR pair or null */
  mr: Record<string, string | null>;
  /** true when every read used to decide came from the same offset */
  matched: boolean;
  scannerDrop: string[];
}

export function computeVerdicts(): ClusterVerdict[] {
  const clusters = JSON.parse(readFileSync(join(OUT, 'review-clusters.json'), 'utf8')) as Cluster[];
  const probe = JSON.parse(readFileSync(join(OUT, 'mr-probe.json'), 'utf8')) as Record<
    string,
    MrRead
  >;
  const matchedPath = join(OUT, 'mr-matched.json');
  const matched: Record<string, Record<string, string[]>> = existsSync(matchedPath)
    ? (JSON.parse(readFileSync(matchedPath, 'utf8')) as Record<string, Record<string, string[]>>)
    : {};

  return clusters.map((c) => {
    // Every record's MR evidence is a SET. The first pass contributes one value;
    // the common-schedule re-read contributes several. Sets are the right unit
    // because a compilation's MR changes mid-video and two uploads of one
    // session may have different lead-ins, so "equal at the same wall-clock
    // second" is too strict a test for sameness.
    const re = matched[String(c.n)];
    const evidence: Record<string, string[]> = {};
    for (const id of c.ids) {
      const s = new Set<string>();
      if (probe[id]?.decided) s.add(`${probe[id]!.p1}/${probe[id]!.p2}`);
      for (const v of re?.[id] ?? []) s.add(v);
      evidence[id] = [...s];
    }
    const mr: Record<string, string | null> = {};
    for (const id of c.ids) mr[id] = evidence[id]!.join(' ') || null;

    // Two records are the same session iff their MR sets INTERSECT; group by the
    // connected components of that relation, so a three-way cluster can split
    // into "these two are one session, that one is not".
    const parent = new Map(c.ids.map((id) => [id, id]));
    const find = (x: string): string => {
      while (parent.get(x) !== x) x = parent.get(x)!;
      return x;
    };
    for (const a of c.ids)
      for (const b of c.ids) {
        if (a >= b) continue;
        if (!evidence[a]!.length || !evidence[b]!.length) continue;
        if (evidence[a]!.some((v) => evidence[b]!.includes(v))) parent.set(find(a), find(b));
      }
    const groups = new Map<string, string[]>();
    for (const id of c.ids) {
      // An unread record is its own group of one. It can never be the evidence
      // that something else is a duplicate.
      const k = evidence[id]!.length ? find(id) : `unread:${id}`;
      const g = groups.get(k) ?? [];
      g.push(id);
      groups.set(k, g);
    }

    const drop: string[] = [];
    const dupeOf: Record<string, string> = {};
    for (const [k, ids] of groups) {
      if (k.startsWith('unread:') || ids.length < 2) continue;
      // Survivor = the scanner's own precedence, which already encodes channel
      // priority then earliest upload. Reuse it rather than inventing a second
      // rule that could disagree with the report a human just read.
      const order = c.members.map((m) => m.id).filter((id) => ids.includes(id));
      const survivor = order.find((id) => c.members.find((m) => m.id === id)?.keep) ?? order[0]!;
      for (const id of ids) {
        if (id === survivor) continue;
        drop.push(id);
        dupeOf[id] = survivor;
      }
    }

    const anyUnread = c.ids.some((id) => !mr[id]);
    const verdict: Verdict = anyUnread
      ? 'human'
      : drop.length === 0
        ? 'different'
        : drop.length === c.size - 1
          ? 'duplicate'
          : 'partial';

    const offsets = new Set(c.ids.filter((id) => probe[id]?.decided).map((id) => probe[id]!.at));

    return {
      n: c.n,
      verdict,
      drop,
      dupeOf,
      mr,
      // Was this comparison offset-safe? Either a common-schedule re-read covers
      // every member, or the first pass happened to read them all at one offset.
      matched: (!!re && c.ids.every((id) => (re[id]?.length ?? 0) > 0)) || offsets.size <= 1,
      scannerDrop: c.members.filter((m) => !m.keep).map((m) => m.id),
    };
  });
}

function main() {
  const v = computeVerdicts();
  const by = (k: Verdict) => v.filter((x) => x.verdict === k);
  const drops = v.reduce((n, x) => n + x.drop.length, 0);
  const scanner = v.reduce((n, x) => n + x.scannerDrop.length, 0);
  const rescued = v
    .filter((x) => x.verdict !== 'human')
    .reduce((n, x) => n + x.scannerDrop.filter((id) => !x.drop.includes(id)).length, 0);

  const md: string[] = [];
  md.push('# Legacy tier-A duplicates — MR verdicts');
  md.push('');
  md.push(`_Generated ${new Date().toISOString()}_`);
  md.push('');
  md.push('| verdict | clusters | drops |');
  md.push('|---|---:|---:|');
  for (const k of ['duplicate', 'partial', 'different', 'human'] as Verdict[])
    md.push(`| ${k} | ${by(k).length} | ${by(k).reduce((n, x) => n + x.drop.length, 0)} |`);
  md.push(`| **total** | **${v.length}** | **${drops}** |`);
  md.push('');
  md.push(`- scanner proposed **${scanner}** drops on duration alone`);
  md.push(`- MR confirms **${drops}**`);
  md.push(`- **${rescued}** records the scanner would have deleted are different matches`);
  md.push(`- **${by('human').length}** clusters carry an unread record and go to a human`);
  md.push('');
  md.push('## Clusters needing a human');
  md.push('');
  md.push('| cluster | members | MR reads |');
  md.push('|---|---|---|');
  for (const x of by('human'))
    md.push(
      `| ${x.n} | ${Object.keys(x.mr).length} | ${Object.entries(x.mr)
        .map(([id, p]) => `${id} ${p ?? '**unread**'}`)
        .join('<br>')} |`,
    );
  md.push('');

  writeFileSync(join(OUT, 'mr-verdicts.json'), JSON.stringify(v, null, 2) + '\n');
  writeFileSync(join(OUT, 'mr-verdicts.md'), md.join('\n'));

  console.log(`clusters ${v.length} · drops ${drops} (scanner wanted ${scanner})`);
  for (const k of ['duplicate', 'partial', 'different', 'human'] as Verdict[])
    console.log(`  ${k.padEnd(10)} ${String(by(k).length).padStart(3)}`);
  console.log(`  rescued from deletion: ${rescued}`);
  console.log(`→ cache/dupes/mr-verdicts.{json,md}`);
}

if (process.argv[1] && /mr-verdicts\.ts$/.test(process.argv[1])) main();

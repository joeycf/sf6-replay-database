// Cross-check the hardcoded patch table against its upstream source.
//
// WHY THIS EXISTS. scripts/seasons.ts validates the table's SHAPE and its
// agreement with the season table, but it cannot validate the table's CONTENT:
// a well-formed token for a patch Capcom never shipped passes every offline
// rule. That is not hypothetical — it is the exact mistake the version-scheme
// note in seasons.ts talks a future maintainer out of, and "2.03" would sail
// through `validatePatches` untouched. Only the source can catch it.
//
// The source is the SuperCombo wiki's Cargo table `SF6_Versions`, the same
// table its Patch Notes page renders, which states: "Version IDs and release
// dates were taken from the PC/Steam release". Our `version` is its
// `gameversion` verbatim, so the check is a set comparison plus a date
// comparison — no scraping, no parsing, no heuristics.
//
// DELIBERATELY NOT IN THE DAILY CRON. The refresh workflow must stay offline
// and deterministic apart from the YouTube intake; a wiki outage is not a data
// error and must never redden a run that produced correct data. This is a
// manual/CI gate — see the patch-table runbook in README.md.
//
// KNOWN GAP, by design: the wiki pages the builds it considers notable, not
// every build Capcom ships. Two shipped builds are absent from it today and
// are recorded in `includes` instead (see PATCHES). So this asserts "our table
// matches the source", never "our table matches every build ever shipped".

import { PATCHES } from './seasons';

const ENDPOINT =
  'https://wiki.supercombo.gg/api.php?action=cargoquery&tables=SF6_Versions' +
  '&fields=SF6_Versions.gameversion,SF6_Versions.date' +
  '&order_by=SF6_Versions.date%20ASC&limit=200&format=json';

interface CargoRow {
  title: { gameversion?: string; date?: string };
}

async function upstream(): Promise<{ version: string; start: string }[]> {
  const res = await fetch(ENDPOINT, {
    headers: { 'user-agent': 'sf6-replay-database patch-table check' },
  });
  if (!res.ok) throw new Error(`wiki responded ${res.status}`);
  const body = (await res.json()) as { cargoquery?: CargoRow[] };
  const rows = body.cargoquery ?? [];
  if (rows.length === 0) throw new Error('wiki returned no rows (schema changed?)');
  return rows.map((r) => ({
    version: (r.title.gameversion ?? '').trim(),
    // Cargo hands back "2023-06-02 00:00:00"
    start: (r.title.date ?? '').slice(0, 10),
  }));
}

const rows = await upstream().catch((err: unknown) => {
  // Cannot-verify is not drift. Say so plainly and leave the run green.
  console.warn(`⚠ patch table NOT verified — ${err instanceof Error ? err.message : String(err)}`);
  return null;
});

if (rows) {
  const ours = new Map(PATCHES.map((p) => [p.version, p.start]));
  const theirs = new Map(rows.map((r) => [r.version, r.start]));
  const drift: string[] = [];

  for (const [version, start] of theirs) {
    if (!ours.has(version)) {
      drift.push(`+ ${version} (${start}) — released upstream, missing from PATCHES`);
    } else if (ours.get(version) !== start) {
      drift.push(`~ ${version} — we say ${ours.get(version)}, the wiki says ${start}`);
    }
  }
  for (const [version, start] of ours) {
    if (!theirs.has(version)) {
      drift.push(`- ${version} (${start}) — in PATCHES, in no upstream row (invented?)`);
    }
  }

  if (drift.length === 0) {
    console.log(`✓ patch table matches the wiki — ${PATCHES.length} versions, dates identical`);
  } else {
    console.error(`\n✖ patch table has drifted from the wiki (${drift.length}):\n`);
    for (const d of drift) console.error(`  ${d}`);
    console.error(
      '\nAdd or correct the row in scripts/seasons.ts, then `npm run data:emit`.\n' +
        'A new season opener also needs its SEASONS row confirmed — the era must\n' +
        'open on the same date as its first patch.\n',
    );
    process.exit(1);
  }
}

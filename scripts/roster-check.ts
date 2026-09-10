/**
 * Roster drift check — is data/characters.json still what Capcom ships?
 *
 * WHY THIS EXISTS. A roster goes stale silently: a character who is not on it
 * fails no build and trips no assertion, they just leave every match they
 * appear in filed with one side missing. See ../check-rosters.sh.
 *
 * THIS REPO'S DRIFT RUNS THE OTHER WAY, AND THAT IS THE INTERESTING PART.
 * Everywhere else the risk is "a fighter shipped and nobody added them". Here
 * the roster is a LIVE SCRAPE, so the standing risk is the opposite: Capcom
 * pages a character AHEAD of release and an unguarded run pulls them in early.
 * That is what UNRELEASED[] in scripts/expiries.ts is for, and it is why this
 * checker reports a gated character as an expected absence rather than drift.
 * On 2026-09-09 the site listed 32 while 31 were playable — Arjun, paged five
 * weeks before his 2026-10-13 release.
 *
 * SO WHAT IS LEFT FOR THIS FILE TO CATCH, given the scrape self-heals? Three
 * things the scrape cannot tell you: a character upstream who is NEITHER on the
 * roster NOR gated (Capcom paged someone and nobody noticed, so the next roster
 * run would silently ship them); a roster id with no upstream counterpart (a
 * slug Capcom renamed, which would otherwise surface as a mystery 404); and an
 * UNRELEASED row whose date has passed while the character is still not paged —
 * a gate quietly holding back nothing.
 *
 * NETWORK, MANUAL, NEVER IN THE CRON.
 *
 * Run: npm run data:roster-check
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UNRELEASED } from './expiries';
import { SLUG_TO_ID, discoverSlugs } from './sf6-site';
import type { CharacterRecord } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

type State = 'CURRENT' | 'DRIFT' | 'UNVERIFIED' | 'UNREADABLE';
const verdict = (state: State, detail = ''): never => {
  if (detail) console.log(detail);
  console.log(`roster-check: ${state}`);
  process.exit(state === 'CURRENT' || state === 'UNVERIFIED' ? 0 : 1);
};

const today = (): string => new Date().toISOString().slice(0, 10);

async function main(): Promise<void> {
  const local = JSON.parse(
    await readFile(join(ROOT, 'data/characters.json'), 'utf8'),
  ) as CharacterRecord[];
  const localIds = new Set(local.map((c) => c.id));
  const gated = new Map(UNRELEASED.map((u) => [u.id, u]));

  let slugs: string[];
  try {
    slugs = await discoverSlugs();
  } catch (e) {
    const msg = (e as Error).message;
    // Markup drift and an unreachable host are different failures and must not
    // collapse into one verdict: the first means "nothing here is trustworthy",
    // the second means "nothing was checked".
    const unreadable = /__NEXT_DATA__|namespaces|markup drift/i.test(msg);
    return void verdict(
      unreadable ? 'UNREADABLE' : 'UNVERIFIED',
      `${unreadable ? '✖' : '!'} ${msg}`,
    );
  }

  const upstreamIds = new Set(slugs.map((s) => SLUG_TO_ID[s] ?? s));
  const missing = [...upstreamIds].filter((id) => !localIds.has(id) && !gated.has(id)).sort();
  const extra = [...localIds].filter((id) => !upstreamIds.has(id)).sort();
  const held = [...upstreamIds].filter((id) => gated.has(id)).sort();
  // A gate whose date has passed while the character is still not paged.
  const stale = [...gated.values()]
    .filter((u) => !upstreamIds.has(u.id) && today() >= u.releases)
    .map((u) => `${u.id} (due ${u.releases})`)
    .sort();

  console.log(
    `  ${upstreamIds.size} character page(s) on the site · ${localIds.size} in characters.json`,
  );
  if (held.length)
    console.log(`  ${held.length} paged but gated (correctly absent): ${held.join(', ')}`);

  if (!missing.length && !extra.length && !stale.length)
    return void verdict('CURRENT', '✓ roster matches Capcom’s character index');

  const lines = ['✖ roster has drifted from streetfighter.com', ''];
  for (const id of missing)
    lines.push(
      `  MISSING  ${id} — paged by Capcom, not on the roster and not gated.`,
      `           If they are PLAYABLE, run \`npm run data:characters\` (this roster is`,
      `           scraped, so that is the whole job) after adding --char-${id} to the`,
      `           design tokens and app.config accents.`,
      `           If they are NOT yet playable, add an UNRELEASED row in`,
      `           scripts/expiries.ts NOW — until you do, the next roster run ships them.`,
    );
  for (const id of extra)
    lines.push(
      `  EXTRA    ${id} — on the roster, with no character page upstream.`,
      `           Usually a slug Capcom renamed; check SLUG_TO_ID in scripts/sf6-site.ts`,
      `           before deleting anything, since records already reference this id.`,
    );
  for (const s of stale)
    lines.push(
      `  STALE GATE  ${s} — the date has passed and Capcom still has not paged them.`,
      `           The row is holding back nothing. Re-date it to the announced window;`,
      `           do not delete it.`,
    );
  verdict('DRIFT', lines.join('\n'));
}

await main();

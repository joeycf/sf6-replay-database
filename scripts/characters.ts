// Roster scraper — rediscovers the SF6 roster live from Capcom's official site
// each run, downloads and optimizes the art, and rewrites data/characters.json.
//
// Run: npm run data:characters   (add --force to re-download existing art)
//
// ─── THE TWO SCRAPE TARGETS, AND WHY ─────────────────────────────────────────
// streetfighter.com/6 is a Next.js site. Its visible markup uses hashed
// CSS-module class names (`detail_name__BaMNB`) that change on every site
// rebuild, so scraping the rendered HTML would break silently and often.
//
// DISCOVERY (the id list) comes from the `<script id="__NEXT_DATA__">` payload:
// props.pageProps.__namespaces carries one `character/<slug>` key per
// character, and that list is complete on every character page.
//
// NAMES come from the server-rendered `og:title` meta, NOT from that payload.
// The payload's `[t]profile__name` is populated lazily and ships EMPTY for the
// most recent characters (verified 2026-07: sagat, cviper, alex, ingrid and
// yasmine all had "" on every page tried, in both locales) — their names are
// fetched client-side. og:title is rendered server-side for every character in
// both locales:
//     EN     "<Name> | STREET FIGHTER 6 | CAPCOM"
//     ja-jp  "<名前>｜STREET FIGHTER 6（ストリートファイター6）｜CAPCOM"   (fullwidth ｜)
// That costs two requests per character instead of two in total, which is a
// fine price for names that are actually there.
//
// The site also 403s without a browser User-Agent.
//
// ─── ART ─────────────────────────────────────────────────────────────────────
// Capcom publishes exactly ONE image per character: a full-body transparent
// render at /6/assets/images/character/<slug>/<slug>.png. There is no separate
// portrait or face asset, so both sizes are derived from it:
//   splash   — the whole render, 1000w, nothing cropped
//   portrait — a 3:4 crop anchored at the TOP (the engine's roster grid renders
//              imgPortrait at `aspect-[3/4] object-cover`, so shipping the
//              uncropped render would let the browser centre-crop and behead
//              the taller characters)

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { UNRELEASED, dueExpiries, formatExpiries } from './expiries';
import type { CharacterRecord } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMG_DIR = join(ROOT, 'public', 'img', 'characters');
const SITE = 'https://www.streetfighter.com/6';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) sf6-replay-database roster scraper (fan project; contact via GitHub joeycf/sf6-replay-database)';
const FORCE = process.argv.includes('--force');

/** Capcom's slugs are JP-canonical where the western name differs. Everything
 *  not listed maps to itself. */
const SLUG_TO_ID: Record<string, string> = {
  gouki_akuma: 'akuma',
  vega_mbison: 'bison',
  cviper: 'viper',
  ehonda: 'honda',
};

/** Community shorthand, punctuation variants, and the official-name forms the
 *  channels actually write. Merged with the scraped short + full names. */
const CURATED_ALIASES: Record<string, string[]> = {
  chunli: ['chun-li', 'chun li', 'chunli'],
  honda: ['e.honda', 'e. honda', 'ehonda', 'honda', 'edmond honda'],
  deejay: ['dee jay', 'dee-jay', 'deejay', 'd.jay'],
  akuma: ['akuma', 'gouki'],
  bison: ['m.bison', 'm. bison', 'mbison', 'bison'],
  viper: ['c.viper', 'c. viper', 'cviper', 'crimson viper', 'viper'],
  aki: ['a.k.i.', 'a.k.i', 'aki'],
  mai: ['mai', 'mai shiranui', 'shiranui'],
  terry: ['terry', 'terry bogard'],
  cammy: ['cammy', 'cammy white'],
  ken: ['ken', 'ken masters'],
  zangief: ['zangief', 'gief'],
};
// Deliberately NOT aliased: 'vega' → bison. Vega-the-claw is not in SF6, so the
// JP naming would be unambiguous in principle, but no English-language channel
// in the tracked corpus writes "Vega" for Bison, and the alias would misfire on
// any stray mention. Add it only if the report shows it costing matches.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.text();
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

interface NextNamespaces {
  props: { pageProps: { __namespaces: Record<string, Record<string, string>> } };
}

/** Every character slug the official site knows about. */
async function discoverSlugs(): Promise<string[]> {
  const html = await fetchText(`${SITE}/character/ryu`);
  const m = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s.exec(html);
  if (!m) {
    throw new Error(
      `no __NEXT_DATA__ block on the character page — the official site changed shape. ` +
        'Re-derive the scrape target before trusting any roster output.',
    );
  }
  const data = JSON.parse(m[1]!) as NextNamespaces;
  const ns = data.props?.pageProps?.__namespaces;
  if (!ns) throw new Error('__NEXT_DATA__ has no props.pageProps.__namespaces — markup drift');

  const slugs = Object.keys(ns)
    .filter((k) => k.startsWith('character/'))
    .map((k) => k.slice('character/'.length))
    .sort();
  if (slugs.length === 0) throw new Error('no character/* namespaces found — markup drift');
  return slugs;
}

/** The character name from a page's server-rendered og:title. */
async function officialName(path: string, sep: string): Promise<string> {
  const html = await fetchText(`${SITE}${path}`);
  const m = /<meta property="og:title" content="([^"]*)"/.exec(html);
  if (!m) throw new Error(`no og:title at ${path} — markup drift`);
  const name = m[1]!.split(sep)[0]!.trim();
  if (!name) throw new Error(`empty og:title name at ${path} — markup drift`);
  return name;
}

/** --char-<id> accents from the design system's source of truth. */
async function loadAccents(): Promise<Record<string, string>> {
  const css = await readFile(join(ROOT, 'design', 'handoff', 'tokens.css'), 'utf8');
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--char-([a-z0-9_]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]!] = m[2]!;
  return out;
}

/** Where title-casing the official string doesn't produce the name people
 *  actually write. Capcom's og:title casing is inconsistent — some are ALL
 *  CAPS ("E.HONDA", "DEE JAY"), some already cased ("M. Bison", "C. Viper") —
 *  and "E.HONDA" has no separator for the title-caser to work with. */
const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  honda: 'E. Honda', // "E.HONDA" — no separator for the title-caser to use
  ed: 'Ed', // a name, not an initialism; "ED" is indistinguishable from "JP" by rule
};

/** Title-case the official name when it arrives ALL CAPS. */
function displayName(id: string, official: string): string {
  const override = DISPLAY_NAME_OVERRIDES[id];
  if (override) return override;
  // Already mixed-case (e.g. "M. Bison", "A.K.I.", "Sagat") → trust Capcom.
  if (official !== official.toUpperCase()) return official;
  // Two-letter all-caps names are initialisms, not shouting ("JP", "ED").
  if (/^[A-Z]{2}$/.test(official)) return official;
  // Dotted initialisms keep their caps ("A.K.I.").
  if (/^(?:[A-Z]\.){2,}$/.test(official)) return official;
  return official
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part) =>
      /^[\s-]+$/.test(part) ? part : part.replace(/^([a-z])/, (c) => c.toUpperCase()),
    )
    .join('');
}

// ── main ─────────────────────────────────────────────────────────────────────

// The self-expiring gate. In THIS script a due expiry is fatal: the roster is
// exactly the work that has come due, and shipping a roster that silently
// omits a now-playable character is worse than not shipping one. This exit(1)
// is the design — clear it by doing the work, not by deleting the check.
// (The daily pipeline path treats the same signal softly; see scripts/expiries.ts.)
const due = dueExpiries();
if (due.length > 0) {
  console.error(`\n✖ ${due.length} expiry/expiries due before the roster can be trusted:\n`);
  console.error(formatExpiries(due));
  console.error('');
  process.exit(1);
}

console.log('Reading the official roster…');
const allSlugs = await discoverSlugs();

const unreleased = new Map(UNRELEASED.map((u) => [u.id, u]));
const skipped: string[] = [];
const slugs: string[] = [];
for (const slug of allSlugs) {
  const id = SLUG_TO_ID[slug] ?? slug;
  if (unreleased.has(id)) {
    const u = unreleased.get(id)!;
    skipped.push(`${id} (playable ${u.releases}${u.note ? `, ${u.note}` : ''})`);
    continue;
  }
  slugs.push(slug);
}

console.log(`  ${allSlugs.length} character pages on the site`);
if (skipped.length > 0) {
  // Always reported, never silent: a roster that is deliberately smaller than
  // the site's index must say so out loud every single run.
  console.log(`  skipping ${skipped.length} unreleased: ${skipped.join(', ')}`);
}
if (slugs.length < 30) {
  throw new Error(
    `roster discovery looks broken: only ${slugs.length} released ids (expected ≥ 30). ` +
      'Check the official site before committing anything.',
  );
}

const accents = await loadAccents();
const missingAccents = slugs.map((s) => SLUG_TO_ID[s] ?? s).filter((id) => !accents[id]);
if (missingAccents.length > 0) {
  console.error(
    `✖ design/handoff/tokens.css has no --char-* accent for: ${missingAccents.join(', ')}\n` +
      '  Add the token(s) — the design system is the accent source of truth — then re-run.',
  );
  process.exit(1);
}

await mkdir(IMG_DIR, { recursive: true });
const out: CharacterRecord[] = [];

for (const slug of slugs) {
  const id = SLUG_TO_ID[slug] ?? slug;
  const official = await officialName(`/character/${slug}`, '|');
  await sleep(200); // be polite to the official site
  const japanese = await officialName(`/ja-jp/character/${slug}`, '｜');
  await sleep(200);

  const portraitOut = join(IMG_DIR, `${id}-portrait.webp`);
  const splashOut = join(IMG_DIR, `${id}-splash.webp`);

  if (FORCE || !existsSync(portraitOut) || !existsSync(splashOut)) {
    const buf = await fetchBuffer(`${SITE}/assets/images/character/${slug}/${slug}.png`);
    const meta = await sharp(buf).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (!W || !H) throw new Error(`${slug}: could not read image dimensions`);

    // 3:4 crop anchored at the top — heads sit at the top of these full-body
    // renders, and the roster grid object-covers to exactly 3:4.
    let cw = W;
    let chh = Math.round(W * (4 / 3));
    let cx = 0;
    if (chh > H) {
      chh = H;
      cw = Math.round(H * (3 / 4));
      cx = Math.round((W - cw) / 2);
    }
    await sharp(buf)
      .extract({ left: cx, top: 0, width: cw, height: chh })
      .resize({ width: 512 })
      .webp({ quality: 82 })
      .toFile(portraitOut);

    await sharp(buf)
      .resize({ width: 1000, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(splashOut);

    await sleep(250);
  }

  const name = displayName(id, official);
  const aliases = [
    ...new Set(
      [name.toLowerCase(), official.toLowerCase(), ...(CURATED_ALIASES[id] ?? [])]
        .map((a) => a.trim())
        .filter(Boolean),
    ),
  ];

  out.push({
    id,
    name,
    imgPortrait: `/img/characters/${id}-portrait.webp`,
    imgSplash: `/img/characters/${id}-splash.webp`,
    accent: accents[id]!,
    extra: { aliases, 'full name': official, japanese },
  });
  console.log(`  ${id.padEnd(10)} ${name.padEnd(14)} ${japanese}`);
}

out.sort((a, b) => a.id.localeCompare(b.id));
await writeFile(join(ROOT, 'data', 'characters.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`✔ data/characters.json — ${out.length} characters, art in public/img/characters/`);

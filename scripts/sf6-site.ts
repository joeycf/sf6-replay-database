/**
 * The shared read side of Capcom's official Street Fighter 6 site.
 *
 * EXTRACTED so scripts/characters.ts (which WRITES the roster) and
 * scripts/roster-check.ts (which only COMPARES it) discover characters exactly
 * the same way. Before this, characters.ts owned the only copy and could not be
 * imported at all — it runs its whole scrape at module load, so any second
 * consumer would have re-implemented discovery and the two would have drifted.
 * One enumeration, one place.
 *
 * See scripts/characters.ts for the full reasoning about WHY discovery reads
 * __NEXT_DATA__ rather than the rendered markup (hashed CSS-module class names
 * change on every site rebuild) and why names come from og:title instead of the
 * payload (it ships empty for the most recent characters).
 */

export const SITE = 'https://www.streetfighter.com/6';

/** The site 403s without a browser User-Agent. */
export const UA =
  'Mozilla/5.0 (X11; Linux x86_64) sf6-replay-database roster scraper (fan project; contact via GitHub joeycf/sf6-replay-database)';

/** Capcom's slugs are JP-canonical where the western name differs. Everything
 *  not listed maps to itself. */
export const SLUG_TO_ID: Record<string, string> = {
  gouki_akuma: 'akuma',
  vega_mbison: 'bison',
  cviper: 'viper',
  ehonda: 'honda',
};

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.text();
}

interface NextNamespaces {
  props: { pageProps: { __namespaces: Record<string, Record<string, string>> } };
}

/**
 * Every character slug the official site knows about.
 *
 * THE NAMESPACE KEY IS THE SIGNAL, AND HTTP STATUS IS NOT. Capcom's Next.js
 * catch-all serves HTTP 200 for character paths that do not exist — /character/
 * tifa, /character/bosch and /character/notarealcharacter all return 200 with no
 * og:title. Only a `character/<slug>` key in props.pageProps.__namespaces means
 * Capcom has actually paged that character. Do not "improve" this by probing URLs.
 */
export async function discoverSlugs(): Promise<string[]> {
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

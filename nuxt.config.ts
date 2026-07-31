import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { joinURL } from 'ufo';

import charactersData from './data/characters.json';
import playersData from './data/players.json';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const engineDir = fileURLToPath(
  new URL(process.env.ENGINE_PATH || '../replay-engine', new URL('.', import.meta.url)),
);

// Prerender EVERYTHING entity-shaped: the full SF6 roster + every player profile
// (players parsed from titles must not 404 on static hosting), plus the core
// routes. The engine seeds '/', '/health', '/not-found' itself and emits
// sitemap/robots/manifest/404.html from the REAL prerendered list
// (modules/static-artifacts). SF6 deliberately keeps the default
// characterRouteSegment, so the roster lives at /characters/*.
const characters = charactersData as { id: string }[];
const players = playersData as { id: string }[];
const appRoutes = [
  '/stats',
  '/characters',
  '/players',
  ...characters.map((c) => `/characters/${c.id}`),
  ...players.map((p) => `/players/${p.id}`),
];

export default defineNuxtConfig({
  extends: [process.env.ENGINE_PATH || ['github:joeycf/replay-engine#v0.6.3', { install: true }]],

  compatibilityDate: '2025-07-01',

  app: {
    // MUST stay an env expression, never a literal. A literal shadows the
    // engine's own env read (app config wins the layer merge) and
    // NUXT_APP_BASE_URL alone then flips only the runtime router, leaving the
    // prerender seeds root-based → every route 404s the build (STACK §5.3
    // desync, reproduced empirically in Phase 5). The committed default IS
    // production truth: SF6 is born behind the shell at replaydatabase.com/sf6.
    baseURL: process.env.NUXT_APP_BASE_URL || '/sf6/',
  },

  css: ['~/assets/theme.css'],

  modules: [
    // Seed the entity routes under the final resolved base (same mechanism as
    // the engine's own seeds — static prerender arrays are not base-prefixed).
    function appPrerenderSeeds(_options, nuxt) {
      nuxt.hook('nitro:init', (nitro) => {
        for (const route of appRoutes) {
          nitro.options.prerender.routes.push(joinURL(nuxt.options.app.baseURL, route));
        }
      });
    },
  ],

  nitro: {
    prerender: {
      // The /dev curation page (source-review) guards itself behind
      // import.meta.dev and 404s outside `nuxt dev`; keep the crawler from
      // discovering and prerendering it (2XKO's exact arrangement).
      ignore: ['/dev'],
    },
  },

  hooks: {
    // The client-fetched files: data/*.json (committed, pipeline-emitted) →
    // public/data/ (gitignored). Lives in the BUILD because Vercel never runs
    // the pipeline. replays.json is the engine's whale; summary.json is the
    // apex selector's card payload, fetched same-origin through the shell's
    // /sf6 rewrite (Phase 6).
    'build:before'() {
      const dataDir = join(rootDir, 'public/data');
      mkdirSync(dataDir, { recursive: true });
      for (const f of ['replays.json', 'summary.json']) {
        cpSync(join(rootDir, `data/${f}`), join(dataDir, f));
        console.log(`✓ copied data/${f} → public/data/${f}`);
      }
    },
  },

  typescript: {
    typeCheck: false,
    nodeTsConfig: {
      compilerOptions: {
        paths: {
          '@engine': [engineDir],
          '@engine/*': [`${engineDir}/*`],
        },
      },
    },
  },
});

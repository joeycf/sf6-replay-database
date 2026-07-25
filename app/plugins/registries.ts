import characters from '../../data/characters.json';
import players from '../../data/players.json';
import stats from '../../data/stats.json';

/**
 * Provide the three small registries to the engine at build time so the
 * prerendered HTML carries real data (titles, counts, roster grids) instead of
 * hydrating into it. The whale — data/replays.json — is deliberately NOT
 * provided here: the engine fetches it client-side (server: false) so it never
 * enters the prerendered payload. See the engine README §"Provide your data".
 */
export default defineNuxtPlugin(() => {
  provideRegistries({ characters, players, stats });
});

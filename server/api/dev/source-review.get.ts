import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Dev-only: the review worklist behind /dev/source-review. Serves the pending
// queue (data/review-queue.json, parse-regenerated) joined with whatever
// verdict data/overrides.json already carries, plus the roster for the
// character-completion form — one small payload, no whale. Same shipping
// guarantees as 2XKO's curation endpoints: 404 outside `nuxt dev`, and the
// static output carries no server at all. Read-only; the sibling POST writes.
//
// Shapes are restated inline rather than imported from ../../../types — the
// pipeline types deliberately never enter the Nuxt graph (types/index.ts
// header), and this endpoint only reads committed JSON.
interface QueueItem {
  id: string;
  kind: 'source-classification' | 'character-completion';
  channel: string;
  title: string;
  publishedAt: string;
  durationSec: number;
  signals?: { online: string; event: string };
}

export default defineEventHandler(() => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  const root = process.cwd();
  const read = <T>(p: string): T => JSON.parse(readFileSync(join(root, p), 'utf8')) as T;

  const queue = read<QueueItem[]>('data/review-queue.json');
  const overrides =
    read<Record<string, { channel?: string; exclude?: boolean; sides?: unknown[] }>>(
      'data/overrides.json',
    );
  const roster = read<{ id: string; name: string }[]>('data/characters.json').map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return {
    roster,
    items: queue.map((q) => {
      const ov = overrides[q.id];
      const saved = ov
        ? ov.exclude === true
          ? { verdict: 'exclude' as const }
          : ov.channel
            ? { verdict: 'channel' as const, channel: ov.channel }
            : ov.sides
              ? { verdict: 'sides' as const }
              : null
        : null;
      return { ...q, saved };
    }),
  };
});

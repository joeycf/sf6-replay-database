import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Body reader that survives the repo's h3 version skew: nitro 2.13 hands this
 *  route a v1-shaped event (`event.node.req`, a Node stream) while the hoisted
 *  `h3` package is a v2 RC whose auto-imported `readBody` calls
 *  `event.req.text()` and throws. Reading the stream directly works under
 *  either shape; the `text()` branch covers a future move to real v2 events. */
type BodySource = AsyncIterable<Buffer> & { text?: () => Promise<string> };
async function readJsonBody(event: unknown): Promise<unknown> {
  const e = event as { node?: { req?: BodySource }; req?: BodySource };
  const req = e.node?.req ?? e.req;
  if (!req) return undefined;
  let text: string;
  if (typeof req.text === 'function') {
    text = await req.text();
  } else {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    text = Buffer.concat(chunks).toString('utf8');
  }
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'invalid JSON body' });
  }
}

// Dev-only: persists ONE review verdict from /dev/source-review into
// data/overrides.json — the only file this endpoint may touch. The id must be
// in the CURRENT queue (data/review-queue.json; this tool adjudicates pending
// items, nothing else), verdicts are validated against the declared source
// tokens / the roster, and re-saving overwrites. `npm run data:parse` is
// deliberately NOT run here — the reviewer runs it after a session, and the
// queue self-clears because parse skips resolved ids (2XKO's manual-entry
// contract).
//
// Verdict shapes:
//   { id, verdict: 'channel', channel: '<source token>' }   source-classification
//   { id, verdict: 'exclude' }                              either kind (junk)
//   { id, verdict: 'sides', handles: [a, b],                character-completion
//     characters: [idA, idB], channel? }
export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  const body = (await readJsonBody(event)) as
    | {
        id?: unknown;
        verdict?: unknown;
        channel?: unknown;
        handles?: unknown;
        characters?: unknown;
      }
    | undefined;
  const id = typeof body?.id === 'string' ? body.id : null;
  const verdict = typeof body?.verdict === 'string' ? body.verdict : null;
  if (!id || !verdict || !['channel', 'exclude', 'sides'].includes(verdict)) {
    throw createError({
      statusCode: 400,
      statusMessage: "expected { id, verdict: 'channel' | 'exclude' | 'sides', … }",
    });
  }

  const root = process.cwd();
  const read = <T>(p: string): T => JSON.parse(readFileSync(join(root, p), 'utf8')) as T;

  interface QueueItem {
    id: string;
    kind: string;
    channel: string;
  }
  const queue = read<QueueItem[]>('data/review-queue.json');
  const item = queue.find((q) => q.id === id);
  if (!item) {
    throw createError({
      statusCode: 404,
      statusMessage: `id "${id}" is not in data/review-queue.json — this tool only adjudicates pending items`,
    });
  }

  // Mirrors scripts/channels.ts [source, eventSource] per intake channel —
  // restated because pipeline modules never enter the Nuxt graph. The e2e's
  // config-mirror gate catches drift structurally (every token it derives from
  // channels.ts must appear in app.config.ts sourceChannels, which this list
  // subsets).
  const CHANNEL_TOKENS: Record<string, string[]> = {
    highLevel: ['highLevel'],
    fgcPlace: ['fgcPlace'],
    sfReplays: ['sfReplays'],
    capcomFighters: ['capcomFighters'],
    kingArena: ['kingArenaOnline', 'kingArenaTournament'],
    superFighters: ['superFighters'],
  };

  const note = (text: string) =>
    `${text} [/dev/source-review ${new Date().toISOString().slice(0, 10)}]`;
  let entry: Record<string, unknown>;

  if (verdict === 'exclude') {
    entry = { '//': note('review verdict: not publishable'), exclude: true };
  } else if (verdict === 'channel') {
    const channel = typeof body?.channel === 'string' ? body.channel : null;
    const valid = CHANNEL_TOKENS[item.channel] ?? [];
    if (!channel || !valid.includes(channel)) {
      throw createError({
        statusCode: 400,
        statusMessage: `channel must be one of ${valid.join(', ')} for a ${item.channel} video`,
      });
    }
    entry = { '//': note('review verdict: source classification'), channel };
  } else {
    // sides — the character-completion verdict
    const handles = body?.handles;
    const characters = body?.characters;
    const pair = (x: unknown): x is [string, string] =>
      Array.isArray(x) && x.length === 2 && x.every((v) => typeof v === 'string' && v.trim());
    if (!pair(handles) || !pair(characters)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'expected handles: [string, string] and characters: [string, string]',
      });
    }
    const roster = new Set(read<{ id: string }[]>('data/characters.json').map((c) => c.id));
    const unknown = characters.filter((c) => !roster.has(c));
    if (unknown.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `unknown character id(s): ${unknown.join(', ')}`,
      });
    }
    // same identity rules as parse.ts (slug of the handle)
    const slug = (h: string) =>
      h
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!slug(handles[0]) || !slug(handles[1])) {
      throw createError({ statusCode: 400, statusMessage: 'a handle slugs to nothing' });
    }
    const channel = typeof body?.channel === 'string' ? body.channel : undefined;
    const valid = CHANNEL_TOKENS[item.channel] ?? [];
    if (channel && !valid.includes(channel)) {
      throw createError({
        statusCode: 400,
        statusMessage: `channel must be one of ${valid.join(', ')} for a ${item.channel} video`,
      });
    }
    entry = {
      '//': note('review verdict: hand-completed sides'),
      sides: [0, 1].map((i) => ({
        player: slug(handles[i]!),
        handle: handles[i]!.trim(),
        character: characters[i]!,
      })),
      ...(channel ? { channel } : {}),
    };
  }

  const ovPath = join(root, 'data/overrides.json');
  const overrides = read<Record<string, Record<string, unknown>>>('data/overrides.json');
  // merge onto any existing entry (provenance keys survive); verdict keys win
  overrides[id] = { ...overrides[id], ...entry };
  writeFileSync(ovPath, JSON.stringify(overrides, null, 2) + '\n', 'utf8');

  return { ok: true, id, verdict };
});

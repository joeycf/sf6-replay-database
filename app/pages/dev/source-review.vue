<template>
  <section class="mx-auto w-full max-w-[900px] px-4 py-8 md:px-[26px]">
    <ClientOnly>
      <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div>
          <p class="font-mono text-label uppercase text-text-muted">Curation — dev only</p>
          <h1 class="mt-1 font-display text-d2 font-bold text-text">Source review</h1>
        </div>
        <p class="ml-auto font-mono text-[12px] text-text-muted">
          verdicts → data/overrides.json · then run
          <span class="text-text">npm run data:parse</span>
        </p>
      </div>

      <p
        v-if="error"
        class="mt-6 font-mono text-body text-warning"
      >
        Failed to load the queue — is this `nuxt dev`, and does data/review-queue.json exist?
      </p>
      <p
        v-else-if="items.length === 0"
        class="mt-6 font-mono text-body text-success"
      >
        Queue is empty — nothing pending review.
      </p>

      <template v-else-if="item">
        <!-- progress -->
        <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[12px]">
          <span class="text-text-secondary">
            <span class="text-text">{{ cursor + 1 }}</span> / {{ items.length }}
          </span>
          <span class="text-success">{{ resolvedCount }} resolved</span>
          <span class="text-text-muted">keys: o online · t tournament · x exclude · ←/→</span>
        </div>

        <!-- jump strip: one cell per item, colour = state -->
        <div class="mt-3 flex flex-wrap gap-[3px]">
          <button
            v-for="(it, i) in items"
            :key="it.id"
            type="button"
            :title="`${i + 1}. ${it.id} — ${stateOf(it)}`"
            class="h-2.5 w-2.5 border transition-transform"
            :class="[
              stateOf(it) === 'resolved'
                ? 'border-success/40 bg-success/70'
                : 'border-white/15 bg-white/[0.06]',
              i === cursor ? 'scale-150 !border-primary' : '',
            ]"
            @click="cursor = i"
          />
        </div>

        <!-- the item under review -->
        <div class="mt-4 cut border border-white/10 bg-surface">
          <div
            class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/[0.07] px-4 py-2 font-mono text-[11px] text-text-secondary"
          >
            <span class="uppercase text-warning">{{ item.kind }}</span>
            <span>{{ item.id }}</span>
            <span>{{ item.channel }}</span>
            <span>{{ item.publishedAt.slice(0, 10) }}</span>
            <span>{{ fmtDur(item.durationSec) }}</span>
            <a
              :href="`https://youtu.be/${item.id}`"
              target="_blank"
              rel="noopener"
              class="ml-auto underline decoration-white/20 hover:text-text"
              >youtube ↗</a
            >
          </div>
          <p class="px-4 pt-2 font-mono text-[12px] text-text">{{ item.title }}</p>

          <div class="flex flex-wrap gap-4 px-4 py-3">
            <img
              :src="`https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`"
              :alt="`${item.id} thumbnail`"
              class="w-[320px] max-w-full border border-white/10"
            />
            <div
              v-if="item.signals"
              class="min-w-[220px] flex-1 font-mono text-[12px]"
            >
              <p class="text-label uppercase text-text-muted">Conflicting signals</p>
              <p class="mt-2">
                <span class="text-text-muted">online:</span>
                <span class="ml-2 bg-secondary/15 px-1 text-secondary">{{
                  item.signals.online
                }}</span>
              </p>
              <p class="mt-1">
                <span class="text-text-muted">event:</span>
                <span class="ml-2 bg-warning/15 px-1 text-warning">{{ item.signals.event }}</span>
              </p>
              <p
                v-if="item.saved"
                class="mt-3 text-success"
              >
                saved: {{ savedLabel(item) }}
              </p>
            </div>
          </div>

          <!-- verdicts -->
          <div
            v-if="item.kind === 'source-classification'"
            class="flex flex-wrap gap-2 border-t border-white/[0.07] px-4 py-3"
          >
            <button
              type="button"
              class="cursor-pointer border border-secondary/50 bg-secondary/15 px-3 py-1.5 font-mono text-[12px] text-secondary hover:bg-secondary/25"
              :disabled="posting"
              @click="classify(onlineToken)"
            >
              [o] Online — {{ onlineToken }}
            </button>
            <button
              type="button"
              class="cursor-pointer border border-warning/50 bg-warning/15 px-3 py-1.5 font-mono text-[12px] text-warning hover:bg-warning/25"
              :disabled="posting"
              @click="classify(eventToken)"
            >
              [t] Tournament — {{ eventToken }}
            </button>
            <button
              type="button"
              class="cursor-pointer border border-white/20 px-3 py-1.5 font-mono text-[12px] text-text-secondary hover:border-white/40"
              :disabled="posting"
              @click="exclude()"
            >
              [x] Exclude
            </button>
          </div>

          <div
            v-else
            class="border-t border-white/[0.07] px-4 py-3"
          >
            <div class="grid gap-3 sm:grid-cols-2">
              <label
                v-for="i in [0, 1]"
                :key="i"
                class="font-mono text-[12px] text-text-secondary"
              >
                side {{ i + 1 }} handle
                <input
                  v-model="handles[i]"
                  type="text"
                  class="mt-1 w-full border border-white/15 bg-transparent px-2 py-1 text-text"
                />
                <select
                  v-model="chars[i]"
                  class="mt-2 w-full border border-white/15 bg-surface px-2 py-1 text-text"
                >
                  <option value="">— character —</option>
                  <option
                    v-for="c in roster"
                    :key="c.id"
                    :value="c.id"
                  >
                    {{ c.name }}
                  </option>
                </select>
              </label>
            </div>
            <div class="mt-3 flex gap-2">
              <button
                type="button"
                class="cursor-pointer border border-success/50 bg-success/15 px-3 py-1.5 font-mono text-[12px] text-success hover:bg-success/25"
                :disabled="posting || !sidesComplete"
                @click="completeSides()"
              >
                Save sides
              </button>
              <button
                type="button"
                class="cursor-pointer border border-white/20 px-3 py-1.5 font-mono text-[12px] text-text-secondary hover:border-white/40"
                :disabled="posting"
                @click="exclude()"
              >
                [x] Exclude
              </button>
            </div>
          </div>
        </div>
      </template>

      <template #fallback>
        <p class="mt-6 font-mono text-body text-text-muted">Loading…</p>
      </template>
    </ClientOnly>
  </section>
</template>

<script setup lang="ts">
// Dev-only curation page for data/review-queue.json (parse.ts generates it;
// pending items never reach the site). Verdicts POST to /api/dev/source-review
// which validates and writes ONLY data/overrides.json; the queue self-clears
// on the next `npm run data:parse`. 2XKO's fuse-review is the shape contract.
if (!import.meta.dev) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' });
}

interface QueueItem {
  id: string;
  kind: 'source-classification' | 'character-completion';
  channel: string;
  title: string;
  publishedAt: string;
  durationSec: number;
  signals?: { online: string; event: string };
  saved: { verdict: 'exclude' | 'channel' | 'sides'; channel?: string } | null;
}

const { data, error } = useAsyncData(
  'source-review',
  () =>
    $fetch<{ roster: { id: string; name: string }[]; items: QueueItem[] }>(
      '/api/dev/source-review',
    ),
  { server: false },
);

const items = computed(() => data.value?.items ?? []);
const roster = computed(() => data.value?.roster ?? []);
const cursor = ref(0);
const posting = ref(false);
const item = computed(() => items.value[cursor.value] ?? null);
const resolvedCount = computed(() => items.value.filter((it) => it.saved).length);
const stateOf = (it: QueueItem) => (it.saved ? 'resolved' : 'pending');
const savedLabel = (it: QueueItem) =>
  it.saved?.verdict === 'channel' ? (it.saved.channel ?? 'channel') : (it.saved?.verdict ?? '');

// mirrors scripts/channels.ts kingArena [source, eventSource] — the only
// classifier channel; a second one would extend this map
const TOKENS: Record<string, { online: string; event: string }> = {
  kingArena: { online: 'kingArenaOnline', event: 'kingArenaTournament' },
};
const onlineToken = computed(() => TOKENS[item.value?.channel ?? '']?.online ?? '');
const eventToken = computed(() => TOKENS[item.value?.channel ?? '']?.event ?? '');

// character-completion form state, reset per item
const handles = ref<[string, string]>(['', '']);
const chars = ref<[string, string]>(['', '']);
watch(item, () => {
  handles.value = ['', ''];
  chars.value = ['', ''];
});
const sidesComplete = computed(
  () => handles.value.every((h) => h.trim().length > 0) && chars.value.every((c) => c.length > 0),
);

const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

async function post(body: Record<string, unknown>): Promise<void> {
  if (!item.value) return;
  posting.value = true;
  try {
    await $fetch('/api/dev/source-review', {
      method: 'POST',
      body: { id: item.value.id, ...body },
    });
    item.value.saved =
      body.verdict === 'channel'
        ? { verdict: 'channel', channel: body.channel as string }
        : { verdict: body.verdict as 'exclude' | 'sides' };
    // auto-advance to the next unresolved item
    const next = items.value.findIndex((it, i) => i > cursor.value && !it.saved);
    if (next >= 0) cursor.value = next;
  } finally {
    posting.value = false;
  }
}

const classify = (channel: string) => post({ verdict: 'channel', channel });
const exclude = () => post({ verdict: 'exclude' });
const completeSides = () =>
  post({ verdict: 'sides', handles: [...handles.value], characters: [...chars.value] });

function onKey(e: KeyboardEvent): void {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.key === 'ArrowRight') cursor.value = Math.min(cursor.value + 1, items.value.length - 1);
  else if (e.key === 'ArrowLeft') cursor.value = Math.max(cursor.value - 1, 0);
  else if (item.value?.kind === 'source-classification') {
    if (e.key === 'o') void classify(onlineToken.value);
    else if (e.key === 't') void classify(eventToken.value);
    else if (e.key === 'x') void exclude();
  } else if (e.key === 'x') void exclude();
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

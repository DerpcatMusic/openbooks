<script lang="ts">
  // History: the books' audit trail (GET /api/audit), newest first, read-only. Every change to documents, rules, categories, business
  // details, bank imports and connections, with who made it (you in the app, an MCP client, the in-app AI, a bank sync).
  import { S } from "#lib/stores/books.svelte.ts";
  import { t, locale } from "#lib/i18n.svelte.ts";
  import { request, withEntity } from "#lib/api.ts";
  import { Badge, Button, EmptyState, Input, PageHeader, Select } from "#lib/ui/index.ts";
  import type { Tone } from "#lib/ui/index.ts";

  interface Entry {
    id: number;
    at: string;
    actor: "ui" | "mcp" | "ai" | "sync";
    kind: string;
    target: string;
    before: unknown;
    after: unknown;
  }
  const KINDS = ["doc", "rules", "meta", "classify", "ingest", "secrets", "print"];
  const TONE: Record<Entry["actor"], Tone> = { ui: "neutral", mcp: "accent", ai: "accent", sync: "good" };
  let kind = $state(""),
    from = $state(""),
    to = $state(""),
    limit = $state(100),
    entries = $state<Entry[]>([]),
    failed = $state(false);

  // re-read whenever the books change (every write reloads S.data) or a filter moves
  $effect(() => {
    void S.data;
    const q = new URLSearchParams({ limit: String(limit), ...(kind ? { kind } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) });
    if (!S.e) return;
    request<{ entries: Entry[] }>(withEntity(`/api/audit?${q}`, S.e)).then(
      (r) => ((entries = r.entries), (failed = false)),
      () => (failed = true),
    );
  });

  const when = (iso: string) => new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  type Large = { truncated: true; sha256: string; bytes: number };
  const large = (v: unknown): v is Large => !!v && typeof v === "object" && (v as Large).truncated === true;
  /** One line on what changed, where the raw before/after isn't the clearest answer. */
  function summary(e: Entry): string[] {
    if (e.kind === "ingest") {
      const a = (e.after ?? {}) as { files?: Record<string, { added: number; removed: number }>; blocked?: Record<string, number | string>; droppedSplits?: string[] };
      return [
        ...Object.entries(a.files ?? {}).map(([file, c]) => t("history.files", { file: file || "—", added: c.added, removed: c.removed })),
        ...(a.blocked ? [t("history.blocked", { date: String(a.blocked.close), added: a.blocked.added!, removed: a.blocked.removed!, changed: a.blocked.changed! })] : []),
        ...(a.droppedSplits?.length ? [t("history.droppedSplits", { n: a.droppedSplits.length })] : []),
      ];
    }
    return [e.before, e.after].filter(large).map((x) => t("history.large", { bytes: x.bytes, hash: x.sha256.slice(0, 12) }));
  }
  const json = (v: unknown) => JSON.stringify(v, null, 1);
</script>

<PageHeader title={t("history.title")} sub={t("history.sub")} />

<div class="flex flex-wrap items-end gap-x-3 gap-y-2 px-4 py-3 sm:px-8">
  <Select label={t("history.kind")} variant="pill" bind:value={kind} options={[{ value: "", label: t("history.kind.all") }, ...KINDS.map((k) => ({ value: k, label: t(`history.kind.${k}`) }))]} />
  <Input label={t("history.from")} type="date" bind:value={from} class="w-40" />
  <Input label={t("history.to")} type="date" bind:value={to} class="w-40" />
</div>

<div class="sm:px-8">
  <div class="panel overflow-hidden max-sm:rounded-none">
    {#if failed}
      <EmptyState icon="alert" title={t("history.error")} />
    {:else if !entries.length}
      <EmptyState icon="file" title={t("history.empty")} text={t("history.emptyText")} />
    {:else}
      <ol class="divide-y divide-line">
        {#each entries as e (e.id)}
          {@const lines = summary(e)}
          <li class="px-4 py-3 sm:px-5">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
              <span class="num w-44 shrink-0 text-sub">{when(e.at)}</span>
              <Badge tone={TONE[e.actor]}>{t(`history.actor.${e.actor}`)}</Badge>
              <span class="text-ink">{t(`history.kind.${e.kind}`)}</span>
              <span class="min-w-0 truncate text-sub" dir="ltr">{e.target}</span>
            </div>
            {#each lines as l, i (i)}<p class="mt-1 text-[13px] text-ink-2">{l}</p>{/each}
            {#if e.kind !== "ingest"}
              <details class="mt-1 text-[13px]">
                <summary class="cursor-pointer text-sub">{t("history.before")} / {t("history.after")}</summary>
                <div class="mt-2 grid gap-2 sm:grid-cols-2">
                  <div><div class="text-[12px] text-sub">{t("history.before")}</div><pre class="max-h-64 overflow-auto rounded-lg bg-hover p-2 text-[12px]" dir="ltr">{json(e.before)}</pre></div>
                  <div><div class="text-[12px] text-sub">{t("history.after")}</div><pre class="max-h-64 overflow-auto rounded-lg bg-hover p-2 text-[12px]" dir="ltr">{json(e.after)}</pre></div>
                </div>
              </details>
            {/if}
          </li>
        {/each}
      </ol>
      {#if entries.length >= limit}<div class="p-3 text-center"><Button variant="ghost" onclick={() => (limit += 100)}>{t("history.more")}</Button></div>{/if}
    {/if}
  </div>
</div>

<script lang="ts">
  // One advisor question (a playbook item's `ask`): yes/no, a choice, or a typed value. Used by the Taxximizer and /you.
  import { t, I, has } from "#lib/i18n.svelte.ts";
  import { Segmented, Select } from "#lib/ui/index.ts";
  import type { Ask } from "#lib/person.ts";

  type V = string | number | boolean | undefined;
  let { q, value, onchange }: { q: Ask; value: V; onchange: (v: V) => void } = $props();
  const text = $derived(I.lang === "he" ? q.q_he : q.q_en);
  const opt = (o: string) => (has(`taxximizer.opt.${o}`) ? t(`taxximizer.opt.${o}`) : o);
  const id = $props.id();
  const typed = $derived(q.type !== "bool" && !(q.type === "select" && !q.options?.[0]?.startsWith("<")));
  const numeric = $derived(q.type === "number" && q.key !== "childBirthYears");
</script>

<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-2">
  <label for={typed ? id : undefined} class="min-w-0 flex-1 basis-52">{text}</label>
  {#if q.type === "bool"}
    <Segmented
      size="sm"
      label={text}
      items={[
        { key: "true", label: t("you.yes") },
        { key: "false", label: t("you.no") },
      ]}
      value={value === undefined ? undefined : String(value)}
      onchange={(v) => onchange(v === "true")} />
  {:else if q.type === "select" && !q.options?.[0]?.startsWith("<")}
    <Select variant="pill" label={text} value={String(value ?? "")} options={[{ value: "", label: t("you.pick") }, ...(q.options ?? []).map((o) => ({ value: o, label: opt(o) }))]} onchange={(v) => onchange(v || undefined)} />
  {:else}
    <input
      {id}
      value={value ?? ""}
      inputmode={numeric ? "decimal" : "text"}
      placeholder={q.key === "childBirthYears" ? "2019, 2022" : q.type === "year" ? "2024" : ""}
      onchange={(e) => {
        const s = e.currentTarget.value.trim();
        onchange(s === "" ? undefined : numeric && Number.isFinite(+s) ? +s : s);
      }}
      dir="ltr"
      class="num pii h-8 w-36 shrink-0 rounded-lg border border-line-strong bg-panel px-2 text-ink outline-none focus:ring-2 focus:ring-accent/50" />
  {/if}
</div>

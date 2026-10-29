<script lang="ts">
  // Partnership (Form 1065) and S corporation (Form 1120-S): the return's income lines from the books and each owner's Schedule K-1 numbers,
  // by percentage. A worksheet to hand to the preparer or to type into the return; the IRS forms themselves are not filled here.
  import type { Owner } from "@openbooks/country-us";
  import { S, ent, setProfile } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { saveCsv } from "#lib/reports/download.ts";
  import { Button, Card, Icon, Input, Money, Select, Table, type Column } from "#lib/ui/index.ts";
  import { numOf, saveUsInputs, textOf, usInputs, usNow } from "#lib/ustax/books.ts";
  import Contractors from "./Contractors.svelte";
  import Deadlines from "./Deadlines.svelte";

  let { y, type }: { y: number; type: "partnership" | "s-corp" } = $props();
  const part = $derived(type === "partnership");
  const p = $derived((S.data?.profile ?? {}) as Record<string, string | undefined>);
  const cur = $derived(ent().currency ?? "USD");
  const pt = $derived(usNow(y).passThrough!);
  const owners = $derived<Owner[]>(usInputs(y).owners ?? []);
  const setOwners = (o: Owner[]) => saveUsInputs(y, { owners: o });
  const edit = (i: number, patch: Partial<Owner>) => setOwners(owners.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const addOwner = () => setOwners([...owners, { name: "", pct: owners.length ? 0 : 100, ...(part ? { role: "general" as const } : {}) }]);

  const FIELDS: [string, string, "auto" | "ltr"][] = [
    ["legalName", "text", "auto"],
    ["ein", "text", "ltr"],
    ["state", "text", "auto"],
    ["address", "text", "ltr"],
    ["cityStateZip", "text", "ltr"],
    ["naics", "text", "ltr"],
    ["business", "text", "auto"],
  ];
  const L = $derived(pt.lines);
  const lines = $derived([
    ["grossReceipts", L.grossReceipts],
    ["cogs", L.cogs],
    ["grossProfit", L.grossProfit],
    ["otherIncome", L.otherIncome],
    ["totalIncome", L.totalIncome],
    ...(part ? [["guaranteedPayments", L.guaranteedPayments] as const] : []),
    ["deductions", L.deductions],
    ["ordinary", L.ordinary],
  ] as const);
  const kcols: Column<(typeof pt.k1)[number]>[] = $derived([
    { key: "name", label: t("fus.pt.owner"), wrap: true },
    { key: "pct", label: "%", numeric: true },
    { key: "box1", label: t("fus.pt.box1"), numeric: true },
    ...(part ? [{ key: "box4", label: t("fus.pt.box4"), numeric: true }, { key: "box14", label: t("fus.pt.box14"), numeric: true }] : []),
    { key: "distribution", label: t(part ? "fus.pt.dist1065" : "fus.pt.dist1120s"), numeric: true },
  ]);
  const exportK1 = () =>
    saveCsv(
      `K-1-${type}-${y}`,
      [["Owner", "TIN", "Percent", "Box 1 ordinary income", ...(part ? ["Box 4a guaranteed payments", "Box 14A self-employment earnings"] : []), "Distributions"], ...pt.k1.map((k) => [k.name, k.tin ?? "", k.pct, k.box1, ...(part ? [k.box4, k.box14] : []), k.distribution])]
        .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
        .join("\n") + "\n",
    );
</script>

<div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
  <div class="min-w-0 space-y-4">
    <div class="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/25 bg-accent/6 px-4 py-4 sm:px-5">
      <span class="grid size-9 shrink-0 place-items-center rounded-full bg-accent/15 text-accent-ink"><Icon name="form" size={18} /></span>
      <div class="min-w-0 flex-1 basis-56">
        <div class="text-[14px] text-ink">{t(part ? "fus.pt.title1065" : "fus.pt.title1120s", { y })}</div>
        <div class="text-[13px] text-sub">{t("fus.pt.sub")}</div>
      </div>
      <Button size="sm" icon="download" disabled={!pt.k1.length} onclick={exportK1}>{t("fus.pt.csv")}</Button>
    </div>

    {#if pt.warnings.length}
      <ul class="space-y-1 rounded-2xl border border-warn/30 bg-warn/6 px-4 py-3 text-[13px] text-ink sm:px-5">
        {#each pt.warnings as w (w)}<li>{t(`fus.pt.warn.${w}`, { type: part ? "1065" : "1120-S", pct: pt.pctTotal })}</li>{/each}
      </ul>
    {/if}

    <Card title={t("fus.pt.lines", { form: part ? "1065" : "1120-S" })} flush>
      <ul class="divide-y divide-line">
        {#each lines as [k, v] (k)}
          <li class="flex items-baseline gap-3 px-4 py-2.5 sm:px-5">
            <span class="min-w-0 flex-1 text-[14px] {k === 'ordinary' || k === 'totalIncome' ? 'text-ink' : 'text-sub'}">{t(`fus.pt.l.${k}`)}</span>
            <Money value={v} currency={cur} class={k === "ordinary" ? "text-ink" : ""} />
          </li>
        {/each}
      </ul>
    </Card>

    <Card title={t("fus.pt.k1", { y })} description={t(part ? "fus.pt.k1Sub1065" : "fus.pt.k1Sub1120s")} flush>
      <Table columns={kcols} rows={pt.k1} key={(r, i) => i} caption={t("fus.pt.k1", { y })} stack>
        {#snippet cell(r, c)}
          {#if c.key === "name"}<span class="text-ink" dir="auto">{r.name || "—"}</span>{r.tin ? ` · ${r.tin}` : ""}
          {:else if c.key === "pct"}<span class="num">{r.pct}</span>
          {:else}<Money value={r[c.key as "box1" | "box4" | "box14" | "distribution"]} currency={cur} />{/if}
        {/snippet}
        {#snippet empty()}<p class="px-4 py-4 text-[14px] text-sub sm:px-5">{t("fus.pt.noOwners")}</p>{/snippet}
      </Table>
    </Card>

    <Card title={t("fus.pt.owners")} description={t("fus.pt.ownersSub")}>
      <div class="space-y-4">
        {#each owners as o, i (i)}
          <div class="grid gap-3 border-b border-line pb-4 last:border-0 last:pb-0 sm:grid-cols-2">
            <Input label={t("fus.pt.owner")} value={o.name} onchange={(e: Event) => edit(i, { name: textOf(e) })} />
            <Input label={t("fus.pt.tin")} dir="ltr" value={o.tin ?? ""} onchange={(e: Event) => edit(i, { tin: textOf(e) || undefined })} />
            <Input label={t("fus.pt.pct")} numeric value={o.pct} onchange={(e: Event) => edit(i, { pct: numOf(e) ?? 0 })} />
            {#if part}
              <Select
                label={t("fus.pt.role")}
                value={o.role ?? "general"}
                options={[
                  { value: "general", label: t("fus.pt.general") },
                  { value: "limited", label: t("fus.pt.limited") },
                ]}
                onchange={(v) => edit(i, { role: v as "general" | "limited" })} />
              <Input label={t("fus.pt.guaranteed")} numeric value={o.guaranteed ?? ""} onchange={(e: Event) => edit(i, { guaranteed: numOf(e) })} />
            {/if}
            <div class="flex items-end sm:col-span-2"><Button size="sm" variant="ghost" icon="trash" onclick={() => setOwners(owners.filter((_, j) => j !== i))}>{t("common.remove")}</Button></div>
          </div>
        {/each}
        <Button size="sm" icon="plus" onclick={addOwner}>{t("fus.pt.add")}</Button>
      </div>
    </Card>

    <Contractors {y} />
    <Deadlines {y} />
  </div>

  <Card title={t("taxUS.companyOwner")} description={t("fus.you.saved")} class="xl:sticky xl:top-4">
    <div class="profile space-y-3">
      {#each FIELDS as [k, ty, dir] (k)}
        <Input label={t(`taxUS.f.${k}`)} type={ty} {dir} value={p[k] ?? ""} onchange={(e: Event) => setProfile({ [k]: textOf(e) })} />
      {/each}
    </div>
    <p class="mt-5 text-[12px] leading-relaxed text-faint">{t("fus.disclaimer")}</p>
  </Card>
</div>

<style>
  :global(html[data-private]) .profile :global(input) {
    filter: blur(6px);
  }
  :global(html[data-private]) .profile :global(input:focus) {
    filter: none;
  }
</style>

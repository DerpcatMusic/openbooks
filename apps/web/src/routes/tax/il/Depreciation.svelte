<script lang="ts">
  // Appendix 1342 (depreciation): the equipment register through the open year, depreciation per asset and class, what the return takes.
  // The class (rate) is guessed from the description; pick another and it is saved with the filing settings. Logic: country-il depreciation.ts.
  import { ASSET_CLASSES, type AssetClass } from "@openbooks/country-il";
  import { S } from "#lib/stores/books.svelte.ts";
  import { t, ltr } from "#lib/i18n.svelte.ts";
  import { Badge, Card, EmptyState, Money, Select, Table } from "#lib/ui/index.ts";
  import type { Column } from "#lib/ui/index.ts";
  import { il, patchIl, register } from "#lib/filings.svelte.ts";
  import type { DepRow } from "@openbooks/country-il";

  const reg = $derived(register(S.year));
  const cols: Column<DepRow>[] = $derived([
    { key: "desc", label: t("dep.col.asset"), class: "w-full max-w-0 min-w-36" },
    { key: "date", label: t("dep.col.date") },
    { key: "cls", label: t("dep.col.class") },
    { key: "cost", label: t("dep.col.cost"), numeric: true },
    { key: "rate", label: t("dep.col.rate"), numeric: true },
    { key: "amount", label: t("dep.col.year", { y: S.year }), numeric: true },
    { key: "accumulated", label: t("dep.col.accumulated"), numeric: true },
    { key: "remaining", label: t("dep.col.remaining"), numeric: true },
  ]);
  const classes = ASSET_CLASSES.map((c) => ({ value: c, label: t(`dep.class.${c}`) }));
  const setClass = (id: string, c: string) => patchIl({ assetClass: { ...il().assetClass, [id]: c as AssetClass } });
</script>

<div class="space-y-4 px-4 py-4 sm:px-8">
  <p class="text-[14px] text-sub">{t("dep.intro")}</p>
  {#if !reg.rows.length}
    <EmptyState icon="file" title={t("dep.empty")} text={t("dep.emptyText")} />
  {:else}
    <Card flush>
      <Table columns={cols} rows={reg.rows} key={(r) => r.id} caption={t("dep.title")} stack>
        {#snippet cell(r, c)}
          {#if c.key === "desc"}<span class="block truncate" dir="auto">{r.desc}</span>
          {:else if c.key === "cls"}
            <Select label={t("dep.col.class")} variant="pill" value={r.cls} options={classes} onchange={(v) => setClass(r.id, v)} />
            {#if r.guessed}<Badge size="sm">{t("dep.guessed")}</Badge>{/if}
          {:else if c.key === "rate"}{ltr(`${+(r.rate * 100).toFixed(1)}%`)}
          {:else if c.key === "date"}{r.date}
          {:else}<Money value={r[c.key as "cost"]} cents={false} />{/if}
        {/snippet}
        {#snippet foot()}
          <tr class="font-medium">
            <td class="px-3 py-2 ps-4 sm:ps-5" colspan="3">{t("dep.total")}</td>
            <td class="num px-3 py-2 text-end"><Money value={reg.totals.cost} cents={false} /></td>
            <td></td>
            <td class="num px-3 py-2 text-end"><Money value={reg.totals.amount} cents={false} /></td>
            <td class="num px-3 py-2 text-end"><Money value={reg.totals.accumulated} cents={false} /></td>
            <td class="num px-3 py-2 pe-4 text-end sm:pe-5"><Money value={reg.totals.remaining} cents={false} /></td>
          </tr>
        {/snippet}
      </Table>
    </Card>
    <p class="text-[12px] text-faint">{t("dep.note")}</p>
  {/if}
</div>

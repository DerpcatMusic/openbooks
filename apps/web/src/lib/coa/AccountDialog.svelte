<script lang="ts">
  // Add or edit an account of the chart. The id ("type:slug") never changes: it is the key on transactions and rules, so an edit only
  // touches the overlay (name, code, subtype, archived). Bank and card accounts take their name from the statements: code and subtype only.
  import { untrack } from "svelte";
  import type { CoaRow } from "@openbooks/core";
  import { Button, Dialog, Input, Select, Switch } from "#lib/ui/index.ts";
  import { t, bidi } from "#lib/i18n.svelte.ts";
  import { chart, coa, isBank, isUS, ledgerTypes, rowName, setAccount, suggestedCode, typeLabel } from "#lib/stores/books.svelte.ts";
  import { slug } from "#lib/txns/txns.ts";
  import { hasRules, ruleName, rulesFor } from "#lib/taxtags.svelte.ts";

  let { open = $bindable(false), row = null }: { open?: boolean; row?: CoaRow | null } = $props();
  const formId = $props.id();

  const bank = $derived(!!row && isBank(row));
  let name = $state(""),
    type = $state("expense"),
    code = $state(""),
    subtype = $state(""),
    archived = $state(false),
    taxRule = $state(""),
    tried = $state(false),
    first = ""; // the name when the dialog opened
  $effect(() => {
    if (!open) return;
    untrack(() => {
      first = row ? rowName(row) : "";
      name = first;
      type = row ? row.type : isUS() ? "expense" : "business";
      code = row ? String(row.code) : "";
      subtype = row?.subtype ?? "";
      archived = row?.archived ?? false;
      taxRule = row ? (coa()[row.id]?.taxRule ?? "") : "";
      tried = false;
    });
  });

  const id = $derived(`${type}:${slug(name)}`);
  const n = $derived(code.trim() === "" ? undefined : Number(code));
  const clash = $derived(n === undefined ? undefined : chart().find((r) => r.code === n && r.id !== row?.id));
  const codeErr = $derived(
    n !== undefined && !(Number.isInteger(n) && n >= 1 && n <= 999999)
      ? t("coa.err.code")
      : clash
        ? t("coa.err.taken", { code: n!, name: bidi(rowName(clash)) })
        : null,
  );
  const nameErr = $derived.by(() => {
    if (bank) return null;
    if (!slug(name)) return tried ? t("coa.err.name") : null;
    return !row && chart().some((r) => r.id === id) ? t("coa.err.exists") : null;
  });

  function save() {
    tried = true;
    if (codeErr || nameErr || (!bank && !slug(name))) return;
    const rule = ["expense", "cogs"].includes(type) && taxRule ? taxRule : undefined;
    if (!row) void setAccount(id, { name: name.trim(), code: n, subtype: subtype.trim() || undefined, taxRule: rule });
    else {
      const pinned = coa()[row.id]?.code !== undefined;
      void setAccount(row.id, {
        code: n === row.code && !pinned ? undefined : n, // an unchanged default stays a default; an emptied field goes back to it
        subtype: subtype.trim() || undefined,
        ...(bank ? {} : { taxRule: rule, archived, ...(name.trim() !== first ? { name: name.trim() || undefined } : {}) }),
      });
    }
    open = false;
  }
</script>

<Dialog bind:open title={row ? (bank ? bidi(row.id) : t("coa.edit")) : t("coa.add")} size="sm">
  <form
    id={formId}
    class="grid gap-4"
    onsubmit={(e) => {
      e.preventDefault();
      save();
    }}>
    {#if bank}
      <p class="text-[13px] text-sub">{t("coa.bankName")}</p>
    {:else}
      <Input label={t("common.name")} bind:value={name} error={nameErr} />
      {#if !row}<Select label={t("common.type")} bind:value={type} options={ledgerTypes.map((k) => ({ value: k, label: typeLabel(k) }))} />{/if}
    {/if}
    <Input label={t("coa.code")} bind:value={code} numeric error={codeErr} hint={codeErr || row ? undefined : t("coa.codeHint", { code: suggestedCode(type) })} />
    <Input label={t("coa.subtype")} bind:value={subtype} placeholder={row ? (isBank(row) ? t(row.type === "card" ? "coa.sub.card" : "coa.sub.bank") : typeLabel(row.type)) : typeLabel(type)} />
    {#if hasRules() && !bank && ["expense", "cogs"].includes(type)}
      <Select
        label={t("taxtags.account.rule")}
        bind:value={taxRule}
        hint={t("taxtags.account.ruleHint")}
        options={[{ value: "", label: t("taxtags.account.none") }, ...rulesFor().map((r) => ({ value: r.id, label: ruleName(r) }))]} />
    {/if}
    {#if row && !bank}
      <Switch label={t("coa.archive")} description={t("coa.archiveHint")} bind:checked={archived} />
      <p class="text-[12px] text-sub">{t("coa.idHint", { id: bidi(row.id) })}</p>
    {/if}
  </form>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (open = false)}>{t("common.cancel")}</Button>
    <Button variant="primary" type="submit" form={formId}>{t("common.save")}</Button>
  {/snippet}
</Dialog>

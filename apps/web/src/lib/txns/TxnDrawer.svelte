<script lang="ts" module>
  // One drawer for the whole app, however many screens mount this component: the first mounted instance renders it and the
  // next one takes over when that one goes away (so a page can mount it for itself and the layout can too, without two drawers).
  let owner = $state<string | null>(null);
</script>

<script lang="ts">
  // Transaction drawer: open it from anywhere with S.drawer = txn.id (Esc, the backdrop or ✕ close it).
  // Amount, ledger account, statement details, "create a rule" (prefilled with the suggested match text and a live count of
  // what it would match), receipts/attachments, links to the statement file, the journal or the counterparty.
  import { goto } from "#lib/nav.ts";
  import { payerOf, suggestRule, haystack } from "@openbooks/core";
  import { S, ent, catLabel, mdy, classify, toast, fileUrl, attach, attachmentsOf, suggest } from "#lib/stores/books.svelte.ts";
  import { t, bidi } from "#lib/i18n.svelte.ts";
  import { Drawer, Money, Button, Icon } from "#lib/ui/index.ts";
  import CategorySelect from "./CategorySelect.svelte";

  const me = $props.id();
  $effect(() => {
    if (owner === null) owner = me;
  });
  $effect(() => () => {
    if (owner === me) owner = null;
  });

  const x = $derived(owner === me && S.drawer ? (S.data?.txns.find((r) => r.id === S.drawer) ?? null) : null);
  const cur = $derived(ent().currency ?? "ILS");
  let rule = $state(""),
    picker = $state<HTMLInputElement>();
  // a fresh suggestion whenever another transaction (or a new ledger account for it) comes up
  const seed = $derived(x ? (x.why && x.why !== "manual" && x.why !== "journal" ? x.why : suggestRule([x])) : "");
  $effect(() => {
    rule = seed;
  });
  const same = $derived(x && S.data ? S.data.txns.filter((r) => r.source !== "journal" && payerOf(r) === payerOf(x)) : []);
  /** What the rule text would catch right now (rules match description, memo and [Mercury category]). */
  const catches = $derived(rule.trim() && S.data ? S.data.txns.filter((r) => r.source !== "journal" && haystack(r).includes(rule.trim())).length : 0);
  const files = $derived(x ? attachmentsOf(x.id) : []);
  const journal = $derived(x?.source === "journal");
  const rows = $derived.by(() => {
    if (!x) return [];
    const ref = journal
      ? t("txn.src.journal")
      : x.source === "bank"
        ? t("txn.src.page", { page: x.page })
        : x.source === "bit" || x.who
          ? t("txn.src.bit", { row: x.page })
          : x.file;
    const by = x.why === "manual" ? t("txn.by.you") : journal ? t("txn.src.journal") : x.why ? t("txn.by.rule", { rule: bidi(x.why) }) : t("txn.by.none");
    return [
      [t("common.date"), mdy(x.date), false],
      [t("common.account"), x.account, true],
      x.memo && [t("txn.memo"), x.memo, true],
      x.mcat && [t("txn.mcat"), x.mcat, false],
      x.kind && [t("common.type"), x.kind.replace(/([A-Z])/g, " $1").toLowerCase(), false],
      [t("txn.source"), ref, !journal],
      [t("txn.by"), by, false],
    ].filter(Boolean) as [string, string, boolean][];
  });

  async function saveRule() {
    const r = rule.trim();
    if (!x || !r || x.category === "ask") return;
    const cat = x.category;
    await classify(
      same.map((s) => s.id),
      cat,
      r,
    );
    toast(t("txn.ruleSaved", { rule: bidi(r), cat: bidi(catLabel(cat)) }));
  }
  const leave = (href: string) => {
    S.drawer = null;
    void goto(href);
  };
</script>

<Drawer open={!!x} title={t("app.transaction")} onclose={() => (S.drawer = null)}>
  {#if x}
    <div class="px-4 py-5 sm:px-5">
      <div class="text-[13px] text-sub">{x.amount > 0 ? t("common.moneyIn") : t("common.moneyOut")}</div>
      <div class="display mt-1 text-[32px] leading-10"><Money value={x.amount} currency={cur} plus class={x.amount > 0 ? "text-good" : "text-ink"} /></div>
      <div class="ui-align mt-1 text-[15px] text-ink [overflow-wrap:anywhere]" dir="auto">{x.who ? `${x.who} · bit` : x.desc}</div>
    </div>

    <div class="border-t border-line px-4 py-4 sm:px-5">
      <div class="text-[13px] text-sub">{t("common.ledgerAccount")}</div>
      {#if journal}
        <div class="mt-2 text-[15px] text-ink">{catLabel(x.category)} <span class="text-[13px] text-sub">· {t("txn.editInJournal")}</span></div>
      {:else}
        <div class="mt-2"><CategorySelect value={x.category} variant="pill" suggestions={() => suggest([x])} onchange={(c) => classify([x.id], c)} /></div>
      {/if}
    </div>

    <dl class="border-t border-line px-4 py-2 text-[14px] sm:px-5">
      {#each rows as [k, v, user] (k)}
        <div class="flex gap-4 py-2">
          <dt class="w-32 shrink-0 text-sub">{k}</dt>
          <dd class="ui-align min-w-0 flex-1 text-ink-2 [overflow-wrap:anywhere]" dir={user ? "auto" : undefined}>{v}</dd>
        </div>
      {/each}
    </dl>

    {#if !journal}
      <div class="border-t border-line px-4 py-4 sm:px-5">
        <label for="{me}-rule" class="text-[13px] text-sub">{t("txn.rule")}</label>
        <p class="mt-1 text-[13px] text-sub">
          {t("txn.ruleHelp")} <span class="text-ink">{catLabel(x.category)}</span>.
          {same.length > 1 ? t("txn.sameCount", { n: same.length }) : ""}
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <input
            id="{me}-rule"
            bind:value={rule}
            dir="auto"
            onkeydown={(e) => e.key === "Enter" && saveRule()}
            class="ui-align h-8 min-w-40 flex-1 rounded-full bg-fill px-3 text-[14px] text-ink outline-none focus:ring-2 focus:ring-accent/50" />
          <Button variant="primary" onclick={saveRule} disabled={x.category === "ask" || !rule.trim()}>{t("txns.createRule")}</Button>
        </div>
        {#if rule.trim()}
          <p class="mt-2 text-[12px] text-sub" aria-live="polite">{x.category === "ask" ? t("txn34.pickFirst") : t("txn34.catches", { n: catches })}</p>
        {/if}
      </div>
    {/if}

    <div class="border-t border-line px-4 py-4 sm:px-5">
      <div class="flex flex-wrap items-center gap-2">
        <span class="min-w-0 flex-1 text-[13px] text-sub">{t("txn.attachments")}</span>
        <Button size="sm" icon="upload" onclick={() => picker?.click()}>{t("txn.attach")}</Button>
      </div>
      <input
        bind:this={picker}
        type="file"
        multiple
        accept="image/*,application/pdf"
        class="hidden"
        tabindex="-1"
        aria-hidden="true"
        onchange={(e) => {
          const fs = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = "";
          if (fs.length) void attach(x.id, fs);
        }} />
      {#each files as f (f)}
        <a
          href={fileUrl(f, `attachments/${x.id}`)}
          target="_blank"
          rel="noopener"
          class="mt-2 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[14px] text-ink-2 outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
          <Icon name="file" size={15} /><span class="min-w-0 flex-1 [overflow-wrap:anywhere]" dir="auto">{f}</span><Icon name="external" size={13} class="text-faint" />
        </a>
      {:else}
        <p class="mt-1 text-[13px] text-faint">{t("txn34.attachHint")}</p>
      {/each}
    </div>
  {/if}
  {#snippet footer()}
    {#if x}
      {#if x.file?.toLowerCase().endsWith(".pdf")}
        <Button icon="file" href="{fileUrl(x.file)}#page={x.page}" target="_blank">{t("txn.openStatement")}</Button>
      {:else if x.file}
        <Button icon="file" href={fileUrl(x.file)} target="_blank">{t("txn.openExport")}</Button>
      {/if}
      {#if journal}
        <Button variant="ghost" onclick={() => leave("/journal")}>{t("txn.openJournal")}</Button>
      {:else}
        <Button variant="ghost" icon="users" onclick={() => leave(`/counterparties?q=${encodeURIComponent(payerOf(x))}`)}>{t("txn.counterparty")}</Button>
      {/if}
    {/if}
  {/snippet}
</Drawer>

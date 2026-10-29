<script lang="ts">
  // Rules editor, "If … Then …": every rule has one or more conditions that must all hold (description, counterparty, bank account,
  // direction, amount, or the legacy exact-case text) and sets a ledger account and/or adds tags. Top to bottom: the first matching
  // rule with an account sets it; tags of every matching rule are added; a manual choice beats rules. Rules apply to every
  // transaction (past ones too). The draft is saved explicitly; match counts and totals are live against it, and a count opens a
  // preview of exactly which transactions that rule catches ("match nothing" lists the rest), each one opening the transaction drawer.
  // A rule whose ledger account is archived or gone is marked Invalid: it stays in the list but the engine skips it. New rules go last.
  import { activeTags, cleanRule, isLegacy, normalizeRule, plOf, ruleLabel, ruleProblem, textOf } from "@openbooks/core";
  import { tick } from "svelte";
  import type { Rule, RuleCondition, RuleInput, TagsDoc, Txn } from "@openbooks/schema";
  import { S, ent, catLabel, saveRules, mdy, accounts, tagsDoc, coa } from "#lib/stores/books.svelte.ts";
  import { t } from "#lib/i18n.svelte.ts";
  import { PageHeader, Button, Badge, IconButton, Money, Search, Select, Drawer, EmptyState } from "#lib/ui/index.ts";
  import CategorySelect from "#lib/txns/CategorySelect.svelte";
  import TagPill from "#lib/txns/TagPill.svelte";
  import TxnDrawer from "#lib/txns/TxnDrawer.svelte";
  import { ruleHits } from "#lib/txns/txns.ts";

  type Field = RuleCondition["field"];
  /** A rule being edited: `k` keys the row; account "" = none. */
  type D = { k: number; when: RuleCondition[]; account: string; tags: string[] };
  const FIELDS: Field[] = ["description", "counterparty", "account", "direction", "amount", "text"];
  const OPS: Record<Field, readonly string[]> = {
    description: ["contains", "equals", "startsWith"],
    counterparty: ["contains"],
    account: ["is"],
    direction: ["in", "out"],
    amount: ["eq", "gte", "lte", "between"],
    text: ["contains"],
  };

  let seq = 0;
  let rules = $state<D[]>([]),
    dirty = $state(false),
    q = $state(""),
    /** preview: a rule's key, "none" for the unmatched rows, null = closed */
    peek = $state<number | "none" | null>(null);
  const toDraft = (r: RuleInput): D => {
    const n = normalizeRule($state.snapshot(r) as RuleInput);
    return { k: seq++, when: n.when.map((c) => ({ ...c })), account: n.then.account ?? "", tags: [...(n.then.tags ?? [])] };
  };
  $effect(() => {
    if (!dirty) rules = (S.data?.rules ?? []).map(toDraft);
  });
  const toRule = (d: D): Rule => ({ when: $state.snapshot(d.when) as RuleCondition[], then: { ...(d.account ? { account: d.account } : {}), ...(d.tags.length ? { tags: $state.snapshot(d.tags) } : {}) } });
  /** What gets stored: a rule that is just "text contains → account" stays a legacy [match, account] tuple, as before. */
  const stored = (d: D): RuleInput | undefined => {
    const r = cleanRule(toRule(d));
    if (!r || isLegacy(r)) return r;
    const text = textOf(r);
    return text !== undefined && r.then.account && !r.then.tags ? [text, r.then.account] : r;
  };
  const invalid = (d: D) => stored(d) === undefined;
  /** the rule is complete but its ledger account is archived or gone: kept, shown "Invalid", skipped by the engine */
  const broken = (d: D) => ruleProblem(toRule(d), $state.snapshot(coa()));
  const brokenCount = $derived(rules.filter((r) => broken(r)).length);
  const canSave = $derived(dirty && rules.length > 0 && !rules.some(invalid));

  // a plain copy of the rows (not the store's deep proxies): the counts re-run on every keystroke in a rule
  const txns = $derived($state.snapshot(S.data?.txns ?? []) as Txn[]);
  const hits = $derived(ruleHits(rules.map(toRule), txns, $state.snapshot(coa())));
  const cur = $derived(ent().currency ?? "ILS");
  const tg = $derived($state.snapshot(tagsDoc()) as TagsDoc);
  const tagOf = (id: string) => tg.tags.find((g) => g.id === id);
  /** deactivated tags can't be added to a rule, but one a rule already has stays so it can be taken off */
  const offeredTags = (r: D) => [...activeTags(tg), ...tg.tags.filter((g) => g.inactive && r.tags.includes(g.id))];
  const shown = $derived.by(() => {
    const s = q.trim().toLowerCase();
    return s ? rules.filter((r) => `${ruleLabel(toRule(r))} ${r.account ? catLabel(r.account) : ""}`.toLowerCase().includes(s)) : rules;
  });
  const edit = (fn: () => void) => {
    fn();
    dirty = true;
  };
  /** A new rule goes last (lowest priority), like Mercury; scroll to it. (The transaction toast's "create rule" still files its rule first.) */
  async function addRule() {
    const k = seq++;
    edit(() => rules.push({ k, when: [fresh("description")], account: "", tags: [] }));
    q = "";
    await tick();
    document.getElementById(`rule-${k}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const move = (i: number, d: number) =>
    edit(() => {
      const [r] = rules.splice(i, 1);
      if (r) rules.splice(i + d, 0, r);
    });
  async function save() {
    await saveRules(rules.map(stored) as RuleInput[]);
    dirty = false;
  }

  // ---------- condition rows ----------
  const fresh = (field: Field): RuleCondition =>
    field === "direction"
      ? { field, op: "out" }
      : field === "amount"
        ? { field, op: "gte", value: 0 }
        : ({ field, op: field === "account" ? "is" : "contains", value: field === "account" ? (accounts()[0] ?? "") : "" } as RuleCondition);
  /** Switching the operator keeps the value (and an amount range gets its upper end). */
  function withOp(c: RuleCondition, op: string): RuleCondition {
    if (c.field === "direction") return { field: "direction", op: op as "in" | "out" };
    if (c.field === "amount")
      return op === "between" ? { field: "amount", op, value: c.value, to: "to" in c ? c.to : c.value } : { field: "amount", op: op as "eq" | "gte" | "lte", value: c.value };
    return { ...c, op } as RuleCondition;
  }
  const patch = (r: D, j: number, p: Record<string, string | number>) => edit(() => (r.when[j] = { ...r.when[j]!, ...p } as RuleCondition));
  /** how a condition takes its value: a bank account, text, a number (amount), or nothing (direction) */
  const kind = (c: RuleCondition) => (c.field === "direction" ? "none" : c.field === "amount" ? "num" : c.field === "account" ? "acct" : "text");
  const val = (c: RuleCondition) => ("value" in c ? c.value : "");
  const upTo = (c: RuleCondition) => ("to" in c ? c.to : 0);
  const FIELD_OPTIONS = $derived(FIELDS.map((f) => ({ value: f, label: t(`rules2.field.${f}`) })));
  const opOptions = (f: Field) => OPS[f].map((o) => ({ value: o, label: t(`rules2.op.${o}`) }));
  const acctOptions = (now: string) => [...new Set([...accounts(), now].filter(Boolean))].map((a) => ({ value: a, label: a }));
  const toggleTag = (r: D, id: string) => edit(() => (r.tags = r.tags.includes(id) ? r.tags.filter((x) => x !== id) : [...r.tags, id]));
  const box =
    "ui-align h-8 min-w-32 flex-1 basis-40 rounded-full bg-fill px-3 text-[14px] text-ink outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/50";

  const peekRule = $derived(typeof peek === "number" ? rules.find((r) => r.k === peek) : undefined);
  const peekIds = $derived.by(() => {
    if (peek === "none") return hits.none;
    const i = rules.findIndex((r) => r.k === peek);
    return i >= 0 ? (hits.h[i]?.ids ?? []) : [];
  });
  const peekRows = $derived.by(() => {
    const ids = new Set(peekIds);
    return txns.filter((x) => ids.has(x.id)).toReversed();
  });
  const PEEK_MAX = 300;
</script>

<PageHeader title={t("rules.title")} sub={t("rules.sub")}>
  {#snippet actions()}
    {#if dirty}<Button variant="ghost" onclick={() => (dirty = false)}>{t("rules.discard")}</Button>{/if}
    <Button icon="plus" onclick={addRule}>{t("rules.new")}</Button>
    <Button variant="primary" onclick={save} disabled={!canSave}>{t("rules.save")}</Button>
  {/snippet}
  <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-line py-3">
    <span class="min-w-0 flex-1 basis-56 text-[14px] text-sub">
      {t("rules.count", { n: rules.length })} ·
      <button
        type="button"
        onclick={() => (peek = "none")}
        disabled={!hits.none.length}
        class="rounded underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50 disabled:no-underline {hits.none.length ? 'text-warn' : ''}"
        >{t(dirty ? "rules.unmatchedDirty" : "rules.unmatched", { n: hits.none.length })}</button>
      {#if dirty && rules.some(invalid)}<span class="text-bad" role="status">· {t("rules2.fix")}</span>{/if}
      {#if brokenCount}<span class="text-warn" role="status">· {t("gaps2.rule.count", { n: brokenCount })}</span>{/if}
    </span>
    <Search bind:value={q} label={t("rules.search")} class="w-full sm:w-64" />
  </div>
</PageHeader>

<div class="px-4 sm:px-8">
  {#if rules.length}
    <ol class="space-y-3 pb-8">
      {#each shown as r (r.k)}
        {@const i = rules.indexOf(r)}
        {@const h = hits.h[i]}
        {@const bad = broken(r)}
        <li id="rule-{r.k}" class="panel p-4 sm:p-5 {dirty && invalid(r) ? 'ring-1 ring-bad/60' : bad ? 'ring-1 ring-warn/60' : ''}">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span class="num w-6 text-faint">{i + 1}</span>
            <span class="flex min-w-0 flex-1 basis-40 items-center gap-2 text-[14px] text-sub">
              {t("rules.matches")}
              {#if h?.n}
                <button
                  type="button"
                  onclick={() => (peek = r.k)}
                  title={t("rules34.preview")}
                  class="num rounded px-1 text-ink-2 underline decoration-line-strong underline-offset-2 outline-none hover:text-ink hover:decoration-current focus-visible:ring-2 focus-visible:ring-accent/50"
                  >{h.n}</button>
                <Money value={h.sum} currency={cur} cents={false} class={plOf(r.account) === "revenue" ? "text-good" : ""} />
              {:else}
                <span class="text-faint">0</span>
              {/if}
            </span>
            {#if bad}<Badge tone="warn" icon="alert">{t("gaps2.rule.invalid")}</Badge>{/if}
            <span class="inline-flex">
              <IconButton icon="chevron-up" size="sm" label={t("rules.moveUp")} disabled={i === 0} onclick={() => move(i, -1)} />
              <IconButton icon="chevron-down" size="sm" label={t("rules.moveDown")} disabled={i === rules.length - 1} onclick={() => move(i, 1)} />
              <IconButton icon="x" size="sm" label={t("common.remove")} onclick={() => edit(() => rules.splice(i, 1))} />
            </span>
          </div>

          <div class="mt-3 grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-x-2 gap-y-3">
            <span class="pt-1.5 text-[13px] text-sub">{t("rules2.if")}</span>
            <div class="space-y-2">
              {#each r.when as c, j (j)}
                {@const k = kind(c)}
                <div class="flex flex-wrap items-center gap-2">
                  <Select variant="pill" label={t("rules2.field")} value={c.field} options={FIELD_OPTIONS} onchange={(f) => edit(() => (r.when[j] = fresh(f as Field)))} />
                  <Select variant="pill" label={t("rules2.op")} value={c.op} options={opOptions(c.field)} onchange={(o) => edit(() => (r.when[j] = withOp(c, o)))} />
                  {#if k === "acct"}
                    <Select variant="pill" label={t("rules2.value")} value={String(val(c))} options={acctOptions(String(val(c)))} onchange={(v) => patch(r, j, { value: v })} />
                  {:else if k === "text"}
                    <input dir="auto" value={val(c)} oninput={(e) => patch(r, j, { value: e.currentTarget.value })} placeholder={t("rules.placeholder")} aria-label={t("rules2.value")} class={box} />
                  {:else if k === "num"}
                    <input type="number" min="0" step="0.01" dir="ltr" value={val(c)} oninput={(e) => patch(r, j, { value: e.currentTarget.valueAsNumber })} aria-label={t("rules2.value")} class="{box} num max-w-32 min-w-24 basis-24" />
                    {#if c.op === "between"}
                      <span class="text-[13px] text-sub">{t("rules2.to")}</span>
                      <input type="number" min="0" step="0.01" dir="ltr" value={upTo(c)} oninput={(e) => patch(r, j, { to: e.currentTarget.valueAsNumber })} aria-label={t("rules2.to")} class="{box} num max-w-32 min-w-24 basis-24" />
                    {/if}
                  {/if}
                  <IconButton icon="x" size="sm" label={t("rules2.removeCondition")} disabled={r.when.length === 1} onclick={() => edit(() => r.when.splice(j, 1))} />
                </div>
              {/each}
              <Button size="sm" variant="ghost" icon="plus" onclick={() => edit(() => r.when.push(fresh("description")))}>{t("rules2.addCondition")}</Button>
            </div>

            <span class="pt-1.5 text-[13px] text-sub">{t("rules2.then")}</span>
            <div class="space-y-2">
              {#if bad}<p class="text-[13px] text-warn" role="status">{t(`gaps2.rule.${bad}`, { account: r.account ? catLabel(r.account) : "" })}</p>{/if}
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-[13px] text-sub">{t("rules2.setAccount")}</span>
                <CategorySelect value={r.account} placeholder={t("rules2.noAccount")} label={t("common.ledgerAccount")} onchange={(v) => edit(() => (r.account = v))} />
                {#if r.account}<IconButton icon="x" size="sm" label={t("rules2.clearAccount")} onclick={() => edit(() => (r.account = ""))} />{/if}
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="text-[13px] text-sub">{t("rules2.addTags")}</span>
                {#each offeredTags(r) as g (g.id)}
                  <TagPill name={g.inactive ? `${g.name} ${t("gaps2.tag.inactiveMark")}` : g.name} color={g.color} on={r.tags.includes(g.id)} onclick={() => toggleTag(r, g.id)} />
                {:else}
                  <span class="text-[13px] text-faint">{t("rules2.noTags")}</span>
                {/each}
                {#each r.tags.filter((id) => !tagOf(id)) as id (id)}
                  <TagPill name={id} on onclick={() => toggleTag(r, id)} />
                {/each}
              </div>
            </div>
          </div>
        </li>
      {/each}
    </ol>
  {:else}
    <EmptyState icon="rules" title={t("rules34.empty")} text={t("rules34.emptyText")} />
  {/if}
</div>

<Drawer open={peek !== null} width={480} title={peek === "none" ? t("rules34.unmatchedTitle") : t("rules34.previewTitle", { rule: peekRule ? ruleLabel(toRule(peekRule)) : "" })} onclose={() => (peek = null)}>
  <p class="px-4 pt-4 text-[13px] text-sub sm:px-5">
    {peek === "none" ? t("rules34.unmatchedHelp") : t("rules34.previewHelp")}
    {dirty ? t("rules34.draft") : ""}
  </p>
  <ul class="px-2 py-2 sm:px-3">
    {#each peekRows.slice(0, PEEK_MAX) as x (x.id)}
      <li>
        <button
          type="button"
          onclick={() => (S.drawer = x.id)}
          class="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start text-[14px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50">
          <span class="min-w-0 flex-1">
            <span class="ui-align block text-ink [overflow-wrap:anywhere]" dir="auto">{x.who ?? x.desc}</span>
            <span class="block text-[12px] text-sub"><span class="num">{mdy(x.date)}</span> · {catLabel(x.category)}</span>
          </span>
          <Money value={x.amount} currency={cur} class={x.amount > 0 ? "text-good" : "text-ink"} />
        </button>
      </li>
    {/each}
  </ul>
  {#if peekRows.length > PEEK_MAX}<p class="px-4 pb-4 text-[13px] text-sub sm:px-5">{t("rules34.andMore", { n: peekRows.length - PEEK_MAX })}</p>{/if}
</Drawer>

<TxnDrawer />

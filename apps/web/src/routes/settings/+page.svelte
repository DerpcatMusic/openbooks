<script lang="ts">
  // Settings: appearance (language, theme, font), security (vault), business (names, structure per tax year), tax years,
  // tax tables (edits are overrides: POST /api/taxtables → doc(_app, "taxtables")), AI, and a summary of these books.
  import { goto } from "#lib/nav.ts";
  import { S, ent, family, isUS, bizType, bizTypes, bizLabel, setBizType, setMeta, setTheme, addYear, removeYear, saveTaxTable, fmt, toast, type Theme } from "#lib/stores/books.svelte.ts";
  import { t, I, setLang, type Lang } from "#lib/i18n.svelte.ts";
  import { Button, Card, IconButton, Input, PageHeader, Segmented, Select, Table } from "#lib/ui/index.ts";
  import VaultPanel from "#lib/vault/VaultPanel.svelte";
  import AiSetup from "./AiSetup.svelte";
  import { bracketsText, parseBrackets, FIELDS } from "./tables.ts";

  const d = $derived(S.data!);

  // font: any Google font loaded in app.html; remembered per browser
  const FONTS = ["Geist", "Inter", "Instrument Sans", "Figtree"];
  let font = $state(
    (() => {
      try {
        return localStorage.getItem("ob-font") || "Geist";
      } catch {
        return "Geist";
      }
    })(),
  );
  function setFont(f: string) {
    font = f;
    document.documentElement.style.setProperty("--app-font", JSON.stringify(f));
    try {
      localStorage.setItem("ob-font", f);
    } catch {}
  }

  // tax years of these books
  const years = $derived(
    d.years
      .map((y) => ({ y, txns: d.txns.filter((x) => x.date.startsWith(String(y))).length, docs: (d.proofs[y] ?? []).length }))
      .reverse(),
  );
  let newYear = $state<number | string>(new Date().getFullYear());
  const ny = $derived(+newYear);
  const nyOk = $derived(Number.isInteger(ny) && ny >= 1990 && ny <= 2100 && !d.years.includes(ny));

  // tax tables (shared by all books of a country)
  const country = $derived(isUS() ? "us" : "il");
  const tables = $derived(Object.entries(d.taxTables?.[country] ?? {}).filter(([, r]) => r).sort((a, b) => +b[0] - +a[0]) as [string, Record<string, any>][]);
  const edit = (y: string, row: Record<string, unknown>, k: string, v: unknown) => saveTaxTable(country, +y, { ...row, [k]: v });
  function addTable() {
    const [ly, latest] = tables[0] ?? [String(ny - 1), {}];
    const y = +ly + 1;
    void saveTaxTable(country, y, { ...latest, note: t("settings.copiedNote", { from: ly, y }) });
    toast(t("settings.tableAdded", { from: ly, y }));
  }
  const bracketLine = (b: [number | null, number][]) =>
    b.map(([hi, r], i) => `${i ? fmt(b[i - 1]![0] ?? 0) : fmt(0)}–${hi ? fmt(hi) : "∞"} @ ${Math.round(r * 100)}%`).join(" · ");

  // business structure per tax year
  const fam = $derived(family());
  const types = $derived(bizTypes());
  const structureRows = $derived(d.years.slice().reverse().map((y) => ({ y })));
  const STRUCT_COLS = $derived([
    { key: "y", label: t("settings.taxYear"), class: "w-24" },
    { key: "type", label: t("settings.structure"), wrap: true },
  ]);
  const YEAR_COLS = $derived([
    { key: "y", label: t("settings.year") },
    { key: "txns", label: t("settings.txns"), numeric: true },
    { key: "docs", label: t("settings.docs"), numeric: true },
    { key: "act", label: t("common.remove"), hideLabel: true },
  ]);
  const BOOKS = $derived([
    [t("settings.structure"), `${bizLabel()} (${S.year})`],
    [t("settings.currency"), ent().currency ?? ""],
    [t("settings.folder"), `entities/${S.e}/`],
    [t("settings.txns"), String(d.txns.length)],
    [t("settings.rules"), String(d.rules.length)],
  ]);
  const section = "space-y-3";
</script>

<svelte:head><title>{t("settings.title")} · OpenBooks</title></svelte:head>

<PageHeader title={t("settings.title")} sub="{ent().flag ?? ''} {ent().name ?? ''}" />

<div class="max-w-3xl space-y-8 px-4 pt-5 pb-16 sm:px-8">
  <Card title={t("settings.appearance")} flush>
    <div class="divide-y divide-line border-t border-line">
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-5">
        <div class="min-w-0 flex-1 basis-48"><div class="text-[14px] text-ink">{t("settings.language")}</div><div class="text-[13px] text-sub">{t("settings.languageHint")}</div></div>
        <Segmented label={t("settings.language")} value={I.lang} onchange={(l) => setLang(l as Lang)} items={[{ key: "en", label: "English", lang: "en" }, { key: "he", label: "עברית", lang: "he" }]} />
      </div>
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-5">
        <div class="min-w-0 flex-1 basis-48"><div class="text-[14px] text-ink">{t("settings.theme")}</div><div class="text-[13px] text-sub">{t("settings.themeHint")}</div></div>
        <Segmented
          label={t("settings.theme")}
          value={S.theme}
          onchange={(k) => setTheme(k as Theme)}
          items={[{ key: "light", label: t("settings.light"), icon: "sun" }, { key: "system", label: t("settings.system"), icon: "monitor" }, { key: "dark", label: t("settings.dark"), icon: "moon" }]} />
      </div>
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-5">
        <div class="min-w-0 flex-1 basis-48"><div class="text-[14px] text-ink">{t("settings.font")}</div><div class="text-[13px] text-sub">{t("settings.fontHint")}</div></div>
        <div class="flex flex-wrap gap-1.5" role="group" aria-label={t("settings.font")}>
          {#each FONTS as f (f)}
            <button
              type="button"
              onclick={() => setFont(f)}
              style:font-family={JSON.stringify(f)}
              aria-pressed={font === f}
              class="h-9 rounded-full border px-3.5 text-[14px] whitespace-nowrap transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 {font === f ? 'border-accent bg-accent/8 text-ink' : 'border-line text-ink-2 hover:border-line-strong'}"
              >{f} <span class="num" dir="ltr">{fmt(1284)}</span></button>
          {/each}
        </div>
      </div>
    </div>
  </Card>

  <section id="security" class="scroll-mt-4">
    <Card title={t("vault.section")} description={t("vault.sectionHint")}>
      <VaultPanel />
    </Card>
  </section>

  <Card title={t("settings.business")} description={t("settings.businessHint")}>
    <div class="grid gap-3 sm:grid-cols-2">
      <Input label={t("common.name")} value={ent().name ?? ""} onchange={(e) => setMeta({ name: e.currentTarget.value.trim() || ent().name })} />
      <Input label={t("settings.shortName")} value={ent().short ?? ""} onchange={(e) => setMeta({ short: e.currentTarget.value.trim() })} />
    </div>
    {#if fam && types.length}
      <div class="-mx-4 mt-4 sm:-mx-5">
        <Table columns={STRUCT_COLS} rows={structureRows} key={(r) => r.y} caption={t("settings.structure")}>
          {#snippet cell(r, c)}
            {#if c.key === "y"}<span class="text-ink num">{r.y}</span>
            {:else}
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
                <Select label={t("settings.structureFor", { y: r.y })} variant="pill" value={bizType(r.y) ?? ""} onchange={(v) => setBizType(r.y, v)} options={types.map((x) => ({ value: x.key, label: x.label }))} />
                <span class="min-w-0 text-[13px] text-sub">{types.find((x) => x.key === bizType(r.y))?.sub ?? ""}{ent().types?.[r.y] ? "" : ` · ${t("settings.carriedOver")}`}</span>
              </div>
            {/if}
          {/snippet}
        </Table>
      </div>
      <p class="mt-3 text-[12px] text-faint">{t(fam === "il" ? "settings.structureNoteIl" : "settings.structureNoteUs")}</p>
    {/if}
  </Card>

  <section class={section}>
    <div><h2 class="text-[16px] text-ink">{t("settings.taxYears")}</h2><p class="mt-0.5 text-[13px] text-sub">{t("settings.taxYearsHint")}</p></div>
    <Card flush>
      <Table columns={YEAR_COLS} rows={years} key={(r) => r.y} caption={t("settings.taxYears")}>
        {#snippet cell(r, c)}
          {#if c.key === "y"}<span class="text-ink num">{r.y}</span>
          {:else if c.key === "act"}
            {#if !r.txns && !r.docs}<Button size="sm" variant="ghost" onclick={() => removeYear(r.y)}>{t("common.remove")}</Button>{/if}
          {:else}{r[c.key as "txns" | "docs"]}{/if}
        {/snippet}
      </Table>
      <form class="flex flex-wrap items-end gap-2 border-t border-line px-4 py-3 sm:px-5" onsubmit={(e) => (e.preventDefault(), nyOk && addYear(ny))}>
        <Input label={t("settings.year")} hideLabel numeric type="number" min="1990" max="2100" class="w-28" bind:value={newYear} />
        <Button type="submit" icon="plus" disabled={!nyOk}>{t("settings.addYear")}</Button>
      </form>
    </Card>
  </section>

  <section class={section}>
    <div>
      <h2 class="text-[16px] text-ink">{t(country === "il" ? "settings.tablesIl" : "settings.tablesUs")}</h2>
      <p class="mt-0.5 text-[13px] text-sub">{t(country === "il" ? "settings.tablesHintIl" : "settings.tablesHintUs")}</p>
    </div>
    {#each tables as [y, row] (y)}
      <Card>
        <div class="flex items-center gap-3">
          <span class="text-[16px] text-ink num">{y}</span>
          <span class="min-w-0 flex-1 text-[13px] text-sub [overflow-wrap:anywhere]" dir="auto">{row.note ?? ""}</span>
          {#if tables.length > 1}<IconButton icon="x" size="sm" label={t("settings.deleteTable", { y })} onclick={() => saveTaxTable(country, +y, null)} />{/if}
        </div>
        <div class="mt-3 grid gap-3 sm:grid-cols-3">
          {#each FIELDS[country === "il" ? "il" : "us"] as [k, type] (k)}
            <Input
              label={t(`settings.f.${k}`)}
              numeric={type === "number"}
              type={type}
              step="any"
              value={row[k] ?? ""}
              onchange={(e) => edit(y, row, k, type === "number" ? +e.currentTarget.value : e.currentTarget.value)} />
          {/each}
        </div>
        {#if row.brackets}
          <div class="mt-3">
            <Input label={t("settings.brackets")} value={bracketsText(row.brackets)} dir="ltr" class="[&_input]:num" onchange={(e) => edit(y, row, "brackets", parseBrackets(e.currentTarget.value))} />
            <div class="mt-2 text-[12px] text-faint num [overflow-wrap:anywhere]" dir="ltr">{bracketLine(row.brackets)}</div>
          </div>
        {/if}
      </Card>
    {/each}
    <Button icon="plus" onclick={addTable}>{t("settings.addTable", { y: tables.length ? +tables[0]![0] + 1 : ny })}</Button>
  </section>

  <Card title={t("settings.ai")} description={t("settings.aiHint")}>
    <AiSetup />
  </Card>

  <section class={section}>
    <h2 class="text-[16px] text-ink">{t("settings.books")}</h2>
    <dl class="panel divide-y divide-line text-[14px]">
      {#each BOOKS as [k, v] (k)}
        <div class="flex flex-wrap gap-x-4 px-4 py-3 sm:px-5"><dt class="w-40 shrink-0 text-sub">{k}</dt><dd class="min-w-0 text-ink-2 [overflow-wrap:anywhere]" dir="auto">{v}</dd></div>
      {/each}
    </dl>
    <p class="text-[13px] text-sub">
      {t("settings.another")}
      <button type="button" class="rounded text-accent-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50" onclick={() => goto("/setup")}>{t("settings.addBusiness")}</button>
    </p>
  </section>
</div>

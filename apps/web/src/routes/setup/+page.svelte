<script lang="ts">
  // Add a business (first run, or "Add a business" in the switcher): country → business type for its first tax year → name,
  // currency. Everything after this happens by dropping statements on the app. Rendered without the shell (layout BARE).
  import { goto } from "#lib/nav.ts";
  import { S, createEntity } from "#lib/stores/books.svelte.ts";
  import { t, I, PACKS } from "#lib/i18n.svelte.ts";
  import { Button, Input, Select } from "#lib/ui/index.ts";
  import { entityId } from "./setup.ts";

  type Country = { id: string; flag: string; label: string; sub: string; currency: string; kind: string; types: { key: string; label: string; sub: string }[]; def: string };
  const COUNTRIES: Country[] = $derived([
    ...PACKS.map((p) => ({
      id: p.manifest.id,
      flag: p.manifest.flag,
      label: p.manifest.names[I.lang],
      sub: t(p.manifest.id === "il" ? "setup.kind.ilSub" : "setup.kind.usSub"),
      currency: p.manifest.currency,
      kind: Object.keys(p.manifest.legacyKinds)[0] ?? "other", // books.py opens books by kind
      types: p.manifest.businessTypes.map((b) => ({ key: b.key, label: t(`biz.${b.key}`), sub: t(`biz.${b.key}.sub`) })),
      def: p.manifest.defaultType,
    })),
    { id: "other", flag: "📒", label: t("setup.kind.other"), sub: t("setup.kind.otherSub"), currency: "USD", kind: "other", types: [], def: "" },
  ]);
  let cid = $state(PACKS[0].manifest.id),
    type = $state(PACKS[0].manifest.defaultType),
    name = $state(""),
    currency = $state(PACKS[0].manifest.currency),
    year = $state(new Date().getFullYear()),
    busy = $state(false);
  const c = $derived(COUNTRIES.find((x) => x.id === cid)!);
  function pickCountry(x: Country) {
    cid = x.id;
    type = x.def;
    currency = x.currency;
  }
  const yearOk = $derived(Number.isInteger(+year) && +year >= 1990 && +year <= 2100);
  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || !yearOk || busy) return;
    busy = true;
    const ok = await createEntity({
      id: entityId(n, c.kind, (S.data?.entities ?? []).map((x) => x.id)),
      name: n,
      short: n.split(/\s+/).slice(0, 3).join(" "),
      kind: c.kind,
      currency,
      flag: c.flag,
      ...(type ? { types: { [String(year)]: type } } : {}),
    });
    busy = false;
    if (ok) void goto("/home");
  }
  const PH: Record<string, string> = { us: "Acme Audio LLC", il: "נועה כהן" };
  const radio = "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-start transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50";
</script>

<svelte:head><title>{S.data ? t("setup.titleAdd") : t("setup.titleFirst")} · OpenBooks</title></svelte:head>

<div class="grid min-h-dvh place-items-center bg-side px-4 py-10">
  <form class="panel w-full max-w-[560px] p-5 sm:p-8" onsubmit={submit}>
    <div class="text-[13px] text-sub">OpenBooks</div>
    <h1 class="display mt-1 text-[26px] leading-8 text-ink">{S.data ? t("setup.titleAdd") : t("setup.titleFirst")}</h1>
    <p class="mt-2 text-[14px] text-sub">{t("setup.intro")}</p>

    <fieldset class="mt-6">
      <legend class="mb-2 text-[13px] text-sub">{t("setup.country")}</legend>
      <div class="grid gap-2" role="radiogroup" aria-label={t("setup.country")}>
        {#each COUNTRIES as x (x.id)}
          <button type="button" role="radio" aria-checked={cid === x.id} onclick={() => pickCountry(x)}
            class="{radio} {cid === x.id ? 'border-accent bg-accent/8' : 'border-line hover:bg-hover'}">
            <span class="text-[20px] leading-none" aria-hidden="true">{x.flag}</span>
            <span class="min-w-0 flex-1"><span class="block text-[14px] text-ink">{x.label}</span><span class="block text-[12px] text-sub">{x.sub}</span></span>
          </button>
        {/each}
      </div>
    </fieldset>

    {#if c.types.length}
      <fieldset class="mt-5">
        <legend class="mb-2 text-[13px] text-sub">{t("setup.type")}</legend>
        <div class="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("setup.type")}>
          {#each c.types as b (b.key)}
            <button type="button" role="radio" aria-checked={type === b.key} onclick={() => (type = b.key)}
              class="{radio} py-2.5 {type === b.key ? 'border-accent bg-accent/8' : 'border-line hover:bg-hover'}">
              <span class="min-w-0 flex-1"><span class="block text-[14px] text-ink">{b.label}</span><span class="block text-[12px] text-sub">{b.sub}</span></span>
            </button>
          {/each}
        </div>
      </fieldset>
    {/if}

    <div class="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
      <Input label={t("setup.name")} bind:value={name} required placeholder={PH[cid] ?? t("setup.namePh")} />
      <Select label={t("setup.currency")} bind:value={currency} options={["ILS", "USD", "EUR"].map((v) => ({ value: v, label: v }))} />
      {#if c.types.length}
        <Input label={t("setup.year")} numeric type="number" min="1990" max="2100" class="sm:w-28" bind:value={year} error={yearOk ? null : t("setup.yearBad")} />
      {/if}
    </div>
    {#if c.types.length}<p class="mt-2 text-[12px] text-faint">{t("setup.typeNote")}</p>{/if}

    <div class="mt-6 flex flex-wrap items-center gap-2">
      {#if S.data}<Button variant="ghost" onclick={() => goto("/home")}>{t("common.cancel")}</Button>{/if}
      <span class="flex-1"></span>
      <Button variant="primary" type="submit" loading={busy} disabled={!name.trim() || !yearOk || busy}>{t("setup.create")}</Button>
    </div>
    <p class="mt-4 text-[12px] text-faint">{t("setup.next")}</p>
  </form>
</div>

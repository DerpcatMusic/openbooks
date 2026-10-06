<script lang="ts">
  // Form 1301, field by field (old web/src/views/TaxReturn.svelte): every box the books fill, the form's Hebrew wording, an
  // explanation, the automatic value (type over it to override; ↺ restores it) and the tax calculation beside it.
  import { S, fmt, knownYear, setForm, setProfile } from "#lib/stores/books.svelte.ts";
  import { t, lang, ltr } from "#lib/i18n.svelte.ts";
  import { Button, Checkbox, IconButton, Input } from "#lib/ui/index.ts";
  import { SECTIONS } from "./fields.ts";
  import { ilYear } from "./il.ts";
  import { personNow, savePerson, withFact } from "#lib/person.ts";

  const b = $derived(ilYear(S.year));
  const PROFILE: [key: string, type?: string, numeric?: boolean][] = [["last"], ["first"], ["id", "text", true], ["phone", "tel", true], ["discharge", "date"], ["serviceMonths", "number", true]];
  const pct = (r: number) => ltr(`${Math.round(r * 100)}%`);
  const val = (e: Event) => (e.currentTarget as HTMLInputElement).value;
  // release date and months served are the person's (/you, the advisor): saved there too, the profile keeps a copy
  const PERSON: Record<string, string> = { discharge: "dischargeDate", serviceMonths: "serviceMonths" };
  function saveProfile(k: string, v: string | number) {
    void setProfile({ [k]: v });
    const me = personNow();
    if (me && PERSON[k]) void savePerson(withFact(me, PERSON[k], v === "" ? undefined : v));
  }
</script>

<div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-8">
  <p class="min-w-0 flex-1 basis-64 text-[14px] text-sub">{t("taxReturn.intro")}</p>
  <div class="flex flex-wrap gap-2">
    <Button icon="printer" href="/print/{b.y}/1301?e={S.e}" target="_blank">{t("taxReturn.printForm")}</Button>
    <Button variant="primary" iconEnd="arrow" href="/documents">{t("taxReturn.proofPack")}</Button>
  </div>
</div>
{#if !knownYear(b.y)}
  <div role="note" class="border-y border-warn/30 bg-warn/8 px-4 py-2.5 text-[13px] text-warn sm:px-8">{t("taxReturn.noTable", { y: b.y, base: b.T.year })}</div>
{/if}

<div class="grid items-start xl:grid-cols-[minmax(0,1fr)_360px]">
  <div class="min-w-0 xl:border-e xl:border-line">
    {#each SECTIONS as sec, n (n)}
      <section class="border-b border-line" aria-labelledby="sec-{n}">
        <div class="flex flex-wrap items-baseline gap-x-3 border-t border-line bg-side px-4 py-2.5 sm:px-8">
          <h2 id="sec-{n}" class="text-[13px] font-medium text-ink">{t(`fields.section.${n + 1}`)}</h2>
          {#if lang() !== "he"}<span class="he text-[12px] text-sub" dir="rtl" lang="he">{sec.he}</span>{/if}
        </div>
        {#if sec.profile}
          <div class="grid grid-cols-1 gap-x-4 gap-y-3 border-t border-line px-4 py-4 min-[420px]:grid-cols-2 sm:grid-cols-3 sm:px-8">
            {#each PROFILE as [k, type = "text", numeric = false] (k)}
              <Input
                label={t(`taxReturn.profile.${k}`)}
                {type}
                {numeric}
                class={numeric || type === "date" ? "" : "ob-name"}
                value={b.p[k] ?? ""}
                onchange={(e: Event) => saveProfile(k, type === "number" ? (val(e) === "" ? "" : +val(e)) : val(e))} />
            {/each}
          </div>
        {/if}
        {#each sec.fields as f (f.key)}
          {@const edited = f.key in b.f}
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-3 sm:px-8">
            <span class="w-9 shrink-0 text-[13px] font-medium text-sub num" dir="ltr">{f.no ?? ""}</span>
            {#snippet reset()}
              <IconButton
                icon="refresh"
                size="sm"
                label={t("taxReturn.backToAuto")}
                class={edited ? "" : "invisible"}
                tabindex={edited ? 0 : -1}
                onclick={() => setForm({ [f.key]: null })} />
            {/snippet}
            {#if f.check}
              <Checkbox
                class="ob-he min-w-0 flex-1"
                label={f.he}
                description={t(`fields.${f.key}.help`)}
                checked={!!b.v(f.key)}
                onchange={(c) => setForm({ [f.key]: c ? "X" : "" })} />
              {@render reset()}
            {:else}
              <div class="min-w-0 flex-1 basis-56">
                <div class="he text-[14px] text-ink ob-he-text" lang="he" aria-hidden="true">{f.he}</div>
                <p class="mt-0.5 text-[12px] text-sub">{t(`fields.${f.key}.help`)}</p>
                {#if b.f[`note:${f.key}`]}<p class="mt-0.5 text-[12px] text-accent-ink" dir="auto">{b.f[`note:${f.key}`]}</p>{/if}
              </div>
              <div class="flex items-center gap-1 max-sm:w-full max-sm:ps-12">
                <Input
                  label={f.he}
                  hideLabel
                  numeric={!!f.no || f.key === "id" || f.key === "file"}
                  class="min-w-0 flex-1 sm:w-40 {f.no || f.key === 'id' || f.key === 'file' ? '' : 'ob-name'} {edited ? 'ob-edited' : ''}"
                  value={b.v(f.key)}
                  placeholder={b.auto[f.key] || "—"}
                  onchange={(e: Event) => setForm({ [f.key]: val(e) })} />
                {@render reset()}
              </div>
            {/if}
          </div>
        {/each}
      </section>
    {/each}
  </div>

  <aside class="px-4 py-6 max-xl:border-b max-xl:border-line sm:px-8 xl:sticky xl:top-4" aria-labelledby="calc-h">
    <h2 id="calc-h" class="text-[14px] font-medium text-ink">{t("taxReturn.calc")}</h2>
    <p class="mt-0.5 text-[12px] text-sub">{t("taxReturn.calcSub")}</p>
    {#snippet line(label: string, value: string, cls = "")}
      <div class="flex justify-between gap-3 py-1 text-[13px] {cls}"><span class="min-w-0">{label}</span><span class="shrink-0 num">{value}</span></div>
    {/snippet}
    <div class="mt-4">
      {@render line(t("taxReturn.business"), fmt(b.taxable))}
      {#each b.rows as r (r.rate)}{@render line(t("taxReturn.bracket", { rate: pct(r.rate), part: fmt(r.part) }), fmt(r.tax), "ps-3 text-sub")}{/each}
      {#if b.cap}{@render line(t("taxReturn.fundProfit", { rate: Math.round((b.T.capitalRate ?? 0.15) * 100) }), fmt(b.capTax), "text-sub")}{/if}
      <div class="my-2 h-px bg-line"></div>
      {@render line(t("taxReturn.gross"), fmt(b.gross))}
      {@render line(t("taxReturn.resident", { pts: b.resident }), "", "text-sub")}
      {#if b.soldier}{@render line(t("taxReturn.soldier", { pts: b.soldier.toFixed(2) }), "", "text-sub")}{/if}
      {@render line(t("taxReturn.credits", { pts: b.points.toFixed(2), point: fmt(b.T.point) }), fmt(-b.credits), "text-good")}
      <div class="my-2 h-px bg-line"></div>
      {@render line(t("taxReturn.due"), fmt(b.due), "font-medium")}
      {#if b.withheld}{@render line(t("taxReturn.withheld"), fmt(-b.withheld), "text-sub")}{/if}
    </div>
    <div class="mt-4 border-t border-line pt-4">
      <div class="text-[12px] font-medium text-sub">{t(b.balance > 0 ? "taxReturn.youPay" : b.balance < 0 ? "taxReturn.refund" : "taxReturn.nothing")}</div>
      <div class="display mt-1 text-[30px] leading-none num {b.balance > 0 ? 'text-bad' : 'text-good'}">{fmt(Math.abs(b.balance))}</div>
      {#if b.assessed}<div class="mt-2 text-[12px] text-sub">{t("taxReturn.assessed", { amount: fmt(b.assessed) })}</div>{/if}
      <p class="mt-3 text-[11px] leading-relaxed text-faint">{t("taxReturn.estimate", { y: b.T.year })}</p>
    </div>
  </aside>
</div>

<style>
  /* overridden value: the input's border turns amber (the kit's Input box has border-line-strong) */
  :global(.ob-edited .border-line-strong) {
    border-color: var(--warn);
  }
  /* names typed in the profile are user data: blurred in privacy mode like every other name */
  :global(html[data-private] .ob-name input) {
    filter: blur(6px);
  }
  /* the form's Hebrew wording: Hebrew paragraph direction, aligned with the interface (plaintext keeps "30%" in place) */
  :global(.ob-he label),
  .ob-he-text {
    display: block;
    font-family: "Noto Sans Hebrew", "Inter", sans-serif;
    unicode-bidi: plaintext;
    text-align: right;
  }
  :global(html[dir="ltr"] .ob-he label),
  :global(html[dir="ltr"]) .ob-he-text {
    text-align: left;
  }
</style>

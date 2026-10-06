<script lang="ts">
  // "You": the person behind every business, stored once (doc _app/person, docs/architecture.md § Country packs). Residence
  // decides which pack computes personal tax and runs the cross-border hook; the facts are the advisor's answers about you.
  // First load migrates the old per-entity "advisor" docs (merged by the server, saved here once).
  import { onMount } from "svelte";
  import { S, toast } from "#lib/stores/books.svelte.ts";
  import { t, I, PACKS } from "#lib/i18n.svelte.ts";
  import { loadPerson, savePerson, packById, question, withFact, answerOf, PERSON_GROUPS, type Person } from "#lib/person.ts";
  import { Button, Card, PageHeader, Select, Skeleton } from "#lib/ui/index.ts";
  import Ask from "../taxximizer/Ask.svelte";
  import CrossBorder from "./CrossBorder.svelte";

  let person = $state<Person | null>(null);
  let error = $state("");
  onMount(async () => {
    while (!S.data) await new Promise((ok) => setTimeout(ok, 50));
    try {
      person = await loadPerson(S.data.entities, S.year, () => toast(t("you.migrated")));
    } catch (x) {
      error = String((x as Error).message || x);
    }
    if (location.hash === "#cross-border") requestAnimationFrame(() => document.getElementById("cross-border")?.scrollIntoView());
  });
  function save(next: Person) {
    person = next;
    savePerson(next).catch((x) => toast(String((x as Error).message || x)));
  }
  const residences = $derived(PACKS.filter((p) => p.crossBorder).map((p) => ({ value: p.manifest.id, label: `${p.manifest.flag} ${p.manifest.names[I.lang]}` })));
  const groups = $derived(
    person
      ? Object.entries(PERSON_GROUPS)
          .map(([g, keys]) => [g, keys.map((k) => question(k, [packById(person!.residence)!].filter(Boolean))).filter((q) => !!q)] as const)
          .filter(([, qs]) => qs.length)
      : [],
  );
</script>

<PageHeader title={t("nav.you")} sub={t("you.sub")}>
  {#snippet actions()}<Button variant="ghost" size="sm" icon="shield" href="/taxximizer">{t("you.openTaxximizer")}</Button>{/snippet}
</PageHeader>

<div class="space-y-4 px-4 pt-5 pb-12 sm:px-8">
  {#if error}
    <Card><p class="text-[14px] text-bad">{t("you.loadFailed", { error })}</p></Card>
  {:else if !person}
    <Skeleton class="h-40" />
  {:else}
    <div class="grid gap-4 lg:grid-cols-2">
      <Card title={t("you.residence")} description={t("you.residenceHint")} class="lg:col-span-2">
        <Select label={t("you.residence")} value={person.residence} options={residences} class="max-w-xs" onchange={(v) => save({ ...person!, residence: v })} />
      </Card>
      {#each groups as [g, qs] (g)}
        <Card title={t(`you.group.${g}`)}>
          <div class="space-y-3">
            {#each qs as q (q.key)}
              <Ask {q} value={answerOf(person.facts, q.key)} onchange={(v) => save(withFact(person!, q.key, v))} />
            {/each}
          </div>
        </Card>
      {/each}
    </div>
    <p class="text-[12px] text-faint">{t("you.more")}</p>
    <div id="cross-border" class="scroll-mt-4">
      <CrossBorder {person} y={S.year} onsave={save} />
    </div>
  {/if}
</div>

<script lang="ts">
  // The to-do list above the review queue: what to do and what to connect, from what the books already know. Filings late or due
  // within the window, connections that need you, nothing connected yet, no pension/savings accounts on record, the year-end deposits
  // (Nov–Dec), and the treaty form when the books hold a US business. Each line links to where it gets done; "done" hides it for the
  // year (kept in the books' "todo" doc).
  import { S, doc, saveDoc, family } from "#lib/stores/books.svelte.ts";
  import { calendar } from "#lib/filings.svelte.ts";
  import { t, lang } from "#lib/i18n.svelte.ts";
  import { url } from "#lib/nav.ts";
  import { Badge, Button, Card } from "#lib/ui/index.ts";

  type Item = { id: string; text: string; href: string; tone: "bad" | "warn" | "accent" };
  const today = new Date().toLocaleDateString("sv"),
    y = +today.slice(0, 4),
    md = today.slice(5);
  const done = $derived(new Set(doc<string[]>("todo", [])));

  const items = $derived.by((): Item[] => {
    if (!S.data) return [];
    const out: Item[] = [];
    for (const f of calendar(y, today).filter((r) => r.status === "overdue" || r.status === "soon"))
      out.push({ id: `filing:${f.id}:${f.date}`, text: t(f.status === "overdue" ? "todo.late" : "todo.due", { what: f.title[lang()], n: f.days }), href: "/filings", tone: f.status === "overdue" ? "bad" : "warn" });
    const conns = S.data.connections ?? [];
    for (const c of conns.filter((c) => c.needsYou || c.lastError)) out.push({ id: `conn:${c.provider}:${today}`, text: t("todo.reconnect", { name: c.provider }), href: "/connections", tone: "bad" });
    if (!conns.some((c) => c.connected)) out.push({ id: "connect-bank", text: t("todo.connect"), href: "/connections", tone: "accent" });
    const accts = (S.data.txns ?? []).map((x) => x.account).join("\n");
    if (!doc<unknown[]>("assets", []).length && !/pension|hishtalmut|gemel|פנסי|השתלמות|גמל|provident/i.test(accts)) out.push({ id: `assets:${y}`, text: t("todo.assets"), href: "/connections", tone: "accent" });
    if (family() === "il" && md >= "11-01") out.push({ id: `yearend:${y}`, text: t("todo.yearEnd"), href: "/taxximizer", tone: "warn" });
    if (new Set((S.data.entities ?? []).map((e) => e.currency)).size > 1) out.push({ id: `w8ben:${y}`, text: t("todo.w8ben"), href: "/taxximizer", tone: "accent" });
    return out.filter((x) => !done.has(x.id));
  });
  const finish = (id: string) => saveDoc("todo", [...done, id]);
</script>

{#if items.length}
  <Card title={t("todo.title")}>
    <ul class="divide-y divide-line">
      {#each items as it (it.id)}
        <li class="flex items-center gap-3 py-2.5">
          <Badge size="sm" tone={it.tone}>{t(`todo.tone.${it.tone}`)}</Badge>
          <a class="flex-1 text-[14px] text-ink hover:underline" href={url(it.href)} dir="auto">{it.text}</a>
          <Button variant="ghost" size="sm" onclick={() => finish(it.id)}>{t("todo.done")}</Button>
        </li>
      {/each}
    </ul>
  </Card>
{/if}

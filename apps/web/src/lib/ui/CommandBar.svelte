<script lang="ts" module>
  // The AI chat lives at module level so it survives closing the bar (as web/src/lib/ai.svelte.js did).
  import type { AiEvent } from "../palette.ts";
  type Step = { id: string; name: string; args?: Record<string, unknown>; state: "run" | "ok" | "err"; error?: string; txns?: string[] };
  type Msg =
    | { role: "user"; text: string }
    | { role: "assistant"; text: string; steps: Step[]; confirm: Extract<AiEvent, { type: "confirm" }> | null; error: string };
  const AI = $state({ chat: [] as Msg[], busy: false });
  let ctrl: AbortController | null = null;
</script>

<script lang="ts">
  // ⌘K / Ctrl+K command bar. Search mode: pages, quick actions (+ tools registered from the tool registry, lib/palette.ts),
  // transactions, counterparties and accounts, fuzzy-matched in both interface languages, with recent items when empty.
  // Ask AI mode ("Ask AI" tab, a "?" prefix, or the Ask AI row): the chat UI over lib/palette.ts's AiBackend (phase 4 plugs it).
  // Keys: ↑↓ move, Enter run, Tab / Shift+Tab next / previous section, Esc stop the answer or close. Phones: a full-screen sheet.
  import { untrack } from "svelte";
  import { goto } from "#lib/nav.ts";
  import { payers as corePayers, translate } from "@openbooks/core";
  import type { Txn } from "@openbooks/schema";
  import { S, upload, setEntity, setTheme, isUS, family, accounts, allCats, catLabel, fmt, mdy, type Theme } from "../stores/books.svelte.ts";
  import { t, bidi, I, DICTS, setLang, type Lang } from "../i18n.svelte.ts";
  import { PV, setPrivate } from "../privacy.svelte.ts";
  import { aiBackend, looksLikeQuestion, md, norm, rank, recent, registered, remember, type Label, type PaletteItem } from "../palette.ts";
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";
  import Button from "./Button.svelte";
  import type { IconName } from "./icons.ts";

  const uid = $props.id();
  const L = (key: string, vars?: Record<string, string | number>): Label => ({ en: translate(DICTS, "en", key, vars), he: translate(DICTS, "he", key, vars) });
  const same = (s: string): Label => ({ en: s, he: s });

  let q = $state(""),
    mode = $state<"search" | "ai">("search"),
    active = $state(0),
    recents = $state<string[]>([]),
    dlg = $state<HTMLDialogElement>(),
    input = $state<HTMLInputElement>(),
    list = $state<HTMLElement>(),
    file = $state<HTMLInputElement>(),
    scroller = $state<HTMLElement>();
  const close = () => (S.cmd = false);

  // open/close the native modal (inert page, focus trapped and restored by the browser)
  $effect(() => {
    if (!dlg) return;
    if (S.cmd && !dlg.open) {
      untrack(() => {
        q = "";
        active = 0;
        mode = AI.busy ? "ai" : "search";
        recents = recent();
      });
      dlg.showModal();
      input?.focus();
    } else if (!S.cmd && dlg.open) dlg.close();
  });

  // ---------- items ----------
  const go = (href: string) => void goto(href);
  const enc = encodeURIComponent;
  const PAGES = $derived.by(() => {
    const us = isUS(),
      tax = !(S.data && !family());
    const p: [string, string, IconName][] = [
      ["/home", "nav.home", "home"],
      ["/transactions", "nav.transactions", "list"],
      ["/invoices", us ? "nav.invoices" : "nav.bills", "file"],
      ["/review", "nav.review", "sparkle"],
      ["/reports", "nav.reports", "report"],
      ["/counterparties", "nav.counterparties", "users"],
      ["/rules", "nav.rules", "rules"],
      ["/accounts", "nav.accounts", "bank"],
      ["/journal", "nav.journal", "file"],
      ["/documents", "nav.documents", "folder"],
      ["/connections", "nav.connections", "wallet"],
      ...(tax
        ? ([
            us ? ["/tax/us", "nav.form5472", "form"] : ["/tax/il", "nav.form1301", "form"],
            ["/planner", "nav.planner", "sparkle"],
            ["/taxximizer", "nav.taxximizer", "shield"],
            ["/you", "nav.you", "user"],
          ] as [string, string, IconName][])
        : []),
      ["/settings", "nav.settings", "settings"],
    ];
    return p.map(([href, key, icon]): PaletteItem => ({ id: `page:${href}`, label: L(key), icon, run: () => go(href) }));
  });
  const LANGS: [Lang, string][] = [
    ["en", "English"],
    ["he", "עברית"],
  ];
  const THEMES: [Theme, IconName][] = [
    ["light", "sun"],
    ["dark", "moon"],
    ["system", "monitor"],
  ];
  const ACTIONS = $derived<PaletteItem[]>([
    { id: "act:import", label: L("cmd.importFiles"), icon: "upload", keep: true, run: () => file?.click() },
    { id: "act:add", label: L("app.addBusiness"), icon: "plus", run: () => go("/setup") },
    ...(S.data?.entities ?? [])
      .filter((e) => e.id !== S.e)
      .map(
        (e): PaletteItem => ({
          id: `act:entity:${e.id}`,
          label: L("cmd.switchTo", { name: bidi(e.short || e.name) }),
          icon: "sort",
          sub: e.flag,
          user: true,
          run: () => {
            void setEntity(e.id);
            go("/home");
          },
        }),
      ),
    ...(S.data?.years ?? [])
      .slice()
      .reverse()
      .map(
        (y): PaletteItem => ({
          id: `act:year:${y}`,
          label: L("cmd.year", { y }),
          icon: "calendar",
          sub: !S.period && S.year === y ? "✓" : "",
          run: () => {
            S.year = y;
            S.period = null;
          },
        }),
      ),
    ...LANGS.map(([l, name]): PaletteItem => ({ id: `act:lang:${l}`, label: L("cmd.language", { name }), icon: "command", sub: I.lang === l ? "✓" : "", run: () => setLang(l) })),
    { id: "act:privacy", label: L("privacy.toggle"), icon: PV.on ? "eye-off" : "eye", sub: PV.on ? "✓" : "", run: () => setPrivate() },
    ...THEMES.map(([th, icon]): PaletteItem => {
      const name = L(`theme.${th}`);
      return {
        id: `act:theme:${th}`,
        label: { en: translate(DICTS, "en", "cmd.theme", { theme: name.en }), he: translate(DICTS, "he", "cmd.theme", { theme: name.he }) },
        icon,
        sub: S.theme === th ? "✓" : "",
        run: () => setTheme(th),
      };
    }),
    ...registered(),
  ]);
  const txnItem = (x: Txn): PaletteItem => ({
    id: `txn:${x.id}`,
    label: same(x.desc || "—"),
    sub: `${mdy(x.date)} · ${catLabel(x.category)}`,
    amount: x.amount,
    user: true,
    icon: x.amount < 0 ? "arrow-up-right" : "arrow-down-left",
    run: () => (S.drawer = x.id),
  });
  const payerItem = (p: { key: string; ts: readonly unknown[]; total: number }): PaletteItem => ({
    id: `payer:${p.key}`,
    label: same(p.key),
    sub: `${p.ts.length} · ${fmt(p.total)}`,
    user: true,
    icon: "users",
    run: () => go(`/counterparties?q=${enc(p.key)}`),
  });
  const catItem = (c: string): PaletteItem => ({
    id: `cat:${c}`,
    label: same(catLabel(c)),
    extra: c,
    sub: t("common.ledgerAccount"),
    icon: "rules",
    run: () => go(`/transactions?q=${enc(`cat:${c}`)}`),
  });
  const acctItem = (a: string): PaletteItem => ({
    id: `acct:${a}`,
    label: same(a),
    sub: t("cmd.bank"),
    user: true,
    icon: "bank",
    run: () => go(`/transactions?q=${enc(`account:${a}`)}`),
  });
  /** A remembered id back to an item, if it still exists in the open books. */
  function resolve(id: string): PaletteItem | undefined {
    const hit = [...PAGES, ...ACTIONS].find((x) => x.id === id);
    if (hit || !S.data) return hit;
    const [kind = "", ...rest] = id.split(":"),
      v = rest.join(":");
    if (kind === "txn") {
      const x = S.data.txns.find((x) => x.id === v);
      return x && txnItem(x);
    }
    if (kind === "payer") {
      const p = corePayers(S.data.txns).find((p) => p.key === v);
      return p && payerItem(p);
    }
    if (kind === "cat") return allCats().includes(v) ? catItem(v) : undefined;
    if (kind === "acct") return accounts().includes(v) ? acctItem(v) : undefined;
  }

  type Group = { key: string; label: string; items: PaletteItem[] };
  const groups = $derived.by((): Group[] => {
    const query = q.trim(),
      out: Group[] = [];
    const aiRow: PaletteItem = {
      id: "ai",
      label: same(query ? t("cmd.askAI", { q: bidi(query) }) : t("cmd.askAIEmpty")),
      icon: "sparkle",
      keep: true,
      run: () => toAI(true),
    };
    const ai: Group = { key: "ai", label: t("cmd.ai"), items: [aiRow] };
    const push = (key: string, label: string, items: PaletteItem[]) => items.length && out.push({ key, label, items });
    if (!query) {
      push("recent", t("cmd.recent"), recents.map(resolve).filter((x) => !!x));
      push("pages", t("cmd.pages"), PAGES);
      push("actions", t("cmd.actions"), ACTIONS);
      out.push(ai);
      return out;
    }
    const question = looksLikeQuestion(query);
    if (question) out.push(ai);
    push("pages", t("cmd.pages"), rank(query, PAGES, 5));
    push("actions", t("cmd.actions"), rank(query, ACTIONS, 5));
    if (S.data) {
      const words = norm(query).split(/\s+/),
        n = query.replace(/[,₪$€\s−-]/g, ""),
        tx: PaletteItem[] = [];
      for (let i = S.data.txns.length - 1; i >= 0 && tx.length < 6; i--) {
        const x = S.data.txns[i]!,
          hay = norm(`${x.desc} ${x.memo ?? ""} ${x.account} ${catLabel(x.category)} ${x.category} ${x.date}`);
        if (words.every((w) => hay.includes(w)) || (/^\d+(\.\d+)?$/.test(n) && String(Math.abs(x.amount)).startsWith(n))) tx.push(txnItem(x));
      }
      push("txns", t("cmd.txns"), tx);
      push("payers", t("cmd.payers"), rank(query, corePayers(S.data.txns).map(payerItem), 4));
      push("accts", t("cmd.accts"), rank(query, [...allCats().map(catItem), ...accounts().map(acctItem)], 4));
    }
    if (!question) out.push(ai);
    return out;
  });
  const flat = $derived(groups.flatMap((g) => g.items));
  const starts = $derived(groups.map((_, gi) => groups.slice(0, gi).reduce((n, g) => n + g.items.length, 0)));
  const only = $derived(flat.length === 1 && !!q.trim()); // nothing matched but "Ask AI"
  $effect(() => {
    void q;
    active = 0;
  });
  $effect(() => {
    list?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  });

  function run(item: PaletteItem | undefined) {
    if (!item) return;
    if (item.id !== "ai") {
      remember(item.id);
      recents = recent();
    }
    if (!item.keep) close();
    item.run();
  }
  /** Tab / Shift+Tab: first row of the next / previous section (wraps). */
  function section(dir: 1 | -1) {
    const g = starts.findLastIndex((s) => s <= active);
    active = starts[(g + dir + starts.length) % starts.length] ?? 0;
  }

  // ---------- Ask AI ----------
  const backend = $derived(S.cmd ? aiBackend() : null); // re-read on open: phase 4 registers it at startup
  const ready = $derived(!!backend?.ready());
  const last = $derived(AI.chat.at(-1));
  const pending = $derived(last?.role === "assistant" ? last.confirm : null);
  function toAI(send = false) {
    mode = "ai";
    const text = q.replace(/^\?\s*/, "").trim();
    q = text;
    if (send && text) ask(text);
    queueMicrotask(() => input?.focus());
  }
  function ask(text: string) {
    text = text.replace(/^\?\s*/, "").trim();
    if (!text || AI.busy || !backend || !ready) return;
    const b = backend;
    q = "";
    AI.chat.push({ role: "user", text });
    const messages = AI.chat.filter((m) => m.text).map((m) => ({ role: m.role, content: m.text }));
    AI.chat.push({ role: "assistant", text: "", steps: [], confirm: null, error: "" });
    const a = AI.chat.at(-1) as Extract<Msg, { role: "assistant" }>;
    AI.busy = true;
    ctrl = new AbortController();
    const on = (ev: AiEvent) => {
      if (ev.type === "text") a.text += ev.text;
      else if (ev.type === "tool") a.steps.push({ id: ev.id, name: ev.name, args: ev.args, state: "run" });
      else if (ev.type === "confirm") a.confirm = ev;
      else if (ev.type === "tool_done") {
        const s = a.steps.find((x) => x.id === ev.id);
        if (s) Object.assign(s, { state: ev.ok ? "ok" : "err", error: ev.error, txns: ev.txns });
        a.confirm = null;
      } else if (ev.type === "error") a.error = ev.error;
    };
    // writes reach the app through /api/events (live updates), so no reload here
    b.ask({ messages, entity: S.e, year: S.year, lang: I.lang }, on, ctrl.signal)
      .catch((e: Error) => {
        if (e?.name !== "AbortError") a.error = String(e?.message || e);
      })
      .finally(() => {
        AI.busy = false;
        ctrl = null;
        a.confirm = null;
        for (const s of a.steps) if (s.state === "run") s.state = "err";
      });
  }
  const stopAI = () => ctrl?.abort();
  const newChat = () => {
    stopAI();
    AI.chat = [];
  };
  function decide(a: Extract<Msg, { role: "assistant" }>, ok: boolean) {
    const id = a.confirm?.id;
    a.confirm = null;
    if (id) void backend?.decide(id, ok).catch(() => {});
    input?.focus(); // the buttons are gone; keep focus inside the bar
  }
  $effect(() => {
    if (mode === "search" && q.startsWith("?")) untrack(() => toAI());
  });
  $effect(() => {
    void [AI.chat.length, last?.text, last?.role === "assistant" && last.steps.length, pending];
    if (mode === "ai" && scroller) queueMicrotask(() => scroller && (scroller.scrollTop = scroller.scrollHeight));
  });
  const isTxn = (id: string) => /^[0-9a-f]{12}$/.test(id) && !!S.data?.txns.some((x) => x.id === id);
  function answerClick(e: MouseEvent) {
    const el = e.target as HTMLElement,
      b = el.closest<HTMLElement>("[data-txn]");
    if (b) {
      S.drawer = b.dataset.txn ?? null;
      close();
    } else if (el.closest("a[href^='/']")) close();
  }
  const chipLabel = (s: Step) =>
    s.name.replace(/_/g, " ") +
    (s.args && Object.keys(s.args).length
      ? " · " +
        Object.entries(s.args)
          .filter(([k]) => !["ids", "rules", "lines", "items"].includes(k))
          .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
          .join(" ")
          .slice(0, 60)
      : "");

  // ---------- keys ----------
  function key(e: KeyboardEvent) {
    if (e.key === "Tab" && e.target === input) {
      if (mode === "search" && flat.length) {
        e.preventDefault();
        section(e.shiftKey ? -1 : 1);
      } else if (mode === "ai" && !pending) {
        e.preventDefault(); // with a pending Approve/Deny, Tab reaches its buttons
        mode = "search";
      }
      return;
    }
    if (mode === "search") {
      const n = flat.length;
      if (!n) return;
      if (e.key === "ArrowDown") active = (active + 1) % n;
      else if (e.key === "ArrowUp") active = (active - 1 + n) % n;
      else if (e.key === "Home" && e.ctrlKey) active = 0;
      else if (e.key === "End" && e.ctrlKey) active = n - 1;
      else if (e.key === "Enter" && !e.isComposing) run(flat[active]);
      else return;
      e.preventDefault();
    } else if (e.target === input) {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        ask(q);
      } else if (e.key === "Backspace" && !q) mode = "search";
    }
  }
  function globalKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      S.cmd = !S.cmd;
    }
  }
  const hints = $derived(
    AI.busy && mode === "ai"
      ? [t("cmd.hint.stop")]
      : mode === "ai"
        ? [t("cmd.hint.send"), t("cmd.hint.search"), t("cmd.hint.close")]
        : [t("cmd.hint.move"), t("cmd.hint.open"), t("cmd.hint.section"), t("cmd.hint.askQ"), t("cmd.hint.close")],
  );
  const optId = (n: number) => `${uid}-o${n}`;
</script>

<svelte:window onkeydown={globalKey} />
<input
  bind:this={file}
  type="file"
  multiple
  accept=".pdf,.csv,.json"
  class="hidden"
  onchange={(e) => {
    const el = e.currentTarget;
    close();
    void upload([...(el.files ?? [])]);
    el.value = "";
  }}
/>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dlg}
  aria-label={t("cmd.title")}
  onkeydown={key}
  oncancel={(e) => {
    e.preventDefault(); // Esc: stop a streaming answer first, then close (also when focus fell out of the input)
    if (AI.busy && mode === "ai") stopAI();
    else close();
  }}
  onclose={() => (S.cmd = false)}
  onclick={(e) => e.target === dlg && close()}
  class={[
    "m-0 flex-col overflow-hidden border-line-strong bg-panel p-0 text-ink shadow-[var(--shadow)] outline-none open:flex backdrop:bg-black/25",
    "fixed inset-0 h-dvh max-h-none w-full max-w-none",
    "sm:inset-x-0 sm:top-[10vh] sm:bottom-auto sm:mx-auto sm:h-auto sm:max-h-[76vh] sm:w-[680px] sm:max-w-[calc(100vw-32px)] sm:rounded-2xl sm:border",
    "transition-[opacity,translate] duration-150 starting:open:translate-y-1 starting:open:opacity-0 motion-reduce:transition-none",
  ]}
>
  {#if S.cmd}
    <div class="flex h-14 shrink-0 items-center gap-3 border-b border-line ps-4 pe-3">
      <Icon name={mode === "ai" ? "sparkle" : "search"} size={18} class={mode === "ai" ? "text-accent-ink" : "text-sub"} />
      <input
        bind:this={input}
        bind:value={q}
        dir="auto"
        spellcheck="false"
        autocomplete="off"
        enterkeyhint={mode === "ai" ? "send" : "go"}
        placeholder={mode === "ai" ? (AI.chat.length ? t("cmd.followPh") : t("cmd.askPh")) : t("cmd.search")}
        role={mode === "search" ? "combobox" : undefined}
        aria-expanded={mode === "search" ? true : undefined}
        aria-controls={mode === "search" ? `${uid}-list` : undefined}
        aria-activedescendant={mode === "search" && flat.length ? optId(active) : undefined}
        aria-autocomplete={mode === "search" ? "list" : undefined}
        aria-label={mode === "ai" ? t("cmd.askPh") : t("cmd.search")}
        class="h-full min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:truncate placeholder:text-faint"
      />
      {#if mode === "ai" && AI.busy}
        <Button size="sm" onclick={stopAI}>{t("cmd.stop")}</Button>
      {:else if mode === "ai" && AI.chat.length}
        <Button size="sm" variant="ghost" onclick={newChat}>{t("cmd.newChat")}</Button>
      {/if}
      <kbd class="shrink-0 rounded-md border border-line px-1.5 text-[11px] leading-5 text-faint max-sm:hidden">esc</kbd>
      <IconButton icon="x" label={t("common.close")} onclick={close} class="sm:hidden" />
    </div>

    <div role="tablist" aria-label={t("cmd.title")} class="flex shrink-0 gap-1 border-b border-line px-3 py-1.5">
      {#each [["search", t("cmd.tab.search"), "search"], ["ai", t("cmd.askChip"), "sparkle"]] as const as [m, label, icon] (m)}
        <button
          role="tab"
          aria-selected={mode === m}
          tabindex="-1"
          onclick={() => (m === "ai" ? toAI() : ((mode = "search"), input?.focus()))}
          class="flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-accent/50 {mode === m
            ? 'bg-fill text-ink'
            : 'text-sub hover:bg-hover hover:text-ink'}"
        >
          <Icon name={icon} size={14} class={m === "ai" ? "text-accent-ink" : ""} />{label}
        </button>
      {/each}
    </div>

    {#if mode === "search"}
      <div bind:this={list} id="{uid}-list" role="listbox" aria-label={t("cmd.title")} class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {#each groups as g, gi (g.key)}
          <div role="group" aria-labelledby="{uid}-g{gi}">
            <div id="{uid}-g{gi}" class="px-2.5 pt-2.5 pb-1 text-[12px] text-sub">{g.label}</div>
            {#each g.items as it, i (it.id)}
              {@const n = starts[gi]! + i}
              <!-- svelte-ignore a11y_click_events_have_key_events (keys go through the combobox input) -->
              <div
                id={optId(n)}
                data-i={n}
                role="option"
                aria-selected={n === active}
                tabindex="-1"
                onclick={() => run(it)}
                onpointermove={() => (active = n)}
                class="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-1 text-[14px] {n === active ? 'bg-fill text-ink' : 'text-ink-2'}"
              >
                <Icon name={it.icon as IconName} size={16} class={it.id === "ai" ? "text-accent-ink" : "text-sub"} />
                <span class="flex min-w-0 flex-1 items-center gap-x-3 {(it.sub?.length ?? 0) > 2 ? 'max-sm:flex-col max-sm:items-stretch' : ''}">
                  <span class="min-w-0 flex-1 truncate" dir={it.user ? "auto" : undefined}>{it.label[I.lang]}</span>
                  {#if it.sub}<span class="min-w-0 truncate text-[13px] text-sub sm:max-w-[45%] sm:shrink-0">{it.sub}</span>{/if}
                </span>
                {#if it.amount !== undefined}<span class="shrink-0 text-end num whitespace-nowrap {it.amount > 0 ? 'text-good' : 'text-ink'}">{fmt(it.amount, 2)}</span>{/if}
              </div>
            {/each}
          </div>
        {/each}
        {#if only}<div class="px-3 py-6 text-center text-[14px] text-sub" role="status">{t("cmd.noMatch")}</div>{/if}
      </div>
    {:else}
      <div bind:this={scroller} class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4" aria-live="polite">
        {#if !backend}
          <p class="text-[14px] text-sub">{t("cmd.aiSoon")}</p>
        {:else if !ready}
          <p class="mb-4 text-[14px] text-ink-2">{t("cmd.setup")}</p>
          <Button variant="primary" icon="settings" href="/settings" onclick={close}>{t("cmd.openSettings")}</Button>
        {:else if !AI.chat.length}
          <p class="text-[14px] text-sub">{t("cmd.empty")}</p>
          <div class="mt-3 flex flex-wrap gap-1.5">
            {#each [t("cmd.ex1"), t("cmd.ex2"), t("cmd.ex3")] as ex (ex)}<Button size="sm" onclick={() => ask(ex)}>{ex}</Button>{/each}
          </div>
        {:else}
          <div class="space-y-4">
            {#each AI.chat as m, mi (mi)}
              {#if m.role === "user"}
                <div class="flex justify-end"><div class="max-w-[85%] rounded-2xl bg-fill px-3.5 py-2 text-[14px] text-ink [overflow-wrap:anywhere]" dir="auto">{m.text}</div></div>
              {:else}
                <div>
                  {#if m.steps.length}
                    <div class="mb-2 flex flex-wrap gap-1.5">
                      {#each m.steps as s (s.id)}
                        <span
                          class="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border border-line px-2 text-[12px] whitespace-nowrap {s.state === 'err' ? 'text-bad' : 'text-sub'}"
                          title={s.error ?? ""}
                        >
                          {#if s.state === "run"}<span class="size-1.5 shrink-0 animate-pulse rounded-full bg-accent"></span>{:else}<Icon
                              name={s.state === "ok" ? "tick" : "x"}
                              size={12}
                            />{/if}
                          <span class="truncate">{chipLabel(s)}</span>
                          {#if s.txns?.length}<span class="text-faint num">{s.txns.length}</span>{/if}
                        </span>
                      {/each}
                    </div>
                  {/if}
                  {#if m.text}
                    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                    <div class="md text-[14px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]" dir="auto" onclick={answerClick}>{@html md(m.text, isTxn)}</div>
                  {:else if m === last && AI.busy && !m.confirm}
                    <div class="text-[14px] text-sub">{t("cmd.thinking")}</div>
                  {/if}
                  {#if m.confirm}
                    <div class="mt-3 rounded-xl border border-warn/40 bg-warn/8 p-3.5" role="alertdialog" aria-label={t("cmd.wants")}>
                      <div class="flex items-center gap-2 text-[13px] text-warn"><Icon name="alert" size={14} />{t("cmd.wants")}</div>
                      <div class="mt-1 text-[14px] text-ink" dir="auto">{m.confirm.summary}</div>
                      <div class="mt-3 flex flex-wrap gap-2">
                        <Button variant="primary" onclick={() => decide(m, true)}>{t("cmd.approve")}</Button>
                        <Button onclick={() => decide(m, false)}>{t("cmd.deny")}</Button>
                      </div>
                    </div>
                  {/if}
                  {#if m.error}<div class="mt-2 text-[13px] text-bad" role="alert" dir="auto">{m.error}</div>{/if}
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <div class="flex min-h-9 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[12px] text-faint max-sm:pb-[max(0.5rem,env(safe-area-inset-bottom))] {mode === 'search' ? 'max-sm:hidden' : ''}">
      {#each hints as h (h)}<span class="whitespace-nowrap max-sm:hidden">{h}</span>{/each}
      {#if mode === "ai"}<span class="ms-auto">{t("cmd.disclaimer")}</span>{/if}
    </div>
  {/if}
</dialog>

<style>
  .md :global(p) {
    margin: 0 0 0.6em;
  }
  .md :global(p:last-child) {
    margin-bottom: 0;
  }
  .md :global(.md-h) {
    color: var(--color-ink);
    font-weight: 500;
  }
  .md :global(strong) {
    color: var(--color-ink);
    font-weight: 560;
  }
  .md :global(ul),
  .md :global(ol) {
    margin: 0 0 0.6em;
    padding-inline-start: 1.25em;
  }
  .md :global(ul) {
    list-style: disc;
  }
  .md :global(ol) {
    list-style: decimal;
  }
  .md :global(li) {
    margin: 0.15em 0;
  }
  .md :global(code) {
    font-size: 0.9em;
    background: var(--color-fill);
    border-radius: 4px;
    padding: 0 4px;
  }
  .md :global(a),
  .md :global(.md-txn) {
    color: var(--color-accent-ink);
  }
  .md :global(a:hover),
  .md :global(.md-txn:hover) {
    text-decoration: underline;
  }
  .md :global(.md-txn) {
    font-family: ui-monospace, monospace;
    font-size: 0.9em;
    cursor: pointer;
  }
  .md :global(.md-t) {
    overflow-x: auto;
    margin: 0 0 0.6em;
  }
  .md :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .md :global(th) {
    text-align: start;
    font-weight: 400;
    color: var(--color-sub);
    border-bottom: 1px solid var(--color-line);
    padding: 4px 8px;
    white-space: nowrap;
  }
  .md :global(td) {
    border-bottom: 1px solid var(--color-line);
    padding: 4px 8px;
  }
  .md :global(.r) {
    text-align: end;
  }
</style>

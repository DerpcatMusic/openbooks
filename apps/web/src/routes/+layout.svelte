<script lang="ts">
  // App shell: sidebar (entity switcher, ⌘K entry, nav, import, settings, language, theme, privacy), drag-and-drop import, toast.
  // Pages under BARE render without the shell (setup, print views, the /dev gallery, documents like /invoices/<id>/doc).
  import "../app.css";
  import { onMount, type Snippet } from "svelte";
  import { page } from "$app/state";
  import { goto, url, appPath } from "#lib/nav.ts";
  import { S, load, live, upload, setEntity, setTheme, isUS, ent, family, bizLabel, bizType, type Theme } from "#lib/stores/books.svelte.ts";
  import { t, I, setLang, type Lang } from "#lib/i18n.svelte.ts";
  import { PV, setPrivate } from "#lib/privacy.svelte.ts";
  import CommandBar from "#lib/ui/CommandBar.svelte";
  import TxnDrawer from "#lib/txns/TxnDrawer.svelte";
  import VaultPrompt from "#lib/vault/VaultPrompt.svelte";
  import { installAi } from "#lib/ai.ts";
  import { vatRegistered } from "@openbooks/country-il";

  let { children }: { children: Snippet } = $props();

  const ICONS: Record<string, string> = {
    home: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z",
    list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
    users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    rules: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
    report: "M3 3v18h18M7 16v-5M12 16V8M17 16v-8",
    form: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8M8 9h2",
    folder: "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2",
    file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
    tick: "M20 6 9 17l-5-5",
    upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
    search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.35-4.35",
    sort: "m7 15 5 5 5-5M7 9l5-5 5 5",
    plus: "M12 5v14M5 12h14",
    sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42",
    moon: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
    monitor: "M20 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2M8 21h8M12 17v4",
    settings:
      "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1",
    bank: "M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3",
    wallet: "M20 12V8H6a2 2 0 0 1 0-4h12v4M4 6v12a2 2 0 0 0 2 2h14v-4M18 12a2 2 0 0 0 0 4h4v-4z",
    eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z",
    "eye-off": "M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3M9.9 9.9a3 3 0 004.2 4.2",
    sparkle: "M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2zM19 3v4M21 5h-4",
    user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
    shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10",
  };

  type Item = { href: string; label: string; icon: string };
  const NAV: [string | null, Item[]][] = $derived([
    [
      null,
      [
        { href: "/home", label: t("nav.home"), icon: "home" },
        { href: "/transactions", label: t("nav.transactions"), icon: "list" },
        { href: "/invoices", label: isUS() ? t("nav.invoices") : vatRegistered(bizType(new Date().getFullYear())) ? t("invoices.title.ilVat") : t("nav.bills"), icon: "file" },
        { href: "/review", label: t("nav.review"), icon: "sparkle" },
        { href: "/reports", label: t("nav.reports"), icon: "report" },
        { href: "/counterparties", label: t("nav.counterparties"), icon: "users" },
      ],
    ],
    [
      t("nav.section.books"),
      [
        { href: "/rules", label: t("nav.rules"), icon: "rules" },
        { href: "/accounts", label: t("nav.accounts"), icon: "bank" },
        { href: "/journal", label: t("nav.journal"), icon: "file" },
        { href: "/documents", label: t("nav.documents"), icon: "folder" },
        { href: "/connections", label: t("nav.connections"), icon: "wallet" },
      ],
    ],
    ...(S.data && !family()
      ? []
      : ([
          [
            t("nav.section.tax"),
            [
              isUS() ? { href: "/tax/us", label: t("nav.form5472"), icon: "form" } : { href: "/tax/il", label: t("nav.form1301"), icon: "form" },
              { href: "/planner", label: t("nav.planner"), icon: "sparkle" },
              { href: "/taxximizer", label: t("nav.taxximizer"), icon: "shield" },
              { href: "/you", label: t("nav.you"), icon: "user" },
            ],
          ],
        ] as [string, Item[]][])),
  ]);
  const DEMO = !!import.meta.env.VITE_DEMO;
  const BARE = /^\/(setup|print|dev)(\/|$)|\/doc$/;
  const path = $derived(appPath(page.url.pathname));
  const bare = $derived(BARE.test(path));
  const active = (href: string) => path === href || path.startsWith(href + "/");
  const ask = $derived(S.data?.txns.filter((x) => x.category === "ask").length ?? 0);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const LANGS: { key: Lang; label: string; title: string }[] = [
    { key: "en", label: "EN", title: "English" },
    { key: "he", label: "עב", title: "עברית" },
  ];
  const THEMES: { key: Theme; icon: string; title: () => string }[] = [
    { key: "light", icon: "sun", title: () => t("theme.light") },
    { key: "system", icon: "monitor", title: () => t("theme.system") },
    { key: "dark", icon: "moon", title: () => t("theme.dark") },
  ];

  let dragging = $state(0),
    switcher = $state(false),
    switchBtn = $state<HTMLButtonElement>(),
    toastValue = $state(""),
    toastTimer: ReturnType<typeof setTimeout> | undefined;
  const closeSwitcher = () => {
    switcher = false;
    switchBtn?.focus();
  };
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");

  onMount(() => {
    // Old app links: #/view/arg?e=id → /view/arg?e=id
    if (location.hash.startsWith("#/")) {
      const [p = "", q] = location.hash.slice(2).split("?"),
        [v = "home", ...rest] = p.split("/");
      const map: Record<string, string> = { tax: "tax/il" };
      const to = v === "form1301" ? `print/${rest[0] ?? ""}/1301` : [map[v] ?? v, ...rest].join("/");
      void goto(`/${to}${q ? `?${q}` : ""}`, { replace: true });
    }
    if (!S.data) void load();
    installAi();
    // Print pages are rendered by headless Chrome for /api/pack: an open SSE stream would keep its virtual-time budget from ever running out.
    if (!/^\/print(\/|$)/.test(appPath(location.pathname)) && !location.hash.startsWith("#/print/")) return live();
  });

  // ?e=<id> on any page opens that business.
  $effect(() => {
    const e = page.url.searchParams.get("e");
    if (e && e !== S.e) void setEntity(e);
  });
  // No books yet: setup.
  $effect(() => {
    if (S.setup && !path.startsWith("/setup") && !path.startsWith("/dev")) void goto("/setup");
  });
  // Toast: auto-dismiss (longer when it carries an action).
  $effect(() => {
    const cur = S.toast;
    if (!cur) return;
    toastValue = cur.action?.value ?? "";
    toastTimer = setTimeout(() => S.toast?.id === cur.id && (S.toast = null), cur.action ? 12000 : 3500);
    return () => clearTimeout(toastTimer);
  });
  const runToast = () => {
    S.toast?.action?.run(toastValue);
    S.toast = null;
  };

  function onkeydown(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "KeyE") {
      e.preventDefault();
      setPrivate();
    } else if (switcher && e.key === "Escape") closeSwitcher();
    // clickable table rows (tr[tabindex]) open with Enter or Space, like buttons
    else if ((e.key === "Enter" || e.key === " ") && el?.matches?.("tr[tabindex]")) {
      e.preventDefault();
      el.click();
    }
  }
</script>

{#snippet icon(name: string, size = 16, cls = "")}
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 {cls}" aria-hidden="true"><path d={ICONS[name]} /></svg>
{/snippet}

{#snippet segmented<K extends string>(label: string, value: K, items: { key: K; label?: string; icon?: string; title: string; lang?: string }[], pick: (k: K) => void)}
  <div
    class="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-full bg-fill p-0.5"
    role="radiogroup"
    aria-label={label}
    tabindex="-1"
    onkeydown={(e) => {
      const d = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
      if (!d) return;
      e.preventDefault();
      const rtl = getComputedStyle(e.currentTarget).direction === "rtl" && (e.key === "ArrowLeft" || e.key === "ArrowRight");
      const i = (items.findIndex((it) => it.key === value) + (rtl ? -d : d) + items.length) % items.length;
      pick(items[i]!.key);
      (e.currentTarget.querySelectorAll("[role=radio]")[i] as HTMLElement | undefined)?.focus();
    }}
  >
    {#each items as it (it.key)}
      <button
        role="radio"
        aria-checked={value === it.key}
        tabindex={value === it.key ? 0 : -1}
        title={it.title}
        aria-label={it.title}
        lang={it.lang}
        onclick={() => pick(it.key)}
        class="flex h-full items-center justify-center rounded-full text-[13px] whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 {it.label
          ? 'px-3'
          : 'w-7'} {value === it.key ? 'bg-panel text-ink shadow-[0_1px_2px_rgb(0_0_0/0.12)]' : 'text-sub hover:text-ink'}"
      >
        {#if it.icon}{@render icon(it.icon, 14)}{/if}{it.label ?? ""}
      </button>
    {/each}
  </div>
{/snippet}

{#snippet prefs()}
  {@render segmented(t("app.language"), I.lang, LANGS.map((l) => ({ ...l, lang: l.key })), (l) => setLang(l))}
  {@render segmented(
    t("theme.label"),
    S.theme,
    THEMES.map((x) => ({ key: x.key, icon: x.icon, title: x.title() })),
    setTheme,
  )}
{/snippet}

{#snippet navLink(it: Item, extra = "")}
  <a
    href={url(it.href)}
    aria-current={active(it.href) ? "page" : undefined}
    class="flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-[15px] whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 {active(it.href)
      ? 'bg-fill text-ink'
      : 'text-ink-2 hover:bg-hover hover:text-ink'} {extra}"
  >
    {@render icon(it.icon, 16, active(it.href) ? "" : "text-sub")}{it.label}
    {#if it.href === "/review" && ask}<span class="ms-auto rounded-full bg-warn/15 px-1.5 text-[11px] leading-[18px] text-warn num">{ask}</span>{/if}
  </a>
{/snippet}

<svelte:window
  {onkeydown}
  ondragenter={(e) => hasFiles(e) && dragging++}
  ondragleave={(e) => hasFiles(e) && dragging--}
  ondragover={(e) => hasFiles(e) && e.preventDefault()}
  ondrop={(e) => {
    if (!hasFiles(e) || bare) return;
    e.preventDefault();
    dragging = 0;
    void upload([...e.dataTransfer!.files]);
  }}
/>

{#key I.lang}
  {#if bare}
    {@render children()}
  {:else}
    <a href="#main" class="sr-only z-50 rounded-lg bg-panel px-3 py-2 text-[14px] text-ink shadow-[var(--shadow)] focus:not-sr-only focus:fixed focus:start-3 focus:top-3">{t("nav.skip")}</a>
    <div class="min-h-screen md:flex">
      <aside class="flex min-w-0 shrink-0 flex-col bg-side max-md:border-b max-md:border-line md:fixed md:inset-y-0 md:start-0 md:w-[240px] md:overflow-y-auto">
        <div class="flex items-center gap-1.5 px-3 pt-3">
          <!-- entity switcher -->
          <div class="relative min-w-0 flex-1">
            <button
              bind:this={switchBtn}
              onclick={() => (switcher = !switcher)}
              class="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-1 text-start outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50"
              aria-expanded={switcher}
              aria-haspopup="menu"
            >
              <span class="grid size-7 shrink-0 place-items-center rounded-md bg-panel text-[15px] shadow-[0_0_0_1px_var(--color-line)]">{ent().flag ?? "📒"}</span>
              <span class="min-w-0 flex-1">
                <span class="ui-align block text-[14px] leading-5 break-words text-ink" dir="auto">{ent().short ?? "OpenBooks"}</span>
                <span class="block text-[12px] leading-4 text-sub">{S.data ? `${bizLabel()} · ${ent().currency ?? ""}` : t("common.loading")}</span>
              </span>
              {#if S.busy}<span class="size-1.5 shrink-0 animate-pulse rounded-full bg-accent"></span>{/if}
              {@render icon("sort", 14, "text-sub")}
            </button>
            {#if switcher}
              <div class="fixed inset-0 z-30" onclick={closeSwitcher} role="presentation"></div>
              <div class="absolute inset-x-0 top-full z-40 mt-1 rounded-xl border border-line bg-panel p-1 shadow-[var(--shadow)]" role="menu">
                <div class="px-2.5 pt-1.5 pb-1 text-[12px] text-sub">{t("app.switcher.title")}</div>
                {#each S.data?.entities ?? [] as en (en.id)}
                  <button
                    role="menuitem"
                    onclick={() => {
                      switcher = false;
                      void setEntity(en.id);
                      void goto("/home");
                    }}
                    class="flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-start text-[14px] outline-none hover:bg-hover focus-visible:bg-hover"
                  >
                    <span>{en.flag}</span><span class="ui-align min-w-0 flex-1 break-words" dir="auto">{en.short ?? en.name}</span>
                    {#if en.id === S.e}{@render icon("tick", 15, "text-accent")}{/if}
                  </button>
                {/each}
                <button
                  role="menuitem"
                  onclick={() => {
                    switcher = false;
                    void goto("/setup");
                  }}
                  class="flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-start text-[14px] text-sub outline-none hover:bg-hover hover:text-ink focus-visible:bg-hover"
                >
                  {@render icon("plus", 15)}{t("app.addBusiness")}
                </button>
              </div>
            {/if}
          </div>
          <button
            onclick={() => setPrivate()}
            aria-pressed={PV.on}
            aria-label={t("privacy.toggle")}
            aria-keyshortcuts="Meta+Shift+E Control+Shift+E"
            title="{t('privacy.toggle')} ({isMac ? '⌘⇧E' : 'Ctrl+Shift+E'})"
            class="grid size-8 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/50 {PV.on
              ? 'bg-accent/15 text-accent-ink'
              : 'text-sub hover:bg-hover hover:text-ink'}">{@render icon(PV.on ? "eye-off" : "eye", 15)}</button
          >
        </div>

        <div class="flex flex-wrap items-center gap-2 px-3 pt-2">
          <button
            onclick={() => (S.cmd = true)}
            aria-keyshortcuts="Meta+K Control+K"
            class="flex h-8 min-w-40 flex-1 items-center gap-2.5 rounded-lg bg-panel px-2.5 text-[14px] text-sub shadow-[0_0_0_1px_var(--color-line)] hover:text-ink"
          >
            {@render icon("search", 15)}<span class="flex-1 text-start whitespace-nowrap">{t("cmd.searchOrAsk")}</span>
            <kbd class="rounded border border-line px-1 text-[11px] leading-4 text-faint max-md:hidden">{isMac ? "⌘" : "Ctrl "}K</kbd>
          </button>
          <div class="flex gap-2 md:hidden">{@render prefs()}</div>
        </div>

        <nav aria-label={t("nav.main")} class="flex gap-0.5 px-3 pt-3 max-md:overflow-x-auto max-md:pb-3 md:flex-col">
          {#each NAV as [section, items], i (i)}
            {#if section}<div class="px-2.5 pt-5 pb-1 text-[12px] font-[480] text-sub max-md:hidden">{section}</div>{/if}
            {#each items as it (it.href)}{@render navLink(it)}{/each}
          {/each}
          {@render navLink({ href: "/settings", label: t("nav.settings"), icon: "settings" }, "md:hidden")}
        </nav>

        <div class="mt-auto space-y-1 px-3 pt-4 pb-3 max-md:hidden">
          <label
            class="flex h-8 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[15px] text-ink-2 focus-within:ring-2 focus-within:ring-accent/50 hover:bg-hover hover:text-ink"
          >
            {@render icon("upload", 16, "text-sub")}{t("common.import")}
            <input type="file" multiple accept=".pdf,.csv,.json" class="sr-only" onchange={(e) => upload([...(e.currentTarget.files ?? [])])} />
          </label>
          {@render navLink({ href: "/settings", label: t("nav.settings"), icon: "settings" })}
          <div class="flex flex-wrap items-center justify-between gap-2 px-1 pt-2">{@render prefs()}</div>
        </div>
      </aside>

      <main id="main" tabindex="-1" class="min-w-0 flex-1 pb-28 outline-none md:ms-[240px]">
        {#if DEMO}
          <div class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line bg-accent/8 px-4 py-2 text-center text-[13px] text-ink-2">
            <span>{t("demo.banner")}</span>
            <a class="whitespace-nowrap text-accent-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50" href="https://github.com/DerpcatMusic/openbooks">{t("demo.get")}</a>
          </div>
        {/if}
        {#if S.data}
          {#key S.e}{@render children()}{/key}
        {:else}
          <div class="py-32 text-center text-sub">{t("app.reading")}</div>
        {/if}
      </main>
    </div>

    {#if dragging > 0}
      <div class="pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-bg/80 p-4 backdrop-blur-sm">
        <div class="rounded-2xl border-2 border-dashed border-accent px-10 py-8 text-center">
          <div class="text-[16px] text-ink">{t("app.drop.title")} <bdi>{ent().short}</bdi></div>
          <div class="mt-1 text-[14px] text-sub">{isUS() ? t("app.drop.us") : t("app.drop.il")} {t("app.drop.other", { year: S.year })}</div>
        </div>
      </div>
    {/if}
  {/if}

  <CommandBar />
  <TxnDrawer />
  <VaultPrompt />

  {#if S.toast}
    <!-- A manual popover joins the top layer, so the toast shows above an open modal drawer/dialog (z-index can't). -->
    <div
      role="status"
      popover="manual"
      {@attach (el: HTMLElement) => el.showPopover()}
      class="fixed inset-x-0 top-auto bottom-6 m-0 mx-auto flex w-fit max-w-[calc(100vw-32px)] items-center gap-3 rounded-[20px] border-0 bg-ink p-0 py-1.5 ps-5 pe-1.5 text-[14px] text-bg shadow-[var(--shadow)]"
    >
      <span class="min-w-0 break-words" dir="auto">{S.toast.msg}</span>
      {#if S.toast.action}
        {#if S.toast.action.value !== undefined}
          <input
            dir="auto"
            bind:value={toastValue}
            onkeydown={(e) => e.key === "Enter" && runToast()}
            onfocus={() => clearTimeout(toastTimer)}
            aria-label={S.toast.action.label}
            class="h-7 w-56 min-w-0 rounded-full border border-bg/25 bg-transparent px-3 text-bg outline-none focus:border-bg/60"
          />
        {/if}
        <button class="h-7 shrink-0 rounded-full bg-bg px-3.5 whitespace-nowrap text-ink" onclick={runToast}>{S.toast.action.label}</button>
      {/if}
      <button class="grid size-7 shrink-0 place-items-center rounded-full opacity-60 hover:opacity-100" onclick={() => (S.toast = null)} aria-label={t("common.dismiss")}>✕</button>
    </div>
  {/if}
{/key}

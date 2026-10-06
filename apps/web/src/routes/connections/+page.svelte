<script lang="ts">
  // Bank connections: pull transactions straight from the bank into inbox/ (connectors), or map any bank's CSV once.
  // Secrets never reach the browser: the state only says whether a connection works. Login fields are type=password where
  // secret, autocomplete off, never pre-filled, and cleared right after the request. A locked vault answers 423: the unlock
  // prompt (lib/vault) opens and the request is resent.
  import { S, ent, load, toast, saveDoc, upload, doc } from "#lib/stores/books.svelte.ts";
  import { api } from "#lib/api.ts";
  import { t, locale, bidi } from "#lib/i18n.svelte.ts";
  import { V, ask, refresh } from "#lib/vault/vault.svelte.ts";
  import { Badge, Button, Card, Checkbox, Dialog, EmptyState, Icon, Input, PageHeader, Search, Segmented, Select } from "#lib/ui/index.ts";
  import type { Tone } from "#lib/ui/index.ts";
  import FilePick from "../documents/FilePick.svelte";
  import { PROVIDERS, GROUPS, providerName, readText, guess, toProfile, canSave, type Mapping } from "./providers.ts";
  import { onMount } from "svelte";

  onMount(() => void refresh());

  const WHAT: Record<string, string> = { mercury: "connections.what.mercury", onezero: "connections.what.onezero", "il-bank": "connections.what.ilBank", "il-card": "connections.what.ilCard" };
  const what = (k: string) => {
    const key = WHAT[k] ?? WHAT[PROVIDERS[k]?.group ?? ""];
    return key ? t(key) : "";
  };
  const conns = $derived(S.data?.connections ?? []);
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" }) : t("common.never"));
  const pill = (c: (typeof conns)[number]): [string, Tone] =>
    c.connected
      ? c.lastError
        ? [t("connections.pill.failed"), "bad"]
        : [t("connections.pill.connected"), "good"]
      : c.pending
        ? [t("connections.pill.waiting"), "warn"]
        : [t("connections.pill.notConnected"), "neutral"];
  const iconOf = (type: string) => (PROVIDERS[type]?.group === "il-card" ? "wallet" : "bank");

  // ---------- requests: each answers with the new state ----------
  async function post(path: "/api/connect" | "/api/sync" | "/api/disconnect", body: unknown) {
    const e = S.e;
    S.busy = true;
    try {
      const d = await api.post(path, body, e);
      if (e === S.e) S.data = d;
      return true;
    } catch (x) {
      toast(String((x as Error).message || x));
      await load(); // a failed sync still records lastError server-side
      return false;
    } finally {
      S.busy = false;
    }
  }
  const sync = (provider?: string) => post("/api/sync", provider ? { provider } : {});

  // ---------- picker + login form ----------
  let q = $state(""),
    pick = $state<string | null>(null),
    f = $state<Record<string, string>>({}),
    otp = $state<Record<string, string>>({});
  const match = (k: string, name: string) => !q.trim() || `${name} ${k}`.toLowerCase().includes(q.trim().toLowerCase());
  const groups = $derived(
    GROUPS.map(([g, label]) => ({ g, label: t(label), items: Object.entries(PROVIDERS).filter(([k, P]) => P.group === g && match(k, P.name)) })).filter((g) => g.items.length),
  );
  const csvMatch = $derived(!q.trim() || `csv import any bank other file ${t("connections.csvSearch")} ${t("connections.csvTitle")}`.toLowerCase().includes(q.trim().toLowerCase()));
  const P = $derived(pick && pick !== "csv" ? PROVIDERS[pick] : null);
  const ready = $derived(!!P && P.fields.every((x) => String(f[x.key] ?? "").trim()));
  let pane = $state<HTMLElement>();
  function choose(k: string | null) {
    pick = k;
    f = {};
    if (k === "csv") resetCsv();
    // phones: the form opens under the bank list, out of view
    if (k && matchMedia("(max-width: 767px)").matches) requestAnimationFrame(() => pane?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }
  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!pick || !ready || S.busy) return;
    const credentials = { ...f };
    f = {}; // secrets don't linger in memory or on screen
    if (await post("/api/connect", { provider: pick, credentials })) pick = null;
  }
  async function submitOtp(e: SubmitEvent, key: string) {
    e.preventDefault();
    const otpCode = (otp[key] ?? "").trim();
    otp[key] = "";
    if (otpCode) await post("/api/connect", { provider: key, otpCode });
  }

  // ---------- confirm dialogs (disconnect, replace or delete a mapping) ----------
  let ask_ = $state<{ title: string; text?: string; ok: string; danger?: boolean; run: () => unknown } | null>(null);
  let confirmOpen = $state(false);
  const confirm = (a: NonNullable<typeof ask_>) => ((ask_ = a), (confirmOpen = true));
  const disconnect = (key: string, connected: boolean) =>
    confirm({ title: t("connections.confirmDisconnect", { name: bidi(providerName(key)) }), ok: connected ? t("connections.disconnect") : t("connections.cancelPending"), danger: true, run: () => post("/api/disconnect", { provider: key }) });

  // ---------- CSV from any bank ----------
  type Csv = { file: File; text: string; rows: string[][]; lines: number; delimiter: string };
  let csv = $state<Csv | null>(null),
    parsed = $state<{ date: string; desc: string; memo?: string; amount: number }[]>([]),
    csvErr = $state(""),
    m = $state<Mapping>(guess([], 0)),
    account = $state(""),
    saveAs = $state(""),
    timer: ReturnType<typeof setTimeout> | undefined;
  const FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((v) => ({ value: v, label: v }));
  function resetCsv() {
    csv = null;
    parsed = [];
    csvErr = "";
    account = saveAs = "";
  }
  async function pickFile(files: File[]) {
    const file = files[0];
    if (!file) return;
    csvErr = "";
    try {
      const text = await readText(file),
        pv = (await api.csvPreview(S.e, text)) as { rows: string[][]; header: number; lines: number; delimiter: string };
      csv = { file, text, rows: pv.rows, lines: pv.lines, delimiter: pv.delimiter };
      m = guess(pv.rows, pv.header);
      account = saveAs = "";
    } catch (x) {
      csvErr = String((x as Error).message || x);
      csv = null;
    }
  }
  const header = $derived(csv ? (csv.rows[m.headerRow] ?? []) : []);
  const colOpts = $derived(header.map((c, i) => ({ value: String(i), label: c || t("connections.column", { n: i + 1 }) })));
  const optCols = $derived([{ value: "", label: t("common.none") }, ...colOpts]);
  const profile = $derived(csv ? toProfile(m, header, account, saveAs) : null);
  const savable = $derived(!!profile && canSave(m, profile));
  $effect(() => {
    // live "this is how it will read"
    if (!profile || !csv) return;
    const body = $state.snapshot(profile),
      text = csv.text,
      e = S.e;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        parsed = ((await api.csvPreview(e, text, body)) as { parsed?: typeof parsed }).parsed ?? [];
      } catch {
        parsed = [];
      }
    }, 150);
    return () => clearTimeout(timer);
  });
  type CsvProfileDoc = { name: string; account: string; dateFormat?: string; headerSignature: string };
  const profiles = $derived(doc<CsvProfileDoc[]>("csv-profiles"));
  async function store() {
    if (!profile || !csv) return;
    const p = $state.snapshot(profile),
      file = csv.file;
    await saveDoc("csv-profiles", [...profiles.filter((x) => x.name !== p.name), p]);
    await upload([file], "inbox");
    resetCsv();
    pick = null;
  }
  const saveCsv = () =>
    profiles.some((x) => x.name === profile?.name) ? confirm({ title: t("connections.replaceMapping", { name: bidi(profile!.name) }), ok: t("connections.replace"), run: store }) : store();
  const deleteMapping = (name: string) =>
    confirm({ title: t("connections.confirmDeleteMapping", { name: bidi(name) }), ok: t("common.delete"), danger: true, run: () => saveDoc("csv-profiles", profiles.filter((x) => x.name !== name)) });
  const amt = (n: number) => (n < 0 ? "−" : "") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const col = (v: string) => (v === "" ? null : +v);
  const s = (v: number | null) => (v == null ? "" : String(v));
  const listBtn = "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[14px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50";
</script>

<svelte:head><title>{t("connections.title")} · OpenBooks</title></svelte:head>

<PageHeader title={t("connections.title")} sub={t("connections.sub", { flag: ent().flag ?? "", name: bidi(ent().name ?? "") })}>
  {#snippet actions()}
    {#if conns.some((c) => c.connected)}<Button variant="primary" icon="download" onclick={() => sync()} disabled={S.busy}>{S.busy ? t("connections.syncing") : t("connections.syncAll")}</Button>{/if}
  {/snippet}
</PageHeader>

<div class="max-w-4xl space-y-6 px-4 pt-5 pb-16 sm:px-8">
  {#if V.status === "plaintext" || V.status === "locked"}
    <div class={["flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3 text-[13px]", V.status === "plaintext" ? "border-warn/30 bg-warn/8" : "border-line bg-fill"]}>
      <Icon name={V.status === "plaintext" ? "alert" : "lock"} size={16} class={V.status === "plaintext" ? "shrink-0 text-warn" : "shrink-0 text-sub"} />
      <p class="min-w-0 flex-1 basis-56 text-ink-2">{t(V.status === "plaintext" ? "vault.nag" : "vault.lockedNote")}</p>
      {#if V.status === "plaintext"}<Button size="sm" href="/settings#security">{t("vault.setup")}</Button>
      {:else}<Button size="sm" variant="primary" icon="lock" onclick={() => void ask()}>{t("vault.unlock")}</Button>{/if}
    </div>
  {/if}

  {#each conns as c (c.provider)}
    {@const [label, tone] = pill(c)}
    <Card flush>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-4 sm:px-5">
        <span class="grid size-9 shrink-0 place-items-center rounded-full bg-fill text-sub"><Icon name={iconOf(c.type)} size={17} /></span>
        <div class="min-w-0 flex-1 basis-48">
          <div class="flex flex-wrap items-center gap-2"><span class="text-[15px] text-ink" dir="auto">{providerName(c.provider)}</span><Badge size="sm" {tone}>{label}</Badge></div>
          <div class="text-[13px] text-sub">{what(c.type)}</div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          {#if c.connected}<Button icon="download" onclick={() => sync(c.provider)} disabled={S.busy}>{S.busy ? t("connections.syncing") : t("connections.syncNow")}</Button>{/if}
          <Button variant="ghost" onclick={() => disconnect(c.provider, c.connected)}>{c.connected ? t("connections.disconnect") : t("common.cancel")}</Button>
        </div>
      </div>

      {#if c.lastError}
        <div class="flex items-start gap-2 border-t border-bad/20 bg-bad/6 px-4 py-2.5 text-[13px] text-bad sm:px-5"><Icon name="alert" size={15} class="mt-0.5 shrink-0" /><span class="min-w-0 [overflow-wrap:anywhere]" dir="auto">{c.lastError}</span></div>
      {/if}

      {#if c.pending}
        <form class="space-y-3 border-t border-line px-4 py-4 sm:px-5" onsubmit={(e) => submitOtp(e, c.provider)}>
          <p class="text-[13px] text-sub">{t("connections.otpHint")}</p>
          <div class="flex flex-wrap items-end gap-3">
            <Input label={t("connections.smsCode")} numeric inputmode="numeric" autocomplete="one-time-code" class="w-40" bind:value={otp[c.provider]} />
            <Button type="submit" variant="primary" loading={S.busy} disabled={S.busy || !otp[c.provider]?.trim()}>{S.busy ? t("connections.verifying") : t("connections.verify")}</Button>
          </div>
        </form>
      {:else if c.connected}
        <dl class="divide-y divide-line border-t border-line text-[14px]">
          <div class="flex flex-wrap gap-x-4 px-4 py-3 sm:px-5"><dt class="w-40 shrink-0 text-sub">{t("connections.lastSync")}</dt><dd class="min-w-0 text-ink-2 num">{when(c.lastSync)}</dd></div>
          <div class="flex flex-wrap gap-x-4 px-4 py-3 sm:px-5"><dt class="w-40 shrink-0 text-sub">{t("connections.accounts")}</dt><dd class="min-w-0 text-ink-2 [overflow-wrap:anywhere]" dir="auto">{c.accounts.length ? c.accounts.join(" · ") : "—"}</dd></div>
          <div class="flex flex-wrap gap-x-4 px-4 py-3 sm:px-5"><dt class="w-40 shrink-0 text-sub">{t("connections.writes")}</dt><dd class="min-w-0 font-mono text-[13px] text-ink-2 [overflow-wrap:anywhere]" dir="ltr">inbox/{c.file}</dd></div>
        </dl>
      {/if}
    </Card>
  {/each}

  <section>
    <h2 class="mb-3 text-[15px] text-ink">{conns.length ? t("connections.connectAnother") : t("connections.connect")}</h2>
    <div class="panel grid overflow-hidden md:grid-cols-[260px_minmax(0,1fr)]">
      <div class="border-b border-line p-3 md:border-e md:border-b-0">
        <Search bind:value={q} label={t("connections.searchPh")} />
        <div class="mt-2 max-h-[300px] overflow-y-auto md:max-h-[440px]">
          {#each groups as g (g.g)}
            <div class="px-2 pt-3 pb-1 text-[12px] text-sub">{g.label}</div>
            {#each g.items as [k, Pv] (k)}
              <button type="button" aria-pressed={pick === k} onclick={() => choose(k)} class="{listBtn} {pick === k ? 'bg-accent/10 text-ink' : 'text-ink-2 hover:bg-hover'}">
                <Icon name={Pv.group === "il-card" ? "wallet" : "bank"} size={15} class="shrink-0 text-sub" /><span class="min-w-0">{Pv.name}</span>
              </button>
            {/each}
          {/each}
          {#if csvMatch}
            <div class="px-2 pt-3 pb-1 text-[12px] text-sub">{t("connections.other")}</div>
            <button type="button" aria-pressed={pick === "csv"} onclick={() => choose("csv")} class="{listBtn} {pick === 'csv' ? 'bg-accent/10 text-ink' : 'text-ink-2 hover:bg-hover'}">
              <Icon name="file" size={15} class="shrink-0 text-sub" /><span class="min-w-0">{t("connections.csvTitle")}</span>
            </button>
          {/if}
          {#if !groups.length && !csvMatch}<p class="px-2 py-6 text-center text-[13px] text-sub">{t("connections.noMatch")}</p>{/if}
        </div>
      </div>

      <div class="min-w-0 scroll-mt-4 p-4 sm:p-5" bind:this={pane}>
        {#if !pick}
          <EmptyState icon="bank" title={t("connections.pickTitle")} text={t("connections.pickHint")} />
        {:else if P}
          <form class="space-y-3" onsubmit={submit} autocomplete="off">
            <div class="text-[15px] text-ink">{P.name}</div>
            {#if pick === "mercury"}
              <ol class="list-decimal space-y-1 ps-5 text-[13px] text-sub">
                <li>{t("connections.mercury1")}</li>
                <li>{t("connections.mercury2")}</li>
                <li>{t("connections.mercury3")}</li>
              </ol>
            {:else if pick === "onezero"}
              <p class="text-[13px] text-sub">{t("connections.onezeroHint")}</p>
            {:else}
              <p class="text-[13px] text-sub">{t("connections.scraperHint", { name: P.name })}</p>
            {/if}
            <p class="text-[13px] text-sub">{what(pick)}</p>
            <div class="grid gap-3 sm:grid-cols-2">
              {#each P.fields as x (x.key)}
                <Input
                  label={x.label}
                  type={x.type}
                  inputmode={x.inputmode}
                  placeholder={x.placeholder ?? ""}
                  autocomplete="off"
                  spellcheck="false"
                  dir={x.key === "username" || x.key === "userCode" ? "auto" : "ltr"}
                  class={x.mono ? "sm:col-span-2" : ""}
                  bind:value={f[x.key]} />
              {/each}
            </div>
            <div class="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onclick={() => choose(null)}>{t("common.cancel")}</Button>
              <Button type="submit" variant="primary" loading={S.busy} disabled={S.busy || !ready}>
                {S.busy ? (P.otp ? t("connections.sending") : t("connections.loggingIn")) : P.otp ? t("connections.sendSms") : t("connections.connectSync")}
              </Button>
            </div>
          </form>
        {:else}
          <div class="space-y-4">
            <div>
              <div class="text-[15px] text-ink">{t("connections.csvTitle")}</div>
              <p class="mt-1 text-[13px] text-sub">{t("connections.csvIntro")}</p>
            </div>
            <FilePick label={csv ? csv.file.name : t("connections.chooseCsv")} accept=".csv,.txt,text/csv" onpick={pickFile} />
            {#if csvErr}<p class="text-[13px] text-bad" dir="auto" role="alert">{csvErr}</p>{/if}

            {#if csv}
              <div class="overflow-x-auto rounded-lg border border-line">
                <table class="w-full text-[13px]">
                  <tbody>
                    {#each csv.rows.slice(Math.max(0, m.headerRow - 1), m.headerRow + 6) as r, i}
                      {@const n = Math.max(0, m.headerRow - 1) + i}
                      <tr class="border-b border-line last:border-0 {n === m.headerRow ? 'bg-accent/8 text-ink' : n < m.headerRow ? 'text-faint' : 'text-ink-2'}">
                        <td class="px-2 py-1.5 text-faint num">{n + 1}</td>
                        {#each r as cell}<td class="max-w-[180px] truncate px-2 py-1.5 whitespace-nowrap" dir="auto">{cell}</td>{/each}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              <p class="text-[12px] text-sub">{t("connections.csvInfo", { n: csv.lines, sep: csv.delimiter === "\t" ? t("connections.tabs") : `“${csv.delimiter}”` })}</p>

              <div class="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                <Select
                  label={t("connections.headerRow")}
                  value={String(m.headerRow)}
                  onchange={(v) => (m = { ...guess(csv!.rows, +v), invert: m.invert })}
                  options={csv.rows.slice(0, 30).map((r, i) => ({ value: String(i), label: t("connections.rowN", { n: i + 1, cells: bidi(r.filter(Boolean).slice(0, 3).join(", ") || t("connections.emptyRow")) }) }))} />
                <div class="grid grid-cols-2 gap-2">
                  <Select label={t("common.date")} value={String(m.dateCol)} onchange={(v) => (m.dateCol = +v)} options={colOpts} />
                  <Select label={t("connections.dateFormat")} bind:value={m.dateFormat} options={FORMATS} />
                </div>
                <Select label={t("common.description")} value={s(m.descCol)} onchange={(v) => (m.descCol = col(v))} options={optCols} />
                <div class="space-y-2">
                  <Segmented
                    label={t("common.amount")}
                    size="sm"
                    value={m.split ? "split" : "one"}
                    onchange={(k) => (m.split = k === "split")}
                    items={[{ key: "one", label: t("connections.oneColumn") }, { key: "split", label: t("connections.debitCredit") }]} />
                  {#if m.split}
                    <div class="grid grid-cols-2 gap-2">
                      <Select label={t("connections.debit")} value={s(m.debitCol)} onchange={(v) => (m.debitCol = col(v))} options={optCols} />
                      <Select label={t("connections.credit")} value={s(m.creditCol)} onchange={(v) => (m.creditCol = col(v))} options={optCols} />
                    </div>
                  {:else}
                    <Select label={t("common.amount")} value={s(m.amountCol)} onchange={(v) => (m.amountCol = col(v))} options={optCols} />
                  {/if}
                </div>
                <Select label={t("connections.memo")} value={s(m.memoCol)} onchange={(v) => (m.memoCol = col(v))} options={optCols} />
                <Select label={t("connections.ref")} value={s(m.refCol)} onchange={(v) => (m.refCol = col(v))} options={optCols} />
                <Input label={t("connections.accountName")} bind:value={account} placeholder={t("connections.accountPh")} />
                <Input label={t("connections.saveAs")} bind:value={saveAs} placeholder={account || t("connections.saveAsPh")} />
              </div>
              <Checkbox label={t("connections.flip")} bind:checked={m.invert} />

              <div>
                <div class="mb-1 text-[12px] text-sub">{parsed.length ? t("connections.howReads") : t("connections.howReadsNone")}</div>
                {#if parsed.length}
                  <div class="overflow-x-auto rounded-lg border border-line">
                    <table class="w-full table-fixed text-[13px]">
                      <tbody>
                        {#each parsed.slice(0, 6) as tx}
                          <tr class="border-b border-line last:border-0">
                            <td class="w-24 px-2 py-1.5 whitespace-nowrap text-sub num sm:w-28">{tx.date}</td>
                            <td class="truncate px-2 py-1.5 text-ink-2 ui-align" dir="auto">{tx.desc}{#if tx.memo}<span class="text-sub">{` · ${tx.memo}`}</span>{/if}</td>
                            <td class="w-28 px-2 py-1.5 text-end whitespace-nowrap num pii {tx.amount < 0 ? 'text-ink-2' : 'text-good'}" dir="ltr">{amt(tx.amount)}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                {/if}
              </div>
              <div class="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" onclick={() => ((pick = null), resetCsv())}>{t("common.cancel")}</Button>
                <Button variant="primary" disabled={S.busy || !savable || !parsed.length} onclick={saveCsv}>{t("connections.saveImport")}</Button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </section>

  {#if profiles.length}
    <Card title={t("connections.saved")} flush>
      <ul class="divide-y divide-line border-t border-line">
        {#each profiles as p (p.name)}
          <li class="flex items-center gap-3 px-4 py-3 text-[14px] sm:px-5">
            <Icon name="file" size={15} class="shrink-0 text-sub" />
            <div class="min-w-0 flex-1">
              <div class="text-ink" dir="auto">{p.name}</div>
              <div class="text-[12px] text-sub [overflow-wrap:anywhere]">{t("connections.profileLine", { account: bidi(p.account), format: p.dateFormat ?? "", cols: bidi(p.headerSignature.split("|").join(", ")) })}</div>
            </div>
            <Button variant="ghost" size="sm" onclick={() => deleteMapping(p.name)}>{t("common.delete")}</Button>
          </li>
        {/each}
      </ul>
    </Card>
  {/if}

  <div class="space-y-2 text-[13px] text-sub">
    <p class="flex items-start gap-2"><Icon name="shield" size={15} class="mt-0.5 shrink-0" /><span>{t("connections.privacy")}</span></p>
    <p class="flex items-start gap-2"><Icon name="alert" size={15} class="mt-0.5 shrink-0" /><span>{t("connections.scrapersNote")}</span></p>
  </div>
</div>

<Dialog bind:open={confirmOpen} title={ask_?.title ?? ""} size="sm">
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (confirmOpen = false)}>{t("common.cancel")}</Button>
    <Button
      variant={ask_?.danger ? "danger" : "primary"}
      onclick={() => {
        confirmOpen = false;
        void ask_?.run();
      }}>{ask_?.ok}</Button>
  {/snippet}
</Dialog>

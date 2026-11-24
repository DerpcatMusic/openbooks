<script lang="ts">
  // Assets section on /connections: pensions, Israeli savings wrappers, brokerage accounts, and read-only crypto wallets.
  // Stored in doc("assets") via /api/assets*; included as non-liability series in net worth.
  import { ASSET_KINDS, isValidCryptoAddress, latestValuation, looksLikePrivateKey } from "@openbooks/core";
  import type { AssetAccount, AssetKind, CryptoChain } from "@openbooks/schema";
  import { api, type State } from "#lib/api.ts";
  import { bidi, t } from "#lib/i18n.svelte.ts";
  import { S, doc, ent, mdy, toast } from "#lib/stores/books.svelte.ts";
  import { Badge, Button, Card, Dialog, EmptyState, Icon, Input, Money, Segmented, Select } from "#lib/ui/index.ts";
  import FilePick from "../documents/FilePick.svelte";

  const CURRENCIES = ["ILS", "USD", "EUR", "GBP"].map((c) => ({ value: c, label: c }));
  const todayIso = () => new Date().toLocaleDateString("sv");
  const assets = $derived(doc<AssetAccount[]>("assets", []));
  const cryptoAssets = $derived(assets.filter((a) => a.kind === "crypto" && a.address && a.chain));
  const kindOptions = $derived(ASSET_KINDS.map((k) => ({ value: k, label: t(`assets.kind.${k}`) })));
  const chainItems = $derived([
    { key: "btc", label: t("assets.chain.btc") },
    { key: "eth", label: t("assets.chain.eth") },
  ]);

  let busy = $state(false);
  let refreshingId = $state<string | null>(null);

  // Manual add / edit dialog
  let editOpen = $state(false);
  let editingId = $state<string | null>(null);
  let formKind = $state<AssetKind>("pension");
  let formName = $state("");
  let formProvider = $state("");
  let formCurrency = $state("ILS");
  let formValue = $state("");
  let formDate = $state(todayIso());
  let formAddress = $state("");
  let formChain = $state<CryptoChain>("btc");

  // Crypto connect dialog
  let cryptoOpen = $state(false);
  let cryptoChain = $state<CryptoChain>("btc");
  let cryptoAddress = $state("");
  let cryptoName = $state("");
  let cryptoCurrency = $state("USD");

  // Delete confirmation dialog
  let deleteTarget = $state<AssetAccount | null>(null);
  let deleteOpen = $state(false);

  const acceptState = (e: string, d: State) => {
    if (e === S.e) {
      S.data = d;
      S.rev++;
    }
  };

  const shortAddress = (addr: string) => (addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr);
  const formatQty = (qty: number, chain?: CryptoChain) =>
    `${qty.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${(chain ?? "").toUpperCase()}`.trim();

  function openAddManual() {
    editingId = null;
    formKind = "pension";
    formName = "";
    formProvider = "";
    formCurrency = ent().currency || "ILS";
    formValue = "";
    formDate = todayIso();
    formAddress = "";
    formChain = "btc";
    editOpen = true;
  }

  function openEdit(a: AssetAccount) {
    const latest = latestValuation(a.valuations);
    editingId = a.id;
    formKind = a.kind;
    formName = a.name;
    formProvider = a.provider ?? "";
    formCurrency = a.currency || "ILS";
    formValue = latest ? String(latest.value) : "";
    formDate = latest?.date ?? todayIso();
    formAddress = a.address ?? "";
    formChain = a.chain ?? "btc";
    editOpen = true;
  }

  function openAddCrypto() {
    cryptoChain = "btc";
    cryptoAddress = "";
    cryptoName = "";
    cryptoCurrency = "USD";
    cryptoOpen = true;
  }

  const parsedValue = $derived(formValue.trim() === "" ? null : Number(formValue.replaceAll(",", "")));
  const manualAddressErr = $derived.by(() => {
    if (formKind !== "crypto" || !formAddress.trim()) return null;
    if (looksLikePrivateKey(formAddress)) return t("assets.err.privateKey");
    if (!isValidCryptoAddress(formChain, formAddress)) return t("assets.err.address", { chain: formChain.toUpperCase() });
    return null;
  });
  const canSaveManual = $derived(
    !busy &&
      formName.trim().length > 0 &&
      !manualAddressErr &&
      (formValue.trim() === "" || (parsedValue !== null && Number.isFinite(parsedValue) && parsedValue >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(formDate))),
  );

  const cryptoAddressErr = $derived.by(() => {
    if (!cryptoAddress.trim()) return null;
    if (looksLikePrivateKey(cryptoAddress)) return t("assets.err.privateKey");
    if (!isValidCryptoAddress(cryptoChain, cryptoAddress)) return t("assets.err.address", { chain: cryptoChain.toUpperCase() });
    return null;
  });
  const canSaveCrypto = $derived(!busy && cryptoAddress.trim().length > 0 && !cryptoAddressErr);

  async function saveManual(ev: SubmitEvent) {
    ev.preventDefault();
    if (!canSaveManual) return;
    const e = S.e;
    busy = true;
    try {
      const payload: Parameters<typeof api.saveAsset>[1] = {
        ...(editingId ? { id: editingId } : {}),
        kind: formKind,
        name: formName.trim(),
        ...(formProvider.trim() ? { provider: formProvider.trim() } : {}),
        currency: formCurrency,
        ...(parsedValue !== null ? { value: parsedValue, date: formDate } : {}),
        ...(formKind === "crypto" && formAddress.trim() ? { address: formAddress.trim(), chain: formChain } : {}),
      };
      const d = await api.saveAsset(e, payload);
      acceptState(e, d);
      editOpen = false;
      toast(t("assets.toast.saved"));
    } catch (x) {
      toast(String((x as Error).message || x));
    } finally {
      busy = false;
    }
  }

  async function saveCrypto(ev: SubmitEvent) {
    ev.preventDefault();
    if (!canSaveCrypto) return;
    const e = S.e;
    const addr = cryptoAddress.trim();
    const label = cryptoName.trim() || (cryptoChain === "btc" ? "Bitcoin" : "Ethereum");
    busy = true;
    try {
      const prevIds = new Set(assets.map((a) => a.id));
      const d = await api.saveAsset(e, {
        kind: "crypto",
        name: label,
        currency: cryptoCurrency,
        address: addr,
        chain: cryptoChain,
        valuations: [],
      });
      acceptState(e, d);
      cryptoOpen = false;
      const savedList = (d.docs?.assets as AssetAccount[] | undefined) ?? [];
      const created = savedList.find((a) => !prevIds.has(a.id) && a.address === addr);
      if (created) {
        let counts = { refreshed: 0, failed: 0 };
        const d2 = await api.refreshAssets(e, { id: created.id, force: true }, (c) => (counts = c));
        acceptState(e, d2);
        toast(counts.failed ? t("assets.toast.refreshFailed") : t("assets.toast.refreshed", { n: Math.max(1, counts.refreshed) }));
      } else {
        toast(t("assets.toast.saved"));
      }
    } catch (x) {
      toast(String((x as Error).message || x));
    } finally {
      busy = false;
    }
  }

  async function refreshCrypto(id?: string) {
    const e = S.e;
    busy = true;
    refreshingId = id ?? "*";
    try {
      let counts = { refreshed: 0, failed: 0 };
      const d = await api.refreshAssets(e, { ...(id ? { id } : {}), force: true }, (c) => (counts = c));
      acceptState(e, d);
      if (counts.failed > 0) toast(t("assets.toast.refreshFailed"));
      else if (counts.refreshed > 0) toast(t("assets.toast.refreshed", { n: counts.refreshed }));
    } catch (x) {
      toast(String((x as Error).message || x));
    } finally {
      busy = false;
      refreshingId = null;
    }
  }

  async function importFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    const e = S.e;
    busy = true;
    try {
      let counts = { added: 0, updated: 0, skipped: 0 };
      const d = await api.importAssets(e, file, (c) => (counts = c));
      acceptState(e, d);
      toast(t("assets.toast.imported", { n: counts.added + counts.updated }));
    } catch (x) {
      toast(String((x as Error).message || x));
    } finally {
      busy = false;
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const e = S.e;
    const id = deleteTarget.id;
    deleteOpen = false;
    deleteTarget = null;
    busy = true;
    try {
      const d = await api.deleteAsset(e, id);
      acceptState(e, d);
      toast(t("assets.toast.deleted"));
    } catch (x) {
      toast(String((x as Error).message || x));
    } finally {
      busy = false;
    }
  }
</script>

<section class="space-y-3" aria-labelledby="assets-heading">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div class="min-w-0 flex-1 basis-56">
      <h2 id="assets-heading" class="text-[15px] text-ink">{t("assets.title")}</h2>
      <p class="mt-0.5 text-[13px] text-sub">{t("assets.sub")}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Button size="sm" icon="plus" onclick={openAddManual} disabled={busy}>{t("assets.addManual")}</Button>
      <Button size="sm" icon="wallet" onclick={openAddCrypto} disabled={busy}>{t("assets.addCrypto")}</Button>
      <FilePick
        label={t("assets.importFile")}
        accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onpick={importFiles} />
      {#if cryptoAssets.length}
        <Button size="sm" icon="refresh" onclick={() => refreshCrypto()} disabled={busy} loading={refreshingId === "*"}>
          {refreshingId === "*" ? t("assets.refreshing") : t("assets.refreshAll")}
        </Button>
      {/if}
    </div>
  </div>

  {#if assets.length}
    <Card flush>
      <ul class="divide-y divide-line">
        {#each assets as a (a.id)}
          {@const latest = latestValuation(a.valuations)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 sm:px-5">
            <span class="grid size-9 shrink-0 place-items-center rounded-full bg-fill text-sub">
              <Icon name={a.kind === "crypto" ? "wallet" : a.kind === "brokerage" ? "report" : "shield"} size={16} />
            </span>
            <div class="min-w-0 flex-1 basis-52">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-[14px] text-ink" dir="auto">{a.name}</span>
                <Badge size="sm" tone="neutral">{t(`assets.kind.${a.kind}`)}</Badge>
                {#if a.chain}
                  <Badge size="sm" tone="neutral">{a.chain.toUpperCase()}</Badge>
                {/if}
                {#if a.stale}
                  <Badge size="sm" tone="warn" icon="alert">{t("assets.stale")}</Badge>
                {/if}
              </div>
              <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-sub">
                {#if a.provider}<span dir="auto">{a.provider}</span>{/if}
                {#if a.address}
                  <span class="font-mono" dir="ltr" title={a.address}>{shortAddress(a.address)}</span>
                {/if}
                {#if latest?.quantity !== undefined && a.chain}
                  <span class="num" dir="ltr">{formatQty(latest.quantity, a.chain)}</span>
                {/if}
                {#if latest}
                  <span>{t("assets.asOf", { date: mdy(latest.date) })}</span>
                {:else}
                  <span>{t("assets.noValuation")}</span>
                {/if}
                {#if a.valuations.length > 1}
                  <span class="text-faint">· {t("assets.valuationsCount", { n: a.valuations.length })}</span>
                {/if}
              </div>
              {#if a.stale && a.lastError}
                <div class="mt-1 text-[12px] text-warn" dir="auto">{a.lastError}</div>
              {/if}
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <div class="me-1 text-end text-[15px] text-ink">
                {#if latest}
                  <Money value={latest.value} currency={a.currency} cents={false} />
                {:else}
                  <span class="text-sub">—</span>
                {/if}
              </div>
              {#if a.kind === "crypto" && a.address && a.chain}
                <Button
                  size="sm"
                  variant="ghost"
                  icon="refresh"
                  loading={refreshingId === a.id}
                  disabled={busy}
                  onclick={() => refreshCrypto(a.id)}>{t("assets.refreshOne")}</Button>
              {/if}
              <Button size="sm" variant="ghost" icon="edit" disabled={busy} onclick={() => openEdit(a)}>{t("common.edit")}</Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onclick={() => {
                  deleteTarget = a;
                  deleteOpen = true;
                }}>{t("common.delete")}</Button>
            </div>
          </li>
        {/each}
      </ul>
    </Card>
  {:else}
    <Card>
      <EmptyState icon="wallet" title={t("assets.emptyTitle")} text={t("assets.emptyText")} compact />
    </Card>
  {/if}

  <p class="flex items-start gap-2 text-[12px] text-sub">
    <Icon name="info" size={14} class="mt-0.5 shrink-0 text-faint" />
    <span>{t("assets.importHint")}</span>
  </p>
</section>

<Dialog bind:open={editOpen} title={editingId ? t("assets.dialog.editTitle") : t("assets.dialog.addTitle")}>
  <form id="asset-manual-form" class="space-y-3" onsubmit={saveManual}>
    <div class="grid gap-3 sm:grid-cols-2">
      <Select label={t("assets.field.kind")} bind:value={formKind} options={kindOptions} />
      <Select label={t("assets.field.currency")} bind:value={formCurrency} options={CURRENCIES} />
    </div>
    <Input label={t("assets.field.name")} bind:value={formName} placeholder={t("assets.field.namePh")} required />
    <Input label={t("assets.field.provider")} bind:value={formProvider} placeholder={t("assets.field.providerPh")} />
    <div class="grid gap-3 sm:grid-cols-2">
      <Input label={t("assets.field.value")} bind:value={formValue} numeric placeholder="0.00" />
      <Input label={t("assets.field.date")} type="date" bind:value={formDate} />
    </div>
    {#if editingId}
      <p class="text-[12px] text-sub">{t("assets.editValuationHint")}</p>
    {/if}
    {#if formKind === "crypto"}
      <div class="space-y-2 border-t border-line pt-3">
        <Segmented
          label={t("assets.field.chain")}
          size="sm"
          value={formChain}
          onchange={(k) => (formChain = k as CryptoChain)}
          items={chainItems} />
        <Input
          label={t("assets.field.address")}
          bind:value={formAddress}
          dir="ltr"
          autocomplete="off"
          spellcheck="false"
          error={manualAddressErr}
          placeholder={formChain === "btc" ? t("assets.field.addressPhBtc") : t("assets.field.addressPhEth")} />
      </div>
    {/if}
  </form>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (editOpen = false)}>{t("common.cancel")}</Button>
    <Button type="submit" form="asset-manual-form" variant="primary" loading={busy} disabled={!canSaveManual}>{t("common.save")}</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={cryptoOpen} title={t("assets.dialog.cryptoTitle")}>
  <form id="asset-crypto-form" class="space-y-3" onsubmit={saveCrypto}>
    <p class="flex items-start gap-2 rounded-lg border border-line bg-fill px-3 py-2 text-[12px] text-sub">
      <Icon name="shield" size={14} class="mt-0.5 shrink-0" />
      <span>{t("assets.cryptoNote")}</span>
    </p>
    <Segmented
      label={t("assets.field.chain")}
      size="sm"
      value={cryptoChain}
      onchange={(k) => (cryptoChain = k as CryptoChain)}
      items={chainItems} />
    <Input
      label={t("assets.field.address")}
      bind:value={cryptoAddress}
      dir="ltr"
      autocomplete="off"
      spellcheck="false"
      required
      error={cryptoAddressErr}
      placeholder={cryptoChain === "btc" ? t("assets.field.addressPhBtc") : t("assets.field.addressPhEth")} />
    <div class="grid gap-3 sm:grid-cols-2">
      <Input label={t("assets.field.name")} bind:value={cryptoName} placeholder={t("assets.field.cryptoNamePh")} />
      <Select label={t("assets.field.currency")} bind:value={cryptoCurrency} options={CURRENCIES} />
    </div>
  </form>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (cryptoOpen = false)}>{t("common.cancel")}</Button>
    <Button type="submit" form="asset-crypto-form" variant="primary" loading={busy} disabled={!canSaveCrypto}>{t("common.add")}</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={deleteOpen} title={deleteTarget ? t("assets.confirmDelete", { name: bidi(deleteTarget.name) }) : ""} size="sm">
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (deleteOpen = false)}>{t("common.cancel")}</Button>
    <Button variant="danger" onclick={confirmDelete}>{t("common.delete")}</Button>
  {/snippet}
</Dialog>

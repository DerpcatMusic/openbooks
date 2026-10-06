<script lang="ts">
  // Settings → Security: set up a passphrase, lock, change it, or reset (forgot it). Status comes from GET /api/vault.
  // Every passphrase field is type=password, autocomplete off, and cleared after each attempt; nothing is pre-filled.
  import { onMount } from "svelte";
  import { Badge, Button, Dialog, Input } from "../ui/index.ts";
  import { t } from "../i18n.svelte.ts";
  import { load, toast } from "../stores/books.svelte.ts";
  import { V, ask, change, lock, refresh, reset, setup } from "./vault.svelte.ts";

  onMount(() => void refresh());

  const MIN = 8;
  let form = $state<"" | "setup" | "change">(""),
    cur = $state(""),
    next = $state(""),
    again = $state(""),
    err = $state(""),
    busy = $state(false),
    resetOpen = $state(false),
    sure = $state("");
  const word = $derived(t("vault.resetWord"));
  const clear = () => {
    cur = next = again = err = "";
  };
  const open = (f: typeof form) => {
    clear();
    form = f;
  };
  const shortErr = $derived(next && next.length < MIN ? t("vault.tooShort", { n: MIN }) : null);
  const mismatch = $derived(again && again !== next ? t("vault.mismatch") : null);
  const ready = $derived(next.length >= MIN && again === next && (form !== "change" || !!cur));

  async function act(f: () => Promise<void>, done?: string) {
    busy = true;
    err = "";
    try {
      await f();
      form = "";
      if (done) toast(done);
      void load(); // connection status may change (sealed / reset)
    } catch (x) {
      err = (x as { status?: number }).status === 401 ? t("vault.wrong") : String((x as Error).message);
    } finally {
      cur = next = again = "";
      busy = false;
    }
  }
  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    const [a, b] = [cur, next];
    void act(form === "setup" ? () => setup(b) : () => change(a, b), t(form === "setup" ? "vault.setupDone" : "vault.changeDone"));
  };
  const doReset = () => {
    resetOpen = false;
    sure = "";
    void act(reset, t("vault.resetDone"));
  };
  const TONE = { plaintext: "warn", locked: "neutral", unlocked: "good", none: "neutral" } as const;
  const pw = { type: "password", autocomplete: "off", spellcheck: false, dir: "ltr" } as const;
</script>

{#if V.status && V.status !== "none"}
  <div class="flex flex-wrap items-start gap-x-4 gap-y-3">
    <div class="min-w-0 flex-1 basis-64">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[14px] text-ink">{t("vault.title")}</span>
        <Badge tone={TONE[V.status]} icon={V.status === "plaintext" ? "alert" : "lock"} size="sm">{t(`vault.status.${V.status}`)}</Badge>
      </div>
      <p class="mt-1 text-[13px] text-sub">{t(`vault.about.${V.status}`)}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      {#if V.status === "plaintext"}
        {#if form !== "setup"}<Button variant="primary" icon="lock" onclick={() => open("setup")}>{t("vault.setup")}</Button>{/if}
      {:else if V.status === "locked"}
        <Button variant="primary" icon="lock" onclick={() => void ask()}>{t("vault.unlock")}</Button>
      {:else}
        <Button icon="lock" onclick={() => act(lock, t("vault.lockedToast"))} disabled={busy}>{t("vault.lock")}</Button>
        {#if form !== "change"}<Button onclick={() => open("change")}>{t("vault.change")}</Button>{/if}
      {/if}
    </div>
  </div>

  {#if form}
    <form class="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2" onsubmit={submit}>
      {#if form === "setup"}<p class="text-[13px] text-sub sm:col-span-2">{t("vault.setupWarn")}</p>{/if}
      {#if form === "change"}<Input label={t("vault.current")} {...pw} bind:value={cur} class="sm:col-span-2" />{/if}
      <Input label={t(form === "change" ? "vault.new" : "vault.passphrase")} {...pw} bind:value={next} hint={t("vault.minHint", { n: MIN })} error={shortErr} />
      <Input label={t("vault.confirm")} {...pw} bind:value={again} error={mismatch} />
      {#if err}<p class="text-[13px] text-bad sm:col-span-2" role="alert">{err}</p>{/if}
      <div class="flex flex-wrap justify-end gap-2 sm:col-span-2">
        <Button variant="ghost" onclick={() => ((form = ""), clear())}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!ready || busy}>{t(form === "setup" ? "vault.setup" : "vault.change")}</Button>
      </div>
    </form>
  {:else if err}
    <p class="mt-3 text-[13px] text-bad" role="alert">{err}</p>
  {/if}

  {#if V.status !== "plaintext"}
    <div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-4">
      <p class="min-w-0 flex-1 basis-64 text-[13px] text-sub">{t("vault.resetHint")}</p>
      <Button variant="danger" onclick={() => ((sure = ""), (resetOpen = true))}>{t("vault.reset")}</Button>
    </div>
  {/if}

  <Dialog bind:open={resetOpen} title={t("vault.resetTitle")} size="sm">
    <ul class="list-disc space-y-1 ps-5 text-[14px]">
      <li>{t("vault.resetLoses")}</li>
      <li>{t("vault.resetKeeps")}</li>
    </ul>
    <div class="mt-4">
      <Input label={t("vault.resetType", { word })} bind:value={sure} autocomplete="off" spellcheck="false" />
    </div>
    {#snippet actions()}
      <Button variant="ghost" onclick={() => (resetOpen = false)}>{t("common.cancel")}</Button>
      <Button variant="danger" icon="trash" disabled={sure.trim().toLowerCase() !== word.toLowerCase()} onclick={doReset}>{t("vault.resetConfirm")}</Button>
    {/snippet}
  </Dialog>
{/if}

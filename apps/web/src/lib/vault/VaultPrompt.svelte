<script lang="ts">
  // The unlock prompt. Mount once in the root layout: <VaultPrompt />. It installs the fetch guard (vault.svelte.ts), so any
  // API call answering 423 opens this dialog and is resent after unlocking. Other screens can open it with ask().
  import { onMount } from "svelte";
  import { goto } from "#lib/nav.ts";
  import { Button, Dialog, Input } from "../ui/index.ts";
  import { t } from "../i18n.svelte.ts";
  import { V, guard, settle, unlock } from "./vault.svelte.ts";

  onMount(guard);

  let pass = $state(""),
    err = $state(""),
    busy = $state(false);
  // a fresh prompt never shows the last attempt's text or error
  $effect(() => {
    if (V.prompt) {
      pass = "";
      err = "";
    }
  });
  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!pass || busy) return;
    busy = true;
    err = "";
    try {
      await unlock(pass);
    } catch (x) {
      err = (x as { status?: number }).status === 401 ? t("vault.wrong") : String((x as Error).message);
    } finally {
      pass = "";
      busy = false;
    }
  }
  const close = () => V.prompt && settle(false);
  function forgot() {
    close();
    void goto("/settings#security");
  }
</script>

<Dialog bind:open={V.prompt} title={t("vault.unlockTitle")} description={t("vault.unlockText")} size="sm" onclose={close}>
  <form id="vault-unlock" onsubmit={submit} class="space-y-3">
    <Input
      label={t("vault.passphrase")}
      type="password"
      autocomplete="off"
      spellcheck="false"
      dir="ltr"
      bind:value={pass}
      error={err || null}
      autofocus
    />
    <button type="button" class="text-[13px] text-sub hover:text-ink hover:underline" onclick={forgot}>{t("vault.forgot")}</button>
  </form>
  {#snippet actions()}
    <Button variant="ghost" onclick={close}>{t("common.cancel")}</Button>
    <Button variant="primary" type="submit" form="vault-unlock" icon="lock" loading={busy} disabled={!pass || busy}>{t("vault.unlock")}</Button>
  {/snippet}
</Dialog>

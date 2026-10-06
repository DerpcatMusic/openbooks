<script lang="ts">
  // AI provider settings (port of web/src/lib/ui/AiSetup.svelte). Calls /api/ai/config|test|models (packages/tools/src/ai.ts);
  // a server without them (501/404) shows the form with the provider list, disabled, under a notice.
  // The key is sent once and never comes back (the server shows "sk-…abcd"); the key field is never pre-filled.
  import { onMount } from "svelte";
  import { request, ApiError } from "#lib/api.ts";
  import { Button, Input, Select } from "#lib/ui/index.ts";
  import { t, bidi, I } from "#lib/i18n.svelte.ts";
  import { refreshAi } from "#lib/ai.ts";

  type P = { label: string; base: string; model: string; models: string[]; key: boolean | null };
  type Cfg = { provider?: string; model?: string; base?: string; keys?: Record<string, string>; providers: Record<string, P> };
  // ai.py PROVIDERS, for the disabled preview while the endpoint isn't there
  const FALLBACK: Record<string, P> = {
    anthropic: { label: "Anthropic", base: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5", models: [], key: true },
    openai: { label: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-5", models: [], key: true },
    openrouter: { label: "OpenRouter", base: "https://openrouter.ai/api/v1", model: "openai/gpt-5", models: [], key: true },
    ollama: { label: "Ollama (local)", base: "http://localhost:11434/v1", model: "", models: [], key: false },
    custom: { label: "Custom OpenAI-compatible", base: "", model: "", models: [], key: null },
  };
  const uid = $props.id();
  let cfg = $state<Cfg | null>(null),
    off = $state(false),
    provider = $state("anthropic"),
    model = $state(""),
    base = $state(""),
    key = $state(""),
    status = $state(""),
    bad = $state(false),
    busy = $state(false),
    models = $state<string[]>([]);

  onMount(async () => {
    try {
      cfg = await request<Cfg>("/api/ai/config");
    } catch (x) {
      off = x instanceof ApiError && (x.status === 501 || x.status === 404);
      cfg = { providers: FALLBACK };
      if (!off) {
        status = (x as Error).message;
        bad = true;
      }
    }
    provider = cfg.provider ?? "anthropic";
    model = cfg.model ?? "";
    base = cfg.base ?? "";
  });
  const Pv = $derived(cfg?.providers[provider] ?? ({} as Partial<P>));
  const saved = $derived(cfg?.keys?.[provider]);
  const suggestions = $derived(provider === "ollama" ? models : (Pv.models ?? []));
  const showBase = $derived(provider === "custom" || provider === "ollama");
  const post = <T,>(path: string, body: object) => request<T>(path, { ...body, lang: I.lang }); // server errors come back in the app's language

  function pick(p: string) {
    provider = p;
    model = base = key = status = "";
    if (p === "ollama") void findModels();
  }
  async function findModels() {
    try {
      models = (await post<{ models: string[] }>("/api/ai/models", { base: base || Pv.base })).models;
      if (!model && models[0]) model = models[0];
      status = models.length ? "" : t("aiSetup.noModels");
      bad = !models.length;
    } catch (e) {
      status = (e as Error).message;
      bad = true;
    }
  }
  async function save(extra: Record<string, unknown> = {}) {
    busy = true;
    const k = key;
    key = ""; // never kept on screen after sending
    try {
      cfg = await post<Cfg>("/api/ai/config", { provider, model, base, ...(k ? { key: k } : {}), ...extra });
      status = t("aiSetup.saved");
      void refreshAi(); // ⌘K's Ask AI tab
      bad = false;
    } catch (e) {
      status = (e as Error).message;
      bad = true;
    }
    busy = false;
  }
  async function test() {
    await save();
    if (bad) return;
    busy = true;
    status = t("aiSetup.testing");
    try {
      const r = await post<{ model: string }>("/api/ai/test", {});
      status = t("aiSetup.ok", { model: bidi(r.model) });
      bad = false;
    } catch (e) {
      status = (e as Error).message;
      bad = true;
    }
    busy = false;
  }
</script>

{#if cfg}
  {#if off}<p class="mb-3 rounded-lg bg-fill px-3 py-2 text-[13px] text-sub" role="status">{t("aiSetup.later")}</p>{/if}
  <fieldset disabled={off} class="contents">
    <div class="grid gap-3 sm:grid-cols-2">
      <Select label={t("aiSetup.provider")} value={provider} onchange={pick} disabled={off} options={Object.entries(cfg.providers).map(([k, p]) => ({ value: k, label: p.label }))} />
      <Input label={t("aiSetup.model")} bind:value={model} list="{uid}-models" placeholder={Pv.model || t("aiSetup.modelPh")} dir="ltr" spellcheck="false" disabled={off} />
      <datalist id="{uid}-models">{#each suggestions as m (m)}<option value={m}></option>{/each}</datalist>
      {#if showBase}
        <Input label={t("aiSetup.base")} bind:value={base} placeholder={Pv.base || "https://…/v1"} dir="ltr" spellcheck="false" disabled={off} />
      {/if}
      {#if Pv.key !== false}
        <Input
          label={Pv.key ? t("aiSetup.key") : t("aiSetup.keyOptional")}
          type="password"
          autocomplete="off"
          spellcheck="false"
          dir="ltr"
          bind:value={key}
          placeholder={saved ? t("aiSetup.keySaved", { key: bidi(saved) }) : ""}
          disabled={off} />
      {/if}
    </div>
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <Button variant="primary" onclick={test} disabled={busy || off}>{t("aiSetup.test")}</Button>
      <Button onclick={() => save()} disabled={busy || off}>{t("common.save")}</Button>
      {#if provider === "ollama"}<Button variant="ghost" onclick={findModels} disabled={off}>{t("aiSetup.refresh")}</Button>{/if}
      {#if saved && Pv.key !== false}<Button variant="ghost" onclick={() => save({ clearKey: true })} disabled={busy || off}>{t("aiSetup.removeKey")}</Button>{/if}
      {#if status}<span class={["text-[13px]", bad ? "text-bad" : "text-good"]} role="status">{status}</span>{/if}
    </div>
  </fieldset>
  <p class="mt-3 text-[12px] text-faint">{t("aiSetup.privacy")}</p>
{/if}

<script lang="ts">
  // Pill search field for toolbars. Bind `value`. `label` is the accessible name (and the placeholder by default).
  import { t } from "../i18n.svelte.ts";
  import Icon from "./Icon.svelte";
  import { ring } from "./styles.ts";
  let { value = $bindable(""), label, placeholder, class: cls = "" }: { value?: string; label: string; placeholder?: string; class?: string } = $props();
</script>

<div data-ui="search" class={["flex h-8 min-w-0 items-center gap-2 rounded-full bg-fill px-3 text-sub focus-within:ring-2 focus-within:ring-accent/50", cls]}>
  <Icon name="search" size={15} />
  <input
    type="search"
    bind:value
    placeholder={placeholder ?? label}
    aria-label={label}
    dir="auto"
    class="ui-align w-full min-w-0 bg-transparent text-[14px] text-ink outline-none placeholder:text-sub [&::-webkit-search-cancel-button]:hidden" />
  {#if value}
    <button type="button" onclick={() => (value = "")} aria-label={t("common.clearSearch")} class={["grid size-5 shrink-0 place-items-center rounded-full hover:text-ink", ring]}
      ><Icon name="x" size={14} /></button>
  {/if}
</div>

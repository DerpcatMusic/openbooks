<script lang="ts">
  // A "choose files" pill: a <label> around a visually hidden file input, styled like the kit's secondary Button.
  // (The kit's Button is a <button>/<a>; a file dialog needs the input itself to be activated.) Used by Documents and Connections.
  import { Icon } from "#lib/ui/index.ts";
  let { label, accept, multiple = false, onpick }: { label: string; accept: string; multiple?: boolean; onpick: (files: File[]) => void } = $props();
</script>

<label
  class="inline-flex min-h-8 max-w-full shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-fill py-1 ps-3 pe-4 text-[14px] leading-tight text-ink-2 transition-colors focus-within:ring-2 focus-within:ring-accent/60 hover:bg-line-strong hover:text-ink">
  <Icon name="upload" size={15} class="shrink-0" /><span class="min-w-0 [overflow-wrap:anywhere]">{label}</span>
  <input
    type="file"
    {multiple}
    {accept}
    class="sr-only"
    onchange={(e) => {
      const files = [...(e.currentTarget.files ?? [])];
      e.currentTarget.value = "";
      if (files.length) onpick(files);
    }} />
</label>

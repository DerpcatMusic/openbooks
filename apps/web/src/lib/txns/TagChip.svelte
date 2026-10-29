<script lang="ts">
  // A tag as a chip: its colour (a chart series token "s1".."s6", optional) as a dot, then its name.
  import { Badge } from "#lib/ui/index.ts";
  let { name, color, class: cls = "" }: { name: string; color?: string | undefined; class?: string } = $props();
</script>

<Badge size="sm" class={cls}>
  {#if color}<span class="size-1.5 rounded-full" style:background="var(--color-{color})"></span>{/if}<span dir="auto">{name}</span>
</Badge>

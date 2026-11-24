<script lang="ts">
  // Gradient area + line with a hover crosshair (sparkline-style). points: [{ label, v }]. LTR time axis in both languages.
  import Money from "./Money.svelte";
  let {
    points,
    label,
    currency = "ILS",
    color = "var(--color-s1)",
    height = 80,
    valueLabel = "",
  }: { points: { label: string; v: number }[]; label: string; currency?: string; color?: string; height?: number; valueLabel?: string } = $props();
  const uid = $props.id();
  let w = $state(300),
    hover = $state(-1);
  const min = $derived(Math.min(0, ...points.map(p => p.v))),
    max = $derived(Math.max(1, ...points.map(p => p.v)));
  const X = (i: number) => (points.length < 2 ? w / 2 : (i / (points.length - 1)) * w),
    Y = (v: number) => 4 + (1 - (v - min) / (max - min || 1)) * (height - 8);
  const d = $derived(points.map((p, i) => `${i ? "L" : "M"}${X(i)},${Y(p.v)}`).join(" "));
  const move = (e: MouseEvent) => {
    if (!points.length) return;
    if (points.length === 1) {
      hover = 0;
      return;
    }
    const r = (e.currentTarget as Element).getBoundingClientRect();
    hover = Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left) / (r.width || 1)) * (points.length - 1))));
  };
  const hp = $derived(points[hover]);
  const tipW = 172;
</script>

<div data-ui="area" class="relative min-w-0" dir="ltr" bind:clientWidth={w} role="figure" aria-label={label}>
  <svg width={w} {height} class="block overflow-visible" onmousemove={move} onmouseleave={() => (hover = -1)} aria-hidden="true">
    <defs
      ><linearGradient id="a{uid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color={color} stop-opacity="0.28" /><stop offset="1" stop-color={color} stop-opacity="0" /></linearGradient
      ></defs>
    {#if min < 0 && max > 0}
      <line x1="0" x2={w} y1={Y(0)} y2={Y(0)} stroke="var(--color-line-strong)" stroke-dasharray="2 3" />
    {/if}
    {#if points.length}
      <path d="{d} L{X(points.length - 1)},{height} L{X(0)},{height} Z" fill="url(#a{uid})" />
      <path {d} fill="none" stroke={color} stroke-width="1.75" stroke-linejoin="round" />
      {#if points.length === 1}
        <circle cx={X(0)} cy={Y(points[0]!.v)} r="3.5" fill="var(--color-panel)" stroke={color} stroke-width="2" />
      {/if}
      {#if hp}
        <line x1={X(hover)} x2={X(hover)} y1="0" y2={height} stroke="var(--color-line-strong)" />
        <circle cx={X(hover)} cy={Y(hp.v)} r="4" fill="var(--color-panel)" stroke={color} stroke-width="2" />
      {/if}
    {/if}
  </svg>
  {#if hp}
    {@const cx = X(hover)}
    <div
      class="pointer-events-none absolute top-1 z-20 max-w-full rounded-lg border border-line-strong bg-panel/95 px-2.5 py-1 text-[12px] whitespace-nowrap shadow-[var(--shadow)] backdrop-blur"
      style:left="{cx + 10 + tipW > w ? Math.max(0, cx - 10 - tipW) : cx + 10}px">
      <span class="text-sub" dir="auto">{hp.label}{valueLabel ? ` · ${valueLabel}` : ""}</span> <Money value={hp.v} {currency} class="text-ink" />
    </div>
  {/if}
</div>

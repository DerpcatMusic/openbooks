<script lang="ts">
  // Pre-filing review (old web/src/views/TaxChecks.svelte): statements reconcile and cover the year, everything classified, the
  // 1301 boxes agree with each other and with the books, certificates and forms are in the proof pack, then what's left to do.
  import { S, fmt, dmy } from "#lib/stores/books.svelte.ts";
  import { t, bidi, ltr } from "#lib/i18n.svelte.ts";
  import { Button, Icon, type IconName } from "#lib/ui/index.ts";
  import { ilYear } from "./il.ts";

  let { onreturn }: { onreturn: () => void } = $props();

  type Status = "ok" | "warn" | "bad" | "todo";
  /** link: "return" switches to the Form 1301 tab, anything else is an app path */
  type Check = [status: Status, title: string, text?: string, link?: string | false];

  const b = $derived(ilYear(S.year));
  const range = (a: string, z: string) => t("taxChecks.range", { from: ltr(dmy(a)), to: ltr(dmy(z)) });
  const checks = $derived.by((): Check[] => {
    const y = b.y,
      sts = S.data!.checks.filter((c) => c.period[0]!.slice(0, 4) <= String(y) && y <= +c.period[1]!.slice(0, 4));
    const cover = sts.flatMap((c) => [...c.period]).sort(),
      full = cover[0]! <= `${y}-01-01` && cover.at(-1)! >= `${y}-12-31`;
    const proofs = S.data!.proofs[y] ?? [],
      f150 = b.n("150"),
      f238 = b.n("238"),
      f294 = b.n("294");
    const bl = b.txns.filter((x) => x.desc.includes("ביטוח לאומי"));
    const has830 = proofs.some((n) => /830/.test(n));
    return [
      ...sts.map((c): Check => [
        c.parsed === c.total ? "ok" : "bad",
        t("taxChecks.reconciles", { range: range(c.period[0]!, c.period[1]!) }),
        t("taxChecks.reconcilesText", { read: fmt(c.parsed, 2), total: fmt(c.total, 2) }),
      ]),
      [
        full ? "ok" : "bad",
        t("taxChecks.wholeYear"),
        full ? t("taxChecks.wholeYearOk", { y }) : t("taxChecks.wholeYearBad", { range: cover[0] ? range(cover[0], cover.at(-1)!) : t("taxChecks.nothing") }),
        "/documents",
      ],
      [
        b.ask.length ? "warn" : "ok",
        t("taxChecks.classified"),
        b.ask.length ? t("taxChecks.needCategory", { n: b.ask.length }) : t("taxChecks.nothingLeft"),
        !!b.ask.length && "/transactions/ask",
      ],
      ...((b.zair
        ? [
            [
              Math.abs(f150 - Math.round(f238 * 0.7)) <= 1 ? "ok" : "warn",
              t("taxChecks.f150zair"),
              t("taxChecks.f150zairText", { f238: fmt(f238), calc: fmt(Math.round(f238 * 0.7)), f150: fmt(f150) }),
              "return",
            ],
            [f238 <= b.T.zairCeiling ? "ok" : "bad", t("taxChecks.zairCeiling"), t("taxChecks.zairCeilingText", { f238: fmt(f238), ceiling: fmt(b.T.zairCeiling) })],
          ]
        : [
            [
              Math.abs(f150 - Math.round(f238 - b.expenses)) <= 1 ? "ok" : "warn",
              t("taxChecks.f150actual"),
              t("taxChecks.f150actualText", { f238: fmt(f238), exp: fmt(b.expenses), calc: fmt(Math.round(f238 - b.expenses)), f150: fmt(f150) }),
              "return",
            ],
            ...(b.type === "osek-patur"
              ? [[f238 <= b.T.zairCeiling ? "ok" : "bad", t("taxChecks.paturCeiling"), t("taxChecks.paturCeilingText", { f238: fmt(f238), ceiling: fmt(b.T.zairCeiling) })]]
              : []),
            ...(b.type === "ltd" ? [["warn", t("taxChecks.ltd"), t("taxChecks.ltdText")]] : []),
          ]) as Check[]),
      [f294 >= f238 ? "ok" : "bad", t("taxChecks.f294"), t("taxChecks.f294Text", { f294: fmt(f294), f238: fmt(f238) }), "return"],
      [b.v("186") !== "" ? "ok" : "bad", t("taxChecks.f186"), t("taxChecks.f186Text"), "return"],
      ...(b.capital.length
        ? [
            [
              b.cap && b.withheld ? "ok" : "warn",
              t("taxChecks.fund"),
              t("taxChecks.fundText", {
                items: b.capital.map((x) => t("taxChecks.fundItem", { amount: fmt(x.amount, 2), date: ltr(dmy(x.date)) })).join(", "),
                cap: fmt(b.cap),
                withheld: fmt(b.withheld),
              }),
              "return",
            ] as Check,
          ]
        : []),
      ...(b.withheld
        ? [[proofs.some((n) => /867|אישור|אלטשולר/.test(n)) ? "ok" : "warn", t("taxChecks.withholdingDoc"), t("taxChecks.withholdingDocText"), "/documents"] as Check]
        : []),
      ...(b.soldier
        ? [
            [
              has830 ? "ok" : "warn",
              t("taxChecks.soldier", { pts: b.soldier.toFixed(2) }),
              t(has830 ? "taxChecks.soldierIn" : "taxChecks.soldierMissing", { date: ltr(dmy(b.p.discharge ?? "")), months: b.p.serviceMonths ?? "" }),
              "/documents",
            ] as Check,
          ]
        : []),
      [bl.length ? "warn" : "ok", t("taxChecks.bl"), t(bl.length ? "taxChecks.blFound" : "taxChecks.blNone")],
      [
        b.balance > 0 ? "warn" : "ok",
        b.balance > 0 ? t("taxChecks.stillPay", { amount: fmt(b.balance) }) : t("taxChecks.refund", { amount: fmt(-b.balance) }),
        b.assessed ? t("taxChecks.assessed", { amount: fmt(b.assessed) }) : "",
      ],
      ["todo", t("taxChecks.pack"), t("taxChecks.packText"), "/documents"],
      ["todo", t("taxChecks.file"), t("taxChecks.fileText", { office: b.p.office ? bidi(b.p.office) : t("taxChecks.yourOffice") })],
    ];
  });
  const open = $derived(checks.filter((c) => c[0] === "bad" || c[0] === "warn").length);
  const ICON: Record<Status, [IconName | "", string]> = { ok: ["tick", "bg-good"], warn: ["alert", "bg-warn"], bad: ["x", "bg-bad"], todo: ["", "bg-faint"] };
</script>

<p class="px-4 py-3 text-[14px] text-sub sm:px-8" role="status">{open ? t("taxChecks.open", { n: open }) : t("taxChecks.allGood")}</p>
<ul>
  {#each checks as [s, title, text, link], i (i)}
    <li class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-4 hover:bg-hover sm:px-8">
      <span class="grid size-5 shrink-0 place-items-center self-start rounded-full text-white {ICON[s][1]}" aria-hidden="true">
        {#if ICON[s][0]}<Icon name={ICON[s][0] as IconName} size={12} />{:else}<span class="size-1 rounded-full bg-white"></span>{/if}
      </span>
      <div class="min-w-0 flex-1 basis-48">
        <div class="text-[14px] text-ink">{title}</div>
        {#if text}<div class="mt-0.5 text-[13px] text-sub">{text}</div>{/if}
      </div>
      {#if link}
        <Button
          variant="ghost"
          size="sm"
          class="max-sm:ms-9"
          aria-label={t("taxChecks.goTo", { title })}
          href={link === "return" ? undefined : link}
          onclick={link === "return" ? onreturn : undefined}>{t("taxChecks.go")}</Button>
      {/if}
    </li>
  {/each}
</ul>

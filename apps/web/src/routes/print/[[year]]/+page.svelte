<script lang="ts">
  // Proof-pack cover (old web/src/views/Print.svelte, mode "pack"): page 1 a summary of the year for the assessing officer,
  // page 2 every business receipt. A fixed Hebrew document. The server's /api/pack prints this page with headless Chrome at
  // http://127.0.0.1:<port>/#/print/<year>?e=<entity> (apps/server/src/pack.ts; the layout maps #/… to /print/<year>?e=…)
  // and appends the statements and proofs.
  import { page } from "$app/state";
  import { translate } from "@openbooks/core";
  import { group, isBiz } from "@openbooks/core";
  import type { Txn } from "@openbooks/schema";
  import { S, catLabel, money, dmy } from "#lib/stores/books.svelte.ts";
  import { t, has, DICTS } from "#lib/i18n.svelte.ts";
  import { scramble } from "#lib/privacy.svelte.ts";
  import { Button } from "#lib/ui/index.ts";
  import { ilYear } from "../../tax/il/il.ts";
  import "../print.css";

  const year = $derived(+(page.params.year ?? "") || S.year);
  const b = $derived(S.data ? ilYear(year) : null);
  const today = new Date().toLocaleDateString("en-GB");
  /** amounts: plain 2-decimal figures (inflated in privacy mode, like every amount on screen) */
  const m = (n: number) => money(scramble(n));
  const he = (k: string) => (has(k) ? translate(DICTS, "he", k) : "");
  const heCat = (k: string) => he(`cat.${k}`) || catLabel(k);
  const HE_SOURCE: Record<string, string> = {
    "business:paypal": "PayPal (העברות מסיטיבנק אירופה)",
    "business:youtube": "Google Ireland (YouTube)",
    "business:music": "מפיצי מוזיקה (RouteNote, AEI Music)",
    "business:client": "לקוחות (העברה בנקאית / ביט)",
  };
  const HE_NOT: Record<string, string> = {
    "exempt:idf-salary": 'משכורת צה"ל (פטור)',
    "own:savings": "משיכה מחיסכון שלי",
    "own:transfer": "העברה מחשבון שלי",
    "own:bit-withdrawal": "משיכה מארנק ביט שלי",
    "personal:family": "משפחה",
    "personal:friends": "חברים (החזרים/חלוקת הוצאות)",
    "personal:refund": "החזר כספי (אל על)",
    "personal:phone-sale": "מכירת טלפון משומש",
    "personal:provident-fund": "קופת גמל",
  };
  const sum = (ts: readonly Txn[]) => ts.reduce((a, x) => a + x.amount, 0);
  /** [category, count, amount], biggest first */
  const byCat = (ts: readonly Txn[]) => {
    const g = new Map<string, [number, number]>();
    for (const x of ts) {
      const r = g.get(x.category) ?? [0, 0];
      g.set(x.category, [r[0] + 1, r[1] + x.amount]);
    }
    return [...g].map(([k, [n, v]]) => [k, n, v] as const).sort((x, y) => y[2] - x[2]);
  };
  const bySource = $derived(b ? byCat(b.biz) : []);
  const notIncome = $derived(b ? byCat(b.txns.filter((x) => !isBiz(x.category) && group(x.category) !== "capital")) : []);
  const statements = $derived(S.data?.checks.filter((c) => c.period[0].slice(0, 4) <= String(year) && year <= +c.period[1].slice(0, 4)) ?? []);
  const proofs = $derived(S.data?.proofs[year] ?? []);
  const ref = (x: Txn) => (x.source === "bank" ? `דף חשבון ${S.data!.checks.findIndex((c) => c.file === x.file) + 1}, עמ' ${x.page}` : `ייצוא ביט, שורה ${x.page}`);
  const bizHe = $derived(b ? he(`biz.${b.type}`) || "עוסק זעיר" : "");
</script>

<svelte:head><title>{t("common.print")} {year} · OpenBooks</title></svelte:head>

<div class="ob-print">
  <div class="ob-print-bar"><Button variant="primary" icon="printer" onclick={() => print()}>{t("print.button")}</Button></div>
  {#if b}
    {@const p = b.p}
    <article class="doc" dir="rtl" lang="he">
      <!-- Page 1: summary -->
      <section>
        <div class="flex flex-wrap justify-between gap-x-4 text-[10pt]">
          <span><span class="pii">{p.last} {p.first}</span> · ת"ז <span class="pii">{p.id}</span>{#if p.phone}{" · "}<span class="pii">{p.phone}</span>{/if}</span><span>{today}</span>
        </div>
        <p class="mt-4">לכבוד <b>{p.office ?? "פקיד השומה"}</b>{b.f.inquiry ? ` · פנייה ${b.f.inquiry}` : ""}</p>
        <h1 class="mt-2">ריכוז הכנסות שנת {year} — {bizHe}{p.business ? ` (${p.business})` : ""}</h1>

        <h2>1. הכנסה מעסק (מפורט בעמוד 2)</h2>
        <div class="wide">
          <table>
            <thead><tr><th>מקור</th><th style="width:50pt">תקבולים</th><th style="width:80pt">סכום (₪)</th></tr></thead>
            <tbody>
              {#each bySource as [k, n, v] (k)}<tr><td>{HE_SOURCE[k] ?? heCat(k)}</td><td class="n">{n}</td><td class="n">{m(v)}</td></tr>{/each}
              <tr class="tot"><td>מחזור — שדה 238</td><td class="n">{b.biz.length}</td><td class="n">{m(b.turnover)}</td></tr>
              <tr class="tot"><td>הכנסה חייבת{b.zair ? " (70%)" : ""} — שדה 150</td><td></td><td class="n">{m(b.taxable)}</td></tr>
            </tbody>
          </table>
        </div>

        <h2>2. כספים שנכנסו לחשבון ואינם הכנסה</h2>
        <div class="wide">
          <table>
            <thead><tr><th>סוג</th><th style="width:50pt">תנועות</th><th style="width:80pt">סכום (₪)</th></tr></thead>
            <tbody>
              {#each notIncome as [k, n, v] (k)}<tr><td>{HE_NOT[k] ?? heCat(k)}</td><td class="n">{n}</td><td class="n">{m(v)}</td></tr>{/each}
            </tbody>
          </table>
        </div>

        {#if b.capital.length}
          <h2>3. חיסכון לכל ילד — אלטשולר שחם (שדות 060, 040)</h2>
          <table>
            <tbody>
              <tr><td>הופקד בחשבון {dmy(b.capital[0]!.date)} (נטו)</td><td class="n">{m(sum(b.capital))}</td></tr>
              <tr><td>מס שנוכה במקור 15% — שדה 040</td><td class="n">{m(b.withheld)}</td></tr>
              <tr><td>רווח ריאלי — שדה 060</td><td class="n">{m(b.cap)}</td></tr>
            </tbody>
          </table>
        {/if}

        {#if b.soldier}
          <h2>4. חייל משוחרר — טופס 830 מצורף (שדות 224, 024)</h2>
          <table>
            <tbody>
              <tr
                ><td>שירות חובה {p.enlisted ? `${dmy(p.enlisted)} – ` : ""}{dmy(p.discharge ?? "")} · {p.serviceTotal ?? `${p.serviceMonths} חודשים`}</td><td class="n"
                  >{p.serviceMonths} חודשים</td
                ></tr>
              <tr><td>נקודות זיכוי לשנת {year} (2 לשנה × {Math.round((b.soldier / 2) * 12)}/12 חודשים)</td><td class="n">{b.soldier.toFixed(2)}</td></tr>
            </tbody>
          </table>
        {/if}

        <h2>5. חישוב המס</h2>
        <table>
          <tbody>
            <tr><td>מס לפני זיכויים</td><td class="n">{m(b.gross)}</td></tr>
            <tr><td>נקודות זיכוי {b.points.toFixed(2)} × {m(b.T.point)} (עד גובה המס)</td><td class="n">-{m(b.credits)}</td></tr>
            {#if b.withheld}<tr><td>ניכוי במקור</td><td class="n">-{m(b.withheld)}</td></tr>{/if}
            <tr class="tot"><td>{b.balance < 0 ? "החזר מס" : "לתשלום"}</td><td class="n">{m(Math.abs(b.balance))}</td></tr>
          </tbody>
        </table>

        <p class="note">
          מצורפים: {statements.map((c) => `דף חשבון ONE ZERO ${dmy(c.period[0])}–${dmy(c.period[1])}`).join(" · ")}{proofs.length
            ? " · " + proofs.map((x) => x.replace(/\.pdf$/i, "")).join(" · ")
            : ""}.
        </p>
        <div class="sign"><span>חתימה: ____________________</span><span class="pii">{p.last} {p.first}</span></div>
      </section>

      <!-- Page 2: every business receipt -->
      <section>
        <h1>פירוט תקבולי העסק {year}</h1>
        <div class="wide">
          <table>
            <thead><tr><th style="width:22pt">#</th><th style="width:56pt">תאריך</th><th>תיאור</th><th style="width:96pt">מקור</th><th style="width:66pt">סכום (₪)</th></tr></thead>
            <tbody>
              {#each b.biz as x, i (x.id)}<tr
                  ><td class="n">{i + 1}</td><td class="n">{dmy(x.date)}</td><td dir="auto">{x.desc.replace(/^bit: /, "ביט: ")}</td><td>{ref(x)}</td><td class="n">{m(x.amount)}</td></tr
                >{/each}
              <tr class="tot"><td></td><td></td><td>סה"כ</td><td></td><td class="n">{m(b.turnover)}</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </article>
  {/if}
</div>

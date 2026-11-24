// The Israeli year for the open books: the IL pack's form1301 bound to S (old web/src/lib/books.svelte.js books(y)).
// Used by the Tax page, the checks and the print views. The maths live in @openbooks/country-il; this only picks the inputs
// and adds what the screens show next to it (field getters, expenses for the non-zair check).
import { isBiz, plOf } from "@openbooks/core";
import { form1301, form1301Auto, form1301FromBooks, type IlTable, type Profile } from "@openbooks/country-il";
import { S, bizType, taxTable, yearTxns } from "#lib/stores/books.svelte.ts";
import { personNow, profileFromPerson } from "#lib/person.ts";
import { disallowed, result } from "#lib/taxtags.svelte.ts";
import { advancesPaid, register, vat1301 } from "#lib/filings.svelte.ts";
import { ilForeign } from "#lib/crossborder.svelte.ts";

/** The 1301 profile with the release date and months served from the person (/you), else from the old per-business profile. */
export const ilProfile = () => profileFromPerson((S.data?.profile ?? {}) as Profile & Record<string, any>, personNow()?.facts);

export function ilYear(y = S.year) {
  const txns = yearTxns(y),
    T = taxTable(y) as unknown as IlTable & { year: number },
    type = bizType(y) ?? "",
    p = ilProfile(),
    f: Record<string, string> = S.data?.form?.[y] ?? {};
  const cut = disallowed(y); // expenses the deduction rules disallow come off the actual-expenses figure (box 150), never the zair 70%
  // foreign holdings (/you): a transparent foreign entity or a controlled company closes osek zair (Circular 7/2025 §3.3); the LLC's
  // profit is attributed at each transaction's Bank of Israel rate. While a rate is missing the foreign income stays off the return (the checks say so).
  const fx = ilForeign(y),
    cb = fx.cb(),
    zairExcluded = fx.zairExcluded,
    foreign = cb && !cb.missingFx.length && cb.attributedIncome ? { income: cb.attributedIncome, taxPaid: cb.foreignTax } : undefined;
  const zair = type === "osek-zair" && !zairExcluded;
  // VAT-registered books file without VAT; bought equipment is depreciated (appendix 1342) instead of expensed when paid; advances come off the balance
  const vat = zair ? undefined : vat1301(y),
    dep = zair ? undefined : register(y),
    capital = dep && (dep.rows.length || dep.totals.bought) ? { cost: dep.totals.bought, depreciation: dep.totals.amount } : undefined,
    extra = { ...(vat ? { vat } : {}), ...(capital ? { capital } : {}) };
  const advances = advancesPaid(y);
  // boxes the tagged spending fills (donations 037, study fund 136, life 036, disability 112) MUST feed form1301() BEFORE tax is calculated
  // so displayed boxes, calculated tax, print view, and MCP tax_summary always agree 100%; user overrides in `f` still win.
  const bookBoxes = form1301FromBooks(result(y)?.byRule ?? []);
  const r = form1301({
    y,
    txns,
    type,
    T,
    form: f,
    bookBoxes,
    facts: personNow()?.facts,
    profile: p,
    disallowed: cut,
    advances,
    today: new Date().toISOString().slice(0, 10),
    zairExcluded,
    ...(foreign ? { foreign } : {}),
    ...extra,
  });
  const auto = { ...form1301Auto({ txns, type, profile: p, disallowed: cut, zairExcluded, bookBoxes, ...extra }), ...bookBoxes };
  const v = (k: string) => f[k] ?? auto[k] ?? "";
  const n = (k: string) => +String(v(k)).replace(/,/g, "") || 0;
  return {
    ...r,
    y,
    T,
    type,
    p,
    f,
    auto,
    bookBoxes,
    v,
    n,
    txns,
    biz: txns.filter((x) => isBiz(x.category)),
    zair,
    /** Foreign holdings: what closes osek zair, unresolved Israeli positions, Form 150s, missing FX, and the crossBorder result. */
    foreignHoldings: fx.foreign,
    unresolvedHoldings: fx.unresolved,
    missingFx: cb?.missingFx ?? [],
    blocked: fx.blocked,
    zairExcluded,
    cb,
    /** Turnover figures without VAT / depreciation instead of equipment cost: what the page explains next to the boxes. */
    vat,
    dep,
    /** Actual expenses the rules allow (non-zair 150 = turnover − expenses, excluding personal box 136 KH). */
    expenses: Math.max(
      0,
      -txns.filter((x) => ["cogs", "expense"].includes(plOf(x.category) ?? "")).reduce((a, x) => a + x.amount, 0) -
        cut -
        (+(bookBoxes["136"] ?? 0) || 0) -
        (vat?.reclaimed ?? 0) -
        (capital ? capital.cost - capital.depreciation : 0),
    ),
    assessed: +(f.assessed ?? 0),
  };
}
export type IlYear = ReturnType<typeof ilYear>;

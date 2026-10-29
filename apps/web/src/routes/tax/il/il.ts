// The Israeli year for the open books: the IL pack's form1301 bound to S (old web/src/lib/books.svelte.js books(y)).
// Used by the Tax page, the checks and the print views. The maths live in @openbooks/country-il; this only picks the inputs
// and adds what the screens show next to it (field getters, expenses for the non-zair check).
import { isBiz, plOf } from "@openbooks/core";
import { form1301, form1301Auto, type IlTable, type Profile } from "@openbooks/country-il";
import { S, bizType, taxTable, yearTxns } from "#lib/stores/books.svelte.ts";
import { personNow, profileFromPerson } from "#lib/person.ts";
import { disallowed } from "#lib/taxtags.svelte.ts";

/** The 1301 profile with the release date and months served from the person (/you), else from the old per-business profile. */
export const ilProfile = () => profileFromPerson((S.data?.profile ?? {}) as Profile & Record<string, any>, personNow()?.facts);

export function ilYear(y = S.year) {
  const txns = yearTxns(y),
    T = taxTable(y) as unknown as IlTable & { year: number },
    type = bizType(y) ?? "",
    p = ilProfile(),
    f: Record<string, string> = S.data?.form?.[y] ?? {};
  const cut = disallowed(y); // expenses the deduction rules disallow come off the actual-expenses figure (box 150), never the zair 70%
  const r = form1301({ y, txns, type, T, form: f, profile: p, disallowed: cut, today: new Date().toISOString().slice(0, 10) });
  const auto = form1301Auto({ txns, type, profile: p, disallowed: cut });
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
    v,
    n,
    txns,
    biz: txns.filter((x) => isBiz(x.category)),
    zair: type === "osek-zair",
    /** Actual expenses the rules allow (non-zair 150 = turnover − expenses). */
    expenses: -txns.filter((x) => ["cogs", "expense"].includes(plOf(x.category) ?? "")).reduce((a, x) => a + x.amount, 0) - cut,
    assessed: +(f.assessed ?? 0),
  };
}
export type IlYear = ReturnType<typeof ilYear>;

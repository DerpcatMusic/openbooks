// Israeli bank / card syncs from israeli-bank-scrapers (= books.py scraper_json + _local_day).
import type { StatementRow } from "@openbooks/schema";
import { pyRound } from "@openbooks/core";
import { pyFloatStr } from "../uid.ts";
import { parseStatementJson, pyFloat, pyS, pyWords, type ReaderFile, type ReaderOut } from "./onezero.ts";

const ISO = /^(\d{4})-?(\d\d)-?(\d\d)(?:.(\d\d)(?::?(\d\d)(?::?(\d\d)(?:[.,](\d+))?)?)?(?:([+-])(\d\d)(?::?(\d\d)(?::?(\d\d)(?:[.,]\d+)?)?)?)?)?$/u;
const jerusalem = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * israeli-bank-scrapers dates are ISO instants (Israeli midnight = 21:00/22:00Z the day before): the Israeli calendar day.
 * Mirrors Python datetime.fromisoformat: unparseable → first 10 chars, naive → its own date, aware → the day in Asia/Jerusalem.
 * ponytail: the common ISO 8601 shapes only (no week dates); anything else takes the first-10-chars fallback.
 */
export function localDay(s: unknown): string {
  const str = pyS(s),
    m = ISO.exec(str.replaceAll("Z", "+00:00"));
  if (!m) return str.slice(0, 10);
  const [y, mo, d, h = 0, mi = 0, sec = 0] = [m[1], m[2], m[3], m[4], m[5], m[6]].map((x) => (x === undefined ? undefined : Number(x))) as number[];
  const t = new Date(0);
  t.setUTCFullYear(y!, mo! - 1, d!);
  const h24 = h === 24 && mi === 0 && sec === 0 && !/[1-9]/.test(m[7] ?? ""); // Python 3.14 reads 24:00 as the next midnight
  if (y! < 1 || t.getUTCMonth() !== mo! - 1 || t.getUTCDate() !== d || (h > 23 && !h24) || mi > 59 || sec > 59) return str.slice(0, 10);
  const off = m[8] ? (m[8] === "-" ? -1 : 1) * (Number(m[9]) * 3600 + Number(m[10] ?? 0) * 60 + Number(m[11] ?? 0)) : 0;
  if (Math.abs(off) >= 86400) return str.slice(0, 10);
  t.setUTCHours(h, mi, sec - off);
  if (!m[8]) return t.toISOString().slice(0, 10); // naive: its own calendar day
  const p = Object.fromEntries(jerusalem.formatToParts(t).map((x) => [x.type, x.value]));
  return `${p.year!.padStart(4, "0")}-${p.month}-${p.day}`;
}

const float = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") return pyFloat(v);
  throw new TypeError(`float() argument must be a string or a real number, not '${v === null ? "NoneType" : typeof v}'`);
};

/**
 * Every completed movement, money out negative (cards report charges as negative chargedAmount, in shekels even when bought abroad).
 * Installments book on their charge date. Pending ones are skipped: they land on the next sync. No balance check (banks show about a year).
 */
export function scraperJson(file: ReaderFile): ReaderOut {
  const { data: d, isInt } = parseStatementJson(file);
  if (!("companyId" in d)) throw new Error("KeyError: 'companyId'");
  const src = `scraper:${pyS(d.companyId, isInt(d, "companyId"))}`,
    name = d.name || pyS(d.companyId, isInt(d, "companyId"));
  const rows: StatementRow[] = [];
  for (const a of d.accounts) {
    const acct = `${pyS(name)} ••${("accountNumber" in a ? pyS(a.accountNumber, isInt(a, "accountNumber")) : "").slice(-4)}`,
      dupes = new Map<string, number>();
    for (const t of a.txns ?? []) {
      if (t.status === "pending") continue;
      const inst = t.installments && Object.keys(t.installments).length ? t.installments : null;
      if (!inst && !("date" in t)) throw new Error("KeyError: 'date'");
      const date = localDay(inst ? t.processedDate : t.date),
        amt = pyRound(float(t.chargedAmount)),
        desc = pyWords(pyS(t.description || "", isInt(t, "description")));
      const memo: string[] = [t.memo || ""];
      if (inst) memo.push(`installment ${pyS(inst.number, isInt(inst, "number"))}/${pyS(inst.total, isInt(inst, "total"))}`);
      const oc = t.originalCurrency;
      if (oc && !["ILS", "₪", t.chargedCurrency || "ILS"].includes(oc)) memo.push(`${pyS(t.originalAmount, isInt(t, "originalAmount"))} ${pyS(oc)}`);
      let k = t.identifier ? pyS(t.identifier, isInt(t, "identifier")) : "";
      if (!k) {
        // same day, amount and text twice (two coffees) stays two rows
        const dk = `${date}|${pyFloatStr(amt)}|${desc}`,
          n = (dupes.get(dk) ?? -1) + 1;
        dupes.set(dk, n);
        k = `${dk}|${n}`;
      }
      const no = inst && "number" in inst ? pyS(inst.number, isInt(inst, "number")) : "";
      rows.push({
        date,
        amount: amt,
        desc,
        memo: memo.filter(Boolean).join(" "),
        source: src,
        account: acct,
        file: file.name,
        page: rows.length + 1,
        key: `${acct}|${k}|${no}`,
      });
    }
  }
  return { rows, checks: [] };
}

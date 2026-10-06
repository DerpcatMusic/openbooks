// Mercury statements: the API dump connectors write ({accounts, transactions}) and the web app's "Export transactions" CSV.
// Port of books.py mercury_json / mercury_csv, bit-identical.
import type { StatementCheck, StatementRow } from "@openbooks/schema";
import { intAmount, parseJson, uidAmount } from "../uid.ts";
import { pyCsv, pyFloat, round2 } from "./csv.ts";

type File = { name: string; bytes: Uint8Array; text?: string };
type Json = Record<string, unknown>;

/** d[k], raising like Python's KeyError. */
const need = (d: Json, k: string): unknown => {
  if (!(k in d)) throw new Error(`KeyError: '${k}'`);
  return d[k];
};
/** str slicing s[:n] (code points). */
const head = (s: unknown, n: number): string => {
  if (typeof s !== "string") throw new TypeError("not a string");
  // oxlint-disable-next-line no-misused-spread -- Python slices code points
  return [...s].slice(0, n).join("");
};

/**
 * Python's sum() over ints and floats (3.12+): ints add exactly until the first float, then Neumaier-compensated
 * float addition (ints included), the compensation added at the end.
 */
export function pySum(xs: readonly number[], isInt: (i: number) => boolean): number {
  let i = 0,
    acc = 0;
  for (; i < xs.length && isInt(i); i++) acc += xs[i]!;
  if (i === xs.length) return acc;
  let hi = acc + xs[i++]!,
    lo = 0;
  for (; i < xs.length; i++) {
    const x = xs[i]!,
      t = hi + x;
    lo += Math.abs(hi) >= Math.abs(x) ? hi - t + x : x - t + hi;
    hi = t;
  }
  return lo && Number.isFinite(lo) ? hi + lo : hi;
}

/** Mercury API dump {accounts, transactions} -> every posted transaction, reconciled per account against Mercury's balance. */
export function mercuryJson(file: File): { rows: StatementRow[]; checks: StatementCheck[] } {
  // Python's json.loads tells 12 (int) from 12.0 (float); the uid and sum() care, so parseJson/intAmount carry it.
  const d = parseJson(file.text ?? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(file.bytes)) as Json;
  const accounts = need(d, "accounts") as Json[],
    txns = need(d, "transactions") as Json[];
  const names = new Map(accounts.map((a) => [need(a, "id"), need(a, "name") as string]));
  const rows: StatementRow[] = [];
  txns.forEach((t, i) => {
    if (["cancelled", "failed", "reversed", "blocked"].includes(t.status as string)) return;
    const s = (k: string) => (t[k] as string | null | undefined) || "";
    const r: StatementRow = {
      date: head(t.postedAt || need(t, "createdAt"), 10),
      amount: need(t, "amount") as number,
      desc: s("counterpartyName") || s("bankDescription"),
      memo: [s("bankDescription"), s("note"), s("externalMemo")].filter(Boolean).join(" "),
      mcat: s("mercuryCategory"),
      kind: need(t, "kind") as string,
      source: "mercury",
      account: names.get(need(t, "accountId")) ?? "Mercury",
      file: file.name,
      page: i + 1,
      key: need(t, "id") as string,
    };
    rows.push(intAmount(r, t, "amount"));
  });
  const dates = rows.map((r) => r.date).sort();
  const checks = accounts.map((a): StatementCheck => {
    const mine = rows.filter((r) => r.account === a.name);
    return {
      file: file.name,
      label: a.name as string,
      period: dates.length ? [dates[0]!, dates.at(-1)!] : ["", ""],
      parsed: round2(
        pySum(
          mine.map((r) => r.amount),
          (i) => /^-?\d+$/.test(uidAmount(mine[i]!)),
        ),
      ),
      total: need(a, "currentBalance") as number,
      balance: true,
    };
  });
  return { rows, checks };
}

const num = (s: unknown): number => {
  const v = pyFloat(String(s).replaceAll(",", ""));
  if (v === null) throw new Error(`could not convert string to float: '${String(s)}'`);
  return v;
};

/** Mercury "Export transactions" CSV (utf-8-sig, universal newlines, csv.DictReader). */
export function mercuryCsv(file: File): { rows: StatementRow[]; checks: StatementCheck[] } {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes).replace(/\r\n?/g, "\n");
  const it = pyCsv(text),
    names: string[] = it.next().value ?? [];
  const rows: StatementRow[] = [];
  let n = 0;
  for (const cells of it) {
    if (!cells.length) continue; // DictReader skips blank lines
    n++;
    // dict(zip(fieldnames, row)), missing cells = None (restval); later duplicate headers win
    const r = new Map<string, string | null>(names.map((h, i) => [h, cells[i] ?? null]));
    const get = (k: string) => (r.has(k) ? r.get(k)! : "");
    if (["failed", "cancelled", "reversed", "blocked"].includes(get("Status")!.toLowerCase())) continue;
    if (!r.has("Date (UTC)")) throw new Error("KeyError: 'Date (UTC)'");
    const ds = r.get("Date (UTC)")!; // None (short row) throws, as in Python
    const parts = ds.split(ds.includes("-") ? "-" : "/");
    if (parts.length !== 3) throw new Error("ValueError: date needs three parts");
    const [m, d, y] = parts as [string, string, string];
    if (!r.has("Amount")) throw new Error("KeyError: 'Amount'");
    rows.push({
      date: `${head(y, 4)}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`,
      amount: num(r.get("Amount")),
      // ponytail: a short row's missing cell is None in Python (desc "None" in the uid); Mercury exports are rectangular, so "" here
      desc: get("Description") ?? "",
      memo: get("Bank Description") ?? "",
      mcat: get("Mercury Category") ?? "",
      kind: "",
      source: "mercury",
      account: get("Source Account") || "Mercury",
      file: file.name,
      page: n,
      key: get("Reference") || get("Timestamp") || `${n}`,
    });
  }
  return { rows, checks: [] };
}

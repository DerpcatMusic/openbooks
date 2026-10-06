// Transaction uid, bit-identical with books.py ingest():
//   sha1(f"{r['source']}|{r['date']}|{r['amount']}|{r['desc']}|{r.pop('key')}").hexdigest()[:12]
// where {amount} is Python's str(): str(int) for integer JSON literals (Mercury JSON `amount`, One Zero sync `chargedAmount`), str(float) otherwise.
import { createHash } from "node:crypto";
import { pyStr } from "@openbooks/core";
import type { StatementRow } from "@openbooks/schema";

const INT = /^-?\d+$/;
/** holder object → field → integer literal text, filled by parseJson. */
const jsonInts = new WeakMap<object, Map<string, string>>();
/** row → integer literal text of its amount, set by intAmount. */
const rowInts = new WeakMap<object, string>();

type Reviver = (this: unknown, key: string, value: unknown, ctx?: { source?: string }) => unknown;

/** JSON.parse that remembers which numbers were written as integer literals (Python's json.loads makes those ints). */
export function parseJson(text: string): unknown {
  const reviver: Reviver = function (key, value, ctx) {
    if (typeof value === "number" && ctx?.source !== undefined && INT.test(ctx.source) && typeof this === "object" && this !== null) {
      const m = jsonInts.get(this) ?? new Map<string, string>();
      m.set(key, ctx.source);
      jsonInts.set(this, m);
    }
    return value;
  };
  return JSON.parse(text, reviver as (this: unknown, key: string, value: unknown) => unknown);
}

/** For JSON readers: `row.amount` came from `holder[field]` of a parseJson result; if that was an integer literal the uid prints it like str(int). Returns row. */
export function intAmount<R extends object>(row: R, holder: object, field: string): R {
  const lit = jsonInts.get(holder)?.get(field);
  if (lit !== undefined) rowInts.set(row, lit);
  return row;
}

/** Python's str(float): repr, i.e. shortest round-trip digits, exponent form below 1e-4 and from 1e16 on (two-digit exponent minimum). */
export function pyFloatStr(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const a = Math.abs(x);
  if (a >= 1e-4 && a < 1e16) return pyStr(x);
  const [m = "", e = ""] = x.toExponential().split("e");
  return `${m}e${e[0]}${e.slice(1).padStart(2, "0")}`;
}

/** The amount exactly as books.py prints it into the uid. Integer literals print from their source text (exact beyond 2^53). */
export function uidAmount(r: StatementRow): string {
  const lit = rowInts.get(r);
  return lit !== undefined ? BigInt(lit).toString() : pyFloatStr(r.amount);
}

export function uid(r: StatementRow, amount: string = uidAmount(r)): string {
  return createHash("sha1").update(`${r.source}|${r.date}|${amount}|${r.desc}|${r.key}`, "utf8").digest("hex").slice(0, 12);
}

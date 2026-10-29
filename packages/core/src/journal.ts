// Manual journal entries (doc "journal"), validated the way Mercury Books does (spec section 7): a date, at least one debit and one
// credit line, every line with a ledger account (never an archived one), and debits equal to credits in whole cents. Pure: the screen,
// the paste import, the MCP tool and the server's write guard all call these.
import type { JournalEntry } from "@openbooks/schema";
import { accountProblem, type Coa } from "./coa.ts";

export const isIsoDate = (s: unknown): s is string => {
  const m = typeof s === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  const d = m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)) : null;
  return !!m && +m[1]! >= 1 && d!.getUTCMonth() === +m[2]! - 1 && d!.getUTCDate() === +m[3]!;
};

const cents = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
type Line = { account: string; debit?: unknown; credit?: unknown };
/** [debits, credits] in cents. */
export const centsTotals = (lines: readonly Line[]): [number, number] =>
  lines.reduce<[number, number]>((a, l) => [a[0] + Math.max(0, cents(l.debit)), a[1] + Math.max(0, cents(l.credit))], [0, 0]);

export type JournalProblem = "date" | "beforeStart" | "empty" | "account" | "archived" | "noDebit" | "noCredit" | "unbalanced";
export interface JournalCtx {
  coa?: Coa | undefined;
  /** The books' entries start date: an entry dated before it is refused. */
  from?: string | null | undefined;
}
/**
 * Why this entry can't be saved, or null. Checked in this order: date, start date, no lines with an amount ("empty"), a line with an
 * amount but no usable account ("account") or an archived one ("archived"), no debit line, no credit line, debits != credits in cents.
 * Lines without an amount are ignored (blank rows of the editor).
 */
export function journalProblem(e: { date: string; lines: readonly Line[] }, ctx: JournalCtx = {}): JournalProblem | null {
  if (!isIsoDate(e.date)) return "date";
  if (ctx.from && e.date < ctx.from) return "beforeStart";
  const used = e.lines.filter((l) => cents(l.debit) || cents(l.credit));
  if (!used.length) return "empty";
  for (const l of used) {
    const p = accountProblem(l.account, ctx.coa);
    if (p === "missing") return "account";
    if (p === "archived") return "archived";
  }
  const [d, c] = centsTotals(used);
  if (!used.some((l) => cents(l.debit) > 0)) return "noDebit";
  if (!used.some((l) => cents(l.credit) > 0)) return "noCredit";
  return d === c ? null : "unbalanced";
}

/** Debits − credits in cents' worth of money (0 = balanced). */
export const imbalance = (lines: readonly Line[]) => {
  const [d, c] = centsTotals(lines);
  return (d - c) / 100;
};

// ---------- paste import: rows copied from a spreadsheet ----------
export interface PasteRow {
  /** 1-based row number in the pasted text, for error messages. */
  row: number;
  date: string;
  account: string;
  debit: number;
  credit: number;
  memo: string;
}
export interface PasteError {
  row: number;
  /** "columns" | "date" | "amount" | "account" | "both" */
  problem: string;
}
export interface PasteDraft {
  /** Entries that came out balanced and valid, ready to save (new ids). */
  entries: { date: string; memo: string; lines: { account: string; debit: number; credit: number }[] }[];
  /** Rows that couldn't be read. */
  errors: PasteError[];
  /** Groups (date + memo) that are valid rows but fail the entry rules; `problem` is a JournalProblem. */
  rejected: { date: string; memo: string; problem: JournalProblem; rows: number[] }[];
  rows: PasteRow[];
}

const HEADER = /^\s*(date|תאריך)\b/i;
/** "1,234.50" → 1234.5; "(50)" → 50 (amounts are magnitudes); "" → 0; anything else → NaN. */
export function parseMoney(s: string): number {
  const t = s.trim().replace(/[\s$€₪]/g, "");
  if (!t) return 0;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  const body = t.replace(/^[(-]|\)$/g, "");
  const n = /^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(body) ? Number(body.replaceAll(",", "")) : Number.NaN;
  return neg ? Math.abs(n) : n;
}
/**
 * 2026-01-31, 31/01/2026, 1/31/2026, 31.1.26 → YYYY-MM-DD, or "" when it isn't a date. Dots mean day first; with slashes or dashes a
 * number above 12 says which one is the day, and a date that could be either follows `dayFirst`.
 */
export function parseDate(s: string, dayFirst = true): string {
  const t = s.trim();
  if (isIsoDate(t)) return t;
  const m = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})$/.exec(t);
  if (!m) return "";
  const [x, y] = [+m[1]!, +m[3]!],
    year = m[4]!.length === 2 ? 2000 + +m[4]! : +m[4]!,
    swap = m[2] !== "." && x <= 12 && (y > 12 || !dayFirst),
    [day, month] = swap ? [y, x] : [x, y];
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : "";
}

/**
 * Rows pasted from a spreadsheet (tab- or comma-separated; a header row is skipped): date, account, debit, credit, memo. Rows with the
 * same date and memo form one entry (a blank memo groups by date alone). `resolve` turns the account cell (a name or "type:slug") into
 * a ledger account id, or "" when it knows none. Nothing is saved here: the caller shows the preview, the errors and the rejects.
 */
export function pasteEntries(text: string, resolve: (cell: string) => string, ctx: JournalCtx & { dayFirst?: boolean } = {}): PasteDraft {
  const raw = text.split(/\r?\n/).filter((l) => l.trim());
  const rows: PasteRow[] = [],
    errors: PasteError[] = [];
  raw.forEach((line, i) => {
    if (i === 0 && HEADER.test(line)) return;
    const row = i + 1,
      cells = line.includes("\t") ? line.split("\t") : splitCsv(line);
    if (cells.length < 4) return void errors.push({ row, problem: "columns" });
    const [d, a, dr, cr, ...rest] = cells,
      date = parseDate(d!, ctx.dayFirst),
      account = resolve(a!.trim()),
      debit = parseMoney(dr ?? ""),
      credit = parseMoney(cr ?? "");
    if (!date) return void errors.push({ row, problem: "date" });
    if (!account) return void errors.push({ row, problem: "account" });
    if (Number.isNaN(debit) || Number.isNaN(credit) || (!debit && !credit)) return void errors.push({ row, problem: "amount" });
    if (debit && credit) return void errors.push({ row, problem: "both" });
    rows.push({ row, date, account, debit, credit, memo: rest.join(" ").trim() });
  });
  const groups = new Map<string, PasteRow[]>();
  for (const r of rows) {
    const k = `${r.date}\u0000${r.memo}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const entries: PasteDraft["entries"] = [],
    rejected: PasteDraft["rejected"] = [];
  for (const g of groups.values()) {
    const { date, memo } = g[0]!,
      lines = g.map((r) => ({ account: r.account, debit: r.debit, credit: r.credit })),
      problem = journalProblem({ date, lines }, ctx);
    if (problem) rejected.push({ date, memo, problem, rows: g.map((r) => r.row) });
    else entries.push({ date, memo, lines });
  }
  return { entries, errors, rejected, rows };
}

/** One comma-separated line, with "quoted, cells". */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "",
    q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"', i++);
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") (out.push(cur), (cur = ""));
    else cur += ch;
  }
  return [...out, cur];
}

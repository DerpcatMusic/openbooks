// Statements as spreadsheets: the Reports page's lines, ledger and aging as sheets for core's XLSX writer (packages/core xlsx.ts).
// Money cells are real numbers with a number format (privacy mode is for the screen only, like the CSV export); section heads are bold on a
// grey band, lines indent, subtotals have a line above and totals a double line below.
import { xlsx, XLSX_TYPE, type AgingReport, type Cell, type Sheet } from "@openbooks/core";
import type { Txn } from "@openbooks/schema";
import type { Line } from "./statements.ts";

type Tr = (key: string) => string;
const r2 = (n: number) => Math.round(n * 100) / 100 + 0;
const money = (n: number, extra: Cell["s"] = {}): Cell => ({ v: r2(n), s: { fmt: "money", ...extra } });
const head = (labels: readonly string[]): Cell[] => labels.map((v, i) => ({ v, s: { bold: true, fill: true, ...(i ? { align: "right" as const } : {}) } }));

/** The lines above the table: who and what, and the basis it is on. */
export const titleRows = (entity: string, title: string, sub: string): Cell[][] => [[{ v: `${entity} — ${title}`, s: { bold: true } }], [{ v: sub }], []];

/** A statement (P&L, balance sheet, cash flow, cash-flow analysis): header, then one row per line. */
export function statementSheet(
  name: string,
  top: readonly (readonly Cell[])[],
  first: string,
  cols: readonly string[],
  lines: readonly Line[],
  rtl = false,
): Sheet {
  const n = cols.length;
  const rows: (readonly (Cell | string | number | null)[])[] = [...top, head([first, ...cols])];
  for (const l of lines) {
    if (l.kind === "head") {
      rows.push([{ v: l.label, s: { bold: true, fill: true } }, ...Array.from({ length: n }, (): Cell => ({ s: { fill: true } }))]);
      continue;
    }
    const bold = l.kind === "sum" || l.kind === "total",
      border = l.kind === "total" ? ("total" as const) : l.kind === "sum" ? ("top" as const) : undefined;
    rows.push([
      { v: l.label, s: { ...(bold ? { bold } : { indent: 1 }), ...(border ? { border } : {}) } },
      ...Array.from({ length: n }, (_, i) => money(l.v[i] ?? 0, { ...(bold ? { bold } : {}), ...(border ? { border } : {}) })),
    ]);
  }
  return {
    name,
    rows,
    widths: [Math.min(48, Math.max(24, ...lines.map((l) => [...l.label].length + 4))), ...cols.map(() => 16)],
    freeze: { rows: top.length + 1, cols: 1 },
    rtl,
  };
}

/** General ledger: a band per ledger account (with its total), then its transactions with the running balance. */
export function ledgerSheet(
  name: string,
  top: readonly (readonly Cell[])[],
  groups: readonly {
    label: string;
    value: number;
    rows: readonly { tx: Pick<Txn, "date" | "desc" | "account" | "amount"> & { who?: string }; run: number }[];
  }[],
  h: { date: string; description: string; account: string; ledger: string; amount: string; balance: string },
  rtl = false,
): Sheet {
  const rows: (readonly (Cell | string | number | null)[])[] = [
    ...top,
    head([h.date, h.description, h.account, h.ledger, h.amount, h.balance]).map((c, i) => (i < 4 ? { ...c, s: { ...c.s, align: "left" as const } } : c)),
  ];
  for (const g of groups) {
    rows.push([
      { v: g.label, s: { bold: true, fill: true } },
      { s: { fill: true } },
      { s: { fill: true } },
      { s: { fill: true } },
      money(g.value, { bold: true, fill: true }),
      { s: { fill: true } },
    ]);
    for (const { tx, run } of g.rows)
      rows.push([{ v: tx.date, s: { fmt: "date", indent: 1 } }, tx.who ? `${tx.who} · bit` : tx.desc, tx.account, g.label, money(tx.amount), money(run)]);
  }
  return { name, rows, widths: [14, 40, 22, 28, 16, 16], freeze: { rows: top.length + 1 }, rtl };
}

/** Aging by party (a column per bucket, Overdue, Total, totals and percent rows) or by document. */
export function agingSheet(
  name: string,
  top: readonly (readonly Cell[])[],
  r: AgingReport,
  view: "party" | "source",
  t: Tr,
  bucket: (i: number) => string,
  label: { party: string; ref: string; none: string },
  rtl = false,
): Sheet {
  if (view === "source") {
    const rows: (readonly (Cell | string | number | null)[])[] = [
      ...top,
      head([label.party, label.ref, t("common.date"), t("bills.col.dueDate"), t("aging.pastDue"), t("aging.bucket"), t("aging.outstanding")]),
    ];
    for (const s of r.sources)
      rows.push([
        s.name || label.none,
        s.ref,
        { v: s.date, s: { fmt: "date" } },
        { v: s.due ?? "", s: { fmt: "date" } },
        { v: Math.max(0, s.days), s: { fmt: "int" } },
        bucket(s.bucket),
        money(s.outstanding),
      ]);
    return { name, rows, widths: [28, 14, 13, 13, 12, 16, 16], freeze: { rows: top.length + 1 }, rtl };
  }
  const rows: (readonly (Cell | string | number | null)[])[] = [
    ...top,
    head([label.party, ...r.buckets.map((_, i) => bucket(i)), t("aging.overdue"), t("common.total")]),
  ];
  for (const p of r.parties) rows.push([p.name || label.none, ...p.buckets.map((n) => money(n)), money(p.overdue), money(p.total, { bold: true })]);
  const tot = { bold: true, border: "top" as const };
  rows.push([{ v: t("common.total"), s: tot }, ...r.totals.buckets.map((n) => money(n, tot)), money(r.totals.overdue, tot), money(r.totals.total, tot)]);
  if (r.totals.percents)
    rows.push([t("aging.pct"), ...r.totals.percents.map((x): Cell => ({ v: x / 100, s: { fmt: "pct" } })), {}, { v: 1, s: { fmt: "pct" } }]);
  return { name, rows, widths: [28, ...r.buckets.map(() => 14), 14, 14], freeze: { rows: top.length + 1, cols: 1 }, rtl };
}

/** Build the workbook and hand it to the browser as a download (name without the extension). */
export async function saveXlsx(name: string, sheets: readonly Sheet[]) {
  const bytes = await xlsx(sheets, { title: name });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: XLSX_TYPE }));
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, "-")}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

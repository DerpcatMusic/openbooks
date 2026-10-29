// PCN874 (online VAT report) file: header "O", one record per invoice, closing "X". Fixed width, ASCII.
// Layout: the Tax Authority's "Clarifications regarding the structure of the PCN874 invoices file", Appendix A (header 131 chars, transaction
// 60 chars, closing 10 chars) and Appendix C (which values each document type takes), English version on the gov.il software-houses page,
// read 2026-10-29. Not verified against the Tax Authority's online simulator (needs a login): run the file through it before uploading.
//  - amounts are whole shekels; a sign (+/-) precedes each amount field; zero amounts carry "+".
//  - the header month is yyyymm of the LAST month of the reporting period (a bimonthly filer reports one file); creation date is yyyymmdd.
//  - lines end with CRLF; the file is named PCN874.TXT.
//  - the last transaction field ("For future allocation", zeros in the spec) carries the invoice allocation number when there is one:
//    the spec predates allocation numbers, so that placement is an assumption.
import type { VatLine, VatReport } from "./vat.ts";

const num = (n: number, w: number) => {
  const s = String(Math.abs(Math.round(n)));
  if (s.length > w) throw new Error(`PCN874: ${n} does not fit ${w} digits`);
  return s.padStart(w, "0");
};
const signed = (n: number, w: number) => (n < 0 ? "-" : "+") + num(n, w);
const alnum = (s: string, w: number) => s.slice(0, w).padEnd(w, "0");

export interface Pcn874Input {
  /** The business's licensed-dealer number (9 digits). */
  vatId: string;
  report: Pick<VatReport, "period" | "lines" | "totals">;
  /** yyyy-mm-dd the file is created. */
  created: string;
}
export const PCN874_FILENAME = "PCN874.TXT";
export const HEADER_LENGTH = 131;
export const RECORD_LENGTH = 60;
export const CLOSING_LENGTH = 10;

const ymd = (d: string) => d.replaceAll("-", "");
export function pcn874Header(vatId: string, report: Pcn874Input["report"], created: string): string {
  const t = report.totals,
    month = report.period.to.slice(0, 7).replace("-", "");
  return [
    "O",
    num(+vatId, 9),
    month,
    "1",
    ymd(created),
    signed(t.taxableSales, 11),
    signed(t.outputVat, 9),
    "+" + num(0, 11), // sales taxed at another rate: not used yet
    "+" + num(0, 9),
    num(t.salesRecords, 9),
    signed(t.zeroExempt, 11),
    signed(t.otherInputsVat, 9),
    signed(t.equipmentVat, 9),
    num(t.inputRecords, 9),
    signed(t.payable, 11),
  ].join("");
}
export function pcn874Record(l: VatLine): string {
  // the sign applies to the invoice: a credit has a negative total and VAT written as a positive number
  const neg = l.net < 0 || (l.net === 0 && l.vat < 0);
  return [
    l.type,
    num(+l.party, 9),
    ymd(l.date),
    alnum(l.group, 4),
    num(+l.ref || 0, 9),
    num(l.vat, 9),
    neg ? "-" : "+",
    num(l.net, 10),
    num(+l.alloc || 0, 9),
  ].join("");
}
/** The whole file as text (CRLF separated, with a final CRLF). */
export function pcn874(inp: Pcn874Input): string {
  if (!/^\d{1,9}$/.test(inp.vatId)) throw new Error("PCN874: the licensed-dealer number must be up to 9 digits");
  const out = [pcn874Header(inp.vatId, inp.report, inp.created), ...inp.report.lines.map(pcn874Record), "X" + num(+inp.vatId, 9)];
  return out.join("\r\n") + "\r\n";
}

export interface Pcn874Parsed {
  header: { vatId: string; month: string; type: string; created: string } & Pcn874Input["report"]["totals"];
  records: { type: string; party: string; date: string; group: string; ref: string; vat: number; net: number; alloc: string }[];
  closingId: string;
}
const sn = (s: string) => (s[0] === "-" ? -1 : 1) * +s.slice(1);
/** Reads a file back (the golden tests and the checker use it). Throws on a wrong width. */
export function parsePcn874(text: string): Pcn874Parsed {
  const rows = text.split(/\r?\n/).filter((x) => x.length);
  const h = rows[0]!,
    x = rows.at(-1)!;
  if (h.length !== HEADER_LENGTH || h[0] !== "O") throw new Error("PCN874: bad header");
  if (x.length !== CLOSING_LENGTH || x[0] !== "X") throw new Error("PCN874: bad closing record");
  let p = 1;
  const take = (n: number) => h.slice(p, (p += n));
  const vatId = take(9),
    month = take(6),
    type = take(1),
    created = take(8);
  const taxableSales = sn(take(12)),
    outputVat = sn(take(10));
  take(12 + 10); // sales at another rate: unused
  const header = {
    vatId,
    month,
    type,
    created,
    taxableSales,
    outputVat,
    salesRecords: +take(9),
    zeroExempt: sn(take(12)),
    otherInputsVat: sn(take(10)),
    equipmentVat: sn(take(10)),
    inputRecords: +take(9),
    payable: sn(take(12)),
  };
  const records = rows.slice(1, -1).map((r) => {
    if (r.length !== RECORD_LENGTH) throw new Error(`PCN874: record of ${r.length} chars`);
    return {
      type: r[0]!,
      party: r.slice(1, 10),
      date: r.slice(10, 18),
      group: r.slice(18, 22),
      ref: r.slice(22, 31),
      vat: +r.slice(31, 40),
      net: sn(r.slice(40, 51)),
      alloc: r.slice(51, 60),
    };
  });
  return { header, records, closingId: x.slice(1) };
}

/** A consistency problem: a code (the UI translates `vat.check.<code>`) and the header figure `a` against what the records add up to, `b`. */
export interface Pcn874Problem {
  code: "vatSales" | "salesRecords" | "inputRecords" | "inputVat" | "payable" | "closingId";
  a?: number;
  b?: number;
}
/** Consistency the Tax Authority's simulator checks: header totals equal the records' sums, counts match. Returns problems (empty = consistent). */
export function checkPcn874(text: string): Pcn874Problem[] {
  const f = parsePcn874(text),
    h = f.header,
    bad: Pcn874Problem[] = [];
  const sales = f.records.filter((r) => "SLMYI".includes(r.type)),
    ins = f.records.filter((r) => !"SLMYI".includes(r.type));
  const signedVat = (r: (typeof f.records)[number]) => (r.net < 0 ? -r.vat : r.vat);
  const vatSales = sales.reduce((a, r) => a + signedVat(r), 0);
  if (vatSales !== h.outputVat) bad.push({ code: "vatSales", a: h.outputVat, b: vatSales });
  if (sales.length !== h.salesRecords) bad.push({ code: "salesRecords", a: h.salesRecords, b: sales.length });
  if (ins.length !== h.inputRecords) bad.push({ code: "inputRecords", a: h.inputRecords, b: ins.length });
  const inVat = ins.reduce((a, r) => a + signedVat(r), 0);
  if (inVat !== h.otherInputsVat + h.equipmentVat) bad.push({ code: "inputVat", a: h.otherInputsVat + h.equipmentVat, b: inVat });
  if (h.payable !== h.outputVat - h.otherInputsVat - h.equipmentVat)
    bad.push({ code: "payable", a: h.payable, b: h.outputVat - h.otherInputsVat - h.equipmentVat });
  if (f.closingId !== h.vatId) bad.push({ code: "closingId" });
  return bad;
}

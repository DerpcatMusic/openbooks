// Uniform-structure export (מבנה אחיד, OPENFRMT v1.31): INI.TXT + BKMVDATA.TXT for a date range, as the Tax Authority's software-registration
// rules and the "Directives for producing files in uniform structure" define them. Pure: books rows in, bytes out.
//
// Sources (read 2026-10-29): record layouts = the Tax Authority's simulator tables for version 1.31 (misim.gov.il TmbakmmsmlNew frmShowTables cur=4,
// stored in form/openfrmt-1.31.json); corrections document "תיקונים למסמך קבצים במבנה אחיד - מעבר לגרסה 1.31" (May 2009): folder
// OPENFRMT\<VAT no. without the check digit>.<yy>\MMDDhhmm, a random 15-digit primary id in INI field 1004, A100 field 1103 and Z900 field 1153,
// A100 first in BKMVDATA; the Tax Authority's presentation of 01.08.2019 (record order A100 ... Z900, document types 100/200/210/300/305/320/330).
// NOT VERIFIED (the directives PDF is behind a login): the values of 1011/1013/1014/1029, the receipt and payment-type codes, D110 transaction
// type, record ordering inside the file and CRLF line ends. Run the output through the Tax Authority's simulator before relying on it.
// This is NOT a registered program: OpenBooks has no software registration number (field 1006 is zeros). Registration is a separate process.
import layout from "../form/openfrmt-1.31.json";
import { zip, type ZipFile } from "@openbooks/core";

type Rec = { length: number; fields: [number, "Str" | "Num", number, number, string][] };
const L = layout.records as unknown as Record<string, Rec>;

/** Fields written as signed amounts X9(n)v<dec>: id → decimals. Every other Num field is a zero-padded integer. */
const DEC: Record<number, number> = {
  1217: 2, 1219: 2, 1220: 2, 1221: 2, 1222: 2, 1223: 2, 1224: 2, 1264: 4, 1265: 2, 1266: 2, 1267: 2, 1268: 2, 1312: 2,
  1368: 2, 1369: 2, 1370: 4, 1414: 2, 1415: 2, 1416: 2, 1422: 2, 1460: 4, 1461: 4, 1462: 4, 1463: 2, 1464: 2,
};
/** VAT rate and similar unsigned percentages (9(2)v99). */
const UNSIGNED: ReadonlySet<number> = new Set([1268]);

export type Value = string | number | undefined;
/** One fixed-width record of `code` ("A100", "C100"...) with the given field values by field id. Strings are cut or space-padded, numbers zero-padded. */
export function record(code: string, v: Readonly<Record<number, Value>>): string {
  const rec = L[code];
  if (!rec) throw new Error(`OPENFRMT: unknown record ${code}`);
  let out = "";
  for (const [id, type, start, len] of rec.fields) {
    if (out.length !== start) throw new Error(`OPENFRMT: ${code} field ${id} starts at ${out.length}, layout says ${start}`);
    const x = start === 0 ? (v[id] ?? code) : v[id]; // the first field is the record code
    if (type === "Str") out += String(x ?? "").replace(/[\r\n]+/g, " ").slice(0, len).padEnd(len, " ");
    else if (id in DEC) {
      const n = typeof x === "number" ? x : +(x ?? 0) || 0,
        digits = String(Math.round(Math.abs(n) * 10 ** DEC[id]!)).padStart(len - (UNSIGNED.has(id) ? 0 : 1), "0");
      if (digits.length > len - (UNSIGNED.has(id) ? 0 : 1)) throw new Error(`OPENFRMT: ${code} field ${id}: ${n} too long`);
      out += (UNSIGNED.has(id) ? "" : n < 0 ? "-" : "+") + digits;
    } else {
      const s = String(Math.abs(Math.trunc(+(x ?? 0) || 0))).padStart(len, "0");
      if (s.length > len) throw new Error(`OPENFRMT: ${code} field ${id}: ${x} too long`);
      out += s;
    }
  }
  if (out.length !== rec.length) throw new Error(`OPENFRMT: ${code} is ${out.length} long, expected ${rec.length}`);
  return out;
}
/** Reads a record back to { field id → trimmed text }. */
export function readRecord(code: string, line: string): Record<number, string> {
  const rec = L[code]!;
  if (line.length !== rec.length) throw new Error(`OPENFRMT: ${code} line of ${line.length} chars, expected ${rec.length}`);
  return Object.fromEntries(rec.fields.map(([id, , start, len]) => [id, line.slice(start, start + len).trimEnd()]));
}

/** ISO-8859-8 (logical Hebrew order): ASCII as is, alef..tav = 0xE0..0xFA, anything else "?". */
export function iso88598(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i] = c < 0x80 ? c : c >= 0x5d0 && c <= 0x5ea ? c - 0x5d0 + 0xe0 : c === 0xa0 ? 0xa0 : c === 0x200e ? 0xfd : c === 0x200f ? 0xfe : 0x3f;
  }
  return out;
}

// ---------- inputs ----------
export interface UniformDocLine {
  desc: string;
  qty: number;
  /** Before VAT. */
  price: number;
}
export interface UniformDoc {
  id: string;
  /** 305 tax invoice, 300 transaction invoice (bill), 400 receipt. */
  type: 300 | 305 | 320 | 330 | 400;
  number: string;
  date: string;
  customerKey?: string;
  customerName: string;
  customerAddress?: string;
  customerVatId?: string;
  lines: readonly UniformDocLine[];
  /** VAT rate on the document (0.18). */
  vat: number;
  currency?: string;
  /** Receipts: how it was paid (cash | cheque | card | transfer | other). */
  method?: string;
  /** The base document (a receipt for an invoice). */
  base?: { type: number; number: string };
  cancelled?: boolean;
}
export interface UniformRow {
  id: string;
  date: string;
  /** Positive: money in (the account is debited, the category credited). */
  amount: number;
  desc: string;
  /** The bank or "Journal" account of the row. */
  account: string;
  /** Ledger account "type:name". */
  category: string;
  source?: string;
}
export interface UniformInput {
  business: {
    vatId: string;
    name: string;
    street?: string;
    houseNo?: string;
    city?: string;
    zip?: string;
    /** Company registry number (Ltd). */
    companyId?: string;
    /** Withholding-tax file number. */
    withholdingFile?: string;
  };
  taxYear: number;
  from: string;
  to: string;
  /** When the files are produced (local time). */
  generated: { date: string; time: string };
  /** 15 random digits, different for every production. */
  primaryId: string;
  software?: { name: string; version: string };
  /** The books' currency, ISO 4217. */
  currency?: string;
  docs: readonly UniformDoc[];
  rows: readonly UniformRow[];
  /** Human name of a ledger account, default the account itself. */
  accountName?: (account: string) => string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: string) => +d.replaceAll("-", "");
const digits = (s: string | undefined) => +(s ?? "").replace(/\D/g, "") || 0;
const PAY: Record<string, number> = { cash: 1, cheque: 2, check: 2, card: 3, transfer: 4, other: 9 };

export interface UniformFiles {
  /** OPENFRMT/<8 digits>.<yy>/<MMDDhhmm> */
  dir: string;
  ini: string;
  data: string;
  readme: string;
  counts: Record<string, number>;
  /** Problems the exporter noticed, as a code plus the value that goes in the sentence (the UI writes it in its language; see noteText for English). */
  notes: UniformNote[];
}
export interface UniformNote {
  code: "unbalanced" | "noCustomerName";
  /** unbalanced: how many entries; noCustomerName: the document's number. */
  n?: number;
  ref?: string;
}
/** A note in English (the MCP tools and logs; the app translates `vat`-style from the code). */
export const noteText = (n: UniformNote) => (n.code === "unbalanced" ? `${n.n} journal entries do not balance` : `document ${n.ref} has no customer name`);

/** Builds INI.TXT (A000 + one A001 line per record type) and BKMVDATA.TXT (A100, B100, B110, C100, D110, D120, Z900). */
export function uniformFiles(inp: UniformInput): UniformFiles {
  const b = inp.business,
    biz = digits(b.vatId),
    cur = inp.currency ?? "ILS",
    notes: UniformNote[] = [],
    lines: { code: string; text: string }[] = [];
  let n = 0;
  /** Appends a record; its own sequence number ("record number in file", always at 4..13) is filled in here. */
  const add = (code: string, f: Record<number, Value>) => {
    n++;
    lines.push({ code, text: setSeq(code, record(code, f), n) });
  };

  // ---- ledger movements (B100) and accounts (B110) ----
  const rows = inp.rows.filter((r) => r.date >= inp.from && r.date <= inp.to).sort((a, c) => a.date.localeCompare(c.date) || a.id.localeCompare(c.id));
  const key = new Map<string, number>(); // account → account key
  const keyOf = (a: string, bank: boolean) => {
    if (!key.has(a)) key.set(a, (bank ? 100 : 1000) + key.size + 1);
    return key.get(a)!;
  };
  const tot = new Map<string, { debit: number; credit: number; bank: boolean }>();
  const bump = (a: string, debit: number, credit: number, bank: boolean) => {
    const t = tot.get(a) ?? { debit: 0, credit: 0, bank };
    t.debit += debit;
    t.credit += credit;
    tot.set(a, t);
  };
  const movements: { no: number; date: string; ref: string; desc: string; acct: string; contra: string; debit: boolean; amount: number; bank: boolean }[] = [];
  let no = 0;
  const entry = new Map<string, number>(); // journal entry id → movement number
  for (const r of rows) {
    const jr = r.account === "Journal";
    if (jr) {
      const eid = r.id.replace(/-\d+$/, "");
      if (!entry.has(eid)) entry.set(eid, ++no);
      const credit = r.amount > 0;
      movements.push({ no: entry.get(eid)!, date: r.date, ref: eid, desc: r.desc, acct: r.category, contra: "", debit: !credit, amount: Math.abs(r.amount), bank: false });
    } else {
      const m = ++no,
        inflow = r.amount > 0;
      movements.push({ no: m, date: r.date, ref: r.id, desc: r.desc, acct: r.account, contra: r.category, debit: inflow, amount: Math.abs(r.amount), bank: true });
      movements.push({ no: m, date: r.date, ref: r.id, desc: r.desc, acct: r.category, contra: r.account, debit: !inflow, amount: Math.abs(r.amount), bank: false });
    }
  }
  for (const m of movements) {
    keyOf(m.acct, m.bank);
    if (m.contra) keyOf(m.contra, !m.bank);
    bump(m.acct, m.debit ? m.amount : 0, m.debit ? 0 : m.amount, m.bank);
  }
  // each movement balances: group sums per number
  const unbalanced = new Map<number, number>();
  for (const m of movements) unbalanced.set(m.no, r2((unbalanced.get(m.no) ?? 0) + (m.debit ? m.amount : -m.amount)));
  const bad = [...unbalanced].filter(([, v]) => v !== 0).length;
  if (bad) notes.push({ code: "unbalanced", n: bad });

  const lineNo = new Map<number, number>();
  add("A100", { 1102: biz, 1103: inp.primaryId, 1104: "&OF1.31&" });
  for (const m of movements) {
    {
      const ln = (lineNo.get(m.no) ?? 0) + 1;
      lineNo.set(m.no, ln);
      add("B100", {
        1352: biz,
        1353: m.no,
        1354: ln,
        1355: 1,
        1356: "OpenBooks",
        1357: m.ref.slice(-20),
        1358: 0,
        1361: m.desc,
        1362: ymd(m.date),
        1363: ymd(m.date),
        1364: String(keyOf(m.acct, m.bank)),
        1365: m.contra ? String(key.get(m.contra) ?? "") : "",
        1366: m.debit ? 1 : 2,
        1367: "",
        1368: m.amount,
        1375: ymd(m.date),
        1376: "OpenBooks",
      });
    }
  }
  // ---- accounts (B110) ----
  for (const [a, t] of tot)
    add("B110", {
      1402: biz,
      1403: String(key.get(a)),
      1404: inp.accountName?.(a) ?? a,
      1405: t.bank ? "BANK" : a.split(":")[0]!.toUpperCase().slice(0, 15),
      1406: t.bank ? "Bank account" : a.split(":")[0],
      1414: 0,
      1415: r2(t.debit),
      1416: r2(t.credit),
      1417: 0,
    });
  // ---- documents ----
  const docs = inp.docs.filter((d) => d.date >= inp.from && d.date <= inp.to).sort((a, c) => a.date.localeCompare(c.date) || a.number.localeCompare(c.number));
  let link = 0;
  for (const d of docs) {
    {
      const k = ++link,
        net = r2(d.lines.reduce((a, x) => a + x.qty * x.price, 0)),
        vat = r2(net * d.vat);
      if (!d.customerName) notes.push({ code: "noCustomerName", ref: d.number });
      add("C100", {
        1202: biz,
        1203: d.type,
        1204: d.number,
        1205: ymd(d.date),
        1206: 0,
        1207: d.customerName,
        1208: d.customerAddress ?? "",
        1215: digits(d.customerVatId),
        1216: ymd(d.date),
        1217: 0,
        1218: d.currency && d.currency !== cur ? d.currency : "",
        1219: net,
        1220: 0,
        1221: net,
        1222: vat,
        1223: r2(net + vat),
        1224: 0,
        1225: d.customerKey ?? "",
        1228: d.cancelled ? "1" : "0",
        1230: ymd(d.date),
        1233: "OpenBooks",
        1234: k,
      });
      d.lines.forEach((x, i) =>
        add("D110", {
          1252: biz,
          1253: d.type,
          1254: d.number,
          1255: i + 1,
          1256: d.base?.type ?? 0,
          1257: d.base?.number ?? "",
          1258: 0,
          1260: x.desc,
          1264: x.qty,
          1265: x.price,
          1266: 0,
          1267: r2(x.qty * x.price),
          1268: d.vat * 100,
          1272: ymd(d.date),
          1273: k,
        }),
      );
      if (d.type === 400)
        add("D120", {
          1302: biz,
          1303: d.type,
          1304: d.number,
          1305: 1,
          1306: PAY[d.method ?? "other"] ?? 9,
          1311: ymd(d.date),
          1312: r2(net + vat),
          1322: ymd(d.date),
          1323: k,
        });
    }
  }

  const total = lines.length + 1;
  const z = setSeq("Z900", record("Z900", { 1152: biz, 1153: inp.primaryId, 1154: "&OF1.31&", 1155: total }), total);
  const data = [...lines.map((l) => l.text), z];
  const counts: Record<string, number> = {};
  for (const l of lines) counts[l.code] = (counts[l.code] ?? 0) + 1;
  counts.Z900 = 1;

  const name = inp.software?.name ?? "OpenBooks",
    version = inp.software?.version ?? "1";
  const a000 = record("A000", {
    1001: "",
    1002: total,
    1003: biz,
    1004: inp.primaryId,
    1005: "&OF1.31&",
    1006: 0, // software registration number: OpenBooks is not registered
    1007: name,
    1008: version,
    1009: 0,
    1010: "OpenBooks",
    1011: 1, // single-year software (unverified code)
    1012: "",
    1013: 2, // double-entry (unverified code)
    1014: bad ? 0 : 1,
    1015: digits(b.companyId),
    1016: digits(b.withholdingFile),
    1018: b.name,
    1019: b.street ?? "",
    1020: b.houseNo ?? "",
    1021: b.city ?? "",
    1022: b.zip ?? "",
    1023: inp.taxYear,
    1024: ymd(inp.from),
    1025: ymd(inp.to),
    1026: ymd(inp.generated.date),
    1027: +inp.generated.time.replace(":", ""),
    1028: 0, // Hebrew
    1029: 1, // ISO-8859-8 (unverified code)
    1030: "",
    1032: cur,
    1034: 0,
  });
  const order = ["A100", "B100", "B110", "C100", "D110", "D120", "M100", "Z900"].filter((c) => counts[c]);
  const ini = [a000, ...order.map((c) => record("A001", { 1050: c, 1051: counts[c] }))];
  const g = inp.generated.date.replaceAll("-", "");
  const dir = `OPENFRMT/${String(biz).padStart(9, "0").slice(0, 8)}.${g.slice(2, 4)}/${g.slice(4, 8)}${inp.generated.time.replace(":", "")}`;
  // README.TXT travels with the files to an accountant or the Authority: Hebrew and English side by side (ISO-8859-8 holds both)
  const readme = [
    `OpenBooks uniform-structure export (OPENFRMT 1.31)  |  ייצוא מבנה אחיד של OpenBooks (OPENFRMT 1.31)`,
    `${b.name}  VAT/company no. ${b.vatId}  |  מספר עוסק/חברה ${b.vatId}`,
    `Data range ${inp.from} to ${inp.to}, tax year ${inp.taxYear}  |  טווח נתונים ${inp.from} עד ${inp.to}, שנת מס ${inp.taxYear}`,
    `Produced ${inp.generated.date} ${inp.generated.time}  |  הופק ${inp.generated.date} ${inp.generated.time}`,
    ``,
    ...order.map((c) => `${c}  ${counts[c]}`),
    ``,
    `OpenBooks is not a registered program of the Israel Tax Authority (software registration number 0).`,
    `OpenBooks אינה תוכנה רשומה ברשות המסים (מספר רישום תוכנה 0).`,
  ];
  return { dir, ini: ini.join("\r\n") + "\r\n", data: data.join("\r\n") + "\r\n", readme: readme.join("\r\n") + "\r\n", counts: { ...counts, A100: 1 }, notes };
}

/** Writes the record's own sequence number (the "record number in file" field) into a built line. */
function setSeq(code: string, line: string, seq: number): string {
  const f = L[code]!.fields.find((x) => x[2] === 4 && x[3] === 9);
  if (!f) return line;
  return line.slice(0, 4) + String(seq).padStart(9, "0") + line.slice(13);
}

/** The three files in a zip under OPENFRMT/<id>.<yy>/<MMDDhhmm>/, Hebrew text in ISO-8859-8. */
export function uniformZip(f: UniformFiles, date = new Date(0)): Uint8Array {
  const files: ZipFile[] = [
    { name: `${f.dir}/INI.TXT`, data: iso88598(f.ini), date },
    { name: `${f.dir}/BKMVDATA.TXT`, data: iso88598(f.data), date },
    { name: `${f.dir}/README.TXT`, data: iso88598(f.readme), date },
  ];
  return zip(files);
}

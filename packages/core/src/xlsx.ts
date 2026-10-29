// A minimal XLSX writer (OOXML SpreadsheetML in a zip), no dependency: sheets of text, numbers and dates with number formats, bold, indent,
// borders and fills, column widths, frozen header rows and right-to-left sheets. Strings are inline (no shared-string table). The zip uses
// deflate through the platform's CompressionStream (browser, Bun, Node) and stores the files uncompressed where it is missing.
// Statements, ledgers and aging reports are built by the app into `Sheet`s (apps/web lib/reports/xlsx.ts); this file knows nothing of them.

import { isIsoDate } from "./journal.ts";

export type NumFmt = "money" | "int" | "pct" | "date";
/** What a cell looks like. Every field is optional; identical combinations share one style. */
export interface CellStyle {
  bold?: boolean;
  /** Indent steps (1 step is about 3 spaces). */
  indent?: number;
  fmt?: NumFmt;
  /** A thin line above (subtotals) or a thin line above and a double line below (grand totals). */
  border?: "top" | "total";
  /** A light grey background (section heads, column headers). */
  fill?: boolean;
  align?: "left" | "right" | "center";
  wrap?: boolean;
}
/** A string, a number, a date ("YYYY-MM-DD" with fmt "date"), or empty. */
export interface Cell {
  v?: string | number | null;
  s?: CellStyle;
}
export interface Sheet {
  /** At most 31 characters, none of []:*?/\ (cleaned, and made unique, by the writer). */
  name: string;
  rows: readonly (readonly (Cell | string | number | null | undefined)[])[];
  /** Column widths in characters. */
  widths?: readonly number[];
  /** Rows (from the top) and columns (from the start) kept in view when scrolling. */
  freeze?: { rows?: number; cols?: number };
  /** Right-to-left sheet (Hebrew): column A on the right. */
  rtl?: boolean;
}

// ---------- XML ----------
const esc = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "") // not allowed in XML 1.0
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** 0 -> A, 25 -> Z, 26 -> AA. */
export const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
/** Excel's date serial (days since 1899-12-30) for an ISO date; null when it is not one. */
export function dateSerial(iso: string): number | null {
  if (!isIsoDate(iso)) return null;
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000);
}

// ---------- styles: built from the combinations the sheets use ----------
const FMT_ID: Record<NumFmt, number> = { money: 164, int: 165, pct: 166, date: 167 };
const FMT_CODE: Record<NumFmt, string> = { money: "#,##0.00;[Red]-#,##0.00", int: "#,##0;[Red]-#,##0", pct: "0.0%", date: "yyyy-mm-dd" };

class Styles {
  private list: CellStyle[] = [{}];
  private index = new Map<string, number>([["{}", 0]]);
  /** The cellXfs index of a style (0 = plain). */
  id(s: CellStyle | undefined): number {
    if (!s) return 0;
    const clean = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== false && v !== 0)) as CellStyle;
    const key = JSON.stringify(Object.entries(clean).sort(([a], [b]) => (a < b ? -1 : 1)));
    if (key === "[]") return 0;
    let i = this.index.get(key);
    if (i === undefined) {
      i = this.list.push(clean) - 1;
      this.index.set(key, i);
    }
    return i;
  }
  xml(): string {
    const fonts = '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>';
    const fills = '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>';
    const line = (side: string, style?: string) => (style ? `<${side} style="${style}"><color auto="1"/></${side}>` : `<${side}/>`);
    const border = (top?: string, bottom?: string) => `<border><left/><right/>${line("top", top)}${line("bottom", bottom)}<diagonal/></border>`;
    const borders = `<borders count="3">${border()}${border("thin")}${border("thin", "double")}</borders>`;
    const numFmts = `<numFmts count="4">${(Object.keys(FMT_ID) as NumFmt[]).map((k) => `<numFmt numFmtId="${FMT_ID[k]}" formatCode="${esc(FMT_CODE[k])}"/>`).join("")}</numFmts>`;
    const xfs = this.list.map((s) => {
      const align = s.indent || s.align || s.wrap;
      const a = align ? `<alignment${s.align ? ` horizontal="${s.align}"` : s.indent ? ' horizontal="left"' : ""}${s.indent ? ` indent="${s.indent}"` : ""}${s.wrap ? ' wrapText="1" vertical="top"' : ""}/>` : "";
      return `<xf numFmtId="${s.fmt ? FMT_ID[s.fmt] : 0}" fontId="${s.bold ? 1 : 0}" fillId="${s.fill ? 2 : 0}" borderId="${s.border === "total" ? 2 : s.border === "top" ? 1 : 0}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${align ? ' applyAlignment="1">' + a + "</xf>" : "/>"}`;
    });
    return `${HEAD}<styleSheet ${NS}>${numFmts}${fonts}${fills}${borders}<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
}

function sheetXml(sh: Sheet, st: Styles): string {
  const rows = sh.rows.map((r, ri) => {
    const cells = r.flatMap((raw, ci) => {
      const c: Cell = raw !== null && typeof raw === "object" ? raw : { v: raw };
      let v = c.v;
      let s = c.s;
      if (s?.fmt === "date" && typeof v === "string") {
        const d = dateSerial(v);
        if (d !== null) v = d;
        else s = { ...s, fmt: undefined as never };
      }
      const ref = `${colName(ci)}${ri + 1}`,
        sid = st.id(s),
        a = sid ? ` s="${sid}"` : "";
      if (v === null || v === undefined || v === "") return sid ? [`<c r="${ref}"${a}/>`] : [];
      if (typeof v === "number") return Number.isFinite(v) ? [`<c r="${ref}"${a}><v>${Math.abs(v) < 5e-7 ? 0 : v}</v></c>`] : [];
      return [`<c r="${ref}"${a} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`];
    });
    return cells.length ? `<row r="${ri + 1}">${cells.join("")}</row>` : "";
  });
  const f = sh.freeze,
    fr = f?.rows ?? 0,
    fc = f?.cols ?? 0;
  const pane =
    fr || fc
      ? `<pane${fc ? ` xSplit="${fc}"` : ""}${fr ? ` ySplit="${fr}"` : ""} topLeftCell="${colName(fc)}${fr + 1}" activePane="${fr && fc ? "bottomRight" : fr ? "bottomLeft" : "topRight"}" state="frozen"/>`
      : "";
  const cols = sh.widths?.length ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(2, w)}" customWidth="1"/>`).join("")}</cols>` : "";
  return `${HEAD}<worksheet ${NS}><sheetViews><sheetView workbookViewId="0"${sh.rtl ? ' rightToLeft="1"' : ""}>${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows.join("")}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

/** Sheet names Excel accepts: no []:*?/\, at most 31 characters, unique ignoring case, not empty. */
export function sheetNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.map((n, i) => {
    const base = ([...n.replace(/[[\]:*?/\\]/g, " ").trim().replace(/^'+|'+$/g, "")].slice(0, 31).join("") || `Sheet${i + 1}`).trim();
    let name = base;
    for (let k = 2; seen.has(name.toLowerCase()); k++) name = `${[...base].slice(0, 31 - String(k).length - 1).join("")} ${k}`;
    seen.add(name.toLowerCase());
    return name;
  });
}

// ---------- zip ----------
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function deflate(b: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const out = new Blob([b as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(out).arrayBuffer());
  } catch {
    return null;
  }
}

/** A zip archive of the files, deflated when the platform can, else stored. Names are UTF-8; the timestamp is fixed so equal input gives equal bytes. */
export async function zip(files: readonly { name: string; data: Uint8Array }[], opts: { deflate?: boolean } = {}): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: DataView, o: number, n: number) => v.setUint16(o, n, true);
  const u32 = (v: DataView, o: number, n: number) => v.setUint32(o, n >>> 0, true);
  const DOS_TIME = 0,
    DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01 00:00
  for (const f of files) {
    const name = enc.encode(f.name),
      crc = crc32(f.data),
      packed = opts.deflate === false ? null : await deflate(f.data),
      method = packed && packed.length < f.data.length ? 8 : 0,
      body = method === 8 ? packed! : f.data;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20);
    u16(lv, 6, 0x0800); // UTF-8 names
    u16(lv, 8, method);
    u16(lv, 10, DOS_TIME);
    u16(lv, 12, DOS_DATE);
    u32(lv, 14, crc);
    u32(lv, 18, body.length);
    u32(lv, 22, f.data.length);
    u16(lv, 26, name.length);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, 20);
    u16(cv, 6, 20);
    u16(cv, 8, 0x0800);
    u16(cv, 10, method);
    u16(cv, 12, DOS_TIME);
    u16(cv, 14, DOS_DATE);
    u32(cv, 16, crc);
    u32(cv, 20, body.length);
    u32(cv, 24, f.data.length);
    u16(cv, 28, name.length);
    u32(cv, 42, offset);
    cen.set(name, 46);
    parts.push(local, body);
    central.push(cen);
    offset += local.length + body.length;
  }
  const size = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 8, files.length);
  u16(ev, 10, files.length);
  u32(ev, 12, size);
  u32(ev, 16, offset);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of all) (out.set(p, o), (o += p.length));
  return out;
}

/** The workbook as .xlsx bytes. */
export async function xlsx(sheets: readonly Sheet[], opts: { title?: string; deflate?: boolean } = {}): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const names = sheetNames(sheets.map((s) => s.name));
  const st = new Styles();
  const sheetFiles = sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s, st)) }));
  const rels = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const files = [
    {
      name: "[Content_Types].xml",
      data: enc.encode(
        `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: enc.encode(
        `${HEAD}<Relationships ${rels}><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
      ),
    },
    {
      name: "docProps/core.xml",
      data: enc.encode(
        `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(opts.title ?? "OpenBooks")}</dc:title><dc:creator>OpenBooks</dc:creator></cp:coreProperties>`,
      ),
    },
    {
      name: "xl/workbook.xml",
      data: enc.encode(
        `${HEAD}<workbook ${NS} xmlns:r="${R}"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc.encode(
        `${HEAD}<Relationships ${rels}>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="${R}/styles" Target="styles.xml"/></Relationships>`,
      ),
    },
    ...sheetFiles,
    { name: "xl/styles.xml", data: enc.encode(st.xml()) }, // last: the sheets above registered their styles
  ];
  return zip(files, opts);
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

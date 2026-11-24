// Tolerant parser for Israeli pension exports ("Har HaKesef" / הר הכסף, Mislaka / מסלקה פנסיונית) in XLSX or CSV,
// plus generic asset CSV exports (name, kind, provider, balance, currency, date).
// Zero external dependencies: reads both uncompressed and deflate-compressed XLSX zips via node:zlib.
import { inflateRawSync } from "node:zlib";
import { ASSET_KINDS, isIsoDate } from "@openbooks/core";
import type { AssetKind } from "@openbooks/schema";
import { csvDecode, csvTable, money } from "./csv.ts";

export interface ParsedAssetRow {
  kind: AssetKind;
  name: string;
  provider?: string;
  currency: string;
  date: string;
  value: number;
  accountNumber?: string;
}

export interface AssetImportResult {
  format: "har-hakesef" | "csv";
  rows: ParsedAssetRow[];
  skipped: number;
  reportDate?: string;
}

// ---------- minimal zero-dependency ZIP / XLSX reader ----------

/** Read a ZIP archive into path → UTF-8 text (supports stored method 0 and deflate method 8). */
function unzipEntries(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Locate End of Central Directory (PK\x05\x06) searching backwards from end
  let eocd = -1;
  const minPos = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return out;
  const cdSize = v.getUint32(eocd + 12, true);
  const cdOff = v.getUint32(eocd + 16, true);
  const td = new TextDecoder("utf-8");

  let pos = cdOff;
  const end = Math.min(bytes.length, cdOff + cdSize);
  while (pos + 46 <= end && v.getUint32(pos, true) === 0x02014b50) {
    const method = v.getUint16(pos + 10, true);
    const compSize = v.getUint32(pos + 20, true);
    const nameLen = v.getUint16(pos + 28, true);
    const extraLen = v.getUint16(pos + 30, true);
    const commentLen = v.getUint16(pos + 32, true);
    const localOff = v.getUint32(pos + 42, true);
    const name = td.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;

    if (localOff + 30 > bytes.length || v.getUint32(localOff, true) !== 0x04034b50) continue;
    const localNameLen = v.getUint16(localOff + 26, true);
    const localExtraLen = v.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > bytes.length) continue;
    const raw = bytes.subarray(dataStart, dataStart + compSize);
    if (method === 0) {
      out.set(name, td.decode(raw));
    } else if (method === 8) {
      try {
        out.set(name, td.decode(inflateRawSync(raw)));
      } catch {
        /* ignore corrupt entry */
      }
    }
  }
  return out;
}

const decodeXml = (s: string): string =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** Convert Excel column letters (A=0, B=1, ..., Z=25, AA=26) to 0-based index. */
function colIndexFromRef(ref: string): number {
  const letters = ref.replace(/\d+$/, "").toUpperCase();
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return Math.max(0, n - 1);
}

/** Convert Excel serial date (days since 1899-12-30) to YYYY-MM-DD. */
function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
  const iso = new Date(ms).toISOString().slice(0, 10);
  return isIsoDate(iso) ? iso : null;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    const body = m[1]!;
    let text = "";
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(body))) text += decodeXml(tm[1]!);
    out.push(text);
  }
  return out;
}

/** Identify cellXf style indexes in `xl/styles.xml` that format numbers as dates. */
function parseDateStyleIndexes(xml: string | undefined): Set<number> {
  const out = new Set<number>();
  if (!xml) return out;
  const customDateFmts = new Set<number>();
  const nfRe = /<numFmt\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = nfRe.exec(xml))) {
    const attrs = m[1]!;
    const idM = /numFmtId="(\d+)"/.exec(attrs);
    const codeM = /formatCode="([^"]*)"/.exec(attrs);
    if (!idM || !codeM) continue;
    const code = decodeXml(codeM[1]!)
      .replace(/"[^"]*"|\[[^\]]*\]/g, "")
      .toLowerCase();
    if (/[ymd]/.test(code) && !/[#0]/.test(code)) customDateFmts.add(Number(idM[1]));
  }
  const xfsMatch = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (!xfsMatch) return out;
  const xfRe = /<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g;
  let idx = 0;
  while ((m = xfRe.exec(xfsMatch[1]!))) {
    const idM = /numFmtId="(\d+)"/.exec(m[1]!);
    if (idM) {
      const id = Number(idM[1]);
      if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || customDateFmts.has(id)) out.add(idx);
    }
    idx++;
  }
  return out;
}

/** Read all worksheets in an XLSX archive as 2D string grids. */
export function readXlsxSheets(bytes: Uint8Array): string[][][] {
  const entries = unzipEntries(bytes);
  if (!entries.size) return [];

  const shared = parseSharedStrings(entries.get("xl/sharedStrings.xml"));
  const dateStyles = parseDateStyleIndexes(entries.get("xl/styles.xml"));

  // Collect worksheet paths in workbook order when possible, else sorted xl/worksheets/sheet*.xml
  const relTargets = new Map<string, string>();
  const relsXml = entries.get("xl/_rels/workbook.xml.rels");
  if (relsXml) {
    const relRe = /<Relationship\b([^>]*)\/?>/g;
    let rm: RegExpExecArray | null;
    while ((rm = relRe.exec(relsXml))) {
      const id = /Id="([^"]+)"/.exec(rm[1]!)?.[1];
      const target = /Target="([^"]+)"/.exec(rm[1]!)?.[1];
      if (id && target) {
        const clean = target.startsWith("/") ? target.slice(1) : target.startsWith("xl/") ? target : `xl/${target}`;
        relTargets.set(id, clean);
      }
    }
  }
  const sheetPaths: string[] = [];
  const wbXml = entries.get("xl/workbook.xml");
  if (wbXml) {
    const shRe = /<sheet\b([^>]*)\/?>/g;
    let sm: RegExpExecArray | null;
    while ((sm = shRe.exec(wbXml))) {
      const rid = /r:id="([^"]+)"/.exec(sm[1]!)?.[1];
      const target = rid ? relTargets.get(rid) : undefined;
      if (target && entries.has(target)) sheetPaths.push(target);
    }
  }
  if (!sheetPaths.length) {
    for (const k of [...entries.keys()].sort()) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(k)) sheetPaths.push(k);
    }
  }

  const sheets: string[][][] = [];
  for (const path of sheetPaths) {
    const xml = entries.get(path);
    if (!xml) continue;
    const rows: string[][] = [];
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(xml))) {
      const row: string[] = [];
      let nextCol = 0;
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(rm[1]!))) {
        const attrs = cm[1]!;
        const body = cm[2] ?? "";
        const ref = /\br="([A-Za-z]+\d+)"/.exec(attrs)?.[1];
        const colIdx = ref ? colIndexFromRef(ref) : nextCol;
        nextCol = colIdx + 1;
        while (row.length <= colIdx) row.push("");

        const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "";
        const styleId = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? "-1");
        let text = "";
        if (type === "inlineStr") {
          const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
          let tm: RegExpExecArray | null;
          while ((tm = tRe.exec(body))) text += decodeXml(tm[1]!);
        } else {
          const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
          const rawVal = vMatch ? decodeXml(vMatch[1]!) : "";
          if (type === "s") {
            text = shared[Number(rawVal)] ?? "";
          } else if (type === "str" || type === "e" || type === "b") {
            text = rawVal;
          } else if (rawVal && dateStyles.has(styleId)) {
            const serial = Number(rawVal);
            text = excelSerialToIso(serial) ?? rawVal;
          } else {
            text = rawVal;
          }
        }
        row[colIdx] = text.trim();
      }
      if (row.some((c) => c !== "")) rows.push(row);
    }
    if (rows.length) sheets.push(rows);
  }
  return sheets;
}

// ---------- column / value / date / kind matching ----------

const isZip = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

const cleanHeader = (s: string) =>
  s
    .replace(/[\u200e\u200f\u202a-\u202e\ufeff]/g, "")
    .replace(/["״”'׳`]/g, "")
    .replace(/[()[\]:_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const PRODUCT_TYPE_HEADERS = [
  "סוג מוצר",
  "סוג קופה",
  "סוג חשבון",
  "סוג נכס",
  "סוג תוכנית",
  "סוג תכנית",
  "סוג",
  "product type",
  "asset kind",
  "asset type",
  "kind",
  "type",
  "wrapper",
  "category",
];

const NAME_HEADERS = [
  "שם מוצר",
  "שם קופה",
  "שם הקופה",
  "שם תוכנית",
  "שם התוכנית",
  "שם תכנית",
  "שם מסלול",
  "מסלול",
  "שם נכס",
  "שם חשבון",
  "מוצר",
  "קופה",
  "תוכנית",
  "תכנית",
  "פוליסה",
  "product name",
  "product",
  "account name",
  "asset name",
  "fund name",
  "fund",
  "plan",
  "name",
  "account",
  "asset",
];

const PROVIDER_HEADERS = [
  "גוף מוסדי",
  "שם גוף מוסדי",
  "חברה מנהלת",
  "שם חברה מנהלת",
  "יצרן",
  "שם יצרן",
  "שם גוף",
  "שם חברה",
  "בית השקעות",
  "חברה",
  "גוף",
  "מוסד",
  "ספק",
  "מנהל",
  "provider",
  "institution",
  "company",
  "manager",
  "custodian",
  "broker",
  "issuer",
];

const BALANCE_HEADERS = [
  "יתרה צבורה",
  "סך צבירה",
  "סהכ צבירה",
  "סהכ יתרה",
  "סך יתרה",
  "יתרה בשח",
  "יתרה בש ח",
  "יתרה כוללת",
  "יתרת חיסכון",
  "יתרת חסכון",
  "שווי נכסים",
  "שווי שוק",
  "יתרה",
  "צבירה",
  "שווי",
  "סכום",
  "ערך",
  "balance",
  "market value",
  "current value",
  "valuation",
  "value",
  "amount",
  "total balance",
  "savings",
  "accumulation",
];

const CURRENCY_HEADERS = ["מטבע", "currency", "ccy", "curr"];

const DATE_HEADERS = [
  "נכון לתאריך",
  "תאריך נכונות",
  "תאריך עדכון",
  "תאריך דוח",
  "תאריך יתרה",
  "תאריך הפקה",
  "תאריך",
  "מועד",
  "valuation date",
  "report date",
  "balance date",
  "as of",
  "as of date",
  "updated",
  "date",
];

const ACCOUNT_NUM_HEADERS = [
  "מספר חשבון",
  "מספר פוליסה",
  "מספר קופה",
  "מספר עמית",
  "מספר אוצר",
  "מס חשבון",
  "מס פוליסה",
  "policy number",
  "account number",
  "fund number",
  "policy",
];

const TOTAL_WORDS = new Set(["סהכ", "סך הכל", "סך הכול", "סיכום", "סה כ", "total", "grand total", "sum", "subtotal"]);

function matchHeader(cell: string, patterns: readonly string[]): boolean {
  const c = cleanHeader(cell);
  if (!c) return false;
  return patterns.some((p) => c === p || c.includes(p));
}

function findCol(header: readonly string[], patterns: readonly string[], exclude = new Set<number>()): number {
  // Exact match first, then substring match, respecting pattern priority order
  for (const p of patterns) {
    const exact = header.findIndex((h, i) => !exclude.has(i) && cleanHeader(h) === p);
    if (exact >= 0) return exact;
  }
  for (const p of patterns) {
    const partial = header.findIndex((h, i) => !exclude.has(i) && cleanHeader(h).includes(p));
    if (partial >= 0) return partial;
  }
  return -1;
}

/** Parse a flexible date string (YYYY-MM-DD, DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY, MM/YYYY, or Excel serial) into YYYY-MM-DD. */
export function parseAssetDate(raw: string | undefined): string | null {
  const s = (raw ?? "").replace(/[\u200e\u200f]/g, "").trim();
  if (!s) return null;
  if (isIsoDate(s)) return s;
  const isoMatch = /(\d{4})[./-](\d{1,2})[./-](\d{1,2})/.exec(s);
  if (isoMatch) {
    const d = `${isoMatch[1]}-${isoMatch[2]!.padStart(2, "0")}-${isoMatch[3]!.padStart(2, "0")}`;
    if (isIsoDate(d)) return d;
  }
  const dmyMatch = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(s);
  if (dmyMatch) {
    const yNum = Number(dmyMatch[3]);
    const y = dmyMatch[3]!.length === 2 ? 2000 + yNum : yNum;
    const m = Number(dmyMatch[2]);
    const day = Number(dmyMatch[1]);
    const d = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (isIsoDate(d)) return d;
  }
  const myMatch = /^(\d{1,2})[./-](\d{4})$/.exec(s);
  if (myMatch) {
    const m = Number(myMatch[1]);
    const y = Number(myMatch[2]);
    if (m >= 1 && m <= 12) {
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const d = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      if (isIsoDate(d)) return d;
    }
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s));
  return null;
}

/** Normalize currency labels (₪, ש"ח, NIS, USD, $, EUR, €, GBP, £) into 3-letter ISO codes. */
export function normalizeCurrency(raw: string | undefined, fallback = "ILS"): string {
  const s = (raw ?? "").replace(/[\u200e\u200f]/g, "").trim();
  if (!s) return fallback;
  const u = s.toUpperCase();
  if (u === "NIS" || u === "ILS" || s.includes("₪") || /ש["״”]ח/.test(s) || s.includes("שקל")) return "ILS";
  if (u === "USD" || s.includes("$") || s.includes("דולר")) return "USD";
  if (u === "EUR" || s.includes("€") || s.includes("אירו") || s.includes("יורו")) return "EUR";
  if (u === "GBP" || s.includes("£") || s.includes("ליש")) return "GBP";
  if (/^[A-Z]{3}$/.test(u)) return u;
  return fallback;
}

/** Infer AssetKind from explicit kind/type text and product name (Hebrew + English). */
export function inferAssetKind(...texts: (string | undefined)[]): AssetKind {
  const joined = texts
    .filter(Boolean)
    .map((x) => cleanHeader(x!))
    .join(" ");
  if (!joined) return "other";

  // Direct exact AssetKind token first
  for (const t of texts) {
    const c = cleanHeader(t ?? "").replace(/\s+/g, "-");
    if ((ASSET_KINDS as readonly string[]).includes(c)) return c as AssetKind;
  }

  if (joined.includes("השתלמות") || joined.includes("hishtalmut")) return "keren-hishtalmut";
  if (joined.includes("פנסיה") || joined.includes("מנהלים") || joined.includes("קצבה") || joined.includes("pension") || joined.includes("annuity"))
    return "pension";
  if (
    joined.includes("גמל") ||
    joined.includes("פוליסת חיסכון") ||
    joined.includes("פוליסת חסכון") ||
    joined.includes("חיסכון לכל ילד") ||
    joined.includes("חסכון לכל ילד") ||
    joined.includes("gemel") ||
    joined.includes("provident")
  )
    return "gemel";
  if (
    joined.includes("ברוקר") ||
    joined.includes("ניירות ערך") ||
    joined.includes("תיק השקעות") ||
    joined.includes("מסחר") ||
    joined.includes("broker") ||
    joined.includes("ira") ||
    joined.includes("401k") ||
    joined.includes("etf") ||
    joined.includes("stocks")
  )
    return "brokerage";
  if (joined.includes("קריפטו") || joined.includes("ביטקוין") || joined.includes("crypto") || joined.includes("bitcoin") || joined.includes("ethereum"))
    return "crypto";
  return "other";
}

function isHebrewText(s: string): boolean {
  return /[\u0590-\u05ff]/.test(s);
}

function parseGrid(
  grid: readonly (readonly string[])[],
  defaultDate: string,
  defaultCurrency: string,
): { rows: ParsedAssetRow[]; skipped: number; reportDate?: string; isHarHaKesef: boolean } {
  // Scan top rows for header row and any report-level date in preamble
  let headerIdx = -1;
  let reportDate: string | undefined;
  const maxScan = Math.min(30, grid.length);

  for (let i = 0; i < maxScan; i++) {
    const r = grid[i]!;
    const hasBalance = r.some((c) => matchHeader(c, BALANCE_HEADERS));
    const hasNameOrKind = r.some((c) => matchHeader(c, NAME_HEADERS) || matchHeader(c, PRODUCT_TYPE_HEADERS));
    if (hasBalance && hasNameOrKind) {
      headerIdx = i;
      break;
    }
    if (!reportDate) {
      for (const cell of r) {
        const d = parseAssetDate(cell);
        if (d) {
          reportDate = d;
          break;
        }
      }
    }
  }

  if (headerIdx < 0) return { rows: [], skipped: 0, ...(reportDate ? { reportDate } : {}), isHarHaKesef: false };

  const header = grid[headerIdx]!;
  const used = new Set<number>();
  const balCol = findCol(header, BALANCE_HEADERS, used);
  if (balCol < 0) return { rows: [], skipped: 0, ...(reportDate ? { reportDate } : {}), isHarHaKesef: false };
  used.add(balCol);

  const kindCol = findCol(header, PRODUCT_TYPE_HEADERS, used);
  if (kindCol >= 0) used.add(kindCol);
  const nameCol = findCol(header, NAME_HEADERS, used);
  if (nameCol >= 0) used.add(nameCol);
  const provCol = findCol(header, PROVIDER_HEADERS, used);
  if (provCol >= 0) used.add(provCol);
  const curCol = findCol(header, CURRENCY_HEADERS, used);
  if (curCol >= 0) used.add(curCol);
  const dateCol = findCol(header, DATE_HEADERS, used);
  if (dateCol >= 0) used.add(dateCol);
  const acctCol = findCol(header, ACCOUNT_NUM_HEADERS, used);

  const hasHebrewHeader = header.some(isHebrewText);
  const effectiveDefaultCurrency = hasHebrewHeader ? "ILS" : defaultCurrency;
  const rows: ParsedAssetRow[] = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i]!;
    if (!r.some((c) => c.trim())) continue;

    const cell = (idx: number) => (idx >= 0 && idx < r.length ? (r[idx] ?? "").trim() : "");
    const rawName = cell(nameCol);
    const rawKind = cell(kindCol);
    const rawProvider = cell(provCol);
    const rawBalance = cell(balCol);
    const rawCurrency = cell(curCol);
    const rawDate = cell(dateCol);
    const rawAcct = cell(acctCol);

    // Skip summary/total rows
    const firstNonEmpty = r.find((c) => c.trim()) ?? "";
    if (
      TOTAL_WORDS.has(cleanHeader(firstNonEmpty)) ||
      TOTAL_WORDS.has(cleanHeader(rawName)) ||
      TOTAL_WORDS.has(cleanHeader(rawKind)) ||
      TOTAL_WORDS.has(cleanHeader(rawProvider))
    ) {
      skipped++;
      continue;
    }

    const value = money(rawBalance);
    if (value === null || !Number.isFinite(value) || value < 0) {
      skipped++;
      continue;
    }

    // Build human-readable asset name from available columns
    let name = rawName;
    if (!name && rawKind && rawProvider) name = `${rawKind} — ${rawProvider}`;
    else if (!name && rawKind) name = rawKind;
    else if (!name && rawProvider) name = rawProvider;
    if (!name) {
      skipped++;
      continue;
    }

    const kind = inferAssetKind(rawKind, rawName);
    const currency = rawCurrency
      ? normalizeCurrency(rawCurrency, effectiveDefaultCurrency)
      : rawBalance.includes("$")
        ? "USD"
        : rawBalance.includes("€")
          ? "EUR"
          : rawBalance.includes("£")
            ? "GBP"
            : rawBalance.includes("₪") || /ש["״”]ח/.test(rawBalance)
              ? "ILS"
              : effectiveDefaultCurrency;
    const date = parseAssetDate(rawDate) ?? reportDate ?? defaultDate;

    rows.push({
      kind,
      name,
      ...(rawProvider ? { provider: rawProvider } : {}),
      currency,
      date,
      value: Math.round(value * 100) / 100,
      ...(rawAcct ? { accountNumber: rawAcct } : {}),
    });
  }

  return { rows, skipped, ...(reportDate ? { reportDate } : {}), isHarHaKesef: hasHebrewHeader };
}

/**
 * Parse an Israeli Har HaKesef (הר הכסף) / Mislaka XLSX or CSV export, or a generic asset CSV
 * (`name, kind, provider, balance, currency, date`).
 */
export function parseAssetImport(file: { name?: string; bytes: Uint8Array }, opts: { defaultDate?: string; defaultCurrency?: string } = {}): AssetImportResult {
  const defaultDate = opts.defaultDate && isIsoDate(opts.defaultDate) ? opts.defaultDate : new Date().toISOString().slice(0, 10);
  const defaultCurrency = opts.defaultCurrency && /^[A-Z]{3}$/.test(opts.defaultCurrency) ? opts.defaultCurrency : "ILS";

  const grids: string[][][] = isZip(file.bytes) || /\.xlsx$/i.test(file.name ?? "") ? readXlsxSheets(file.bytes) : [csvTable(csvDecode(file.bytes))[0]];

  const allRows: ParsedAssetRow[] = [];
  let totalSkipped = 0;
  let reportDate: string | undefined;
  let isHarHaKesef = false;

  for (const g of grids) {
    const res = parseGrid(g, defaultDate, defaultCurrency);
    allRows.push(...res.rows);
    totalSkipped += res.skipped;
    if (res.reportDate && !reportDate) reportDate = res.reportDate;
    if (res.isHarHaKesef) isHarHaKesef = true;
  }

  return {
    format: isHarHaKesef ? "har-hakesef" : "csv",
    rows: allRows,
    skipped: totalSkipped,
    ...(reportDate ? { reportDate } : {}),
  };
}

// The one table of banks and their login fields (port of web/src/lib/connect.js). Key = the connector's provider ("mercury",
// "onezero") or the israeli-bank-scrapers companyId; fields must match that library's loginFields for the company.
// Labels and names are translated where read (getters), since this table is built once at load.
import { t } from "#lib/i18n.svelte.ts";

export type Group = "us" | "il-bank" | "il-card";
export interface LoginField {
  key: string;
  type: "text" | "password" | "email" | "tel";
  inputmode?: "numeric";
  placeholder?: string;
  mono?: boolean;
  readonly label: string;
}
export interface Provider {
  readonly name: string;
  group: Group;
  otp?: boolean;
  fields: LoginField[];
}

const F: Record<string, Partial<LoginField>> = {
  token: { type: "password", placeholder: "secret-token:mercury_production_…", mono: true },
  email: { type: "email" },
  password: { type: "password" },
  phoneNumber: { type: "tel", placeholder: "+972 50 123 4567" },
  id: { inputmode: "numeric" },
  nationalID: { inputmode: "numeric" },
  card6Digits: { inputmode: "numeric" },
};
const p = (id: string, group: Group, fields: string, extra: { otp?: boolean } = {}): Provider => ({
  get name() {
    return t(`connect.p.${id}`);
  },
  group,
  ...extra,
  fields: fields.split(" ").map((key) => ({
    key,
    type: "text",
    ...F[key],
    get label() {
      return t(`connect.f.${key}`);
    },
  })),
});
export const PROVIDERS: Record<string, Provider> = {
  mercury: p("mercury", "us", "token"),
  onezero: p("onezero", "il-bank", "email password phoneNumber", { otp: true }),
  hapoalim: p("hapoalim", "il-bank", "userCode password"),
  leumi: p("leumi", "il-bank", "username password"),
  discount: p("discount", "il-bank", "id password num"),
  mizrahi: p("mizrahi", "il-bank", "username password"),
  beinleumi: p("beinleumi", "il-bank", "username password"),
  mercantile: p("mercantile", "il-bank", "id password num"),
  otsarHahayal: p("otsarHahayal", "il-bank", "username password"),
  massad: p("massad", "il-bank", "username password"),
  union: p("union", "il-bank", "username password"),
  yahav: p("yahav", "il-bank", "username nationalID password"),
  pagi: p("pagi", "il-bank", "username password"),
  max: p("max", "il-card", "username password"),
  visaCal: p("visaCal", "il-card", "username password"),
  isracard: p("isracard", "il-card", "id card6Digits password"),
  amex: p("amex", "il-card", "id card6Digits password"),
  behatsdaa: p("behatsdaa", "il-card", "id password"),
  beyahadBishvilha: p("beyahadBishvilha", "il-card", "id password"),
};
export const GROUPS: [Group, string][] = [
  ["us", "connect.g.us"],
  ["il-bank", "connect.g.ilBank"],
  ["il-card", "connect.g.ilCard"],
];
/** "hapoalim:2" → "Bank Hapoalim (2)" */
export const providerName = (key: string) => {
  const [k = "", n] = key.split(":");
  return (PROVIDERS[k]?.name ?? k) + (n ? ` (${n})` : "");
};

// ---------- CSV from any bank: map columns once, saved as a profile in doc "csv-profiles" ----------
/** UTF-8 (BOM dropped), else Windows-1255, which older Israeli bank exports use. The server decodes files the same way. */
export async function readText(file: Blob) {
  const b = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return new TextDecoder("windows-1255").decode(b);
  }
}
/** Same rule as the importer's csv signature: a file matches a profile when a row's non-empty cells are exactly these. */
export const headerSignature = (row: readonly string[]) => row.filter(Boolean).join("|");

export type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
export interface Mapping {
  headerRow: number;
  dateFormat: DateFormat;
  dateCol: number;
  descCol: number | null;
  amountCol: number | null;
  debitCol: number | null;
  creditCol: number | null;
  split: boolean;
  memoCol: number | null;
  refCol: number | null;
  invert: boolean;
}
const find = (cells: readonly string[], re: RegExp) => {
  const i = cells.findIndex((c) => re.test(c));
  return i < 0 ? null : i;
};
const DATE = /date|תאריך|datum|fecha/i,
  AMOUNT = /amount|סכום|bedrag|betrag|importe/i;
/** First guess at the column mapping from the header row `h` (and the row under it, for the date format). */
export function guess(rows: readonly (readonly string[])[], h: number): Mapping {
  const cells = rows[h] ?? [],
    sample = (rows[h + 1] ?? [])[find(cells, DATE) ?? 0] ?? "";
  const [a = 0, b = 0] = sample.split(/[./-]/).map(Number);
  const dateFormat: DateFormat = /^\d{4}/.test(sample)
    ? "YYYY-MM-DD"
    : a > 12
      ? "DD/MM/YYYY"
      : b > 12
        ? "MM/DD/YYYY"
        : /[֐-׿]/.test(cells.join(""))
          ? "DD/MM/YYYY"
          : "MM/DD/YYYY";
  const debitCol = find(cells, /debit|חובה|withdraw|משיכה|charge/i),
    creditCol = find(cells, /credit|זכות|deposit|הפקדה/i),
    amountCol = find(cells, AMOUNT);
  return {
    headerRow: h,
    dateFormat,
    dateCol: find(cells, DATE) ?? 0,
    descCol: find(cells, /desc|תיאור|פרטים|הפעולה|payee|merchant|omschrijving|name|שם/i),
    amountCol,
    debitCol,
    creditCol,
    split: amountCol == null && debitCol != null && creditCol != null,
    memoCol: find(cells, /memo|note|הערה|reference text/i),
    refCol: find(cells, /^ref|reference|אסמכתא|check/i),
    invert: false,
  };
}
/** The stored profile (schema CsvProfile): unused columns are left out rather than null. */
export function toProfile(m: Mapping, header: readonly string[], account: string, name: string) {
  const cols = {
    descCol: m.descCol,
    memoCol: m.memoCol,
    refCol: m.refCol,
    amountCol: m.split ? null : m.amountCol,
    debitCol: m.split ? m.debitCol : null,
    creditCol: m.split ? m.creditCol : null,
  };
  return {
    name: (name || account).trim(),
    account: account.trim(),
    headerSignature: headerSignature(header),
    headerRow: m.headerRow,
    dateCol: m.dateCol,
    dateFormat: m.dateFormat,
    invert: m.invert,
    ...Object.fromEntries(Object.entries(cols).filter(([, v]) => v != null)),
  } as { name: string; account: string; headerSignature: string; headerRow: number; dateCol: number; dateFormat: DateFormat; invert: boolean } & Partial<
    Record<keyof typeof cols, number>
  >;
}
export const canSave = (m: Mapping, p: ReturnType<typeof toProfile>) =>
  !!p.account && p.descCol != null && (m.split ? p.debitCol != null || p.creditCol != null : p.amountCol != null);

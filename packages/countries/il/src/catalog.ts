// Every box on form 1301 (form/fields-2025.json, built from the Tax Authority's 2025 guide and checked against the blank form):
// its number, wording, kind, rate, ordinance section, rule and the documents to attach. The calculation and the proof checklist
// read from here instead of naming boxes one by one.
// ponytail: one catalog (2025) for every year; add fields-<year>.json when a year's form changes boxes or rates.
import cat from "../form/fields-2025.json";

export type FieldKind = "income" | "income-rate" | "exempt" | "deduction" | "credit" | "withheld" | "info";
export interface FieldDef {
  /** Registered spouse's box (null for unnumbered flags/rows). */
  no: string | null;
  spouse?: string;
  registered?: string;
  row?: string;
  he: string;
  en: string;
  kind: FieldKind;
  rate?: number;
  section?: string;
  rule?: string;
  proof?: string[];
  page?: number;
  /** Form section letter (ג = personal exertion at ordinary rates, ה = special rates, ...). */
  part: string;
}

export const FIELDS: readonly FieldDef[] = cat.sections.flatMap((s) => s.fields.map((f) => ({ ...(f as Omit<FieldDef, "part">), part: s.id })));
export const fieldDef = (no: string) => FIELDS.find((f) => f.no === no);
const nos = (pred: (f: FieldDef) => boolean) => FIELDS.filter((f) => f.no && pred(f)).map((f) => f.no!);

/** Ordinary-rate income (sections ג and ד), taxed together on the brackets. */
export const ORDINARY = nos((f) => f.kind === "income");
/** Personal exertion (section ג): the discharged-soldier credit only offsets tax on this. */
export const PERSONAL = nos((f) => f.kind === "income" && f.part === "ג");
/** Special-rate boxes (section ה and the rated rows elsewhere), each taxed at its own rate. */
export const RATED = FIELDS.filter((f) => f.no && f.kind === "income-rate" && f.rate != null);
/** Tax already paid that comes off the bill: withheld from salary (042), interest (043) and other income (040). 115 is part of 040. */
export const WITHHELD = ["040", "042", "043"];

/** Boxes with a value that the guide says to back with documents: [{ field, proof }] for the checklist and the proof pack. */
export function proofsNeeded(value: (no: string) => number) {
  return FIELDS.filter((f) => f.no && f.proof?.length && value(f.no) !== 0).map((f) => ({ no: f.no!, he: f.he, en: f.en, proof: f.proof! }));
}

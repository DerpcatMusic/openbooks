// United States country pack: single-member LLC (disregarded), LLC taxed as C-corp, multi-member LLC. Not a residence pack yet
// (no crossBorder): US residents are out of scope until a 1040 pack exists.
import type { CountryPack, PlaybookItem } from "@openbooks/core";
import { DeductionTable } from "@openbooks/schema";
import { Schema } from "effect";
import playbook from "../playbook.json";
import deductions from "../tables/deductions.json";
import en from "../strings/en.json";
import he from "../strings/he.json";
import { usDeadlines } from "./deadlines.ts";
import { manifest } from "./manifest.ts";
import type { UsTable } from "./schema.ts";
import { usTable, usTables } from "./tables.ts";

export const us: CountryPack<UsTable> = {
  manifest,
  tables: usTables,
  table: usTable,
  playbook: playbook as PlaybookItem[],
  deadlines: usDeadlines,
  deductions: Schema.decodeUnknownSync(DeductionTable)(deductions),
  strings: { en, he },
};

export { manifest };
export * from "./forms.ts";
export * from "./schema.ts";
export * from "./tables.ts";
export * from "./irs.ts";
export * from "./pdfs.ts";
export * from "./dates.ts";
export * from "./deadlines.ts";
export * from "./entity.ts";
export * from "./tax.ts";
export * from "./schedc.ts";
export * from "./contractors.ts";
export * from "./passthrough.ts";
export * from "./irs-forms.ts";
export * from "./return.ts";

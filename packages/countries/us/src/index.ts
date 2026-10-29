// United States country pack: single-member LLC (disregarded), LLC taxed as C-corp, multi-member LLC. Not a residence pack yet
// (no crossBorder): US residents are out of scope until a 1040 pack exists.
import { pickTable, type CountryPack, type PlaybookItem } from "@openbooks/core";
import { DeductionTable } from "@openbooks/schema";
import { Schema } from "effect";
import playbook from "../playbook.json";
import deductions from "../tables/deductions.json";
import en from "../strings/en.json";
import he from "../strings/he.json";
import t2025 from "../tables/2025.json";
import t2026 from "../tables/2026.json";
import { manifest } from "./manifest.ts";
import { UsTable } from "./schema.ts";

const decode = Schema.decodeUnknownSync(UsTable);
const tables: Record<number, UsTable> = { 2025: decode(t2025), 2026: decode(t2026) };

export const us: CountryPack<UsTable> = {
  manifest,
  tables,
  table: (y) => pickTable(tables, y),
  playbook: playbook as PlaybookItem[],
  deductions: Schema.decodeUnknownSync(DeductionTable)(deductions),
  strings: { en, he },
};

export { manifest };
export * from "./forms.ts";
export * from "./schema.ts";
export * from "./irs.ts";
export * from "./pdfs.ts";

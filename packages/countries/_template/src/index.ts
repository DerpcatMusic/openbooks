import { pickTable, type CountryPack, type Manifest, type PlaybookItem } from "@openbooks/core";
import { Schema } from "effect";
import playbook from "../playbook.json";
import en from "../strings/en.json";
import he from "../strings/he.json";
import t2026 from "../tables/2026.json";
import { XxTable } from "./schema.ts";

export const manifest: Manifest = {
  id: "xx",
  names: { en: "Example", he: "דוגמה" },
  flag: "🏳️",
  currency: "XXX",
  businessTypes: [
    { key: "sole", treatment: "sole-proprietor", label: { en: en["biz.sole"], he: he["biz.sole"] }, sub: { en: en["biz.sole.sub"], he: he["biz.sole.sub"] } },
  ],
  defaultType: "sole",
  legacyKinds: {},
  taxYear: { start: "01-01" },
  accounts: ["revenue:sales", "expense:general"],
};
const tables: Record<number, XxTable> = { 2026: Schema.decodeUnknownSync(XxTable)(t2026) };
export const pack: CountryPack<XxTable> = { manifest, tables, table: (y) => pickTable(tables, y), playbook: playbook as PlaybookItem[], strings: { en, he } };
export * from "./calc.ts";

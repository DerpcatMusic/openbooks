// Israel country pack: osek patur / zair / murshe and Ltd; residence pack for Israeli residents (cross-border with foreign entities).
import { pickTable, type CountryPack, type PlaybookItem } from "@openbooks/core";
import { Schema } from "effect";
import playbook from "../playbook.json";
import en from "../strings/en.json";
import he from "../strings/he.json";
import t2024 from "../tables/2024.json";
import t2025 from "../tables/2025.json";
import t2026 from "../tables/2026.json";
import { ilCrossBorder } from "./crossborder.ts";
import { manifest, vatRegistered } from "./manifest.ts";
import { IlTable, isComplete } from "./schema.ts";

const decode = Schema.decodeUnknownSync(IlTable);
const tables: Record<number, IlTable> = { 2024: decode(t2024), 2025: decode(t2025), 2026: decode(t2026) }; // a new year = a new JSON file + one line here

export const il: CountryPack<IlTable> = {
  manifest,
  tables,
  table: (y) => pickTable(tables, y),
  playbook: playbook as PlaybookItem[],
  strings: { en, he },
  crossBorder(person, y, home, foreign, fx) {
    const T = pickTable(tables, y);
    if (!isComplete(T)) throw new Error(`il ${T.year}: tax table lacks BL/pension rates`);
    return ilCrossBorder(T, person, y, home, foreign, fx);
  },
};

export { manifest, vatRegistered };
export * from "./advisor.ts";
export * from "./calc.ts";
export * from "./crossborder.ts";
export * from "./forms.ts";
export * from "./schema.ts";

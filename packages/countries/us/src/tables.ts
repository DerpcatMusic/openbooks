// The US year tables (tables/<year>.json), parsed once. Its own module so deadlines.ts can read amounts without importing the pack.
import { pickTable } from "@openbooks/core";
import { Schema } from "effect";
import t2025 from "../tables/2025.json";
import t2026 from "../tables/2026.json";
import { UsTable } from "./schema.ts";

const decode = Schema.decodeUnknownSync(UsTable);
export const usTables: Record<number, UsTable> = { 2025: decode(t2025), 2026: decode(t2026) }; // a new year = a new JSON file + one line here
export const usTable = (y: number) => pickTable(usTables, y);

// Statement readers (pure parse) + bank connectors (Effect). Public API: docs/architecture.md § Importers.
export * from "./read.ts";
export * from "./uid.ts";
export * from "./readers/onezero.ts";
export * from "./readers/scraper.ts";
export * from "./readers/bit.ts";
export * from "./readers/mercury.ts";
export { csvDecode, csvTable, csvSig, csvDate, money, csvRows, mappedCsv, csvPreview, type CsvPreview } from "./readers/csv.ts"; // its py* helpers duplicate onezero/bit ones
export * from "./connectors/index.ts";

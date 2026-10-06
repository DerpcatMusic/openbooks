// The single source of truth for data shapes that cross a boundary: statement rows (importers → storage), ledger transactions
// (storage → core/UI/tools), entity meta, and tool inputs (registry → MCP / in-app AI / ⌘K). Types are derived from these schemas;
// JSON Schema for MCP/AI comes from toolSchema()/jsonSchema(). Pure packages (core, country calculations) use `import type` only.
import { Schema } from "effect";

const IsoDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)).annotate({ description: "YYYY-MM-DD" });
const YearMonthOrDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}(-\d{2})?$/)).annotate({ description: "YYYY-MM or YYYY-MM-DD" });
/** Ledger account "type:name" (or "ask" = uncategorized). */
export const LedgerAccount = Schema.String.check(Schema.isPattern(/^(ask|[a-z-]+:[^\s].{0,79})$/)).annotate({
  description: 'Ledger account "type:name", e.g. expense:software',
});
export const TxnId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9-]{1,40}$/));

/** One row a statement reader produces (books.py readers). `key` feeds the dedupe uid and is not stored. */
export const StatementRow = Schema.Struct({
  date: IsoDate,
  amount: Schema.Finite,
  desc: Schema.String,
  source: Schema.String, // bank | bit | mercury | csv | scraper:<companyId> | journal
  account: Schema.String,
  file: Schema.String,
  page: Schema.Int,
  key: Schema.String,
  memo: Schema.optionalKey(Schema.String),
  mcat: Schema.optionalKey(Schema.String), // Mercury category
  kind: Schema.optionalKey(Schema.String), // Mercury kind
  who: Schema.optionalKey(Schema.String), // bit counterparty
});
export type StatementRow = typeof StatementRow.Type;

/** What txn.data holds: the row without `key`, plus its uid. */
export const StoredTxn = Schema.Struct({ ...StatementRow.fields, key: Schema.optionalKey(Schema.String), id: Schema.String });
export type StoredTxn = typeof StoredTxn.Type;

export const Why = Schema.String; // "manual" | "journal" | "" (ask) | the matching rule text
/** A ledger row: a stored transaction (or a journal line) with its ledger account. */
export const Txn = Schema.Struct({ ...StoredTxn.fields, category: Schema.String, why: Why });
export type Txn = typeof Txn.Type;

/** Reconciliation line a reader reports (statement table, `checks` column). */
export const StatementCheck = Schema.Struct({
  file: Schema.String,
  label: Schema.String,
  period: Schema.Tuple([Schema.String, Schema.String]),
  parsed: Schema.Finite,
  total: Schema.Finite,
  balance: Schema.optionalKey(Schema.Boolean),
});
export type StatementCheck = typeof StatementCheck.Type;

/** [match text, ledger account]; first match wins. */
export const Rule = Schema.Tuple([Schema.String, Schema.String]);
export type Rule = typeof Rule.Type;

export const JournalLine = Schema.Struct({
  account: Schema.String,
  debit: Schema.optionalKey(Schema.Finite),
  credit: Schema.optionalKey(Schema.Finite),
});
export const JournalEntry = Schema.Struct({ id: Schema.String, date: IsoDate, memo: Schema.optionalKey(Schema.String), lines: Schema.Array(JournalLine) });
export type JournalEntry = typeof JournalEntry.Type;

/** entity.meta. kind is legacy ("il-osek-zair" | "us-llc" | "other"); new code reads country + types. */
export const EntityMeta = Schema.Struct({
  name: Schema.String,
  short: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.String),
  currency: Schema.optionalKey(Schema.String),
  flag: Schema.optionalKey(Schema.String),
  types: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)), // {"2025": "osek-zair", "2026": "osek-murshe"}
  import: Schema.optionalKey(Schema.String), // "all": One Zero sync imports debits too
});
export type EntityMeta = typeof EntityMeta.Type;

/** Mapped-CSV profile (doc "csv-profiles"). Column indexes are 0-based. */
export const CsvProfile = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  account: Schema.optionalKey(Schema.String),
  headerSignature: Schema.String,
  headerRow: Schema.optionalKey(Schema.Int),
  dateCol: Schema.Int,
  dateFormat: Schema.optionalKey(Schema.Literals(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"])),
  descCol: Schema.optionalKey(Schema.Int),
  amountCol: Schema.optionalKey(Schema.Int),
  debitCol: Schema.optionalKey(Schema.Int),
  creditCol: Schema.optionalKey(Schema.Int),
  memoCol: Schema.optionalKey(Schema.Int),
  refCol: Schema.optionalKey(Schema.Int),
  invert: Schema.optionalKey(Schema.Boolean),
});
export type CsvProfile = typeof CsvProfile.Type;

/** A sourced number in a tax table: where it comes from and from when it applies. Tables keep plain numbers; sources sit beside them. */
export const Source = Schema.Struct({ url: Schema.String, effective: Schema.optionalKey(IsoDate), note: Schema.optionalKey(Schema.String) });
export type Source = typeof Source.Type;
/** Every country's tables/<year>.json has these; the pack's own schema adds its fields. */
export const TaxTableBase = Schema.Struct({
  note: Schema.optionalKey(Schema.String),
  /** dotted field path ("brackets", "ltd.corpRate") → source */
  sources: Schema.optionalKey(Schema.Record(Schema.String, Source)),
});

// ---------- tool inputs (phase 4 adds the rest; these two are the pattern) ----------
const Entity = { entity: Schema.optionalKey(Schema.String.annotate({ description: "Entity id; default: the first" })) };
export const ListTransactionsInput = Schema.Struct({
  ...Entity,
  from: Schema.optionalKey(YearMonthOrDate),
  to: Schema.optionalKey(YearMonthOrDate),
  account: Schema.optionalKey(Schema.String),
  category: Schema.optionalKey(Schema.String),
  uncategorized: Schema.optionalKey(Schema.Boolean),
  search: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))),
  offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export const ClassifyInput = Schema.Struct({
  ...Entity,
  ids: Schema.Array(TxnId).check(Schema.isBetweenLength(1, 500)),
  category: LedgerAccount,
  rule: Schema.optionalKey(Schema.String.check(Schema.isBetweenLength(1, 200))),
  confirm: Schema.optionalKey(Schema.Boolean),
});

/** Standard Schema V1 + Standard JSON Schema V1 in one object: what MCP SDK v2's registerTool({ inputSchema }) accepts. */
export const toolSchema = <S extends Schema.Top & { readonly DecodingServices: never }>(s: S) => Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(s));
/** Plain JSON Schema (draft 2020-12) for AI providers' tool definitions. */
export const jsonSchema = (s: Schema.Top) => Schema.toJsonSchemaDocument(s).schema;
export { Schema };

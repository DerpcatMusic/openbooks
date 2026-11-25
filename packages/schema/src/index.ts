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

/**
 * What the bank itself says about a payment, so its other side can be found by fact rather than by a guessed amount (Mercury and Wise
 * report these). `to`: the exact amount that arrives on the other side when it changes currency on the way. `ref`: the reference the
 * other side sees (Mercury's external memo, Wise's payment reference). `party`: who it went to or came from. `fee`: what the bank says
 * it charged, in the row's currency. `url`: where the bank keeps the record and its receipts; `receipts`: how many are attached there.
 */
export const TransferLink = Schema.Struct({
  to: Schema.optionalKey(Schema.Struct({ amount: Schema.Finite, currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)) })),
  ref: Schema.optionalKey(Schema.String),
  party: Schema.optionalKey(Schema.String),
  fee: Schema.optionalKey(Schema.Finite),
  url: Schema.optionalKey(Schema.String),
  receipts: Schema.optionalKey(Schema.Int),
  /** When the bank said the money lands on the other side (YYYY-MM-DD): Mercury estimatedDeliveryDate, Wise delivery estimate. */
  eta: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))),
});
export type TransferLink = typeof TransferLink.Type;

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
  /** ISO 4217 of `amount` when the reader knows it and it isn't the entity's currency (ingest drops it when equal). Absent = the entity's currency. */
  currency: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/))),
  link: Schema.optionalKey(TransferLink),
});
export type StatementRow = typeof StatementRow.Type;

/** What txn.data holds: the row without `key`, plus its uid. */
export const StoredTxn = Schema.Struct({ ...StatementRow.fields, key: Schema.optionalKey(Schema.String), id: Schema.String });
export type StoredTxn = typeof StoredTxn.Type;

export const Why = Schema.String; // "manual" | "journal" | "" (ask) | the matching rule text
/** A ledger row: a stored transaction (or a journal line) with its ledger account and, when it has any, its tag ids (by hand + rules). */
export const Txn = Schema.Struct({
  ...StoredTxn.fields,
  category: Schema.String,
  why: Why,
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  /** `amount` in the books' currency at the Bank of Israel rate of its day, when the row is in another currency (set by the server). */
  baseAmount: Schema.optionalKey(Schema.Finite),
});
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

/** Legacy rule [match text, ledger account]: one case-sensitive "contains" over "desc memo [mcat]". Still stored and accepted as is. */
export const LegacyRule = Schema.Tuple([Schema.String, Schema.String]);
export type LegacyRule = typeof LegacyRule.Type;
/** One condition of a rule. "text" is the legacy match; the others are the editor's fields. Amounts compare the absolute value. */
export const RuleCondition = Schema.Union([
  Schema.Struct({ field: Schema.Literal("text"), op: Schema.Literal("contains"), value: Schema.String }),
  Schema.Struct({ field: Schema.Literal("description"), op: Schema.Literals(["contains", "equals", "startsWith"]), value: Schema.String }),
  Schema.Struct({ field: Schema.Literal("counterparty"), op: Schema.Literal("contains"), value: Schema.String }),
  Schema.Struct({ field: Schema.Literal("account"), op: Schema.Literal("is"), value: Schema.String }),
  Schema.Struct({ field: Schema.Literal("direction"), op: Schema.Literals(["in", "out"]) }),
  Schema.Struct({ field: Schema.Literal("amount"), op: Schema.Literals(["eq", "gte", "lte"]), value: Schema.Finite }),
  Schema.Struct({ field: Schema.Literal("amount"), op: Schema.Literal("between"), value: Schema.Finite, to: Schema.Finite }),
]);
export type RuleCondition = typeof RuleCondition.Type;
/** "If every condition holds, Then set the ledger account and/or add tags (tag ids)." Rules are ordered; the first with an account sets it. */
export const Rule = Schema.Struct({
  when: Schema.Array(RuleCondition),
  then: Schema.Struct({ account: Schema.optionalKey(Schema.String), tags: Schema.optionalKey(Schema.Array(Schema.String)) }),
});
export type Rule = typeof Rule.Type;
/** What the `rule` table / doc "rules" holds and tools accept: legacy tuples and rule objects side by side, in order. */
export const RuleInput = Schema.Union([LegacyRule, Rule]);
/** A [match, account] tuple or a { when, then } rule (what /api/rules accepts). */
export const isRuleInput = Schema.is(RuleInput);
export type RuleInput = typeof RuleInput.Type;

/** What a tag means for tax (Taxximizer): a deduction rule id from the country pack's tables/deductions.json, a business-use share (0-100) and a note. */
export const TagTax = Schema.Struct({
  rule: Schema.optionalKey(Schema.String),
  pct: Schema.optionalKey(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100 }))),
  note: Schema.optionalKey(Schema.String),
});
export type TagTax = typeof TagTax.Type;
/** doc "tags": tag groups, tags (optional group and colour token), and the tags each transaction id carries by hand (rules add more on read). */
export const TagsDoc = Schema.Struct({
  groups: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  tags: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      group: Schema.optionalKey(Schema.String),
      color: Schema.optionalKey(Schema.String),
      tax: Schema.optionalKey(TagTax),
      /** Deactivated: hidden from pickers and filters, kept on the transactions that already carry it. Absent = active. */
      inactive: Schema.optionalKey(Schema.Boolean),
      /** Transactions with this tag are reportable transactions with the foreign owner (Form 5472 Part V, Reg. 1.482-1(i)(7)). */
      relatedParty: Schema.optionalKey(Schema.Boolean),
    }),
  ),
  on: Schema.Record(Schema.String, Schema.Array(Schema.String)),
});
export type TagsDoc = typeof TagsDoc.Type;

/** One line of a split transaction: signed like the transaction (negative = money out), so the lines add up to its amount to the cent. */
export const SplitLine = Schema.Struct({
  account: Schema.String,
  amount: Schema.Finite,
  memo: Schema.optionalKey(Schema.String),
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type SplitLine = typeof SplitLine.Type;
/** doc "splits": stored transaction id -> its lines. The ledger emits one row per line (id `${txnId}~${i}`). */
export const SplitsDoc = Schema.Record(Schema.String, Schema.Array(SplitLine));
export type SplitsDoc = typeof SplitsDoc.Type;

export const JournalLine = Schema.Struct({
  account: Schema.String,
  debit: Schema.optionalKey(Schema.Finite),
  credit: Schema.optionalKey(Schema.Finite),
});
export const JournalEntry = Schema.Struct({ id: Schema.String, date: IsoDate, memo: Schema.optionalKey(Schema.String), lines: Schema.Array(JournalLine) });
export type JournalEntry = typeof JournalEntry.Type;

/** Asset account kinds tracked in doc "assets" (pensions, Israeli savings wrappers, brokerage, crypto wallets, other). */
export const AssetKind = Schema.Literals(["pension", "keren-hishtalmut", "gemel", "brokerage", "crypto", "other"]);
export type AssetKind = typeof AssetKind.Type;
export const CryptoChain = Schema.Literals(["btc", "eth"]);
export type CryptoChain = typeof CryptoChain.Type;
/** One dated valuation snapshot of an asset account, in the asset's own currency. */
export const AssetValuation = Schema.Struct({
  date: IsoDate,
  value: Schema.Finite,
  quantity: Schema.optionalKey(Schema.Finite),
  unitPrice: Schema.optionalKey(Schema.Finite),
});
export type AssetValuation = typeof AssetValuation.Type;
/** doc "assets": off-bank asset accounts (pensions, savings wrappers, brokerage, read-only crypto wallets) included in net worth. */
export const AssetAccount = Schema.Struct({
  id: Schema.String,
  kind: AssetKind,
  name: Schema.String,
  provider: Schema.optionalKey(Schema.String),
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  valuations: Schema.Array(AssetValuation),
  /** Public wallet address only (read-only crypto lookup; private keys and seed phrases are never accepted). */
  address: Schema.optionalKey(Schema.String),
  chain: Schema.optionalKey(CryptoChain),
  lastRefreshed: Schema.optionalKey(Schema.String),
  stale: Schema.optionalKey(Schema.Boolean),
  lastError: Schema.optionalKey(Schema.String),
});
export type AssetAccount = typeof AssetAccount.Type;
export const AssetsDoc = Schema.Array(AssetAccount);
export type AssetsDoc = typeof AssetsDoc.Type;

/** entity.meta. kind is legacy ("il-osek-zair" | "us-llc" | "other"); new code reads country + types. */
export const EntityMeta = Schema.Struct({
  name: Schema.String,
  short: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.String),
  currency: Schema.optionalKey(Schema.String),
  flag: Schema.optionalKey(Schema.String),
  types: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)), // {"2025": "osek-zair", "2026": "osek-murshe"}
  /** Formation / start date (YYYY-MM-DD): years ending before this date do not hold this entity. */
  formed: Schema.optionalKey(IsoDate),
  /** Optional dissolution / disposal date (YYYY-MM-DD): years starting after this date do not hold this entity. */
  disposed: Schema.optionalKey(IsoDate),
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

/** A pack's tables/deductions.json (research tables: docs/tax-research-*.md): per-expense rules and tax moves, each with sources and a confidence. */
const Bilingual = Schema.Struct({ en: Schema.String, he: Schema.String });
const Citation = Schema.Struct({ title: Schema.String, url: Schema.String, section: Schema.optionalKey(Schema.String) });
export const DeductionRule = Schema.Struct({
  id: Schema.String,
  label: Bilingual,
  match: Schema.Struct({ keywords: Schema.Array(Schema.String), mcc: Schema.optionalKey(Schema.Array(Schema.Union([Schema.String, Schema.Finite]))) }), // IL lists them as numbers, US as strings
  /** % of the expense that is deductible; null = depends on the business-use share. */
  incomeTaxPct: Schema.NullOr(Schema.Finite),
  /** % of the input VAT that is reclaimable; null = not determined (treat as not reclaimable). */
  vatPct: Schema.NullOr(Schema.Finite),
  cap: Schema.NullOr(
    Schema.Struct({
      amount: Schema.NullOr(Schema.Finite),
      currency: Schema.String,
      per: Schema.String, // year | day | recipient | trip | invoice | mile | once
      year: Schema.optionalKey(Schema.NullOr(Schema.Int)),
      kind: Schema.optionalKey(Schema.String),
      note: Schema.optionalKey(Schema.String),
    }),
  ),
  appliesTo: Schema.Array(Schema.String),
  conditions: Schema.Array(Schema.String),
  evidence: Schema.Array(Schema.String),
  confidence: Schema.String, // statute | regulation | circular | irs-guidance | practice
  sources: Schema.Array(Citation),
  notes: Schema.String,
  unverified: Schema.optionalKey(Schema.Array(Schema.String)),
  basis: Schema.optionalKey(Schema.String),
  tags_default: Schema.optionalKey(Schema.String),
  values: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});
export type DeductionRule = typeof DeductionRule.Type;
export const DeductionMove = Schema.Struct({
  id: Schema.String,
  title: Bilingual,
  when: Schema.String,
  effect: Schema.String,
  sources: Schema.Array(Citation),
});
export type DeductionMove = typeof DeductionMove.Type;
export const DeductionTable = Schema.Struct({
  country: Schema.String,
  asOf: Schema.String,
  years: Schema.Array(Schema.Int),
  disclaimer: Schema.String,
  rules: Schema.Array(DeductionRule),
  moves: Schema.Array(DeductionMove),
});
export type DeductionTable = typeof DeductionTable.Type;

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

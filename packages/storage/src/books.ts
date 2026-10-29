// The Books service: books.py's Entity / entities / create_entity / ingest / ledger / state over bun:sqlite, as Effects.
// Every write publishes a Change after commit. Calls are synchronous inside (bun:sqlite is), so writes never interleave in-process;
// other processes (books.py, MCP stdio) are serialized by SQLite (WAL + busy_timeout).
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Context, Data, Effect, Layer } from "effect";
import {
  accountProblem,
  canon,
  checkBooks,
  classify as classifyCore,
  cleanRules,
  journalProblem,
  ledger,
  movedBefore,
  payrollProblem,
  splitProblem,
  tripProblem,
  type BooksDoc,
  type Coa,
  type JournalProblem,
  type LedgerExtras,
  type PayrollProblem,
  type PayrollRun,
  type SplitProblem,
  type Trip,
  type TripProblem,
} from "@openbooks/core";
import type { CsvProfile, EntityMeta, JournalEntry, RuleInput, SplitsDoc, StatementCheck, StoredTxn, TagsDoc, Txn } from "@openbooks/schema";
import { Changes, type Topic } from "./changes.ts";
import { isEntityId, ls, migrate, openDb, pySorted } from "./db.ts";
import { ingest, type Read } from "./ingest.ts";
import { assemble, RESERVED, statements, taxTables, type State } from "./state.ts";

export class BadInput extends Data.TaggedError("BadInput")<{ message: string }> {}
/** No such entity (books.py KeyError → HTTP 404). */
export class UnknownEntity extends Data.TaggedError("UnknownEntity")<{ entity: string }> {}
/** The write would change something dated on or before the books' close date (HTTP 409; the message says which date). */
export class ClosedPeriod extends Data.TaggedError("ClosedPeriod")<{ message: string }> {}

const JOURNAL: Record<JournalProblem, string> = {
  date: "has no valid date",
  beforeStart: "is dated before the books' entries start date",
  empty: "has no line with an amount",
  account: "has a line with an amount but no ledger account",
  archived: "uses an archived ledger account",
  noDebit: "needs at least one debit line",
  noCredit: "needs at least one credit line",
  unbalanced: "has debits that do not equal credits",
};
const SPLIT: Record<SplitProblem, string> = {
  lines: "needs at least two lines",
  amount: "has a line without an amount",
  account: "has a line without a usable ledger account (missing or archived)",
  sum: "lines do not add up to the transaction amount to the cent",
};
const TRIP: Record<TripProblem, string> = {
  name: "needs a name",
  dates: "needs real dates with the last day on or after the first",
  country: "needs a destination country (two capital letters, e.g. DE)",
  nights: "has more nights than days",
  businessDays: "has more business days than days",
  fx: "needs an exchange rate above zero",
  carDays: "has more car days than days",
};
const PAYROLL: Record<PayrollProblem, string> = {
  period: "needs a period",
  payDate: "needs a real pay date",
  provider: "needs a provider",
  amount: "needs gross pay above zero and no negative or missing figure",
  net: "has net pay that is not gross pay less withholding and benefits",
  over: "has payments above what the run costs (gross pay plus employer taxes)",
};
const BOOKS = {
  date: "The close date and the entries start date must be real dates (YYYY-MM-DD).",
  closeFuture: "The close date can't be in the future.",
  closeBeforeStart: "The close date can't be before the entries start date.",
  startLater: "The entries start date can only move earlier, never later: that would drop history the books already counted.",
  basis: "The accounting basis is cash or accrual.",
} as const;
/** The machine's date, YYYY-MM-DD (the screens use the same clock). */
const localToday = () => new Date().toLocaleDateString("sv");

type Listed = { id: string } & EntityMeta;

export interface BooksApi {
  /** $OPENBOOKS_HOME: books.db and one folder per entity. */
  readonly home: string;
  readonly entities: Effect.Effect<readonly Listed[]>;
  createEntity: (id: string, meta: EntityMeta) => Effect.Effect<void, BadInput>;
  setMeta: (e: string, patch: Partial<EntityMeta>) => Effect.Effect<void, UnknownEntity>;
  ingest: (e: string) => Effect.Effect<void, UnknownEntity>;
  ledger: (e: string) => Effect.Effect<readonly Txn[], UnknownEntity>;
  checks: (e: string) => Effect.Effect<{ checks: StatementCheck[]; unreadable: string[]; inbox: string[] }, UnknownEntity>;
  /** e: an entity id or a pseudo-entity (`_app`, `_ai`, `_vault`). */
  doc: <A>(e: string, name: string, fallback: A) => Effect.Effect<A, UnknownEntity>;
  /**
   * Fails ClosedPeriod when the write changes a ledger row, journal entry, reconciliation month or review mark on or before the close
   * date, and BadInput for a journal entry that doesn't balance (or uses an archived account), a split that doesn't add up, or a
   * books doc with impossible dates (see checkBooks).
   */
  putDoc: (e: string, name: string, value: unknown) => Effect.Effect<void, UnknownEntity | ClosedPeriod | BadInput>;
  rules: (e: string) => Effect.Effect<readonly RuleInput[], UnknownEntity>;
  /** Legacy [match, account] tuples and rule objects, in order. Fails ClosedPeriod when the new rules would move the ledger account of a transaction on or before the close date. */
  setRules: (e: string, rules: readonly RuleInput[]) => Effect.Effect<void, UnknownEntity | ClosedPeriod>;
  /** core classify() and its writes in one step, checked against the close date as a whole (no half-saved rule). */
  classify: (e: string, ids: readonly string[], category: string, rule?: string) => Effect.Effect<void, UnknownEntity | ClosedPeriod>;
  state: (e: string) => Effect.Effect<State, UnknownEntity>;
}

export class Books extends Context.Service<Books, BooksApi>()("openbooks/Books") {}

export interface BooksOptions {
  home: string;
  /** @openbooks/importers read() */
  read: Read;
  /** An already-open books.db (e.g. shared with the data_version poll); default openDb(home). */
  db?: Database;
}

const isPseudo = (e: string) => /^_[a-z]+$/.test(e);

export const makeBooks = (opts: BooksOptions) =>
  Effect.gen(function* () {
    const changes = yield* Changes;
    const { home, read } = opts;
    const db = opts.db ?? openDb(home);
    const publish = (entity: string | null, topics: Topic[], docs?: string[]) => changes.publish(docs ? { entity, topics, docs } : { entity, topics });

    /** books.py Entity(): the meta, migrating a JSON-era folder on first sight; undefined = unknown. */
    const metaOf = (e: string): EntityMeta | undefined => {
      if (!isEntityId(e)) return undefined;
      const get = () => db.query<{ meta: string }, [string]>("select meta from entity where id = ?").get(e);
      let row = get();
      if (!row && existsSync(join(home, e, "entity.json"))) {
        db.transaction(() => {
          if (!get()) migrate(db, e, join(home, e)); // another process may have migrated it meanwhile
        }).immediate();
        row = get();
      }
      return row ? (JSON.parse(row.meta) as EntityMeta) : undefined;
    };
    /** Run f for a known entity (pseudo too when allowed), else fail UnknownEntity. */
    const on = <A>(e: string, f: (meta: EntityMeta | undefined) => A, pseudo = false) =>
      Effect.suspend(() => {
        if (pseudo && isPseudo(e)) return Effect.sync(() => f(undefined));
        const m = metaOf(e);
        return m ? Effect.sync(() => f(m)) : Effect.fail(new UnknownEntity({ entity: e }));
      });

    const getDoc = <A>(e: string, name: string, fallback: A): A => {
      const row = db.query<{ value: string }, [string, string]>("select value from doc where entity = ? and name = ?").get(e, name);
      return row ? (JSON.parse(row.value) as A) : fallback;
    };
    /** Doc "rules" once rules were saved by this version; until then the `rule` table (books.py's), which is never rewritten. */
    const getRules = (e: string): RuleInput[] =>
      getDoc<RuleInput[] | null>(e, "rules", null) ??
      db
        .query<{ match: string; category: string }, [string]>("select match, category from rule where entity = ? order by pos")
        .all(e)
        .map((r) => [r.match, r.category] as const);
    // books.py tolerates entries without lines or memo (je.get("lines", []))
    const journal = (e: string) => getDoc<JournalEntry[]>(e, "journal", []).map((je) => ({ ...je, lines: je.lines ?? [] }));
    // ---------- close date: doc "books" = { closeDate }. Anything dated on or before it is refused (docs/architecture.md) ----------
    const closeDate = (e: string) => getDoc<{ closeDate?: string | null }>(e, "books", {}).closeDate || null;
    const refuse = (close: string, n: number) =>
      Effect.fail(
        new ClosedPeriod({
          message: `The books are closed through ${close}: this would change ${n} ${n === 1 ? "entry" : "entries"} dated on or before it. Move the close date to change them.`,
        }),
      );
    const storedTxns = (e: string) =>
      db
        .query<{ data: string }, [string]>("select data from txn where entity = ? order by date, rowid")
        .all(e)
        .map((r) => JSON.parse(r.data) as StoredTxn);
    /** The ledger rows as the close check compares them: id, date and ledger account. */
    const accountsOf = (ts: readonly Txn[]) => ts.map((t) => ({ id: t.id, date: t.date, category: t.category }));
    /** What besides rules/overrides/journal shapes the ledger: splits, the chart (archived accounts) and the entries start date. */
    const extras = (e: string): LedgerExtras => ({
      splits: getDoc<SplitsDoc>(e, "splits", {}),
      coa: getDoc<Coa>(e, "coa", {}),
      from: getDoc<BooksDoc>(e, "books", {}).startDate,
    });
    type Change = { rules?: readonly RuleInput[]; overrides?: Record<string, string>; journal?: JournalEntry[] } & LedgerExtras;
    const rowsOf = (e: string, c: Change = {}) =>
      ledger(storedTxns(e), c.overrides ?? getDoc(e, "overrides", {}), c.rules ?? getRules(e), c.journal ?? journal(e), undefined, { ...extras(e), ...c });
    /** Refuse a change (new rules/overrides/splits/chart/start date) that would move a ledger row dated on or before the close date. */
    const guardLedger = (e: string, change: Change) =>
      Effect.suspend(() => {
        const close = closeDate(e);
        if (!close) return Effect.void;
        const moved = movedBefore(accountsOf(rowsOf(e)), accountsOf(rowsOf(e, change)), close);
        return moved.length ? refuse(close, moved.length) : Effect.void;
      });
    const bad = (message: string) => Effect.fail(new BadInput({ message }));
    /** Items of a list or map whose canonical JSON differs between the stored doc and the new value (added, changed). */
    const changedIn = <T>(before: Record<string, T>, after: Record<string, T>) => Object.keys(after).filter((k) => canon(before[k]) !== canon(after[k]));
    /**
     * Refuse a write to a doc that shapes the ledger: the close date first (journal, reconciliations, review marks, splits, chart, books),
     * then the doc's own rules (a journal entry must balance, a split must add up, the books' dates must make sense). Only entries that
     * differ from what is stored are validated, so books saved before a rule existed still open and save.
     */
    const guardDoc = (e: string, name: string, value: unknown) =>
      Effect.suspend(() => {
        if (isPseudo(e)) return Effect.void;
        const close = closeDate(e);
        const months = (v: unknown) =>
          Object.entries((v ?? {}) as Record<string, Record<string, unknown>>).flatMap(([acct, ms]) =>
            Object.entries(ms ?? {}).map(([ym, rec]) => ({ id: `${acct}|${ym}`, date: `${ym}-01`, rec })),
          );
        const entries = (v: unknown) => (Array.isArray(v) ? (v as JournalEntry[]) : []);
        const closed = (n: number) => (close && n ? refuse(close, n) : Effect.void);
        switch (name) {
          case "reconciliations":
            return close ? closed(movedBefore(months(getDoc(e, name, {})), months(value), close).length) : Effect.void;
          case "journal": {
            const after = entries(value),
              ctx = { coa: getDoc<Coa>(e, "coa", {}), from: getDoc<BooksDoc>(e, "books", {}).startDate };
            return Effect.gen(function* () {
              if (close) yield* closed(movedBefore(entries(getDoc(e, name, [])), after, close).length);
              const before = new Map(entries(getDoc(e, name, [])).map((x) => [x.id, x]));
              for (const x of after)
                if (canon(before.get(x.id)) !== canon(x)) {
                  const p = journalProblem({ date: x.date, lines: x.lines ?? [] }, ctx);
                  if (p) return yield* bad(`Journal entry ${x.memo ? `“${x.memo}” ` : ""}${x.date} ${JOURNAL[p]}.`);
                }
            });
          }
          case "splits": {
            const after = (value ?? {}) as SplitsDoc,
              before = getDoc<SplitsDoc>(e, name, {}),
              amounts = new Map(storedTxns(e).map((t) => [t.id, t.amount])),
              coa = getDoc<Coa>(e, "coa", {});
            return Effect.gen(function* () {
              for (const id of changedIn(before, after)) {
                const amount = amounts.get(id);
                if (amount === undefined) return yield* bad(`Split of ${id}: no such transaction.`);
                const p = splitProblem(amount, after[id]!, (a) => !accountProblem(a, coa));
                if (p) return yield* bad(`Split of ${id} ${SPLIT[p]}.`);
              }
              yield* guardLedger(e, { splits: after });
            });
          }
          case "coa":
            return guardLedger(e, { coa: (value ?? {}) as Coa });
          case "books": {
            const next = (value ?? {}) as BooksDoc,
              p = checkBooks(getDoc<BooksDoc>(e, name, {}), next, localToday());
            return p ? bad(BOOKS[p]) : guardLedger(e, { from: next.startDate });
          }
          case "trips": {
            // a trip changes what the Taxximizer counts, not the ledger: only its own shape is checked, and only for the trips that changed
            const before = new Map(((getDoc<Trip[] | null>(e, name, []) ?? []) as Trip[]).map((x) => [x.id, x])),
              list = Array.isArray(value) ? (value as Trip[]) : [];
            for (const x of list)
              if (canon(before.get(x.id)) !== canon(x)) {
                const p = tripProblem(x);
                if (p) return bad(`Trip ${x.name ? `“${x.name}” ` : ""}${TRIP[p]}.`);
              }
            return Effect.void;
          }
          case "payroll": {
            // a run is the provider's figures, checked against each other (no tax is calculated): only the runs that changed are checked
            const before = new Map(((getDoc<PayrollRun[] | null>(e, name, []) ?? []) as PayrollRun[]).map((x) => [x.id, x])),
              list = Array.isArray(value) ? (value as PayrollRun[]) : [];
            for (const x of list)
              if (canon(before.get(x.id)) !== canon(x)) {
                const p = payrollProblem(x);
                if (p) return bad(`Payroll run ${x.period ? `“${x.period}” ` : ""}${PAYROLL[p]}.`);
              }
            return Effect.void;
          }
          case "reviewed": {
            if (!close) return Effect.void;
            // a review mark is bookkeeping, not an amount, but a closed period is closed: its marks stay as they were
            const dates = new Map(storedTxns(e).map((t) => [t.id, t.date])),
              marks = (v: unknown) =>
                Object.entries((v ?? {}) as Record<string, unknown>).flatMap(([id, on]) => (dates.has(id) ? [{ id, date: dates.get(id)!, on: !!on }] : []));
            return closed(movedBefore(marks(getDoc(e, name, {})), marks(value), close).length);
          }
          default:
            return Effect.void;
        }
      });
    /** The raw writes: no guard, no publish. */
    const writeDoc = (e: string, name: string, value: unknown) =>
      db
        .transaction(() => {
          if (value === null || value === undefined) db.query("delete from doc where entity = ? and name = ?").run(e, name);
          else db.query("insert or replace into doc values (?, ?, ?)").run(e, name, JSON.stringify(value));
          if (name === "csv-profiles") db.query("delete from statement where entity = ?").run(e); // CSVs read differently now: re-ingest
        })
        .immediate();
    // rules live in doc "rules" from now on; books.py's `rule` table is only read until the first save (getRules)
    const writeRules = (e: string, rs: readonly RuleInput[]) => writeDoc(e, "rules", rs);
    const putDoc = (e: string, name: string, value: unknown) =>
      on(e, () => undefined, true).pipe(
        Effect.andThen(guardDoc(e, name, value)),
        Effect.andThen(on(e, () => writeDoc(e, name, value), true)),
        Effect.andThen(publish(e, name === "csv-profiles" ? ["docs", "statements"] : ["docs"], [name])),
      );
    const setRules = (e: string, rs: readonly RuleInput[]) => {
      const rows = cleanRules(rs);
      return guardLedger(e, { rules: rows }).pipe(Effect.andThen(on(e, () => writeRules(e, rows))), Effect.andThen(publish(e, ["rules"])));
    };

    const listEntities = (): Listed[] => {
      for (const d of pySorted(ls(home))) if (existsSync(join(home, d, "entity.json"))) metaOf(d); // folders from before books.db
      return db
        .query<{ id: string; meta: string }, []>("select id, meta from entity order by id")
        .all()
        .map((r) => ({ id: r.id, ...(JSON.parse(r.meta) as EntityMeta) }));
    };
    const doIngest = (e: string, meta: EntityMeta) =>
      ingest(db, join(home, e, "inbox"), e, read, {
        meta,
        profile: getDoc(e, "profile", {}),
        csvProfiles: getDoc<CsvProfile[] | null>(e, "csv-profiles", []) ?? [],
      });
    const ingestE = (e: string) => on(e, (m) => doIngest(e, m!)).pipe(Effect.tap((changed) => (changed ? publish(e, ["txns", "statements"]) : Effect.void)));
    const ledgerE = (e: string) =>
      Effect.andThen(ingestE(e), () =>
        on(e, () => {
          const stored = db
            .query<{ data: string }, [string]>("select data from txn where entity = ? order by date, rowid")
            .all(e)
            .map((r) => JSON.parse(r.data) as StoredTxn);
          return ledger(stored, getDoc(e, "overrides", {}), getRules(e), journal(e), getDoc<TagsDoc | null>(e, "tags", null) ?? undefined, extras(e));
        }),
      );

    return Books.of({
      home,
      entities: Effect.sync(listEntities),
      createEntity: (id, meta) =>
        Effect.suspend(() => {
          if (!/^[a-z0-9-]{1,32}$/.test(id)) return Effect.fail(new BadInput({ message: "id: lowercase letters, digits and dashes" }));
          const fresh = db
            .transaction(() => {
              if (db.query("select 1 from entity where id = ?").get(id)) return false;
              db.query("insert into entity values (?, ?)").run(id, JSON.stringify(meta));
              return true;
            })
            .immediate();
          if (!fresh) return Effect.fail(new BadInput({ message: "that id exists" }));
          mkdirSync(join(home, id, "inbox"), { recursive: true });
          return publish(id, ["entities"]);
        }),
      setMeta: (e, patch) =>
        on(e, (m) => db.query("update entity set meta = ? where id = ?").run(JSON.stringify({ ...m, ...patch }), e)).pipe(
          Effect.andThen(publish(e, ["entities", "meta"])),
        ),
      ingest: (e) => Effect.asVoid(ingestE(e)),
      ledger: ledgerE,
      checks: (e) => Effect.andThen(ingestE(e), () => on(e, () => statements(db, e))),
      doc: (e, name, fallback) => on(e, () => getDoc(e, name, fallback), true),
      putDoc,
      rules: (e) => on(e, () => getRules(e)),
      setRules,
      classify: (e, ids, category, rule) =>
        on(e, () => classifyCore(ids, category, getRules(e), getDoc(e, "overrides", {}), rule)).pipe(
          Effect.flatMap((r) =>
            guardLedger(e, { rules: r.rules, overrides: r.overrides }).pipe(
              Effect.andThen(on(e, () => (rule ? writeRules(e, r.rules) : undefined))),
              Effect.andThen(rule ? publish(e, ["rules"]) : Effect.void),
              Effect.andThen(on(e, () => writeDoc(e, "overrides", r.overrides))),
              Effect.andThen(publish(e, ["docs"], ["overrides"])),
            ),
          ),
        ),
      state: (e) =>
        Effect.gen(function* () {
          const txns = yield* ledgerE(e);
          return yield* on(e, (m) => {
            const docs = db
              .query<{ name: string; value: string }, [string]>("select name, value from doc where entity = ? order by name")
              .all(e)
              .filter((d) => !RESERVED.has(d.name));
            return assemble(db, join(home, e), e, {
              entity: { id: e, ...m! },
              entities: listEntities(),
              txns: [...txns],
              form: getDoc(e, "form", {}),
              profile: getDoc(e, "profile", {}),
              rules: getRules(e),
              docs: Object.fromEntries(docs.map((d) => [d.name, JSON.parse(d.value) as unknown])),
              taxTables: taxTables(getDoc("_app", "taxtables", {})),
            });
          });
        }),
    });
  });

/** Books over $home/books.db; needs Changes. */
export const booksLayer = (opts: BooksOptions) => Layer.effect(Books, makeBooks(opts));

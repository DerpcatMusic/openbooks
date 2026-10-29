// The Books service: books.py's Entity / entities / create_entity / ingest / ledger / state over bun:sqlite, as Effects.
// Every write publishes a Change after commit. Calls are synchronous inside (bun:sqlite is), so writes never interleave in-process;
// other processes (books.py, MCP stdio) are serialized by SQLite (WAL + busy_timeout).
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Context, Data, Effect, Layer } from "effect";
import { classify as classifyCore, cleanRules } from "@openbooks/core";
import type { CsvProfile, EntityMeta, RuleInput, StatementCheck, StoredTxn, Txn } from "@openbooks/schema";
import { docRefusal, ledgerOf, ledgerRefusal, type BooksView, type Change, type Closed, type Refusal } from "./guard.ts";
import { Changes, type Topic } from "./changes.ts";
import { isEntityId, ls, migrate, openDb, pySorted } from "./db.ts";
import { ingest, type Read } from "./ingest.ts";
import { assemble, RESERVED, statements, taxTables, type State } from "./state.ts";

export class BadInput extends Data.TaggedError("BadInput")<{ message: string }> {}
/** No such entity (books.py KeyError → HTTP 404). */
export class UnknownEntity extends Data.TaggedError("UnknownEntity")<{ entity: string }> {}
/** The write would change something dated on or before the books' close date (HTTP 409; the message says which date). */
export class ClosedPeriod extends Data.TaggedError("ClosedPeriod")<{ message: string }> {}

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
    const view = (e: string): BooksView => ({ doc: (name, fallback) => getDoc(e, name, fallback), rules: () => getRules(e), stored: () => storedTxns(e) });
    const storedTxns = (e: string) =>
      db
        .query<{ data: string }, [string]>("select data from txn where entity = ? order by date, rowid")
        .all(e)
        .map((r) => JSON.parse(r.data) as StoredTxn);
    const closed = (r: Closed | null) => (r ? Effect.fail(new ClosedPeriod({ message: r.closed })) : Effect.void);
    const fail = (r: Refusal | null): Effect.Effect<void, ClosedPeriod | BadInput> =>
      r && "bad" in r ? Effect.fail(new BadInput({ message: r.bad })) : closed(r);
    // ---------- close date (doc "books" = { closeDate }) and each doc's own rules: guard.ts, shared with the browser-only store ----------
    const guardLedger = (e: string, change: Change) => Effect.suspend(() => closed(ledgerRefusal(view(e), change)));
    const guardDoc = (e: string, name: string, value: unknown) => Effect.suspend(() => (isPseudo(e) ? Effect.void : fail(docRefusal(view(e), name, value))));
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
          return ledgerOf(view(e));
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

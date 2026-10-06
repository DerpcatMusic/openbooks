// The Books service: books.py's Entity / entities / create_entity / ingest / ledger / state over bun:sqlite, as Effects.
// Every write publishes a Change after commit. Calls are synchronous inside (bun:sqlite is), so writes never interleave in-process;
// other processes (books.py, MCP stdio) are serialized by SQLite (WAL + busy_timeout).
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Context, Data, Effect, Layer } from "effect";
import { cleanRules, ledger } from "@openbooks/core";
import type { CsvProfile, EntityMeta, JournalEntry, Rule, StatementCheck, StoredTxn, Txn } from "@openbooks/schema";
import { Changes, type Topic } from "./changes.ts";
import { isEntityId, ls, migrate, openDb, pySorted } from "./db.ts";
import { ingest, type Read } from "./ingest.ts";
import { assemble, RESERVED, statements, taxTables, type State } from "./state.ts";

export class BadInput extends Data.TaggedError("BadInput")<{ message: string }> {}
/** No such entity (books.py KeyError → HTTP 404). */
export class UnknownEntity extends Data.TaggedError("UnknownEntity")<{ entity: string }> {}

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
  putDoc: (e: string, name: string, value: unknown) => Effect.Effect<void, UnknownEntity>;
  rules: (e: string) => Effect.Effect<readonly Rule[], UnknownEntity>;
  setRules: (e: string, rules: readonly Rule[]) => Effect.Effect<void, UnknownEntity>;
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
    const getRules = (e: string): Rule[] =>
      db
        .query<{ match: string; category: string }, [string]>("select match, category from rule where entity = ? order by pos")
        .all(e)
        .map((r) => [r.match, r.category] as const);
    // books.py tolerates entries without lines or memo (je.get("lines", []))
    const journal = (e: string) => getDoc<JournalEntry[]>(e, "journal", []).map((je) => ({ ...je, lines: je.lines ?? [] }));
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
          return ledger(stored, getDoc(e, "overrides", {}), getRules(e), journal(e));
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
      putDoc: (e, name, value) =>
        on(
          e,
          () =>
            db
              .transaction(() => {
                if (value === null || value === undefined) db.query("delete from doc where entity = ? and name = ?").run(e, name);
                else db.query("insert or replace into doc values (?, ?, ?)").run(e, name, JSON.stringify(value));
                if (name === "csv-profiles") db.query("delete from statement where entity = ?").run(e); // CSVs read differently now: re-ingest
              })
              .immediate(),
          true,
        ).pipe(Effect.andThen(publish(e, name === "csv-profiles" ? ["docs", "statements"] : ["docs"], [name]))),
      rules: (e) => on(e, () => getRules(e)),
      setRules: (e, rs) =>
        on(e, () => {
          const rows = cleanRules(rs);
          db.transaction(() => {
            db.query("delete from rule where entity = ?").run(e);
            const ins = db.query("insert into rule values (?, ?, ?, ?)");
            rows.forEach(([m, c], i) => ins.run(e, i, m, c));
          }).immediate();
        }).pipe(Effect.andThen(publish(e, ["rules"]))),
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

// What @openbooks/importers' connectors need from storage: the entity's `secret` rows (ConnectionStore) and the vault's
// reveal/conceal (ConnectionVault). Both run on the Books connection, so pollExternal never mistakes these writes for another process.
import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { type Conn, ConnectionStore, ConnectionVault } from "@openbooks/importers";
import { Effect, Layer } from "effect";
import { Changes } from "./changes.ts";
import { type Tampered, Vault, type VaultLocked } from "./vault.ts";

/** books.py Entity.secrets / put_secrets over `db`; every write publishes `secrets`. */
export const connectionStoreLayer = (home: string, db: Database) =>
  Layer.effect(
    ConnectionStore,
    Effect.gen(function* () {
      const changes = yield* Changes;
      return ConnectionStore.of({
        dir: (e) => join(home, e),
        rows: (e) =>
          Effect.sync(() =>
            Object.fromEntries(
              db
                .query<{ provider: string; value: string }, [string]>("select provider, value from secret where entity = ?")
                .all(e)
                .map((r) => [r.provider, JSON.parse(r.value) as Conn]),
            ),
          ),
        putRows: (e, rows) =>
          Effect.sync(() =>
            db
              .transaction(() => {
                db.query("delete from secret where entity = ?").run(e);
                const ins = db.query("insert into secret values (?, ?, ?)");
                for (const [p, v] of Object.entries(rows)) ins.run(e, p, JSON.stringify(v));
              })
              .immediate(),
          ).pipe(Effect.andThen(changes.publish({ entity: e, topics: ["secrets"] }))),
      });
    }),
  );

/** The Vault, seen by connectors. */
export const connectionVaultLayer = Layer.effect(
  ConnectionVault,
  Effect.gen(function* () {
    const v = yield* Vault;
    return ConnectionVault.of({
      reveal: (e, p, row) => v.reveal(e, p, row) as Effect.Effect<Conn, VaultLocked | Tampered>,
      conceal: (e, p, row) => v.conceal(e, p, row) as Effect.Effect<Conn, VaultLocked>,
    });
  }),
);

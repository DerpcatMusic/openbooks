// The services the server runs on (docs/architecture.md "Storage service", "Secrets", "Live updates"), all over ONE books.db
// connection: Books, Vault and the connectors' ConnectionStore write through it, so `pragma data_version` (pollExternal) only
// moves for other processes. Background fibers live in the layer's scope: the data_version poll and one inbox watcher per entity
// (entities created later get theirs when Books publishes `entities`).
import { join } from "node:path";
import { ConnectionStore, ConnectionVault, read, Scraper } from "@openbooks/importers";
import {
  Books,
  booksLayer,
  Changes,
  ChangesLive,
  connectionStoreLayer,
  connectionVaultLayer,
  makeVault,
  openDb,
  pollExternal,
  Vault,
  watchInbox,
} from "@openbooks/storage";
import { Effect, Layer, Stream } from "effect";

export { Books, Changes, Vault } from "@openbooks/storage";
export type Services = Books | Vault | Changes | ConnectionStore | ConnectionVault | Scraper;

export interface LayerOptions {
  home: string;
  /** scrypt cost; tests pass 2^10 */
  vaultN?: number;
}

export const defaultLayer = (o: LayerOptions): Layer.Layer<Services> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const db = yield* Effect.acquireRelease(
        Effect.sync(() => openDb(o.home)),
        (db) => Effect.sync(() => db.close()), // runtime.dispose(): Windows can't delete an open db
      );
      const vault = Layer.effect(
        Vault,
        Effect.gen(function* () {
          const changes = yield* Changes;
          return yield* makeVault(db, {
            ...(o.vaultN ? { N: o.vaultN } : {}),
            changed: () => Effect.runSync(changes.publish({ entity: null, topics: ["secrets"] })),
          });
        }),
      );
      const services = Layer.mergeAll(booksLayer({ home: o.home, read, db }), connectionStoreLayer(o.home, db), Scraper.direct).pipe(
        Layer.provideMerge(connectionVaultLayer.pipe(Layer.provideMerge(vault))),
        Layer.provideMerge(ChangesLive),
      );
      const background = Layer.effectDiscard(
        Effect.gen(function* () {
          const scope = yield* Effect.scope;
          const [books, changes] = [yield* Books, yield* Changes];
          yield* Effect.forkIn(pollExternal(db), scope);
          const watched = new Set<string>();
          const watch = (e: string) =>
            watched.has(e)
              ? Effect.void
              : Effect.sync(() => watched.add(e)).pipe(Effect.andThen(Effect.forkIn(watchInbox(join(o.home, e, "inbox"), e, books.ingest), scope)));
          yield* Effect.forkIn(
            changes.subscribe.pipe(Stream.runForEach((c) => (c.entity && c.topics.includes("entities") ? watch(c.entity) : Effect.void))),
            scope,
          );
          for (const e of yield* books.entities) yield* watch(e.id);
        }),
      );
      return Layer.provideMerge(background, services);
    }),
  );

// Live updates (docs/architecture.md "Live updates"): one PubSub of typed changes, fed by Books/Vault writes,
// the per-entity inbox watcher and a `pragma data_version` poll for writers in other processes (books.py, MCP stdio).
import type { Database } from "bun:sqlite";
import { mkdirSync, watch } from "node:fs";
import { Cause, Context, Effect, Layer, PubSub, Queue, Schedule, Stream } from "effect";
import type { Duration } from "effect";

export type Topic = "entities" | "meta" | "txns" | "rules" | "docs" | "statements" | "secrets" | "external";
export interface Change {
  v: number; // server-wide monotonic counter
  entity: string | null;
  topics: Topic[];
  docs?: string[];
}

export class Changes extends Context.Service<
  Changes,
  {
    publish: (c: Omit<Change, "v">) => Effect.Effect<void>; // the service stamps `v`
    subscribe: Stream.Stream<Change>;
    version: Effect.Effect<number>; // last `v` published, for SSE `hello`
  }
>()("openbooks/Changes") {}

export const makeChanges = Effect.gen(function* () {
  const hub = yield* PubSub.unbounded<Change>();
  let v = 0;
  return Changes.of({
    publish: (c) => Effect.suspend(() => PubSub.publish(hub, { ...c, v: ++v })).pipe(Effect.asVoid),
    subscribe: Stream.fromPubSub(hub),
    version: Effect.sync(() => v),
  });
});

export const ChangesLive = Layer.effect(Changes, makeChanges);

/** Statement files, as books.py ingest picks them: `.pdf/.csv/.json`, case-insensitive. Dotfiles (`.<name>.tmp`, `.x.swp`) are not. */
const statementFile = (name: string | null) => name === null || (!name.startsWith(".") && /\.(pdf|csv|json)$/i.test(name));

/**
 * One tick per burst of relevant changes in `dir` (created if missing). Watching the directory, not the files, is what
 * survives atomic saves (write a temp file, rename over the target): the rename shows up as an event for the target name.
 * A watcher error restarts the watch after 1 s.
 */
export const inboxEvents = (dir: string, debounce: Duration.Input = "300 millis"): Stream.Stream<void> =>
  Stream.callback<void, Error>((queue) =>
    Effect.acquireRelease(
      Effect.try({
        try: () => {
          mkdirSync(dir, { recursive: true });
          const w = watch(dir, (_event, name) => {
            if (statementFile(name)) Queue.offerUnsafe(queue, undefined);
          });
          w.on("error", (e) => Queue.failCauseUnsafe(queue, Cause.fail(e)));
          return w;
        },
        catch: (e) => e as Error,
      }),
      (w) => Effect.sync(() => w.close()),
    ),
  ).pipe(Stream.retry(Schedule.spaced("1 second")), Stream.debounce(debounce), Stream.orDie);

/**
 * Watch one entity's inbox: on each settled burst run `ingest(entity)`. Pass `Books.ingest`: it publishes `txns`/`statements`
 * itself, and only when a statement really changed, so the watcher publishes nothing (no double events). Fork it in a scope.
 */
export const watchInbox = <E, R>(dir: string, entity: string, ingest: (e: string) => Effect.Effect<void, E, R>, debounce?: Duration.Input) =>
  inboxEvents(dir, debounce).pipe(
    Stream.runForEach(() => ingest(entity).pipe(Effect.catchCause((cause) => Effect.logWarning(`inbox ingest failed for ${entity}`, cause)))),
  );

/**
 * `pragma data_version` changes when *another* connection (any process) commits, never for this connection's own writes,
 * which Books publishes itself. Pass the connection Books writes through. Runs forever; fork it in a scope.
 */
export const pollExternal = (db: Pick<Database, "query">, every: Duration.Input = "1 second") =>
  Effect.gen(function* () {
    const changes = yield* Changes;
    const read = () => (db.query("pragma data_version").get() as { data_version: number }).data_version;
    let last = read();
    yield* Effect.suspend(() => {
      const now = read();
      if (now === last) return Effect.void;
      last = now;
      return changes.publish({ entity: null, topics: ["external"] });
    }).pipe(Effect.repeat(Schedule.spaced(every)));
  });

import { Database } from "bun:sqlite";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Fiber, type Scope, Stream } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import { type Change, Changes, ChangesLive, pollExternal, watchInbox } from "./changes.ts";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "ob-changes-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const run = <A>(eff: Effect.Effect<A, never, Changes | Scope.Scope>) => Effect.runPromise(eff.pipe(Effect.scoped, Effect.provide(ChangesLive)));

/** Start collecting changes; the returned effect stops and yields what arrived. */
const collect = Effect.gen(function* () {
  const got: Change[] = [];
  const changes = yield* Changes;
  yield* changes.subscribe.pipe(
    Stream.runForEach((c) => Effect.sync(() => got.push(c))),
    Effect.forkScoped,
  );
  yield* Effect.sleep("20 millis"); // let the subscription attach
  return got;
});

describe("Changes", () => {
  test("publish reaches subscribers with a monotonic v", async () => {
    const got = await run(
      Effect.gen(function* () {
        const changes = yield* Changes;
        const got = yield* collect;
        yield* changes.publish({ entity: "a", topics: ["rules"] });
        yield* changes.publish({ entity: null, topics: ["docs"], docs: ["form"] });
        yield* Effect.sleep("10 millis");
        expect(yield* changes.version).toBe(2);
        return got;
      }),
    );
    expect(got).toEqual([
      { v: 1, entity: "a", topics: ["rules"] },
      { v: 2, entity: null, topics: ["docs"], docs: ["form"] },
    ]);
  });

  test("inbox watcher: a dropped file and an atomic rename each ingest once; temp/other files are ignored", async () => {
    const inbox = join(tmp(), "e1", "inbox"); // missing: the watcher creates it
    const ingested: string[] = [];
    const got = await run(
      Effect.gen(function* () {
        const got = yield* collect;
        yield* Effect.forkScoped(watchInbox(inbox, "e1", (e) => Effect.sync(() => ingested.push(e)), "100 millis"));
        yield* Effect.sleep("50 millis");

        writeFileSync(join(inbox, "a.csv"), "date,amount\n");
        writeFileSync(join(inbox, "a.csv"), "date,amount\n2025-01-01,1\n"); // same burst
        yield* Effect.sleep("300 millis");
        expect(ingested).toEqual(["e1"]);

        writeFileSync(join(inbox, ".b.json.tmp"), "{}"); // connectors._write_inbox style
        renameSync(join(inbox, ".b.json.tmp"), join(inbox, "b.JSON"));
        yield* Effect.sleep("300 millis");
        expect(ingested).toEqual(["e1", "e1"]);

        writeFileSync(join(inbox, "notes.txt"), "x");
        writeFileSync(join(inbox, ".c.csv.swp"), "x");
        yield* Effect.sleep("300 millis");
        return got;
      }),
    );
    expect(ingested).toEqual(["e1", "e1"]);
    expect(got).toEqual([]); // the ingest (Books.ingest) publishes, not the watcher
  });

  test("data_version poll sees writes from another connection and from python3, not our own", async () => {
    const file = join(tmp(), "books.db");
    const db = new Database(file);
    db.run("pragma journal_mode=wal");
    db.run("create table t (x)");
    const other = new Database(file);
    const got = await run(
      Effect.gen(function* () {
        const got = yield* collect;
        const poll = yield* Effect.forkScoped(pollExternal(db, "30 millis"));
        yield* Effect.sleep("60 millis");

        db.run("insert into t values (0)"); // own write: Books publishes it, the poll must not
        yield* Effect.sleep("100 millis");
        expect(got).toEqual([]);

        other.run("insert into t values (1)");
        yield* Effect.sleep("100 millis");
        expect(got.length).toBe(1);

        const py = Bun.spawnSync([
          "python3",
          "-c",
          `import sqlite3; c = sqlite3.connect(${JSON.stringify(file)}); c.execute("insert into t values (2)"); c.commit()`,
        ]);
        expect(py.exitCode, py.stderr.toString()).toBe(0);
        yield* Effect.sleep("100 millis");
        yield* Fiber.interrupt(poll);
        return got;
      }),
    );
    other.close();
    db.close();
    expect(got.map((c) => [c.entity, c.topics])).toEqual([
      [null, ["external"]],
      [null, ["external"]],
    ]);
  });
});

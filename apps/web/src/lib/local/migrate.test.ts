import "fake-indexeddb/auto";
import { expect, test } from "vite-plus/test";
import { Local } from "./store.ts";

// The backup scripts/local/export-backup.ts writes from a self-hosted home restores into the browser store as working books.
test.skipIf(!process.env.OB_BACKUP)("self-hosted backup restores", async () => {
  const fs = await import("node:fs");
  const l = await Local.open("migrate-test");
  await l.import(JSON.parse(fs.readFileSync(process.env.OB_BACKUP!, "utf8")));
  const s = l.state("il");
  expect(s.txns.length).toBeGreaterThan(0);
  expect(Object.values(s.proofs).flat().length).toBeGreaterThan(0);
  console.log(s.txns.length, s.proofs, s.docs.planner ? "planner" : "", JSON.stringify(l.state("us").entity));
});

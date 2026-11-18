// The audit trail (table `audit`): one row per change to an entity's books, written inside the same transaction as the change, so a
// change and its record commit or roll back together. Rows are only ever inserted. Before/after hold what changed (the changed items of a
// list or map, not the whole doc), as JSON, capped: past CAP characters a side is replaced by its hash and a summary.
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { canon } from "@openbooks/core";
import { Context } from "effect";

/** Who made a change: the app's screens, an MCP client, the in-app AI, or a bank sync. */
export type ActorKind = "ui" | "mcp" | "ai" | "sync";
/** The actor of the writes an Effect makes; the server, the tools and the bank sync set it, the screens are the default. */
export const Actor = Context.Reference<ActorKind>("openbooks/Actor", { defaultValue: () => "ui" });

/** doc (a books doc), rules, meta, classify, ingest, secrets (a bank connection), print (an issued document printed). */
export type AuditKind = "doc" | "rules" | "meta" | "classify" | "ingest" | "secrets" | "print";
export interface AuditRow {
  id: number;
  entity: string;
  at: string;
  actor: ActorKind;
  kind: AuditKind;
  target: string;
  before: unknown;
  after: unknown;
}

export const CAP = 8_000;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keyed = (v: unknown) => Array.isArray(v) && v.every((x) => isObj(x) && typeof x.id === "string");

/**
 * The part of a change worth keeping: for a list of `{ id }` items, the items removed or changed (before) and added or changed (after);
 * for a map, the keys whose value differs; anything else whole.
 */
export function delta(before: unknown, after: unknown): { before: unknown; after: unknown } {
  if ((keyed(before) || before == null) && (keyed(after) || after == null) && (before != null || after != null)) {
    const b = new Map(((before ?? []) as { id: string }[]).map((x) => [x.id, x])),
      a = new Map(((after ?? []) as { id: string }[]).map((x) => [x.id, x]));
    const ids = [...new Set([...b.keys(), ...a.keys()])].filter((id) => canon(b.get(id)) !== canon(a.get(id)));
    return { before: ids.flatMap((id) => (b.has(id) ? [b.get(id)] : [])), after: ids.flatMap((id) => (a.has(id) ? [a.get(id)] : [])) };
  }
  if (isObj(before) && isObj(after)) {
    const ks = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => canon(before[k]) !== canon(after[k]));
    return {
      before: Object.fromEntries(ks.filter((k) => k in before).map((k) => [k, before[k]])),
      after: Object.fromEntries(ks.filter((k) => k in after).map((k) => [k, after[k]])),
    };
  }
  return { before, after };
}

/** JSON of one side, or past CAP characters its sha256, size and a summary (item ids or keys). */
export function capped(v: unknown): string | null {
  if (v === undefined) return null;
  const s = JSON.stringify(v);
  if (s.length <= CAP) return s;
  const summary = Array.isArray(v)
    ? { items: v.length, ids: v.slice(0, 50).map((x) => (isObj(x) ? (x.id ?? null) : null)) }
    : isObj(v)
      ? { keys: Object.keys(v).slice(0, 50), count: Object.keys(v).length }
      : {};
  return JSON.stringify({ truncated: true, sha256: createHash("sha256").update(s).digest("hex"), bytes: s.length, ...summary });
}

/** Append one row. Call inside the change's own transaction. Nothing is written when nothing changed. */
export function audit(db: Database, row: Omit<AuditRow, "id" | "at"> & { at?: string }, whole = false) {
  if (canon(row.before) === canon(row.after)) return;
  const d = whole ? { before: row.before, after: row.after } : delta(row.before, row.after);
  db.query("insert into audit (entity, at, actor, kind, target, before, after) values (?, ?, ?, ?, ?, ?, ?)").run(
    row.entity,
    row.at ?? new Date().toISOString(),
    row.actor,
    row.kind,
    row.target,
    capped(d.before),
    capped(d.after),
  );
}

export interface AuditQuery {
  kind?: string | undefined;
  /** YYYY-MM-DD, inclusive. */
  from?: string | undefined;
  to?: string | undefined;
  target?: string | undefined;
  limit?: number | undefined;
}
/** Newest first. */
export function readAudit(db: Database, e: string, q: AuditQuery = {}): AuditRow[] {
  // ISO timestamps of the `to` day all sort before "YYYY-MM-DD~"
  const filters: [string, string | undefined][] = [
    ["kind = ?", q.kind],
    ["target = ?", q.target],
    ["at >= ?", q.from],
    ["at < ?", q.to && `${q.to}~`],
  ];
  const set = filters.filter((f): f is [string, string] => !!f[1]);
  const where = ["entity = ?", ...set.map((f) => f[0])],
    args: (string | number)[] = [e, ...set.map((f) => f[1])];
  args.push(Math.max(1, Math.min(q.limit ?? 200, 1000)));
  return db
    .query<Omit<AuditRow, "before" | "after"> & { before: string | null; after: string | null }, (string | number)[]>(
      `select rowid as id, entity, at, actor, kind, target, before, after from audit where ${where.join(" and ")} order by rowid desc limit ?`,
    )
    .all(...args)
    .map((r) => ({ ...r, before: r.before === null ? null : JSON.parse(r.before), after: r.after === null ? null : JSON.parse(r.after) }));
}

// books.py state(e): everything the app shows for one entity (GET /api/state). Field names and shapes are the API contract.
import type { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { join } from "node:path";
import { il } from "@openbooks/country-il";
import { us } from "@openbooks/country-us";
import type { EntityMeta, Rule, StatementCheck, Txn } from "@openbooks/schema";
import { ls, pySorted } from "./db.ts";

export interface Connection {
  provider: string;
  type: string;
  connected: boolean;
  pending: boolean;
  lastSync: string | null;
  lastError: string | null;
  accounts: unknown[];
  file: string;
}

export interface State {
  entity: { id: string } & EntityMeta;
  entities: ({ id: string } & EntityMeta)[];
  txns: Txn[];
  checks: StatementCheck[];
  form: Record<string, unknown>;
  profile: Record<string, unknown>;
  rules: Rule[];
  years: number[];
  proofs: Record<string, string[]>;
  unreadable: string[];
  docs: Record<string, unknown>;
  attachments: Record<string, string[]>;
  taxTables: Record<string, Record<string, unknown>>;
  inbox: string[];
  connections: Connection[];
}

/** Docs with their own endpoints, left out of state.docs. */
export const RESERVED = new Set(["form", "profile", "overrides"]);

/** connectors.status(e): the non-secret view of each connection. A vault-sealed row counts as connected. */
export function connections(db: Database, e: string): Connection[] {
  const rows = db.query<{ provider: string; value: string }, [string]>("select provider, value from secret where entity = ?").all(e);
  const byKey = new Map(rows.map((r) => [r.provider, JSON.parse(r.value) as Record<string, unknown>]));
  return pySorted(byKey.keys()).map((k) => {
    const c = byKey.get(k)!;
    return {
      provider: k,
      type: k.split(":")[0]!,
      connected: Boolean(c.secret || c.sealed),
      pending: Boolean(c.pending),
      lastSync: (c.lastSync as string | undefined) ?? null,
      lastError: (c.lastError as string | undefined) ?? null,
      accounts: (c.accounts as unknown[] | undefined) ?? [],
      file: `${k.replaceAll(":", "-")}-sync.json`,
    };
  });
}

/**
 * Pack tax tables in taxtables.json's shape ({country: {year: table}}, without the packs' `sources`, so state matches books.py),
 * with the app's overrides (doc(_app, "taxtables")) on top; an override of null removes that year.
 */
export function taxTables(overrides: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const p of [il, us])
    out[p.manifest.id] = Object.fromEntries(
      Object.entries(p.tables).map(([y, t]) => {
        const copy: Record<string, unknown> = { ...t };
        delete copy.sources;
        return [y, copy];
      }),
    );
  for (const [c, ys] of Object.entries(overrides))
    for (const [y, t] of Object.entries(ys)) {
      const to = (out[c] ??= {});
      if (t === null) delete to[y];
      else to[y] = t;
    }
  return out;
}

const cmpCheck = (a: StatementCheck, b: StatementCheck) => cmp(a.period[0], b.period[0]) || cmp(a.period[1], b.period[1]) || cmp(a.label, b.label);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The statement table, as state() reports it: reconciliation checks, unreadable files, every statement file. */
export function statements(db: Database, e: string) {
  const st = db.query<{ file: string; checks: string; ok: number }, [string]>("select file, checks, ok from statement where entity = ? order by file").all(e);
  return {
    checks: st.flatMap((s) => JSON.parse(s.checks) as StatementCheck[]).sort(cmpCheck),
    unreadable: st.filter((s) => !s.ok).map((s) => s.file),
    inbox: st.map((s) => s.file),
  };
}

/** The filesystem + statement-table parts of state(); the caller supplies what goes through Books (ledger, docs, rules). */
export function assemble(
  db: Database,
  dir: string,
  e: string,
  parts: Pick<State, "entity" | "entities" | "txns" | "form" | "profile" | "rules" | "docs" | "taxTables">,
): State {
  const { checks, unreadable, inbox } = statements(db, e);
  const proofs = join(dir, "proofs");
  const ys = [
    ...new Set([
      ...ls(proofs)
        .filter((n) => /^\d{4}$/.test(n))
        .map(Number),
      ...parts.txns.map((t) => Number(t.date.slice(0, 4))),
    ]),
  ].sort((a, b) => a - b);
  const att = join(dir, "attachments");
  return {
    entity: parts.entity,
    entities: parts.entities,
    txns: parts.txns,
    checks,
    form: parts.form,
    profile: parts.profile,
    rules: parts.rules,
    years: ys,
    proofs: Object.fromEntries(ys.map((y) => [y, pySorted(ls(join(proofs, String(y))).filter((n) => n.endsWith(".pdf")))])),
    unreadable,
    docs: parts.docs,
    attachments: Object.fromEntries(
      pySorted(ls(att))
        .filter((n) => isDir(join(att, n)))
        .map((n) => [n, pySorted(ls(join(att, n)))]),
    ),
    taxTables: parts.taxTables,
    inbox,
    connections: connections(db, e),
  };
}

const isDir = (p: string) => statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;

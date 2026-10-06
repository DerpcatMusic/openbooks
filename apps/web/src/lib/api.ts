// Typed client for the local server's HTTP API (identical in books.py and apps/server; docs/architecture.md § HTTP API).
// Stateless: the books store (stores/books.svelte.ts) decides which entity and what to do with the State that comes back.
import type { EntityMeta, Rule, StatementCheck, Txn } from "@openbooks/schema";

export type Entity = { id: string } & EntityMeta;
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
/** GET /api/state and every write's answer (books.py state()). Phase 3 may add fields, never rename. */
export interface State {
  entity: Entity;
  entities: Entity[];
  txns: Txn[];
  checks: StatementCheck[];
  form: Record<string, Record<string, string>>; // year → box → value
  profile: Record<string, any>;
  rules: Rule[];
  years: number[];
  proofs: Record<string, string[]>; // year → PDF names
  unreadable: string[];
  docs: Record<string, any>; // invoices, journal, customers, planner, csv-profiles, …
  attachments: Record<string, string[]>; // txn id → file names
  taxTables: Record<string, Record<string, any>>; // country → year → table (taxtables.json / _app overrides)
  inbox: string[];
  connections: Connection[];
}
/** No books yet: the app shows setup. */
export interface NoBooks {
  entities: [];
  setup: true;
}
/** Live-update event from GET /api/events (`event: change`). */
export type Topic = "entities" | "meta" | "txns" | "rules" | "docs" | "statements" | "secrets" | "external";
export interface Change {
  v: number;
  entity: string | null;
  topics: Topic[];
  docs?: string[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** `path` with `?e=<entity>` appended (every entity-scoped endpoint takes it). */
export const withEntity = (path: string, e: string) => (e ? `${path}${path.includes("?") ? "&" : "?"}e=${encodeURIComponent(e)}` : path);

/** fetch + JSON + error mapping. `body`: a File/Blob is sent raw, anything else as JSON; no body = GET. */
export async function request<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit =
    body === undefined
      ? {}
      : body instanceof Blob
        ? { method: "POST", body }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch(path, init);
  const d = await r.json().catch(() => ({ error: r.statusText }));
  if (!r.ok) throw new ApiError(d?.error || r.statusText, r.status);
  return d as T;
}

export const api = {
  state: (e: string) => request<State | NoBooks>(withEntity("/api/state", e)),
  /** Any POST /api/<x> that answers with the new State (category, rules, form, profile, meta, doc, year, taxtables, connect, sync, disconnect). */
  post: (path: string, body: unknown, e: string) => request<State>(withEntity(path, e), body),
  /** Add a business: { id, name, short, kind, currency, flag }. */
  createEntity: (meta: { id: string } & EntityMeta) => request<State>("/api/entity", meta),
  /** A statement or proof file. to: auto (statements → inbox, else proofs for `year`) | inbox | proofs. */
  upload: (e: string, f: File, year: number, to: "auto" | "inbox" | "proofs" = "auto") =>
    request<State>(withEntity(`/api/upload?to=${to}&year=${year}&name=${encodeURIComponent(f.name)}`, e), f),
  attach: (e: string, txn: string, f: File) =>
    request<State>(withEntity(`/api/attach?txn=${encodeURIComponent(txn)}&name=${encodeURIComponent(f.name)}`, e), f),
  csvPreview: (e: string, text: string, profile?: unknown) => request<unknown>(withEntity("/api/csv-preview", e), { text, profile }),
  packUrl: (e: string, year: number) => withEntity(`/api/pack?year=${year}`, e),
  fileUrl: (e: string, name: string, sub = "inbox") => `/files/${e}/${sub}/${encodeURIComponent(name)}`,
};

/**
 * Subscribe to GET /api/events. Calls `onHello(v)` on (re)connect and `onChange(c)` per change.
 * Returns a stop function. If the server has no event stream (books.py answers 404), calls `onUnavailable()` once and stops.
 */
export function events(h: { onHello: (v: number) => void; onChange: (c: Change) => void; onUnavailable: () => void }): () => void {
  if (typeof EventSource === "undefined") {
    h.onUnavailable();
    return () => {};
  }
  let es: EventSource | null = null,
    retry: ReturnType<typeof setTimeout> | undefined,
    seen = false,
    stopped = false;
  const open = () => {
    es = new EventSource("/api/events");
    es.addEventListener("hello", (m) => {
      seen = true;
      h.onHello(JSON.parse(m.data).v);
    });
    es.addEventListener("change", (m) => h.onChange(JSON.parse(m.data)));
    es.onerror = () => {
      if (es?.readyState !== EventSource.CLOSED || stopped) return; // CONNECTING: the browser retries by itself
      if (!seen) return h.onUnavailable(); // never connected: no event stream on this server
      retry = setTimeout(open, 3000); // was live, then the server refused (restart): try again
    };
  };
  open();
  return () => {
    stopped = true;
    clearTimeout(retry);
    es?.close();
  };
}

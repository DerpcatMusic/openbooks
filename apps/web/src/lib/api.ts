// Typed client for the local server's HTTP API (identical in books.py and apps/server; docs/architecture.md § HTTP API).
// Stateless: the books store (stores/books.svelte.ts) decides which entity and what to do with the State that comes back.
import type { EntityMeta, RuleInput, StatementCheck, Txn } from "@openbooks/schema";

export type Entity = { id: string } & EntityMeta;
export interface Connection {
  provider: string;
  type: string;
  connected: boolean;
  pending: boolean;
  linkToken?: string;
  authUrl?: string;
  expiresAt?: string;
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
  rules: RuleInput[]; // [match, account] tuples and/or { when, then } rules; run them through core normalizeRule
  years: number[];
  proofs: Record<string, string[]>; // year → PDF names
  unreadable: string[];
  docs: Record<string, any>; // invoices, journal, customers, planner, csv-profiles, …
  attachments: Record<string, string[]>; // txn id → file names
  taxTables: Record<string, Record<string, any>>; // country → year → table (taxtables.json / _app overrides)
  inbox: string[];
  connections: Connection[];
  /** The close date kept a bank import out of the closed period; splits a re-import broke (shown unsplit). */
  integrity?: {
    closedImport: { at: string; close: string; added: number; removed: number; changed: number } | null;
    brokenSplits: string[];
  };
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

/** GET /api/networth: every entity's bank and card accounts, one end-of-day balance a day, converted to `currency` at that day's BoI rate. */
export interface NetWorth {
  currency: string;
  dates: string[];
  series: { entity: string; account: string; currency: string; liability: boolean; values: number[] }[];
  /** Currency-days without a rate (that account counts 0 that day). */
  missing: { currency: string; date: string }[];
  excluded?: { entity: string; account: string; reason: string }[];
}
/** GET /api/flow: combined cash-flow rows across all entities, converted to `currency` at daily BoI rates. */
export interface CombinedFlowTxn {
  id: string;
  entity: string;
  entityName: string;
  flag: string;
  account: string;
  date: string;
  category: string;
  desc: string;
  who?: string;
  amount: number;
  nativeAmount: number;
  nativeCurrency: string;
}
export interface CombinedFlow {
  currency: string;
  from: string;
  to: string;
  entities: { id: string; name: string; flag: string; currency: string; accounts: string[] }[];
  txns: CombinedFlowTxn[];
  missing: { currency: string; date: string }[];
}
/** One side of a suggested transfer (GET /api/transfers). */
export interface TransferSide {
  entity: string;
  id: string;
  date: string;
  amount: number;
  currency: string;
  account: string;
  desc: string;
  category: string;
}
export interface TransferSuggestion {
  out: TransferSide;
  in: TransferSide;
  gap: number;
  diff: number;
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
export async function request<T>(path: string, body?: unknown, onResponse?: (r: Response) => void): Promise<T> {
  const init: RequestInit =
    body === undefined
      ? {}
      : body instanceof Blob
        ? { method: "POST", body }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch(path, init);
  onResponse?.(r);
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
  upload: (e: string, f: File, year: number, to: "auto" | "inbox" | "proofs" = "auto", filed?: (where: string | null) => void) =>
    request<State>(withEntity(`/api/upload?to=${to}&year=${year}&name=${encodeURIComponent(f.name)}`, e), f, (r) =>
      filed?.(r.headers.get("X-OpenBooks-Filed")),
    ),
  attach: (e: string, txn: string, f: File) =>
    request<State>(withEntity(`/api/attach?txn=${encodeURIComponent(txn)}&name=${encodeURIComponent(f.name)}`, e), f),
  csvPreview: (e: string, text: string, profile?: unknown) => request<unknown>(withEntity("/api/csv-preview", e), { text, profile }),
  netWorth: (currency: string, from: string, to: string) => request<NetWorth>(`/api/networth?currency=${encodeURIComponent(currency)}&from=${from}&to=${to}`),
  flow: (currency: string, from: string, to: string) => request<CombinedFlow>(`/api/flow?currency=${encodeURIComponent(currency)}&from=${from}&to=${to}`),
  /** BoI representative rates, ILS per unit: currency → date → rate. */
  fx: (currencies: readonly string[], from: string, to: string) =>
    request<{ rates: Record<string, Record<string, number>> }>(`/api/fx?currencies=${currencies.map(encodeURIComponent).join(",")}&from=${from}&to=${to}`),
  /** Likely transfers touching this business; `ref` ("entity/txn id"): every possible other side of one row (manual search, wider window). */
  transfers: (e: string, ref?: string) =>
    request<{ suggestions: TransferSuggestion[] }>(withEntity(ref ? `/api/transfers?ref=${encodeURIComponent(ref)}` : "/api/transfers", e)),
  packUrl: (e: string, year: number) => withEntity(`/api/pack?year=${year}`, e),
  closePackUrl: (e: string, year: number) => withEntity(`/api/close-pack?year=${year}`, e),
  laws: (opts?: { primaryOnly?: boolean; jurisdiction?: "il" | "us" | "treaty" }) => {
    const q = new URLSearchParams();
    if (opts?.primaryOnly) q.set("primary", "1");
    if (opts?.jurisdiction) q.set("jurisdiction", opts.jurisdiction);
    const qs = q.toString();
    return request<{ summary: Record<string, any>; sources: Record<string, any>[] }>(qs ? `/api/laws?${qs}` : "/api/laws");
  },
  refreshLaws: (body: { primaryOnly?: boolean; jurisdiction?: "il" | "us" | "treaty"; urls?: string[] } = {}) =>
    request<{ summary: Record<string, any>; sources: Record<string, any>[] }>("/api/laws/refresh", body),
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

// The browser-only books: the server's Books service (packages/storage/src/books.ts) over IndexedDB instead of books.db + folders.
// Keys in `kv` (JSON, mirrored in memory): entity/<id>, doc/<e>/<name>, rules/<e>, txns/<e>, stmts/<e>, years/<e>.
// Keys in `blob` (bytes): <e>/inbox/<name>, <e>/proofs/<year>/<name>, <e>/attachments/<txn>/<name>.
// The ledger, classify, rule cleaning, write checks (close date, doc rules), statement readers and tax tables are the same pure code the server runs.
import { classify, cleanRules } from "@openbooks/core";
import { csvPreview } from "@openbooks/importers/csv";
import { read } from "@openbooks/importers/read";
import type { CsvProfile, EntityMeta, RuleInput, StatementCheck, StoredTxn } from "@openbooks/schema";
import { docRefusal, ledgerOf, ledgerRefusal, type BooksView, type Change, type Refusal } from "@openbooks/storage/guard";
import { KINDS, parseStatements } from "@openbooks/storage/parse";
import { taxTables } from "@openbooks/storage/taxtables";
import type { State } from "../api.ts";

export const RESERVED = new Set(["form", "profile", "overrides"]);
export class Bad extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
type Listed = { id: string } & EntityMeta;
type Stmt = { file: string; checks: StatementCheck[]; ok: boolean };
export type Backup = { app: "openbooks-local"; v: 1; kv: Record<string, unknown>; blobs: Record<string, string> };

const ext = (f: string) => (f.includes(".") ? f.slice(f.lastIndexOf(".")).toLowerCase() : "");
const req = <T>(r: IDBRequest<T>) => new Promise<T>((ok, no) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => no(r.error))));
const done = (t: IDBTransaction) => new Promise<void>((ok, no) => ((t.oncomplete = () => ok()), (t.onerror = t.onabort = () => no(t.error))));
const b64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class Local {
  private constructor(
    private db: IDBDatabase,
    private kv: Map<string, any>,
    private blobs: Set<string>,
  ) {}

  /** Opens (creating) the IndexedDB database. `name` is separate from anything the demo uses (the demo never touches IndexedDB). */
  static async open(name = "openbooks-local", idb: IDBFactory = indexedDB) {
    const o = idb.open(name, 1);
    o.onupgradeneeded = () => (o.result.createObjectStore("kv"), o.result.createObjectStore("blob"));
    const db = await req(o);
    const t = db.transaction(["kv", "blob"]);
    const [keys, vals, blobs] = await Promise.all([
      req(t.objectStore("kv").getAllKeys()),
      req(t.objectStore("kv").getAll()),
      req(t.objectStore("blob").getAllKeys()),
    ]);
    return new Local(db, new Map(keys.map((k, i) => [k as string, vals[i]])), new Set(blobs as string[]));
  }

  // ---------- storage primitives ----------
  private async put(store: "kv" | "blob", k: string, v: unknown) {
    const t = this.db.transaction(store, "readwrite");
    if (v === undefined) t.objectStore(store).delete(k);
    else t.objectStore(store).put(v, k);
    if (store === "kv") {
      if (v === undefined) this.kv.delete(k);
      else this.kv.set(k, v);
    } else if (v === undefined) this.blobs.delete(k);
    else this.blobs.add(k);
    await done(t);
  }
  private get = <A>(k: string, fallback: A): A => (this.kv.has(k) ? this.kv.get(k) : fallback);
  async blob(k: string): Promise<Uint8Array | undefined> {
    return this.blobs.has(k) ? new Uint8Array(await req(this.db.transaction("blob").objectStore("blob").get(k))) : undefined;
  }
  private under = (prefix: string, set: Iterable<string>) => [...set].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));

  // ---------- entities, docs, rules ----------
  entities = (): Listed[] =>
    this.under("entity/", this.kv.keys())
      .sort()
      .map((id) => ({ id, ...this.kv.get(`entity/${id}`) }));
  private meta(e: string): EntityMeta {
    const m = this.kv.get(`entity/${e}`);
    if (!m) throw new Bad("unknown entity", 404);
    return m;
  }
  async createEntity(id: string, meta: EntityMeta) {
    if (!/^[a-z0-9-]{1,32}$/.test(id)) throw new Bad("id: lowercase letters, digits and dashes");
    if (this.kv.has(`entity/${id}`)) throw new Bad("that id exists");
    await this.put("kv", `entity/${id}`, meta);
  }
  async setMeta(e: string, patch: Partial<EntityMeta>) {
    await this.put("kv", `entity/${e}`, { ...this.meta(e), ...patch });
  }
  /** e: an entity id or a pseudo-entity (`_app`). */
  doc = <A>(e: string, name: string, fallback: A): A => (/^_[a-z]+$/.test(e) || this.meta(e) ? this.get(`doc/${e}/${name}`, fallback) : fallback);
  private view = (e: string): BooksView => ({
    doc: (name, fallback) => this.get(`doc/${e}/${name}`, fallback),
    rules: () => this.get(`rules/${e}`, []),
    stored: () => this.get(`txns/${e}`, []),
  });
  /** The server's guards: a closed period is HTTP 409, a doc breaking its own rules 400. */
  private refuse(r: Refusal | null) {
    if (r) throw "closed" in r ? new Bad(r.closed, 409) : new Bad(r.bad);
  }
  private guard = (e: string, change: Change) => this.refuse(ledgerRefusal(this.view(e), change));
  async putDoc(e: string, name: string, value: unknown) {
    if (!/^_[a-z]+$/.test(e)) {
      this.meta(e);
      this.refuse(docRefusal(this.view(e), name, value));
    }
    await this.put("kv", `doc/${e}/${name}`, value ?? undefined);
    if (name === "csv-profiles") await this.ingest(e); // CSVs read differently now
  }
  rules = (e: string): RuleInput[] => (this.meta(e), this.get(`rules/${e}`, []));
  async setRules(e: string, rs: readonly RuleInput[]) {
    const rows = cleanRules(rs);
    this.guard(e, { rules: rows });
    await this.put("kv", `rules/${e}`, rows);
  }
  async classify(e: string, ids: string[], category: string, rule?: string) {
    const r = classify(ids, category, this.rules(e), this.doc(e, "overrides", {}), rule);
    this.guard(e, { rules: r.rules, overrides: r.overrides });
    if (rule) await this.put("kv", `rules/${e}`, r.rules);
    await this.put("kv", `doc/${e}/overrides`, r.overrides);
  }

  // ---------- files, statements ----------
  /** Reads every inbox statement into txns (the server's ingest, over blobs). */
  async ingest(e: string) {
    const meta = this.meta(e);
    const names = this.under(`${e}/inbox/`, this.blobs).sort();
    const bytes = new Map(await Promise.all(names.map(async (n) => [n, (await this.blob(`${e}/inbox/${n}`))!] as const)));
    const { txns, stmts } = parseStatements(
      names.map((name) => ({ name, get: () => ({ name, bytes: bytes.get(name)! }) })),
      () => "",
      e,
      read,
      { meta, profile: this.doc(e, "profile", {}), csvProfiles: this.doc<CsvProfile[] | null>(e, "csv-profiles", []) ?? [] },
    );
    await this.put(
      "kv",
      `txns/${e}`,
      txns.map((t) => JSON.parse(t[7]) as StoredTxn).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    );
    await this.put(
      "kv",
      `stmts/${e}`,
      stmts.map(([, file, , checks, ok]): Stmt => ({ file, checks: JSON.parse(checks), ok: !!ok })),
    );
  }
  private looksLikeStatement(e: string, name: string, bytes: Uint8Array) {
    try {
      read(
        { name, bytes },
        { meta: this.meta(e), profile: this.doc(e, "profile", {}), csvProfiles: this.doc(e, "csv-profiles", []) ?? [], siblingPdfPeriods: () => [] },
      );
      return true;
    } catch {
      return false;
    }
  }
  /** POST /api/upload. PDFs always go to proofs (reading a bank PDF needs pdftotext, which only the installed app has). */
  async upload(e: string, name: string, bytes: Uint8Array, to: string, year: number) {
    this.meta(e);
    if (!KINDS.includes(ext(name)) || /[/\\]/.test(name)) throw new Bad("only PDF, CSV or JSON");
    if (to === "auto") to = ext(name) !== ".pdf" && this.looksLikeStatement(e, name, bytes) ? "inbox" : "proofs";
    if (ext(name) === ".pdf") to = "proofs";
    if (to === "inbox") {
      await this.put("blob", `${e}/inbox/${name}`, bytes);
      await this.ingest(e);
    } else {
      if (!Number.isInteger(year)) throw new Bad("bad year");
      await this.put("blob", `${e}/proofs/${year}/${name}`, bytes);
    }
  }
  async attach(e: string, txn: string, name: string, bytes: Uint8Array) {
    this.meta(e);
    if (!/^[A-Za-z0-9-]+$/.test(txn) || !name || /[/\\]/.test(name) || name === "." || name === "..") throw new Bad("bad attachment");
    await this.put("blob", `${e}/attachments/${txn}/${name}`, bytes);
  }
  async addYear(e: string, year: number, remove?: boolean) {
    if (!(year >= 1990 && year <= 2100)) throw new Bad("bad year");
    const ys = new Set(this.get<number[]>(`years/${e}`, []));
    if (remove) {
      if (!this.under(`${e}/proofs/${year}/`, this.blobs).length) ys.delete(year);
    } else ys.add(year);
    await this.put("kv", `years/${e}`, [...ys]);
  }
  /** GET /api/pack: the year's proof PDFs merged. ponytail: no summary cover (the server prints it with headless Chrome); print /print/<year> for that. */
  async pack(e: string, year: number) {
    const { PDFDocument } = await import("pdf-lib");
    const names = this.under(`${e}/proofs/${year}/`, this.blobs)
      .filter((n) => n.endsWith(".pdf"))
      .sort();
    if (!names.length) throw new Bad(`No PDFs in ${year} documents to merge`, 404);
    const out = await PDFDocument.create();
    for (const n of names) {
      const src = await PDFDocument.load((await this.blob(`${e}/proofs/${year}/${n}`))!, { ignoreEncryption: true }).catch(() => {
        throw new Bad(`Can't read ${n} as a PDF`);
      });
      for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
    }
    return out.save();
  }
  csvPreview = csvPreview;

  // ---------- state ----------
  state(e: string): State {
    const meta = this.meta(e);
    const txns = ledgerOf(this.view(e));
    const stmts = this.get<Stmt[]>(`stmts/${e}`, []);
    const proofs: Record<string, string[]> = {};
    for (const k of this.under(`${e}/proofs/`, this.blobs)) {
      const [y, ...n] = k.split("/");
      if (n.join("/").endsWith(".pdf")) (proofs[y!] ??= []).push(n.join("/"));
    }
    const years = [
      ...new Set([...this.get<number[]>(`years/${e}`, []), ...Object.keys(proofs).map(Number), ...txns.map((t) => Number(t.date.slice(0, 4)))]),
    ].sort((a, b) => a - b);
    const attachments: Record<string, string[]> = {};
    for (const k of this.under(`${e}/attachments/`, this.blobs)) {
      const [t, ...n] = k.split("/");
      (attachments[t!] ??= []).push(n.join("/"));
    }
    const docs = Object.fromEntries(
      this.under(`doc/${e}/`, this.kv.keys())
        .filter((n) => !RESERVED.has(n))
        .sort()
        .map((n) => [n, this.kv.get(`doc/${e}/${n}`)]),
    );
    return {
      entity: { id: e, ...meta },
      entities: this.entities(),
      txns,
      checks: stmts.flatMap((s) => s.checks).sort((a, b) => (a.period[0] < b.period[0] ? -1 : a.period[0] > b.period[0] ? 1 : 0)),
      form: this.doc(e, "form", {}),
      profile: this.doc(e, "profile", {}),
      rules: this.rules(e),
      years,
      proofs: Object.fromEntries(years.map((y) => [y, (proofs[y] ?? []).sort()])),
      unreadable: stmts.filter((s) => !s.ok).map((s) => s.file),
      docs,
      attachments,
      taxTables: taxTables(this.doc("_app", "taxtables", {})),
      inbox: stmts.map((s) => s.file).sort(),
      connections: [],
    } as State;
  }

  // ---------- backup ----------
  /** Everything, files included as base64: one JSON file the user keeps. */
  async export(): Promise<Backup> {
    const blobs: Record<string, string> = {};
    for (const k of this.blobs) blobs[k] = b64((await this.blob(k))!);
    return { app: "openbooks-local", v: 1, kv: Object.fromEntries(this.kv), blobs };
  }
  /** Replaces everything with a backup. */
  async import(b: Backup) {
    if (b?.app !== "openbooks-local" || b.v !== 1 || typeof b.kv !== "object" || typeof b.blobs !== "object") throw new Bad("not an OpenBooks backup");
    const t = this.db.transaction(["kv", "blob"], "readwrite");
    for (const s of ["kv", "blob"] as const) t.objectStore(s).clear();
    for (const [k, v] of Object.entries(b.kv)) t.objectStore("kv").put(v, k);
    for (const [k, v] of Object.entries(b.blobs)) t.objectStore("blob").put(unb64(v).buffer, k);
    await done(t);
    this.kv = new Map(Object.entries(b.kv));
    this.blobs = new Set(Object.keys(b.blobs));
  }
}

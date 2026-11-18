// Issued business documents (doc "invoices"): the server's rules, applied inside the write's transaction (packages/storage).
// Israeli bookkeeping rules (Kol Zchut "הוצאת חשבונית מס, חשבונית עסקה וקבלה"; the Tax Authority's bookkeeping instructions): each
// document type has its own gapless running number; an issued document is never deleted or changed, only cancelled by issuing a
// cancelling document that points at it; a reprint is marked as a copy. US invoices follow the same rules (they cost nothing extra).
// Pure: pass the stored list and the new one, get the list to store or the reason it is refused.
import { canon, closedOn, isoOk } from "./close.ts";

export interface IssuedDoc {
  id: string;
  kind: string;
  number?: string | null;
  status?: string;
  issued?: string;
  /** credit: the id of the document it cancels (the original's number is copied into `ref`). */
  cancels?: string;
  /** Set by the server on a cancelled document: the credit that cancelled it. */
  cancelledBy?: string;
  /** Set by the server: how many times the issued document was printed (1st = original, later = copies). */
  prints?: number;
  items?: readonly { desc?: string; qty?: unknown; price?: unknown }[];
  ref?: string | null;
  refKind?: string;
  [k: string]: unknown;
}

/** Kinds that can be issued; "credit" (cancellation / credit document) has its own series and cancels another document. */
export const DOC_KINDS = ["invoice", "bill", "receipt", "tax", "credit"] as const;
/** What may change after issue: the payments applied to it (open ↔ paid). Nothing on a cancelled document or a credit. */
const PAYMENT = new Set(["status", "paidTxn", "paidDate", "payments"]);
/** Kept by the server whatever a client sends. */
const SERVER = new Set(["prints", "cancelledBy"]);

export const isIssued = (d: Pick<IssuedDoc, "status"> | undefined) => !!d && !!d.status && d.status !== "draft";
const digits = (n: string | null | undefined) => +String(n ?? "").replace(/\D/g, "") || 0;

/** Next number of a kind's series given every document stored: max + 1, so with nothing ever deleted the series has no gaps. */
export function nextDocNumber(docs: readonly IssuedDoc[], kind: string, refKind?: string): string {
  const max = Math.max(0, ...docs.filter((d) => d.kind === kind && isIssued(d) && d.number).map((d) => digits(d.number)));
  const prefix = kind === "invoice" ? "INV-" : kind === "credit" && refKind === "invoice" ? "CN-" : "";
  return prefix + String(max + 1).padStart(4, "0");
}

export type DocProblem =
  | { code: "deleteIssued" | "editIssued" | "cancelled"; number: string }
  | { code: "date" | "kind" | "status"; id: string }
  | { code: "backdate"; id: string; last: string }
  | { code: "closed"; id: string; close: string }
  | { code: "cancelTarget"; id: string };

const strip = (d: IssuedDoc, keys: Set<string>) => Object.fromEntries(Object.entries(d).filter(([k]) => !keys.has(k)));
const neg = (v: unknown) => (Number(v) ? -Number(v) : 0);

/**
 * The list to store after a client wrote `after` over `before`, or why it is refused:
 * - an issued document can't be deleted, edited, renumbered or turned back into a draft; only its payments move (open ↔ paid), and not
 *   even those once it is cancelled; the server's own fields (prints, cancelledBy) are kept from `before`
 * - a draft has no number; a document going draft → issued gets the next number of its kind, and its date must be a real date, after
 *   the close date and not before the last issued document of that kind (no backdating)
 * - a credit copies the cancelled document's customer, currency, VAT and items (negated), refers to it by number, and marks it cancelled.
 */
export function issueDocs(before: readonly IssuedDoc[], after: readonly IssuedDoc[], close?: string | null): { docs: IssuedDoc[] } | { problem: DocProblem } {
  const was = new Map(before.map((d) => [d.id, d]));
  const ids = new Set(after.map((d) => d.id));
  for (const d of before) if (isIssued(d) && !ids.has(d.id)) return { problem: { code: "deleteIssued", number: d.number ?? d.id } };

  const out: IssuedDoc[] = [];
  const fresh: number[] = []; // positions of the documents issued by this write
  for (const d of after) {
    const b = was.get(d.id);
    if (b && isIssued(b)) {
      const frozen = b.status === "cancelled" || b.kind === "credit" ? new Set(SERVER) : new Set([...SERVER, ...PAYMENT]);
      if (canon(strip(b, frozen)) !== canon(strip(d, frozen)))
        return { problem: { code: b.status === "cancelled" ? "cancelled" : "editIssued", number: b.number ?? b.id } };
      if (b.status !== "cancelled" && (d.status === "draft" || d.status === "cancelled")) return { problem: { code: "editIssued", number: b.number ?? b.id } };
      const kept = Object.fromEntries([...SERVER].filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
      out.push({ ...strip(d, SERVER), ...kept } as IssuedDoc);
    } else if (isIssued(d)) {
      fresh.push(out.length);
      out.push(strip(d, SERVER) as IssuedDoc);
    } else out.push({ ...strip(d, SERVER), number: null } as IssuedDoc); // a draft: no number, whatever the client guessed
  }

  // issue in date order (then list order), each kind's numbers and dates checked against everything issued before it
  const issued = out.filter((d) => was.has(d.id) && isIssued(was.get(d.id)));
  for (const i of [...fresh].sort((x, y) => String(out[x]!.issued).localeCompare(String(out[y]!.issued)) || x - y)) {
    let d = out[i]!;
    if (!(DOC_KINDS as readonly string[]).includes(d.kind)) return { problem: { code: "kind", id: d.id } };
    if (d.status === "cancelled") return { problem: { code: "status", id: d.id } };
    if (typeof d.issued !== "string" || !isoOk(d.issued)) return { problem: { code: "date", id: d.id } };
    if (closedOn(d.issued, close)) return { problem: { code: "closed", id: d.id, close: close! } };
    const last = issued.filter((x) => x.kind === d.kind && x.issued).reduce((m, x) => (x.issued! > m ? x.issued! : m), "");
    if (d.issued < last) return { problem: { code: "backdate", id: d.id, last } };
    if (d.kind === "credit") {
      const j = out.findIndex((x) => x.id === d.cancels),
        o = out[j];
      if (!o || !issued.includes(o) || o.kind === "credit" || o.status === "cancelled") return { problem: { code: "cancelTarget", id: d.id } };
      d = {
        ...d,
        customer: o.customer ?? null,
        currency: o.currency,
        ...(o.vat !== undefined ? { vat: o.vat } : {}),
        ...(o.noVat ? { noVat: true } : {}),
        items: (o.items ?? []).map((x) => ({ ...x, price: neg(x.price) })),
        ref: o.number ?? null,
        refKind: o.kind,
        status: "open",
      };
      out[j] = { ...o, status: "cancelled", cancelledBy: d.id };
      issued[issued.indexOf(o)] = out[j]!;
    }
    out[i] = d = { ...d, number: nextDocNumber(issued, d.kind, d.refKind) };
    issued.push(d);
  }
  return { docs: out };
}

/**
 * Bills from vendors (doc "bills"): an approved bill is a book entry, so it is cancelled (status "cancelled"), never deleted, and a bill
 * dated on or before the close date can't be added, changed or removed; its payments and status still move (paying an old bill today).
 * Returns the number or id of the first bill refused, with why.
 */
export function billProblem(
  before: readonly { id: string; status?: string; number?: string; date?: string; [k: string]: unknown }[],
  after: readonly { id: string; status?: string; number?: string; date?: string; [k: string]: unknown }[],
  close?: string | null,
): { code: "deleteIssued" | "closed"; number: string } | null {
  const ids = new Set(after.map((b) => b.id));
  for (const b of before) if (isIssued(b) && !ids.has(b.id)) return { code: "deleteIssued", number: b.number ?? b.id };
  if (!close) return null;
  const was = new Map(before.map((b) => [b.id, b])),
    now = new Map(after.map((b) => [b.id, b]));
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const x = was.get(id),
      y = now.get(id);
    if (!closedOn(x?.date, close) && !closedOn(y?.date, close)) continue;
    if (canon(x && strip(x as IssuedDoc, PAYMENT)) !== canon(y && strip(y as IssuedDoc, PAYMENT))) return { code: "closed", number: (x ?? y)!.number ?? id };
  }
  return null;
}

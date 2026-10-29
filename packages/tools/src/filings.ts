// Filing tools: the country pack's deadline calendar with the user's done marks, the Israeli VAT periodic report, and the uniform-structure
// (OPENFRMT) file. Built by a factory so they share tools.ts's entity/ledger helpers without importing it (tools.ts lists them).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deductions, dueInYear, filingRows, readFilings, zip, type CountryPack, type DeductionInput } from "@openbooks/core";
import {
  ilFacts,
  ilSettings,
  iso88598,
  noteText,
  periodOf,
  periodReport,
  uniformDocs,
  uniformFiles,
  vatRegistered,
  type CustomerDoc,
  type InvoiceDoc,
} from "@openbooks/country-il";
import type { EntityMeta, Txn } from "@openbooks/schema";
import { Effect, Schema } from "effect";
import { defineTool, ToolError, type Tool } from "./registry.ts";
import type { input as toolInput } from "./tools.ts";

type Entity = { id: string; meta: EntityMeta };
type Pack = { type: string; pack: CountryPack };
/** What tools.ts hands over. */
export interface Helpers {
  entityOf: (args: { entity?: string | undefined }, ctx: { entity: string | undefined }) => Effect.Effect<Entity, ToolError, never>;
  ledgerOf: (e: Entity) => Effect.Effect<Txn[], ToolError, never>;
  docOf: <A>(e: Entity, name: string, fallback: A) => Effect.Effect<A, ToolError, never>;
  /** The deduction engine's input for the entity-year. */
  dedCtx: (e: Entity, y: number) => Effect.Effect<{ inp: DeductionInput }, ToolError, never>;
  packFor: (m: EntityMeta, y: number) => Pack | undefined;
  home: Effect.Effect<string, never, never>;
  input: typeof toolInput;
  label: (account: string) => string;
}

const fail = (message: string) => Effect.fail(new ToolError({ message }));
const S = Schema.String,
  N = Schema.Number,
  I = Schema.Int,
  B = Schema.Boolean;
const YEAR = I.check(Schema.isBetween({ minimum: 1990, maximum: 2100 }));
const DATE = S.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)).annotate({ description: "YYYY-MM-DD" });
const MONTH = S.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/u)).annotate({ description: "YYYY-MM" });
const nullable = <T extends Schema.Top>(s: T) => Schema.NullOr(s);
const today = () => new Date().toLocaleDateString("sv");

export function filingTools(h: Helpers): Tool[] {
  const factsOf = (settings: Record<string, unknown>, pack: CountryPack, e: Entity) => (y: number) => {
    const p = h.packFor(e.meta, y);
    if (!p || p.pack !== pack) return null;
    const s = ilSettings(settings);
    return pack.manifest.id === "il" ? ilFacts(p.type, s) : { businessType: p.type };
  };

  const filing_calendar = defineTool({
    name: "filing_calendar",
    title: { en: "Filing calendar", he: "לוח דיווחים" },
    description:
      "Tax filings and payments due in a calendar year for the entity's country and business type (Israel: VAT reports, income-tax and Bituach Leumi advances, the annual return; US: the pack's deadlines), each with its status today (done = the user marked it filed with a date and confirmation number; overdue; soon = within 14 days; upcoming), days left, the form, and the source. A row marked unverified is a date that could not be confirmed from a primary source. Not tax advice.",
    kind: "read",
    input: h.input({ year: Schema.optionalKey(YEAR), upcomingOnly: Schema.optionalKey(B) }),
    output: Schema.Struct({
      entity: S,
      year: I,
      country: S,
      businessType: S,
      today: S,
      counts: Schema.Struct({ done: I, overdue: I, soon: I, upcoming: I }),
      rows: Schema.Array(
        Schema.Struct({
          id: S,
          date: S,
          title: S,
          form: nullable(S),
          status: S,
          days: I,
          doneOn: nullable(S),
          confirmation: nullable(S),
          unverified: B,
          source: nullable(S),
        }),
      ),
    }),
    run: (a: { entity?: string; year?: number; upcomingOnly?: boolean }, ctx) =>
      Effect.gen(function* () {
        const e = yield* h.entityOf(a, ctx),
          year = a.year ?? new Date().getFullYear(),
          p = h.packFor(e.meta, year);
        if (!p?.pack.deadlines)
          return yield* fail(`${e.id} has no filing calendar: its business type is not set or its country has none. Set the business type in the app.`);
        const doc = readFilings(yield* h.docOf<unknown>(e, "filings", null)),
          now = today(),
          rows = filingRows(dueInYear(p.pack, year, factsOf(doc.settings, p.pack, e)), doc, now).filter((r) => !a.upcomingOnly || r.status !== "done");
        const count = (s: string) => rows.filter((r) => r.status === s).length;
        return {
          entity: e.id,
          year,
          country: p.pack.manifest.id,
          businessType: p.type,
          today: now,
          counts: { done: count("done"), overdue: count("overdue"), soon: count("soon"), upcoming: count("upcoming") },
          rows: rows.map((r) => ({
            id: r.id,
            date: r.date,
            title: r.title.en,
            form: r.form ?? null,
            status: r.status,
            days: r.days,
            doneOn: r.done?.on ?? null,
            confirmation: r.done?.confirmation ?? null,
            unverified: !!r.unverified,
            source: r.source ?? null,
          })),
        };
      }),
  });

  /** Everything the Israeli generators need for one entity-year. */
  const ilData = (e: Entity, y: number) =>
    Effect.gen(function* () {
      const p = h.packFor(e.meta, y);
      if (!p || p.pack.manifest.id !== "il") return yield* fail("This works for Israeli books only (set the business type: osek murshe or Ltd for VAT).");
      const { inp } = yield* h.dedCtx(e, y);
      const [invoices, customers, filings, txns] = [
        yield* h.docOf<InvoiceDoc[]>(e, "invoices", []),
        yield* h.docOf<CustomerDoc[]>(e, "customers", []),
        readFilings(yield* h.docOf<unknown>(e, "filings", null)),
        yield* h.ledgerOf(e),
      ];
      const rate = (p.pack.table(y) as { vatRate?: number }).vatRate ?? 0.18;
      return { type: p.type, inp, invoices, customers, filings, settings: ilSettings(filings.settings), txns, rate, rows: deductions(inp).rows };
    });

  const vat_report = defineTool({
    name: "vat_report",
    title: { en: "VAT report", he: "דוח מע״מ" },
    description:
      "The Israeli VAT periodic report (osek murshe and Ltd) for one period, as the form's fields in whole shekels: taxable sales before VAT, VAT on sales, zero-rated and exempt sales, VAT on other inputs, VAT on equipment inputs, and the amount to pay (positive) or receive (negative), with the statutory due date, the online date and the problems found (customer numbers missing above 5,000, allocation numbers, foreign-currency documents without a rate). Output VAT comes from issued tax invoices (and receipts that do not point at one); input VAT from expenses via the deduction rules' VAT share. `period` is YYYY-MM: a month, or the first month of a two-month period for bimonthly filers (the entity's saved setting unless `frequency` is given). The PCN874 file is downloaded in the app. Not tax advice.",
    kind: "read",
    input: h.input({ period: MONTH, frequency: Schema.optionalKey(Schema.Literals(["monthly", "bimonthly"])), lines: Schema.optionalKey(B) }),
    output: Schema.Struct({
      entity: S,
      period: Schema.Struct({ from: S, to: S, months: I }),
      currency: nullable(S),
      totals: Schema.Struct({ taxableSales: N, outputVat: N, zeroExempt: N, salesRecords: I, otherInputsVat: N, equipmentVat: N, inputRecords: I, payable: N }),
      due: Schema.Struct({ statutory: S, online: S, detailed: S }),
      issues: Schema.Array(Schema.Struct({ level: S, code: S, ref: nullable(S) })),
      lines: Schema.Array(Schema.Struct({ type: S, date: S, ref: S, vat: N, net: N, label: S })),
      note: S,
    }),
    run: (a: { entity?: string; period: string; frequency?: "monthly" | "bimonthly"; lines?: boolean }, ctx) =>
      Effect.gen(function* () {
        const e = yield* h.entityOf(a, ctx),
          y = +a.period.slice(0, 4),
          d = yield* ilData(e, y);
        if (!vatRegistered(d.type))
          return yield* fail(`${d.type} is not VAT-registered: there is no periodic VAT report (an osek patur has only an annual turnover declaration).`);
        const freq = a.frequency ?? d.settings.vatFrequency,
          period = periodOf(`${a.period}-01`, freq);
        const r = periodReport(period, {
          invoices: d.invoices,
          customers: d.customers,
          rows: d.rows,
          txns: d.txns,
          rate: d.rate,
          settings: d.settings,
          ...(e.meta.currency ? { currency: e.meta.currency } : {}),
        });
        return {
          entity: e.id,
          period: { from: period.from, to: period.to, months: period.months },
          currency: e.meta.currency ?? null,
          totals: r.totals,
          due: r.due,
          issues: r.issues.map((i) => ({ level: i.level, code: i.code, ref: i.ref ?? null })),
          lines: a.lines ? r.lines.map((l) => ({ type: l.type, date: l.date, ref: l.ref, vat: l.vat, net: l.net, label: l.label })) : [],
          note: "Whole shekels, sums of per-document rounded amounts. Bank dates stand in for the tax-invoice date on inputs. Check the figures against the Tax Authority's form before sending.",
        };
      }),
  });

  const export_uniform_file = defineTool({
    name: "export_uniform_file",
    title: { en: "Uniform structure file", he: "קובץ במבנה אחיד" },
    description:
      "Writes the Israeli Tax Authority uniform-structure files (OPENFRMT version 1.31: INI.TXT, BKMVDATA.TXT and README.TXT, in a zip) for a date range into the books' exports folder and returns the path and a summary: record counts, problems found. OpenBooks is NOT a registered program of the Tax Authority (software registration number 0); registration is a separate process. Run the files through the Tax Authority's simulator before relying on them. Reads the books; changes nothing in them.",
    kind: "read",
    input: h.input({ from: DATE, to: DATE }),
    output: Schema.Struct({
      entity: S,
      path: S,
      bytes: I,
      folder: S,
      counts: Schema.Record(S, I),
      notes: Schema.Array(S),
      registered: B,
      warning: S,
    }),
    run: (a: { entity?: string; from: string; to: string }, ctx) =>
      Effect.gen(function* () {
        const e = yield* h.entityOf(a, ctx);
        if (a.to < a.from) return yield* fail("`to` is before `from`");
        const d = yield* ilData(e, +a.to.slice(0, 4));
        if (!d.settings.vatId) return yield* fail("Set the business's licensed-dealer / company number first (Filings > settings in the app).");
        const now = new Date(),
          g = now.toLocaleDateString("sv"),
          time = now.toLocaleTimeString("sv").slice(0, 5);
        const rows = d.txns
          .filter((t) => t.date >= a.from && t.date <= a.to)
          .map((t) => ({ id: t.id, date: t.date, amount: t.amount, desc: t.desc, account: t.account, category: t.category, source: t.source }));
        const f = uniformFiles({
          business: { vatId: d.settings.vatId, name: e.meta.name },
          taxYear: +a.to.slice(0, 4),
          from: a.from,
          to: a.to,
          generated: { date: g, time },
          primaryId: Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => b % 10).join(""),
          currency: e.meta.currency ?? "ILS",
          docs: uniformDocs(d.invoices as never, d.customers, (i) => ((i as { method?: string }).method === "ביט" ? "other" : "transfer")),
          rows,
          accountName: h.label,
        });
        const home = yield* h.home,
          dir = join(home, e.id, "exports"),
          path = join(dir, `OPENFRMT-${a.from}_${a.to}.zip`);
        const bytes = zip([
          { name: `${f.dir}/INI.TXT`, data: iso88598(f.ini) },
          { name: `${f.dir}/BKMVDATA.TXT`, data: iso88598(f.data) },
          { name: `${f.dir}/README.TXT`, data: iso88598(f.readme) },
        ]);
        yield* Effect.try({
          try: () => (mkdirSync(dir, { recursive: true }), writeFileSync(path, bytes)),
          catch: (x) => new ToolError({ message: `Could not write ${path}: ${String(x)}` }),
        });
        return {
          entity: e.id,
          path,
          bytes: bytes.length,
          folder: f.dir,
          counts: f.counts,
          notes: f.notes.map(noteText),
          registered: false,
          warning: "Not a registered program: software registration number 0. Validate with the Tax Authority's simulator.",
        };
      }),
  });

  return [filing_calendar, vat_report, export_uniform_file];
}

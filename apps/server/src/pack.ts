// Proof pack (books.py build_pack): a summary cover printed by headless Chrome from the app's #/print/<year> page, then every
// statement PDF whose period touches the year and every proof PDF for the year, merged with pdf-lib (books.py used pdfunite).
import { mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { brokenSplits, zip, type ZipFile } from "@openbooks/core";
import type { SplitsDoc, Txn } from "@openbooks/schema";

export function chromePath(): string {
  return Bun.which("google-chrome-stable") ?? Bun.which("chromium") ?? Bun.which("chromium-browser") ?? "google-chrome";
}

export async function merge(files: readonly Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const bytes of files) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  }
  return out.save();
}

/** checks: state.checks; returns the written pack's path (<entity>/data/proof-pack-<year>.pdf). */
export async function buildPack(opts: {
  dir: string;
  entity: string;
  year: number;
  port: number;
  checks: readonly { file: string; period: readonly [string, string] | readonly string[] }[];
  chrome?: string;
}): Promise<string> {
  const { dir, entity, year } = opts;
  const tmp = mkdtempSync(join(tmpdir(), "openbooks-pack-"));
  try {
    const cover = join(tmp, "report.pdf");
    const p = Bun.spawn(
      [
        opts.chrome ?? chromePath(),
        "--headless=new",
        "--disable-gpu",
        `--user-data-dir=${tmp}/profile`,
        "--no-pdf-header-footer",
        "--virtual-time-budget=15000",
        `--print-to-pdf=${cover}`,
        `http://127.0.0.1:${opts.port}/#/print/${year}?e=${entity}`,
      ],
      { stdout: "ignore", stderr: "ignore", timeout: 120_000 },
    );
    if ((await p.exited) !== 0 || !existsSync(cover)) throw new Error(`Chrome couldn't print the cover (exit ${p.exitCode})`);
    const y = String(year);
    const stmts = [
      ...new Set(
        opts.checks
          .filter((c) => c.file.toLowerCase().endsWith(".pdf") && (c.period[0] ?? "").slice(0, 4) <= y && y <= (c.period[1] ?? "").slice(0, 4))
          .map((c) => c.file),
      ),
    ]
      .sort()
      .map((f) => join(dir, "inbox", f));
    const pd = join(dir, "proofs", y);
    const proofs = existsSync(pd)
      ? readdirSync(pd)
          .filter((f) => f.endsWith(".pdf"))
          .sort()
          .map((f) => join(pd, f))
      : [];
    const bytes = await merge(await Promise.all([cover, ...stmts, ...proofs].map((f) => Bun.file(f).bytes())));
    mkdirSync(join(dir, "data"), { recursive: true });
    const out = join(dir, "data", `proof-pack-${year}.pdf`);
    await Bun.write(out, bytes);
    return out;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Reproducible Year-Close / Accountant Handoff Package (.zip):
 * Includes ALL statement files touching the year (PDF, CSV, JSON — never omitting payout CSVs), all proofs,
 * a complete CSV ledger, locked FX rates, tax form overrides, source coverage gaps, broken splits, and unresolved items.
 */
export function buildClosePackage(opts: {
  dir: string;
  entity: string;
  entityMeta: Record<string, unknown>;
  year: number;
  basis: string;
  txns: readonly Txn[];
  splits?: SplitsDoc;
  checks: readonly { file: string; label?: string; period: readonly [string, string] | readonly string[]; parsed?: number; total?: number }[];
  formOverrides?: Record<string, unknown>;
  fxRates?: Record<string, unknown>;
  profile?: Record<string, unknown>;
}): Uint8Array {
  const { dir, entity, year } = opts;
  const y = String(year);
  const enc = new TextEncoder();
  const files: ZipFile[] = [];
  const yTxns = opts.txns.filter((t) => t.date.startsWith(`${y}-`));
  const uncategorized = yTxns.filter((t) => t.category === "ask");
  const broken = brokenSplits(yTxns, opts.splits);

  // Source coverage across ALL statements touching the year (PDF, CSV, JSON)
  const yearChecks = opts.checks.filter((c) => (c.period[0] ?? "").slice(0, 4) <= y && y <= (c.period[1] ?? "").slice(0, 4));
  const coverDates = yearChecks
    .flatMap((c) => [c.period[0] ?? "", c.period[1] ?? ""])
    .filter(Boolean)
    .sort();
  const inboxDir = join(dir, "inbox");
  const stmtNames = [...new Set([...yearChecks.map((c) => c.file), ...yTxns.map((t) => t.file).filter(Boolean)])].sort();
  const includedStatements: string[] = [];
  for (const name of stmtNames) {
    const p = join(inboxDir, name);
    if (existsSync(p)) {
      files.push({ name: `statements/${name}`, data: new Uint8Array(readFileSync(p)) });
      includedStatements.push(name);
    }
  }

  // Proofs for the year (PDF, CSV, JSON, images, etc.)
  const proofsDir = join(dir, "proofs", y);
  const includedProofs: string[] = [];
  if (existsSync(proofsDir)) {
    for (const name of readdirSync(proofsDir).sort()) {
      const p = join(proofsDir, name);
      if (existsSync(p)) {
        files.push({ name: `proofs/${name}`, data: new Uint8Array(readFileSync(p)) });
        includedProofs.push(name);
      }
    }
  }

  // Complete ledger CSV for the year
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const ledgerCsv =
    [
      ["id", "date", "account", "category", "amount", "currency", "desc", "memo", "tags", "why", "source", "file"].join(","),
      ...yTxns.map((t) =>
        [t.id, t.date, t.account, t.category, t.amount.toFixed(2), t.currency ?? "", t.desc, t.memo ?? "", (t.tags ?? []).join(";"), t.why, t.source, t.file]
          .map(esc)
          .join(","),
      ),
    ].join("\n") + "\n";
  files.push({ name: `ledger-${year}.csv`, data: enc.encode("\ufeff" + ledgerCsv) });

  const manifest = {
    schema: "openbooks-close-pack/v1",
    generatedAt: new Date().toISOString(),
    entity,
    entityMeta: opts.entityMeta,
    year,
    accountingBasis: opts.basis,
    coverage: {
      earliestDate: coverDates[0] ?? null,
      latestDate: coverDates.at(-1) ?? null,
      fullCalendarYear: !!coverDates[0] && coverDates[0] <= `${y}-01-01` && (coverDates.at(-1) ?? "") >= `${y}-12-31`,
      statementChecks: yearChecks,
      includedStatements,
      includedProofs,
    },
    reconciliation: {
      transactionCount: yTxns.length,
      uncategorizedCount: uncategorized.length,
      brokenSplits: broken,
    },
    formOverrides: opts.formOverrides ?? {},
    fxRates: opts.fxRates ?? {},
    profile: opts.profile ?? {},
  };
  files.push({ name: "manifest.json", data: enc.encode(JSON.stringify(manifest, null, 2) + "\n") });

  const summary =
    [
      `OpenBooks Year-Close Accountant Package`,
      `=======================================`,
      `Entity: ${entity} (${String(opts.entityMeta.name ?? "")})`,
      `Tax Year: ${year}`,
      `Accounting Basis: ${opts.basis}`,
      `Generated: ${manifest.generatedAt}`,
      ``,
      `Coverage`,
      `--------`,
      `Date span: ${manifest.coverage.earliestDate ?? "none"} .. ${manifest.coverage.latestDate ?? "none"}`,
      `Full calendar year covered: ${manifest.coverage.fullCalendarYear ? "YES" : "NO — check missing statements"}`,
      `Statements included (${includedStatements.length}): ${includedStatements.join(", ") || "none"}`,
      `Proofs included (${includedProofs.length}): ${includedProofs.join(", ") || "none"}`,
      ``,
      `Reconciliation & Unresolved Items`,
      `---------------------------------`,
      `Transactions in ${year}: ${yTxns.length}`,
      `Uncategorized ("ask"): ${uncategorized.length}`,
      `Broken splits (re-import mismatch): ${broken.length}`,
      `Manual form overrides: ${Object.keys(opts.formOverrides ?? {}).join(", ") || "none"}`,
    ].join("\n") + "\n";
  files.push({ name: "README.txt", data: enc.encode(summary) });

  return zip(files);
}

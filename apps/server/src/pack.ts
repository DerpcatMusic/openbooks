// Proof pack (books.py build_pack): a summary cover printed by headless Chrome from the app's #/print/<year> page, then every
// statement PDF whose period touches the year and every proof PDF for the year, merged with pdf-lib (books.py used pdfunite).
import { mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";

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

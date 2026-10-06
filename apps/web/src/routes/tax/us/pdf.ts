// Writes the US pack's IRS form hooks (@openbooks/country-us irs.ts) onto the official blanks next to this file (irs.gov,
// copied from app/irs/) with pdf-lib, plus the Part V statement page. Port of the pdf half of web/src/lib/irs.js.
// pdf-lib is ~1 MB, so the page imports this module on click.
import { PDFCheckBox, PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { ascii, form1120, form1120ProForma, form5472, IRS_PREFIX, partV, PRO_FORMA_STAMP, type CorpInput, type IrsInput } from "@openbooks/country-us";

const BLANKS = { f5472: new URL("./f5472.pdf", import.meta.url).href, f1120: new URL("./f1120.pdf", import.meta.url).href };
const blank = async (name: keyof typeof BLANKS) => PDFDocument.load(await (await fetch(BLANKS[name])).arrayBuffer());
const cents = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Hook output → form: "X" checks a box, anything else is text. A field the blank lacks is skipped, as before. */
function write(doc: PDFDocument, values: Readonly<Record<string, string>>) {
  const form = doc.getForm();
  for (const [name, v] of Object.entries(values)) {
    try {
      const f = form.getField(IRS_PREFIX + name);
      if (f instanceof PDFCheckBox) f.check();
      else form.getTextField(IRS_PREFIX + name).setText(v);
    } catch (e) {
      console.warn("irs: field", name, (e as Error).message);
    }
  }
}

export async function fill5472(d: IrsInput & { de?: boolean }) {
  const doc = await blank("f5472");
  write(doc, form5472(d));
  return doc.save();
}

/** Pro forma 1120 (disregarded LLC, stamped across the top) or, with the C-corp's P&L, the real page 1. */
export async function fill1120(d: IrsInput | CorpInput) {
  const doc = await blank("f1120");
  const corp = "revenue" in d;
  write(doc, corp ? form1120(d) : form1120ProForma(d));
  if (!corp) {
    const page = doc.getPage(0);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText(PRO_FORMA_STAMP, { x: (page.getWidth() - font.widthOfTextAtSize(PRO_FORMA_STAMP, 14)) / 2, y: page.getHeight() - 22, size: 14, font });
  }
  return doc.save();
}

async function statement(d: IrsInput) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const v = partV(d);
  const right = (page: PDFPage, s: string, x: number, y: number, f: PDFFont = font) =>
    page.drawText(s, { x: x - f.widthOfTextAtSize(s, 10), y, size: 10, font: f });
  let page!: PDFPage,
    y = 0;
  const newPage = () => {
    page = doc.addPage([612, 792]);
    y = 740;
    page.drawText(ascii(`${d.legalName}   EIN ${d.ein}   Tax year ${d.year}`), { x: 50, y, size: 11, font: bold });
    page.drawText("Form 5472, Part V - Reportable transactions of a foreign-owned U.S. DE", { x: 50, y: (y -= 18), size: 11, font: bold });
    page.drawText(ascii(`Related party: ${d.owner || ""}. Contributions to and distributions from the entity (U.S. dollars).`), {
      x: 50,
      y: (y -= 16),
      size: 9,
      font,
    });
    y -= 26;
    page.drawText("Date", { x: 50, y, size: 10, font: bold });
    page.drawText("Type", { x: 120, y, size: 10, font: bold });
    page.drawText("Description", { x: 200, y, size: 10, font: bold });
    right(page, "Amount", 560, y, bold);
    y -= 16;
  };
  newPage();
  for (const t of v.rows) {
    if (y < 90) newPage();
    page.drawText(ascii(t.date), { x: 50, y, size: 10, font });
    page.drawText(t.kind, { x: 120, y, size: 10, font });
    let desc = ascii(t.desc);
    while (desc && font.widthOfTextAtSize(desc, 10) > 270) desc = desc.slice(0, -1);
    page.drawText(desc, { x: 200, y, size: 10, font });
    right(page, cents(Math.abs(t.amount)), 560, y);
    y -= 14;
  }
  if (y < 110) newPage();
  y -= 10;
  for (const [k, n] of [
    ["Total contributions to the LLC", v.contributions],
    ["Total distributions to the owner", v.distributions],
    ["Total reportable transactions (Form 5472, line 1f)", v.total],
  ] as const) {
    page.drawText(k, { x: 200, y, size: 10, font: bold });
    right(page, cents(n), 560, y, bold);
    y -= 14;
  }
  return doc;
}

/**
 * One printable packet: 1120 page 1 (the only page with required entries + signature), 5472, and for a DE the Part V statement.
 * Forms are flattened here because both blanks share field names (copied widgets would collide); fill1120/fill5472 alone stay fillable.
 */
export async function filingPacket(d: IrsInput | CorpInput) {
  const corp = "revenue" in d;
  const out = await PDFDocument.create();
  for (const [bytes, pages] of [
    [await fill1120(d), [0]],
    [await fill5472({ ...d, de: !corp }), null],
  ] as const) {
    const src = await PDFDocument.load(bytes);
    src.getForm().flatten();
    for (const p of await out.copyPages(src, pages ? [...pages] : src.getPageIndices())) out.addPage(p);
  }
  if (!corp) {
    const st = await statement(d);
    for (const p of await out.copyPages(st, st.getPageIndices())) out.addPage(p);
  }
  return out.save();
}

export function download(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

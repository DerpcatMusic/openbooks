// The official blank IRS PDFs the web app fills (apps/web/src/routes/tax/us/*.pdf), with where each came from. Every file was downloaded
// from irs.gov on 2026-10-29; `sha256` pins the bytes so a replaced blank (new revision, shifted fields) fails the golden tests in
// forms.test.ts instead of silently landing numbers on the wrong lines. Field maps for each form: forms-irs.ts.
export interface IrsPdf {
  /** Form id used by the field maps and the web writer. */
  id: "5472" | "1120" | "schedule-c" | "schedule-se" | "8995" | "1040-es" | "1099-nec-2025" | "1099-nec-2026";
  file: string;
  /** The tax year the blank is for (the year of the numbers it carries). */
  taxYear: number;
  /** Revision as the IRS prints it. */
  revision: string;
  url: string;
  sha256: string;
}
const pub = "https://www.irs.gov/pub/irs-pdf/";
export const IRS_PDFS: readonly IrsPdf[] = [
  { id: "5472", file: "f5472.pdf", taxYear: 0, revision: "Rev. December 2023", url: `${pub}f5472.pdf`, sha256: "7ac5b2c3ea1c1184cde04f52b6f2faa88d30124d8617beda350da1be5e0c2c1d" },
  { id: "1120", file: "f1120.pdf", taxYear: 2025, revision: "2025", url: `${pub}f1120.pdf`, sha256: "016c7fb4042a565c23a98014b17019af7ddc89e3260dd3f926b84d6688b7be6e" },
  { id: "schedule-c", file: "f1040sc.pdf", taxYear: 2025, revision: "2025", url: `${pub}f1040sc.pdf`, sha256: "ddf401dbe060467d39f90ad2abf645df1de31512821a150dc68a3882bbf19716" },
  { id: "schedule-se", file: "f1040sse.pdf", taxYear: 2025, revision: "2025", url: `${pub}f1040sse.pdf`, sha256: "05bc2b3e1dfca65d8c6fc6d652af4fa3736e953c6575d6e9f82590484677d347" },
  { id: "8995", file: "f8995.pdf", taxYear: 2025, revision: "2025", url: `${pub}f8995.pdf`, sha256: "55380ad230303e1586ce97f0f224265b8337ad18c9204f0fb7325e95a76b5cde" },
  { id: "1040-es", file: "f1040es.pdf", taxYear: 2026, revision: "2026", url: `${pub}f1040es.pdf`, sha256: "396ffad25baa737b33a67d27624f7444be3ac4e7245d287aebe5f89864f90b54" },
  { id: "1099-nec-2025", file: "f1099nec-2025.pdf", taxYear: 2025, revision: "Rev. April 2025", url: "https://www.irs.gov/pub/irs-prior/f1099nec--2025.pdf", sha256: "7cf3272e27de046a92346375601f3211b711a9c800f9185034dd70badcab0abe" },
  { id: "1099-nec-2026", file: "f1099nec-2026.pdf", taxYear: 2026, revision: "Rev. December 2026", url: `${pub}f1099nec.pdf`, sha256: "68a8f00078be6dd6a4912cc4209df317b31840d5fe19560222d39df9f2f7ff49" },
];
/** The blank for a form and tax year, or undefined while the IRS has not published that year's form (Schedule C 2026 comes out around December). */
export const pdfFor = (form: "schedule-c" | "schedule-se" | "8995" | "1040-es" | "1099-nec", year: number): IrsPdf | undefined =>
  IRS_PDFS.find((p) => (form === "1099-nec" ? p.id === `1099-nec-${year}` : p.id === form && p.taxYear === year));

# Israeli filings in OpenBooks

OpenBooks prepares complete, validated files and the figures for each Israeli filing. It cannot submit them: the Tax Authority (ITA)
accepts no third-party submission from software, so you sign in to the Authority's own sites with your own credentials and upload or
type what OpenBooks produced. This page lists what is built, where every rule comes from, what has been checked and what has not.

Read 2026-10-29. Statute texts are the consolidated Hebrew Wikisource versions; layouts are the Tax Authority's published specifications.

## What is built

| Area | Where | Output |
| --- | --- | --- |
| Filing calendar and hub | `/filings`, `packages/core/src/filings.ts`, `packages/countries/il/src/deadlines.ts` | Deadlines by business type, status, done mark with date and confirmation number (doc `filings`), `.ics` export |
| Rest-day rules | `packages/countries/il/src/calendar.ts` | Moves deadlines past weekends, holidays and Chol HaMoed; three-rest-days postponement |
| VAT periodic report | `/filings/vat`, `packages/countries/il/src/vat.ts` | The form's fields, payment due, due dates, issues list |
| PCN874 file | `packages/countries/il/src/pcn874.ts` | `PCN874.TXT` (header 131, record 60, closing 10 characters) |
| Uniform structure (OPENFRMT 1.31) | `/filings/uniform`, `packages/countries/il/src/openfrmt.ts` | Zip with `INI.TXT`, `BKMVDATA.TXT`, `README.TXT` |
| Advances | `/filings/advances`, `packages/countries/il/src/advances.ts` | Income-tax and Bituach Leumi advance schedules, recorded payments linked to bank transactions |
| Form 1301 | `/tax/il`, `packages/countries/il/src/forms.ts` | Turnover, reclaimed VAT, capital and depreciation, advances paid feed the balance |
| Form 1342 | `/tax/il/depreciation`, `packages/countries/il/src/depreciation.ts` | Asset register and yearly deduction |
| MCP tools | `packages/tools/src/filings.ts`, `docs/mcp.md` | `filing_calendar`, `vat_report`, `export_uniform_file` |

## Sources

- VAT Law 1975 s.67(b): report and payment within 15 days of the period. s.67(b1): when at least three of the five days before the
  deadline are rest days, the deadline becomes the fourth weekday after the run of rest days. s.67A(d)(1): detailed reporting within 23 days.
- Income Tax Ordinance s.175(f): same postponement rule for advances. s.175(b): turnover for advances.
- VAT Regulations 1976 reg.20: monthly periods, two-month periods under the turnover ceiling (NIS 1,775,000 from September 2025, indexed).
- Income Tax Regulations (Determination of Advances by Turnover) 1982, reg.2: monthly advances from 15 February, bimonthly under a threshold.
- Tax Authority, "Clarifications regarding the structure of the PCN874 invoices file", Appendices A and C (English version, software-houses
  page on gov.il): header, record and closing layouts and the document types.
- Tax Authority OPENFRMT 1.31 record tables (the simulator's tables, stored in `packages/countries/il/form/openfrmt-1.31.json`) and the
  corrections document for 1.31 (May 2009): folder naming, primary id, record order. Tax Authority presentation of 1 August 2019 for the
  document types.
- Income Tax (Depreciation) Regulations 1941: depreciation classes and rates in `tables/deductions.json` (rule `il.depreciation`).
- Bituach Leumi rates for the self-employed: the rate tables in `packages/countries/il/tables/`.

## Verified and not verified

| Item | Status |
| --- | --- |
| Statutory dates and the rest-day / three-rest-days rule | From statute text; unit tests with Hebrew-calendar cases. Holiday dates use the runtime's Hebrew calendar. |
| Online filing extended to the 19th, detailed reporting on the 23rd | Tax Authority practice from secondary sources only (gov.il page not reachable). Shown with a caveat. |
| PCN874 field widths, signs and order | Built from the published layout; golden tests; the file is read back and its header totals checked against its records. **Not run through the Tax Authority's online simulator** (needs a login). |
| Allocation number placement in PCN874 | An assumption: the spec predates allocation numbers, so the number goes in the last "future allocation" field. |
| OPENFRMT record layouts | From the simulator tables for 1.31. |
| OPENFRMT field values 1011, 1013, 1014, 1029, receipt and payment-type codes, D110 transaction type, record ordering inside the file, CRLF | **Not verified** (the directives PDF is behind a login). Run the zip through the Authority's simulator. |
| Software registration | **Not done.** OpenBooks has no registration number (field 1006 is zeros). The UI says so. |
| Advance due dates for Bituach Leumi | Shown as the 15th of the following month; the rest-day rule is not assumed. Unverified. |
| Depreciation | Straight line on original cost from the month of purchase. Immediate expensing and accelerated rates are not applied. Asset class is guessed from the description unless you set it. |
| Form 1301 boxes filled from the books (036, 037, 112, 136) | Box numbers from the bundled form map; compare with the current year's form before filing. |

## How to file

### VAT (monthly or bimonthly)

1. Set the business number and the reporting frequency on `/filings`.
2. Open `/filings/vat`, pick the period, fix every item marked Fix, review the ones marked Check.
3. Download `PCN874.TXT`.
4. Sign in to the Tax Authority's VAT site with your own credentials, choose to upload a PCN874 file for the period, check the totals it
   reads against the fields shown, submit, and pay by the statutory date.
5. Back on `/filings`, mark the deadline filed with the date and the confirmation number.

### Uniform structure

1. Open `/filings/uniform`, set the range and the business number, download the zip.
2. Load `INI.TXT` and `BKMVDATA.TXT` in the Authority's OPENFRMT simulator and fix what it reports.
3. Give the zip to your accountant or to the Authority when it asks. Because OpenBooks is not a registered program, this is not a
   certified program output.

### Advances

1. Enter the advance rate printed on the Authority's notice on `/filings/advances` (it is not guessed).
2. Pay on the Authority's and Bituach Leumi's sites, then record each payment on the page; link the bank transaction when there is one.
3. Recorded advances reduce the 1301 balance estimate.

### Annual return (1301) and 1342

Review `/tax/il` and `/tax/il/depreciation`; correct the asset classes. The 1301 is an estimate for preparing the return, submitted by you
(or your accountant) on the Authority's site.

## Limits

- Cash basis. Input VAT is dated by the bank transaction, which stands in for the tax-invoice date the law uses. Output VAT is by issue date.
- Foreign-currency documents are converted at the stored rate; a document without a VAT rate is reported as an issue, not guessed.
- Bills (חשבון עסקה) are not tax documents. Receipts for a tax invoice document payment only.
- Dates can move by decree or extension. Check the date on the Authority's site before relying on it.
- The VAT report covers one business; consolidated or branch reporting is not supported.

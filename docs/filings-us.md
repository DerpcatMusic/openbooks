# US federal filings

What OpenBooks produces for US federal taxes, from what, and where the numbers come from. Code: `packages/countries/us/src`, pages `apps/web/src/routes/tax/us`, tools `packages/tools/src/tools.ts`.

**Scope and honesty.** OpenBooks fills the IRS forms and writes upload files. It does not e-file. Electronic filing of 1040, 1120, 1065 and 1099-NEC with the IRS needs an IRS-authorized e-file provider (or, for information returns, an IRIS/FIRE account); the filled PDFs and CSVs are what you hand to that provider or to a preparer. The numbers are a worked estimate from the ledger, not tax advice.

## Which business gets what

`usTrack(businessType)` (`entity.ts`) decides the page. The business type is stored per tax year.

| Business type                                | Track         | Page output                                                                         |
| -------------------------------------------- | ------------- | ----------------------------------------------------------------------------------- |
| `sole-prop`, `llc-us-owner`                  | individual    | Schedule C, Schedule SE, Form 8995 (QBI), 1040-ES vouchers, 1099-NEC, deadlines     |
| `llc-disregarded` (foreign-owned; legacy ids) | foreign-owned | Form 5472 + pro forma 1120, BOI note, Delaware/Wyoming fees, deadlines (no 1099s)   |
| `llc-ccorp`                                  | c-corp        | Form 1120 worksheet at 21%, Form 1120-W estimates, 1099-NEC, deadlines              |
| `llc-partnership`                            | partnership   | Form 1065 worksheet, K-1 worksheet and CSV, owners editor, 1099-NEC, deadlines     |
| `s-corp`                                     | s-corp        | Form 1120-S worksheet, K-1 worksheet and CSV, 1099-NEC, deadlines                   |

Labels are in `apps/web/src/lib/locales/parts/filings-us.{en,he}.ts` and the `setup.kind.*` keys.

## Filled PDFs

Blank forms are downloaded from irs.gov and pinned by sha256 in `pdfs.ts`; a replaced blank (new revision, moved fields) fails the golden tests in `irs.test.ts`. Field maps are in `irs-forms.ts`; the browser writer is `apps/web/src/routes/tax/us/pdf.ts`.

| Form                | Tax year | Revision          | Source                                                 | sha256                                                             |
| ------------------- | -------- | ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| Schedule C          | 2025     | 2025              | https://www.irs.gov/pub/irs-pdf/f1040sc.pdf            | `ddf401dbe060467d39f90ad2abf645df1de31512821a150dc68a3882bbf19716` |
| Schedule SE         | 2025     | 2025              | https://www.irs.gov/pub/irs-pdf/f1040sse.pdf           | `05bc2b3e1dfca65d8c6fc6d652af4fa3736e953c6575d6e9f82590484677d347` |
| Form 8995           | 2025     | 2025              | https://www.irs.gov/pub/irs-pdf/f8995.pdf              | `55380ad230303e1586ce97f0f224265b8337ad18c9204f0fb7325e95a76b5cde` |
| Form 1040-ES        | 2026     | 2026              | https://www.irs.gov/pub/irs-pdf/f1040es.pdf            | `396ffad25baa737b33a67d27624f7444be3ac4e7245d287aebe5f89864f90b54` |
| Form 1099-NEC       | 2025     | Rev. April 2025   | https://www.irs.gov/pub/irs-prior/f1099nec--2025.pdf   | `7cf3272e27de046a92346375601f3211b711a9c800f9185034dd70badcab0abe` |
| Form 1099-NEC       | 2026     | Rev. December 2026 | https://www.irs.gov/pub/irs-pdf/f1099nec.pdf          | `68a8f00078be6dd6a4912cc4209df317b31840d5fe19560222d39df9f2f7ff49` |
| Form 5472 (earlier) | 2025     | Rev. December 2023 | https://www.irs.gov/pub/irs-pdf/f5472.pdf             | `7ac5b2c3ea1c1184cde04f52b6f2faa88d30124d8617beda350da1be5e0c2c1d` |
| Form 1120 (earlier) | 2025     | 2025              | https://www.irs.gov/pub/irs-pdf/f1120.pdf              | `016c7fb4042a565c23a98014b17019af7ddc89e3260dd3f926b84d6688b7be6e` |

Downloaded 2026-10-29. `pdfFor(form, year)` returns nothing for a year the IRS has not published; the buttons are then disabled with a note (Schedule C, SE and 8995 for 2026 are expected around December).

- Schedule C, SE and 8995 are combined into one packet. 1040-ES for year `y` uses this year's estimate; the vouchers for `y+1` use the next-year schedule (`ret.nextEstimates`) and the same 2026 table.
- 1099-NEC: one Copy B per payee (`NEC_COPY_B_PAGE`). Copy A is printed in red ink and cannot be filed from a home printer, so it is not generated; use the CSV with the provider.
- 1065 and 1120-S are worksheets and CSVs only; the forms are not filled.

## Calculations

All pure and tested (`schedc.test.ts`, `tax.test.ts`, `irs.test.ts`). Whole dollars at the line level, as the forms are.

- **Schedule C** (`schedc.ts`): ledger income and expense accounts, mapped by the deduction engine to the form's lines. Meals are 50% (IRC §274(n)(1)); an `expense:meals` account with no engine rule is halved and a warning says so. Car expenses: standard mileage rate or actual. Home office: simplified method, $5 per sq ft, up to 300 sq ft (Rev. Proc. 2013-13). De minimis safe harbor $2,500 per item (Treas. Reg. 1.263(a)-1(f)).
- **Schedule SE** (`tax.ts`): 92.35% of net profit, 12.4% Social Security up to the wage base, 2.9% Medicare, 0.9% additional Medicare over the threshold (Form 8959, https://www.irs.gov/taxtopics/tc560), half of SE tax deducted.
- **QBI** (Form 8995): 20% of the lesser of qualified business income and taxable income before QBI, with the per-year threshold in the table. Above the threshold the wage/property limits and specified-service rules (Form 8995-A) are not modelled; the result is flagged as an upper bound and the page warns.
- **Income tax**: bracket tables and standard deduction from the per-year table (below).
- **1040-ES** (`esWorksheet`): required annual payment is the smaller of 90% of this year's tax and 100% of last year's (110% when last year's AGI was over $150,000), in four installments. Dates are 15 April, 15 June, 15 September, 15 January. If last year's tax is not entered, the page says it used 90% of this year only. Safe harbor: https://www.irs.gov/pub/irs-pdf/f1040es.pdf and IRC §6654.
- **1120** (c-corp): taxable income at 21% (IRC §11(b), https://www.law.cornell.edu/uscode/text/26/11); **1120-W**: installments of 25% of the estimated tax, due the 15th of months 4, 6, 9, 12; not required under $500 of tax (https://www.irs.gov/instructions/i1120w).
- **1065 / 1120-S**: ordinary business income and K-1 allocation by ownership percentage; guaranteed payments and distributions are not modelled beyond the owner table. Box 14 on the 1065 K-1 shows self-employment earnings for general partners.

## 1099-NEC (`contractors.ts`)

- Who: vendors paid for services in the course of business during the year, by check, ACH or cash: sum of the ledger payments to the vendor.
- Threshold: $600 for payments made in 2025; $2,000 for payments made in 2026 and after (OBBBA §70433; https://www.irs.gov/instructions/i1099mec).
- Excluded: card and PayPal/third-party network payments (reported by the processor on Form 1099-K), payments to corporations unless for legal services (vendor `payee: corporation`), foreign payees (`payee: foreign`, W-8BEN; Form 1042-S is not modelled), and vendors flagged exempt. These are vendor flags the user sets; the engine does not infer them from a name or address.
- Vendor fields: TIN, TIN type (EIN when the TIN matches `NN-NNNNNNN`, else SSN, unless set), address, W-9 received, payee name if different. Vendors without a TIN, address or W-9 are listed as issues; a missing TIN also raises a backup-withholding flag (Pub. 1099 part N), not a computed amount.
- Output: CSV with payer, payee, TIN, address, box 1 and issues; per-payee Copy B PDFs; one PDF with all.
- Due: 31 January to the IRS and the recipient (no extension of that date for box 1 reporting; https://www.irs.gov/instructions/i1099mec).

## Foreign-owned disregarded LLC

Form 5472 with a pro forma Form 1120 (penalty $25,000 per form, `form5472Penalty`, https://www.irs.gov/instructions/i5472), due 15 April (15 October extended). No 1099s are prepared on this track because a foreign owner with no US trade or business has no US contractors reporting by default; add them manually if the situation differs.

**BOI.** FinCEN's revised beneficial ownership information rule (final rule published 14 August 2026, effective that day) exempts all companies formed in the US, so a US LLC owned by a foreign person does not file. The page says so and links the rule: https://www.federalregister.gov/documents/2026/08/14/2026-16576/beneficial-ownership-information-reporting-requirement-revision

## Deadlines

`CountryPack.deadlines?(year, facts)` is optional on the contract (`packages/core`); the US pack implements it in `deadlines.ts` and the tax page and calendar read it. Every date moves to the next business day when it falls on a weekend or a District of Columbia legal holiday, including Emancipation Day (16 April) (IRC §7503; Treas. Reg. §301.7503-1; https://www.irs.gov/instructions/i1040gi). Extensions (Form 4868, 7004) extend the time to file, never to pay, and are listed as their own deadline. State items: Delaware LLC annual tax 1 June and corporation franchise tax 1 March (https://corp.delaware.gov/alt-entitytaxinstructions/, https://corp.delaware.gov/paytaxes/); Wyoming annual report on the first day of the formation anniversary month (https://sos.wyo.gov/faqs.aspx?root=BUS); FBAR 15 April, automatic extension to 15 October, for a US owner with foreign accounts over $10,000.

## Tax tables

`packages/countries/us/tables/{2025,2026}.json`. Every `fed.*` key has a source URL in the table's `sources` map; an unknown year borrows the earlier one.

| Key                                  | 2025                                         | 2026                                         |
| ------------------------------------ | -------------------------------------------- | -------------------------------------------- |
| `fed.brackets`, `fed.qbi`            | Rev. Proc. 2024-40 (as amended by OBBBA §70102 and §70105) | Rev. Proc. 2025-32 (OBBBA §70102, §70105) |
| `fed.standardDeduction`              | Rev. Proc. 2025-32                           | Rev. Proc. 2025-32                           |
| `fed.ssWageBase`                     | $176,100 (SSA, https://www.ssa.gov/oact/cola/cbb.html) | $184,500 (SSA)                       |
| `fed.mileage`                        | 70 cents (IR-2024-312)                       | 72.5 cents to 30 June, 76 cents from 1 July (IR-2025-128, IR-2026-29) |
| `fed.safeHarbor`                     | Form 1040-ES; IRC §6654                      | same                                         |
| `fed.addlMedicare`                   | tc560; IRC §3101(b)(2)                       | same                                         |
| `fed.homeOfficeSimplified`           | Rev. Proc. 2013-13                           | same                                         |
| `fed.deMinimis`                      | Treas. Reg. 1.263(a)-1(f)                    | same                                         |
| `fed.corpEstimateMin`                | Form 1120-W instructions                     | same                                         |
| `nec1099`                            | Instructions for Forms 1099-MISC and 1099-NEC | same ($2,000 per OBBBA §70433)             |
| `delawareTax`, `wyomingMin`          | corp.delaware.gov, sos.wyo.gov (read 2026-10-29) | same                                     |

## Verified and not

Verified: unit and golden tests for every calculation and every filled form (`bun --bun vp test`); the sole-prop demo end to end in a browser (Schedule C / SE / QBI / 1040-ES numbers, all PDF downloads opened, a 1099-NEC Copy B for a contractor, the foreign LLC path with the BOI step, the partnership K-1 table, Hebrew right-to-left, 375 px); the MCP tools `us_tax_estimate` and `prepare_1099s` through the in-process server tests.

Not verified or not covered:

- Nothing is submitted to the IRS; there is no e-file. Real filings need an authorized provider and a preparer's judgement.
- Schedule C, SE and 8995 cannot be filled for 2026 until the IRS publishes them; the 2027 estimate schedule reuses the 2026 table.
- 1065 and 1120-S forms are not filled, only worksheets and K-1 CSV; no Schedule K-2/K-3, basis, at-risk or passive-loss limits.
- Not modelled: other income on the 1040, itemized deductions, credits other than a single entered amount, state income tax, Form 8995-A, Form 8829 actual home expenses, depreciation (Form 4562), 1099-NEC for foreign payees, 1099-MISC, W-2/W-3 payroll forms and 941s.
- The vendor-is-a-corporation exemption is a flag set by the user, not detected.

# Mercury Books: behavioral spec (clean-room step 1)

Status: draft for the OpenBooks parity effort. Source: Mercury's public web bundle (build 481836e7, static JS). This is our own prose: it describes behavior, data shapes, endpoint paths and formulas. It contains no copied code and no copied UI copy beyond short labels; long UI messages are paraphrased.

## How to read this

- Confidence tags: **[seen]** = read directly in the bundle (UI code, or the bundle's built-in mock backend, which implements the server rules); **[seen:mock]** = visible only in that mock backend, so the real server may differ in detail; **[inferred]** = deduced from names, shapes or neighboring code; **[gap]** = not recovered.
- Wire conventions [seen]: almost every call is an HTTP POST with a JSON body under `/books/{booksId}/...` (a few are GET, such as XLSX downloads with `?q=<json>`); mutations that return nothing reply `{}`; lists use opaque cursor tokens (`pageToken`, `nextPageToken`). Money is decimal dollars with 2 decimals (the AI layer uses integer cents internally). All dates are UTC; calendar-year reporting; no fiscal-year or timezone setting. Currency is USD only.
- The Books backend is a former acquisition ("Teal"), which is why names such as `tealAccrualSourceId` and `tealSourceAccountId` appear. Mercury Books sits next to Mercury Banking (cards, recipients, Invoicing); several features (Mercury-synced accounts, vendors = banking recipients, invoices from Invoicing, Plaid, Stripe/PayPal, Gusto) are integrations OpenBooks may skip or replace.
- Section 14a lists what OpenBooks can skip. The default chart of accounts is in section 1.

## Findings that change how OpenBooks should be built

1. **Everything is double-entry journal entries.** A bank transaction is a journal entry with one "source" line (on the bank/card ledger) and one or more category lines. Imports first offset to two system fallback ledgers (Uncategorized Cash Inflow / Outflow); "uncategorized" is simply "has a line on a fallback ledger". Review status (reviewed/unreviewed) is independent of categorization. Bills, invoices and payroll runs also post journal entries (creation source `accrual`), and matching a payment rewrites the bank entry (creation source `paymentApplication`). See sections 2, 5, 13.
2. **Categorization method is derived, not stored.** Order of precedence: uncategorized, matched, manual (no autocat result, or the user changed the ledger), rule, else auto. The auto result carries method (llmClassifier, similarity, embedding, transfersBetweenAccounts) and a 0..1 confidence; the Low/Medium/High/Very-high label has exact thresholds (section 2.5). A rule hit has confidence 1.
3. **Rules are deliberately small.** One enrichment only (set ledger), flat AND of up to 7 leaves with each condition type at most once, no OR (use more rules), first active match wins by priority, new rules append last, reorder by placement (first/last/before/after), future transactions only, and a rule becomes `invalid` (kept, ignored) when its ledger is deleted. Banking has a separate, richer rule system for GL codes that Books does not use. See section 3.
4. **Tags: at most one tag per tag group on a line.** Picking a second tag in the same group replaces the first. Tags apply to non-source lines (the grid shows the union). Deactivate is reversible and keeps existing assignments; delete is hard and strips the tag everywhere; deleting a group deletes its tags. See section 4.
5. **Bills, invoices and payroll runs share one "accrual source" model.** Stored status is only draft/open/cancelled; paid, partially paid and overdue are always derived from amounts and due date. Recognition entry: debit expense lines / credit Accounts Payable (invoices mirror against Accounts Receivable); cancel posts a mirrored reversal rather than deleting. A payment is a "payment application" that replaces the uncategorized cash line with allocation lines plus optional adjustment lines. Suggestion rule for matching: exact outstanding equals payment, date inside [effective date, due date + 14 days]. AR/AP and these ledgers are accrual-basis only. See sections 5, 6, 13.
6. **Reconciliation has no per-item "clear" checkboxes.** A reconciliation is a contiguous, non-overlapping date window per source account, anchored to a statement ending date and balance; entries belong to the window by date; difference = book (reconciled) balance minus statement ending balance; Complete stays disabled until the difference is exactly zero (no force-complete). Nothing is hard-locked afterwards: editing an entry inside a completed window needs a confirmation and flips that window to a discrepancy state, which blocks starting new reconciliations until fixed; deleting a window deletes it and every later one. Mercury-synced accounts are "auto-reconciled" with no manual start. See section 8.
7. **The books close date is a soft marker, not a lock.** It must be strictly after the previous close, not in the future, and on or after the entries start date; reconciliation is not required to close; entries stay editable. The bundle uses it only to label report periods and to clamp reports when `includeOnlyClosed` is set; no client-side blocking of edits was found (server behavior unknown). Entries start date can only move earlier in the UI. Accounting basis (cash or accrual) is chosen at instance creation and is not editable in the UI (change via support). See section 10.
8. **Cash Flow Analysis is a ledger-driven roll-forward, not an indirect-method statement.** "Cash" = ledgers flagged `reportCashFlow`. Layout: starting balance (with per-cash-ledger rows), movement (= ending minus starting, computed per column on the client), the net cash flows of the counter (non-cash) ledgers as a category tree, ending balance (with per-ledger rows). A synthetic first range carries opening balances. See section 9.
9. **Chart of accounts**: 5 types, 13 subtypes with a fixed type to normal-balance table; ledger code is a digits-only string up to 20 chars, unique per books; 28 "required ledger purposes" mark system ledgers (each used at most once; fallback, transfers, opening balances, AR, AP, payroll set); delete is hard-delete only (children first, blocked for system/linked ledgers); opening balances are one journal entry per ledger at the start date; cash basis hides accrual-only ledgers. See section 1 for the full 188-row default list.
10. **Reports**: P&L row order and totals are specified (gross profit, operating profit, net profit); balance sheet retained earnings and current-year earnings are synthetic roll-ups; ranges capped at 5 years, charts need 2 to 20 periods; BS/P&L/CF XLSX export is client-side; GL, journal-entry and aging XLSX are server-side. See section 9.
11. **Home dashboard**: monthly burn = average net cash flow of the last 3 complete calendar months, shown only with at least 3 months of history; runway = floor(cash at end of last full month / |average|); net margin and expense ratio only when revenue is above zero. See section 11 (the "coverage" variant is only partly recovered).
12. **Manual journal entries**: need at least one debit and one credit line, equal totals in cents, a ledger on every line, only editable ledgers; imports are paste grids (no file upload). Recurring and reversing entries do not exist in Books. See section 7.
13. **Command (AI)** is a thin client over a shared chat backend: the model proposes "client actions", the browser shows an approval card, and only then calls the ordinary Books API as the user. There are 13 write tools with hard caps (10 ledgers, 100 entries, 200 lines, 100 applications). Good guardrails to copy: re-validate against live data at approval time, reconciliation-impact confirm, soft-only close, abort on org switch. See section 12.

Known unknowns: the real server's default chart of accounts and its cash/accrual differences (only a client mock is shipped), server enforcement of the close date, server-side autocat and transfer detection, the rule-delete logic for ledgers, and the exact shapes of the journal-entry and general-ledger XLSX exports. Section 6 and 13 are the weakest sections (vendor and payroll-run endpoint shapes are partly inferred).

---

## 1. Ledger / chart of accounts

### Purpose
The chart of accounts (COA) is the tree of ledger accounts that every journal line posts to. Each Books instance owns one COA, seeded at instance creation from a "COA template" and edited afterwards. Source accounts (bank, card, loan, etc.) are also ledgers. [seen]

### Data model
- Ledger fields: id, name, type, subType, debitCredit (normal balance), sortCode (the account number, a digit string), parentId, editable, isRequired, deletable, deleteBlockedReason, isAutocatCategory, requiredLedgerPurpose, reportCashFlow, financialAccountType, createdAt, details.openingBalance. [seen]
- Types: asset, liability, equity, revenue, expense. Normal balance by type: asset debit, expense debit, others credit. [seen]
- Subtypes per type: asset = current, non-current, transfers between accounts, uncategorized; liability = current, non-current; equity = equity, retained earnings; revenue = operating revenues, other income; expense = cost of goods sold, operating expenses, other expenses. Cash-basis and accrual-basis share these enums. [seen]
- financialAccountType (links a ledger to a source account): bankAccount, creditCard, payments, payroll, loan, prepaidCard, accountsReceivable, accountsPayable, investment, treasury. Credit normal balance for AP, loan, creditCard; debit otherwise. reportCashFlow is true for bank, prepaid, payments (mock also seeds creditCard). [seen]
- requiredLedgerPurpose (system ledgers; each value at most once per instance, 28 values): uncatInflow, uncatOutflow, accountTransfers, openingBalances, accountsReceivable, accountsPayable, wagesExpense, bonusExpense, commissionsExpense, contractorExpense, employeeReimbursements, severanceExpense, payrollTaxExpense, employerBenefitsExpense, healthInsuranceExpense, benefitsExpense, donationsExpense, wagesPayable, payrollTaxPayable, employeeBenefitLiabilities, payrollLiabilities, benefitsPayable, payrollTaxAccruals, payrollAdjustmentsClearing, stockExerciseClearing, payrollClearing, retainedEarnings, currentYearEarnings. The last two are computed virtual rows in reports, not posted accounts. [seen]
- Mock derivations: isRequired = has a purpose; deletable = no purpose and not Mercury-linked; isAutocatCategory = no financial type, no purpose, editable. [seen, mock only]
- Tree: the API returns a flat list; the client groups by type, nests by parentId, sorts siblings by sortCode; orphans become top-level; duplicate ids are an error. [seen]
- Default templates: server holds two platform templates (cash, accrual), both named as the recommended default. The full default list is NOT shipped in the bundle except in a client mock that emulates the server; the 188-row table at the end of this section is that mock. 16 rows are accrual-only; cash basis drops them (and any child of a dropped row). [seen]
- Template shape: id, name, type (platform or agent/custom), accountingBasis, status (live or draft), ledgers as a tree of nodes with name, sortCode, type, subType, debitCredit, editable, reportCashFlow, financialAccountType?, requiredLedgerPurpose?, isRequired, parentId?, children. [seen]

### API endpoints (all POST in practice; base /books/{booksId} unless noted)
- /ledgers {expand:[details]} returns {ledgers}. [seen]
- /create-ledger {name, type, subType, debitCredit, sortCode, parentId?, openingBalance?} returns {ledger}. [seen]
- /update-ledger {ledgerId, name?, sortCode?, type?, subType?, debitCredit?, parentId?, clearFields?} returns {ledger}; the client filters the payload by edit mode (below). [seen]
- /create-ledgers-bulk {ledgers[]} returns {ledgerResults} each success or error with message; /update-ledgers-bulk {updates[]} same shape with error code and message (e.g. invalidLedger); /delete-ledgers-bulk {ledgerIds} returns {deleteResults} in input order, errors invalidLedger or deletingParentLedger. AI agent tools cap creates at 10 per call. [seen]
- /set-ledger-opening-balance {ledgerId, balance} returns {journalEntry}; /set-ledger-opening-balances-bulk {openingBalances[]} returns per-item success or error. [seen]
- Org-level /books/{organizationId}/: coa-templates/list returns {platformTemplates, agentTemplates}; coa-templates (create draft {name, accountingBasis, status}); coa-templates/{id}/update {name?, status?}; coa-templates/{id}/delete; ledger-templates/bulk {coaTemplateId, ledgers tree}. [seen]

### UI behavior
- Route chart-of-accounts with optional type segment; tabs: All plus five types; a tab with no ledgers is disabled. [seen]
- Columns: code, account (indented tree, icon for system ledger, icon for Mercury-linked), type, subtype, debit/credit, opening balance (signed). Per-column filters and sorting; when filtered or sorted the tree flattens, rows show a dash marker and the parent name in a tooltip. [seen]
- Inline cell editing with autosave; a bulk-edit panel for several rows (excludes code, name, opening balance). Changing type resets subtype to the first valid one and debit/credit to the type's normal side. [seen]
- Add form defaults: asset / current assets / debit / code 1000. Choosing a parent sets code to parent code + 1 and locks type, subtype, debit/credit to the parent's. [seen]
- Export to XLSX named by date; columns code, account, type, subtype, debit/credit, opening balance, nested names joined with colon. [seen]
- Delete: selection auto-expands to all descendants (children first); the action is disabled if anything in the set is not deletable; confirmation warns sub-accounts go too and rules targeting the account become inactive; per-row errors are shown afterward. No archive, only hard delete; deleting a source ledger also drops the source account. [seen]
- Create-instance COA import grid: CSV or XLSX upload, fuzzy column-name matching, hierarchy encoded as colon-separated names, type/subtype/debit-credit accepted as enum value or label (case-insensitive), starts with three blank rows, row actions: add sibling, add child, add parent, outdent, delete (system rows cannot be deleted). Template editor can preview platform templates and edit custom ones. Keyboard shortcuts on the detail panel for edit, delete, save, escape. [seen]

### Business rules
- Edit modes: (a) system ledger (has purpose): only name, sortCode, parentId editable. (b) locked (editable false, no purpose): nothing, or name only when linked to a source account. (c) Mercury-linked source ledger: everything except opening balance. (d) unrestricted: name, sortCode, type, subType, debitCredit, parentId, openingBalance. [seen]
- Parenting: a non-system ledger without system descendants may take any parent and then inherits parent type/subtype/debitCredit. A system ledger, or a ledger containing one, needs a parent with identical type and subtype. No move under self or descendants. [seen]
- Field validation: name required, max 255; sortCode required, digits only, max 20 chars, unique across instance; type, subType, debitCredit required; opening balance optional number. [seen]
- Delete blocked, in priority: default invoicing revenue ledger, default sales-tax ledger, ledger used as Stripe/PayPal revenue/fee/refund target, system ledger, else the server `deletable` flag (its rule is unknown). [seen / server rule inferred]
- Opening balance (mock semantics): signed dollars, 2 decimals; positive = ledger's normal side, negative = opposite; zero deletes it; one journal entry per ledger dated at the instance start date, flagged opening-balance and manual, described "Opening balance for {name}", offset line to the openingBalances ledger; moving the start date moves these entries. [seen, mock]
- Template validation (server): sortCodes unique across whole template; system ledgers unique and valid with immutable type/subtype; missing required system ledgers auto-appended. Custom template flow: create draft, save tree, set live. Import option appears only when no custom template exists; delete only drafts; edit only custom. [seen]
- New source ledgers: asset ones take first free code 10001-10099, liabilities 20001-20099, top-level, no parent. [seen, mock]
- Retained earnings (report row) = cumulative revenue minus expense to period end, minus current-year earnings; current-year earnings = revenue minus expense since Jan 1 of period end year. [seen]
- Cash flow report: reportCashFlow ledgers are "cash"; other ledgers' movements form net cash flow lines. [seen]
- Code ranges shown in hints: 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx revenue, 5xxx-6xxx expenses (the default list actually uses 10000-series). [seen]

### Edge cases
- Default list has "Fixed Assets: Other" (16690) with credit normal balance, probably a mock typo. [seen]
- Cash basis hides accrual-only ledgers; none of the 16 has children. [seen]
- Duplicate ids in flat list crash tree building. [seen]
- Updating a ledger inside bulk can partially succeed; the UI must show per-item errors. [seen]
- Open gaps: real server default COA and basis differences; server `deletable` logic; whether real source ledgers sit under a cash parent. [inferred]

### Default COA (client mock; 188 rows)
Columns: code | name | parent code | T (A asset, L liability, E equity, R revenue, X expense) | subtype (curA, ncA, xfer, uncatA, curL, ncL, eq, RE, opRev, othInc, COGS, opEx, othEx) | nb (D/C) | flags (CF = reportCashFlow; accrualOnly; purpose name).

|code|name|parent code|T|subtype|nb|flags|
|-|-|-|-|-|-|-|
|10000|Cash and Cash Equivalents||A|curA|D||
|10100|Petty Cash||A|curA|D|CF|
|10300|Savings and Treasury Accounts||A|curA|D|CF|
|10400|Payment Processor Balances||A|curA|D|CF|
|10600|Undeposited Funds||A|curA|D||
|10900|Cash - Adjustments||A|curA|D|CF|
|12000|Accounts Receivable||A|curA|D|accrualOnly, accountsReceivable|
|12200|Processor Receivables||A|curA|D|accrualOnly|
|12500|Unbilled and Accrued Revenue||A|curA|D|accrualOnly|
|12900|Allowance for Bad Debt||A|curA|C|accrualOnly|
|13000|Prepaid Expenses||A|curA|D||
|13100|Prepaid Insurance||A|curA|D||
|13300|Prepaid Benefits||A|curA|D|accrualOnly|
|14100|Inventory||A|curA|D||
|14150|Inventory In Transit||A|curA|D||
|14400|Short-Term Investments||A|curA|D||
|15000|Other Current Assets||A|curA|D||
|16000|Loans To Shareholders||A|ncA|D||
|16600|Intangible Assets||A|ncA|D||
|16610|Accumulated Amortization - Intangible Assets||A|ncA|C||
|16630|Fixed Assets||A|ncA|D||
|16640|Fixed Assets: Computers and Equipment|16630|A|ncA|D||
|16645|Accumulated Depreciation: Computers and Equipment|16640|A|ncA|C||
|16650|Fixed Assets: Furniture and Fixtures|16630|A|ncA|D||
|16655|Accumulated Depreciation: Furniture and Fixtures|16650|A|ncA|C||
|16660|Fixed Assets: Leasehold Improvements|16630|A|ncA|D||
|16665|Accumulated Depreciation: Leasehold Improvements|16660|A|ncA|C||
|16680|Fixed Assets: Vehicles|16630|A|ncA|D||
|16685|Accumulated Depreciation: Vehicles|16680|A|ncA|C||
|16690|Fixed Assets: Other|16630|A|ncA|C||
|16695|Accumulated Depreciation: Other|16690|A|ncA|C||
|16850|Startup and Organizational Costs||A|ncA|D||
|16900|Security Deposits||A|ncA|D||
|17000|Operating Lease Right-of-Use Asset||A|ncA|D|accrualOnly|
|18000|Other Non-Current Assets||A|ncA|D||
|19000|Transfers Between Accounts||A|xfer|D|accountTransfers|
|19200|Processor Transfers in Transit||A|xfer|D||
|19300|Credit Card Payments in Transit||A|xfer|D||
|19400|Bill Pay Clearing||A|xfer|D||
|20000|Accounts Payable||L|curL|C|accrualOnly, accountsPayable|
|21000|Credit Cards Payable||L|curL|C||
|21990|Credit Cards Payable - Adjustments||L|curL|C||
|22000|Accrued Expenses||L|curL|C|accrualOnly|
|23000|Deferred Revenue||L|curL|C|accrualOnly|
|23200|Customer Deposits||L|curL|C|accrualOnly|
|23500|Employee Reimbursements Payable||L|curL|C|accrualOnly|
|24150|Wages Payable||L|curL|C|accrualOnly, wagesPayable|
|24200|Sales Taxes Payable||L|curL|C||
|24300|Income Taxes Payable||L|curL|C|accrualOnly|
|24400|Payroll Taxes Payable||L|curL|C|payrollTaxPayable|
|24500|Short Term Debt||L|curL|C||
|24900|Other Current Liabilities||L|curL|C||
|24910|Employee Benefit Liabilities||L|curL|C|employeeBenefitLiabilities|
|24920|Payroll Liabilities||L|curL|C|payrollLiabilities|
|24930|Payroll Adjustments Clearing||L|curL|C|payrollAdjustmentsClearing|
|24940|Benefits Payable||L|curL|C|benefitsPayable|
|24950|Tax Balance Sheet||L|curL|C|payrollTaxAccruals|
|24980|Stock Exercise Clearing||L|curL|C|stockExerciseClearing|
|24990|Payroll Clearing||L|curL|C|payrollClearing|
|27000|Loans From Shareholders||L|ncL|C||
|27050|Long Term Debt||L|ncL|C||
|27200|Convertible Notes Payable||L|ncL|C||
|27300|Operating Lease Liability||L|ncL|C|accrualOnly|
|27900|Other Non-Current Liabilities||L|ncL|C||
|31000|Common Stock||E|eq|C||
|31100|Preferred Stock||E|eq|C||
|32000|Additional Paid-In Capital||E|eq|C||
|32200|Owner, Partner, or Member Contributions||E|eq|C||
|32300|Owner, Partner, or Member Draws||E|eq|D||
|32400|Owner, Partner, or Member Capital||E|eq|C||
|32500|Equity Issuance Costs||E|eq|D||
|33000|SAFE Notes||E|eq|C||
|37000|Dividends and Distributions Paid||E|eq|D||
|38000|Treasury Stock||E|eq|D||
|41000|Sales Revenue||R|opRev|C||
|41100|Subscription Revenue||R|opRev|C||
|41150|Subscription Revenue: Refunds|41100|R|opRev|D||
|41160|Subscription Revenue: Discounts|41100|R|opRev|D||
|41200|Services Revenue||R|opRev|C||
|41250|Services Revenue: Refunds|41200|R|opRev|D||
|41260|Services Revenue: Discounts|41200|R|opRev|D||
|41300|Product Revenue||R|opRev|C||
|41350|Product Revenue: Refunds|41300|R|opRev|D||
|41360|Product Revenue: Discounts|41300|R|opRev|D||
|41400|Usage Revenue||R|opRev|C||
|41450|Usage Revenue: Refunds|41400|R|opRev|D||
|41460|Usage Revenue: Discounts|41400|R|opRev|D||
|41900|Other Revenue||R|opRev|C||
|42300|Chargebacks and Disputes||R|opRev|D||
|43000|Dividend Income||R|othInc|C||
|43100|Interest Income||R|othInc|C||
|43450|Gain or Loss on Disposal of Fixed Assets||R|othInc|C||
|43500|Other Income||R|othInc|C||
|43520|Credit Card Rewards and Cashback||R|othInc|C||
|43580|Grant Income||R|othInc|C||
|43590|Tax Credit Income||R|othInc|C||
|43600|Uncategorized Cash Inflow||R|othInc|C|uncatInflow|
|51000|Cost of Revenue||X|COGS|D||
|51100|Cost of Revenue: Inventory|51000|X|COGS|D||
|51200|Cost of Revenue: Hosting and Infrastructure|51000|X|COGS|D||
|51250|Cost of Revenue: AI Models and Inference|51000|X|COGS|D||
|51300|Cost of Revenue: Software|51000|X|COGS|D||
|51400|Cost of Revenue: Payment Processing Fees|51000|X|COGS|D||
|51450|Cost of Revenue: Platform Fees|51000|X|COGS|D||
|51500|Cost of Revenue: Shipping and Fulfillment|51000|X|COGS|D||
|51600|Cost of Revenue: Contractors|51000|X|COGS|D||
|51700|Cost of Revenue: Employees|51000|X|COGS|D||
|51900|Cost of Revenue: Other|51000|X|COGS|D||
|53000|Payroll Expenses||X|opEx|D||
|53010|Salaries and Wages|53000|X|opEx|D|wagesExpense|
|53020|Bonuses|53000|X|opEx|D|bonusExpense|
|53040|Commissions|53000|X|opEx|D|commissionsExpense|
|53060|Stock-Based Compensation|53000|X|opEx|D|accrualOnly|
|53100|Officers' Salaries|53000|X|opEx|D||
|53150|Guaranteed Payments to Partners|53000|X|opEx|D||
|53180|Contractors and Consultants|53000|X|opEx|D|contractorExpense|
|53200|Benefits Expense|53000|X|opEx|D|benefitsExpense|
|53201|Employer Benefits Expense||X|opEx|D|employerBenefitsExpense|
|53210|Group Term Life Insurance|53000|X|opEx|D||
|53230|Officers' Life Insurance|53000|X|opEx|D||
|53250|Shareholder Health Insurance (2% S-Corp)|53000|X|opEx|D||
|53260|Health Insurance Expense||X|opEx|D|healthInsuranceExpense|
|53300|Retirement Plan Contributions|53000|X|opEx|D||
|53400|Payroll Taxes|53000|X|opEx|D|payrollTaxExpense|
|53500|Payroll Processing Fees|53000|X|opEx|D||
|53530|Recruiting||X|opEx|D||
|53540|Employee Reimbursements||X|opEx|D|employeeReimbursements|
|53550|Other Employee Costs||X|opEx|D||
|53560|Learning, Training, and Development||X|opEx|D||
|53580|Employee Gifts||X|opEx|D||
|53620|Team Events||X|opEx|D||
|53690|Research and Development||X|opEx|D||
|53710|R&D Compute and Data|53690|X|opEx|D||
|53720|Severance Expense||X|opEx|D|severanceExpense|
|53790|Sales and Marketing||X|opEx|D||
|53810|Advertising|53790|X|opEx|D||
|53820|Influencer and Affiliate Marketing|53790|X|opEx|D||
|53830|Conferences, Events, and Sponsorships|53790|X|opEx|D||
|53840|Swag|53790|X|opEx|D||
|53890|Other Sales and Marketing|53790|X|opEx|D||
|53910|Rent||X|opEx|D||
|53930|Utilities, Phone, and Internet||X|opEx|D||
|53950|Repairs and Maintenance||X|opEx|D||
|54000|Technology||X|opEx|D||
|54020|Software and Subscriptions|54000|X|opEx|D||
|54040|Computers and Hardware|54000|X|opEx|D||
|54080|Other Technology|54000|X|opEx|D||
|54800|Insurance||X|opEx|D||
|54820|Business Insurance|54800|X|opEx|D||
|54840|Workers' Compensation Insurance|54800|X|opEx|D||
|54860|Other Insurance|54800|X|opEx|D||
|55000|Professional Services||X|opEx|D||
|55020|Legal|55000|X|opEx|D||
|55040|Accounting, Tax, and Audit|55000|X|opEx|D||
|55070|Other Professional Services|55000|X|opEx|D||
|55090|Design and Creative Services|55000|X|opEx|D||
|55370|Vehicle Lease||X|opEx|D||
|55390|Gas and Auto||X|opEx|D||
|55400|Travel||X|opEx|D||
|55420|Airfare|55400|X|opEx|D||
|55440|Lodging|55400|X|opEx|D||
|55460|Ground Transportation|55400|X|opEx|D||
|55470|Travel Meals|55400|X|opEx|D||
|55490|Travel - Other|55400|X|opEx|D||
|55500|Meals||X|opEx|D||
|55600|Entertainment||X|opEx|D||
|55620|Office Supplies||X|opEx|D||
|55640|Equipment and Small Tools||X|opEx|D||
|55660|Shipping and Postage||X|opEx|D||
|55680|Bank Fees||X|opEx|D||
|55800|Taxes and Licenses||X|opEx|D||
|55820|Dues, Licenses, and Registrations|55800|X|opEx|D||
|55840|Franchise and State Taxes|55800|X|opEx|D||
|55880|Sales and Use Tax|55800|X|opEx|D||
|55890|Other Taxes and Licenses|55800|X|opEx|D||
|55910|Bad Debt||X|opEx|D|accrualOnly|
|55930|Charitable Contributions||X|opEx|D|donationsExpense|
|56000|Penalties and Settlements||X|opEx|D||
|56200|Depreciation||X|opEx|D||
|56250|Amortization of Intangibles||X|opEx|D||
|56900|Other Operating Expenses||X|opEx|D||
|59000|Interest Paid||X|othEx|D||
|59500|Non-Operating Expenses||X|othEx|D||
|59900|Uncategorized Cash Outflow||X|othEx|D|uncatOutflow|
|60100|Income Taxes||X|othEx|D||
|80100|Opening Balance Retained Earnings||E|RE|C|openingBalances|
|80200|Retained Earnings||E|RE|C|retainedEarnings|
|80300|Current Year Earnings||E|RE|C|currentYearEarnings|

---

## 2. Transactions and categorization

### 2.1 Purpose
The Transactions page is the review queue for bank/card activity. Every imported bank transaction is a double-entry journal entry (one line on the bank/card "source" ledger, one or more lines on category ledgers). New transactions first sit in a fallback ledger, an automatic categorizer then assigns a real ledger (or a user rule does), and the human reviews and marks the entry reviewed. [seen]

### 2.2 Data model

**JournalEntry** [seen]
- `id`, `description` (required, max 512), `datetime` (ISO instant), `creationDate`
- `creationSource`: `manual` | `transaction` | `accrual` | `paymentApplication`. The transactions page lists only `transaction` and `paymentApplication`; the manual-journal-entries page lists `manual`; `accrual` entries are bill/invoice/payroll recognition and are read-only here.
- `isOpeningBalance` (bool; opening-balance entries are not editable or deletable from the transaction UI; managed in chart of accounts)
- `reviewStatus`: `reviewed` | `unreviewed` (UI label for unreviewed = "To review")
- `categorizationStatus`: `pending` | `delayed` | `completed` (also entry-level counters `notAttempted` in metrics). `pending` means the autocat pipeline has not finished; row shows an "Auto-categorizing" state.
- `lineEntryIds[]`, `lineEntries[]`
- `autocatResult?` (only when expand includes `autocatResult`), `transfer?` (expand `transfer`), `statementRunningBalance?` (reconciliation views only)

**LineEntry** [seen]
- `id`, `journalEntryId`, `journalEntryDescription`, `datetime`
- `ledgerId`, `ledgerName`, `debitCredit` (`debit`|`credit`), `amount` (non-negative decimal dollars; sign is carried by debitCredit)
- `description` (the line "memo"; max-length constant not recovered; journal description max is 512, memo likely same [inferred])
- `editable` (false when the ledger is system-owned/non-editable, e.g. Mercury-synced source ledgers), `categorizationStatus`, `sortOrder?`
- `opposingLedgerIds[]` (expand `lineEntriesOpposingLedgerIds`; ids of the other ledgers in the entry)
- `tags[]` = `{id, name, tagGroupId}`; written via `tagIds[]`
- `paymentApplications?[]` (expand `lineEntriesPaymentApplications` / `lineEntriesLinePaymentApplications`), each with `accrualSource {type: bill|invoice|payroll, accrualSourceId, referenceNumber, externalId?}`
- `transaction?` (expand `lineEntriesTransactions`): the Mercury bank transaction metadata: `id, amount, datetime, description, postedStatus, reviewStatus, sourceAccountId, personal, transactionMethodKind, counterpartyName, teamMemberName, note, customCategoryName, merchantType{category,display,icon}, cardLastFourDigits, externalMetadataId, attachments[{id,fileName,downloadUrl}]`

**Source line vs category lines** [seen]: the "source line" is the line whose ledger belongs to a source account (bank, card, loan, payments...). Everything else is a category line. Money in = source line is `debit` (asset-normal ledger); money out = source line is `credit`. The displayed signed amount of a transaction = sum over lines on the source ledger of (+amount if line.debitCredit equals ledger's normal side, else -amount). Liability-type source accounts (credit cards) carry `invertTransactionAmounts` which flips the sign convention for imports and display. A split transaction has more than one category line; sum of category lines must equal the source line.

**AutocatResult** [seen] `{id, ledgerId, method, confidence (0..1), ruleId?, createdAt}`.
- `method` enum seen in code: `llmClassifier`, `similarity`, `embedding`, `transfersBetweenAccounts`, `rule`. There is no stored `manual` method [seen]: "manual" is derived (see 2.5).
- Rule results carry `confidence = 1` and `ruleId` [seen:mock]. Non-rule mock confidence is uniform in 0.30..0.99.

**Transfer** [seen] `{fromEntry, toEntry}`, each `{journalEntryId, description, datetime, lineEntries[]}`; the two journal entries are separate (one per bank account) and both route the offset through the system ledger "Transfers Between Accounts" (subType `transfersBetweenAccounts`, purpose `accountTransfers`). Panel shows a "Linked transfer" card with the counterpart (also used for processor payout to bank deposit links).

**Fallback ledgers** [seen]: "Uncategorized Cash Inflow" (sortCode 43600, revenue/otherIncome, credit-normal, purpose `uncatInflow`) and "Uncategorized Cash Outflow" (59900, expense/otherExpenses, debit-normal, purpose `uncatOutflow`). A new bank line that is a debit to the source (money in) is offset to Inflow; money out to Outflow [seen:mock]. These are system ledgers, so they are never valid rule targets.

**Autocat-eligible ledger** `isAutocatCategory = !financialAccountType && !requiredLedgerPurpose && editable` [seen]. Only these are offered as rule outcomes and in the rule popover.

**Transaction processing task** (import job) `{id, status: pending|complete|failed, sourceAccountId, createdDatetime, updatedDatetime}` [seen].

### 2.3 API
| Endpoint | Request | Response |
|---|---|---|
| `journal-entries` (list; the transactions page uses it with `creationSources:[transaction,paymentApplication]`) | see filters below | `{journalEntries[], nextPageToken?, prevPageToken?, totalCount?}` |
| `journal-entry` (get one) | `{journalEntryId, expand[]}` | `{journalEntry}` |
| `create-journal-entry` | `{datetime, description, lineEntries:[{amount, debitCredit, description, ledgerId, tagIds?}]}` | `{journalEntry}` |
| `create-journal-entries-bulk` | `{journalEntries:[...create shape]}` | `{journalEntries[]}` |
| `update-journal-entry` | `{journalEntryId, datetime?, description?, lineEntryChanges?:{create:[...], update:[{id, amount?, debitCredit?, description?, ledgerId?, tagIds?, sortOrder?}], delete:[lineEntryId]}}` | `{journalEntry}` |
| `update-journal-entries` (bulk; used by grid edits, review toggles, rule override) | `{updates:[same shape as above plus reviewStatus?]}` | `{}` |
| `delete-journal-entry` | `{journalEntryId}` | `{}` |
| `delete-journal-entries` | `{journalEntryIds[]}` | `{}` (fails if any id missing) |
| `create-transactions` (manual CSV/paste import) | `{sourceAccountId, transactions:[{id (client uuid), amount, datetime, description}]}` | `{transactionProcessingTask}`; errors if source account or its ledger missing |
| `latest-transaction-processing-task` | `{sourceAccountId}` | `{transactionProcessingTask}` |
| `latest-transaction-processing-tasks` | `{}` | `{transactionProcessingTasks[]}` = currently pending task per account; empty list means nothing importing |
| `categorization/metrics` | `{ledgerIds?[]}` | `{instance:{total,pending,delayed,completed,notAttempted}, ledgers:{[ledgerId]: same}}` |
| `infer-transaction-filters` | `{search, page:"booksTransactions", timezone (IANA)}` | `{filterPayload}` |
| `suggest-transaction-filters` | `{page}` | `{suggestions[], recents[]}` |
| `record-transaction-filter-recent` | `{filterText, page}` | `{}` |
| `record-transaction-filter-feedback` | `{filterText, inferredFilters, reaction: thumbsUp|thumbsDown, page, feedbackText?, supersedesId?}` | `{id}` |
| `instance` | `{}` | `{instance{entriesStart,name,subscription,earliestJournalEntryDatetime,latestJournalEntryDatetime,latestCloseDatetime,accountingBasis,categorizationPipeline}, notificationStatuses[]}` |

[seen] for all rows. Notes:
- All the editable update paths reject unknown journal entries or ledgers with an error keyed on the endpoint.
- Server-side effect on update [seen:mock]: if an entry is `pending`/`delayed` and after the edit none of its lines sit on a fallback (uncategorized) ledger, the entry and its lines become `completed`.
- Unreviewed list gets `includeTotalCount:true` so the "To review (N)" count comes from `totalCount` on page 1.
- Instance flag `categorizationPipeline` is `mercury` (autocat + rules available) or `disabled` (and possibly other legacy values). `isRulesEnabled = (pipeline === "mercury")`; rules endpoints/UI and the autocat banner/badges depend on it; metrics polling only runs when `mercury`. [seen]
- Dismissing one-time banners: POST notification dismissal `{notificationType}`; relevant type `transactionsPageAutocatBannerNotification`. [seen]

**List filters (query/body of `journal-entries`)** [seen]
`ledgerId`; `ledgerIdGroups: string[][]` (entry must satisfy every group; within a group any ledger matches) which carries Account, Category, Source (mercury/external) and account-type-tab filters; `startDate`, `endDate` (date-only); `creationSources[]`/`creationSource`; `journalEntryIds[]`; `keywords` (description substring; mock splits on spaces, every word must appear, case-insensitive); `reviewStatus[]`; `categorizationMethod[]` (values `ai|rule|user|matched|uncategorized`); `categorizationStatus[]` (`pending`); `tagIds[]` (mock: entry must have every listed tag across its lines); `amount` (exact absolute; an integer amount matches any cents in that dollar [seen:mock]); `minAmount`, `maxAmount` (absolute, inclusive); `journalEntrySort`; `pageToken`, `limit` (mock default 200), `includeTotalCount`, `expand[]`.
Expand values seen: `lineEntries`, `lineEntriesPaymentApplications`, `lineEntriesLinePaymentApplications`, `lineEntriesOpposingLedgerIds`, `lineEntriesTransactions`, `accrualSource`, `transfer`, `autocatResult`, `statementRunningBalance`. The transactions page requests payment-application expands (when invoicing/payments features are on) plus `autocatResult` only when rules are enabled.

**Sort enum** `journalEntrySort`: `dateTimeAsc/Desc` (default Desc), `descriptionAsc/Desc`, `amountAsc/Desc` (on the transactions page = signed amount relative to the source ledger), `creationDateAsc/Desc`, `transactionSourceAccountAsc/Desc`, `transactionContraLedgerAsc/Desc` (category; ties by name), `reconciliationContraLedgerAsc/Desc`, `tagNameAsc/Desc` (first tag name alphabetically; no-tag last; tiebreak id), `debitLedgerAsc/Desc`, `creditLedgerAsc/Desc`. Pagination is cursor-style via `nextPageToken`; the UI uses infinite scroll. [seen]

### 2.4 Page behavior
- **Tabs by account type** (route `/transactions/{type}`): All, Bank, Credit card, Pre-paid card, Payments, Investments, Loans, Payroll. A tab is shown only if the org has at least one source account of that type; a tab adds a `ledgerIdGroups` group of that type's source ledgers. Switching tab clears grid filters (AI-applied filters are carried over once). [seen]
- **Columns** (right-most column frozen, row marker shows a check for reviewed rows): Date (sortable, date-range filter within entriesStart..latest), Account (multi-select filter, sortable), Ledger account / category (multi-select filter excluding source ledgers, sortable, editable; header tooltip explains ledger accounts differ from banking categories; inline "create ledger"), Description (sortable, editable, required, max 512; text filter "includes", min 3 and max 100 chars), Tags (editable, sortable), Amount (sortable, filter equals/>=/<=/between, signed relative to the source ledger). A trailing "open" action opens the entity panel. [seen]
- **Toolbar filters**: Review (All / To review / Reviewed; the quick chip shows the live to-review count with an animated change), Categorization method (multi-select, order: Auto, Rule, Manual, Matched, then a separator and Uncategorized), Source (All/Mercury/External: Mercury-synced vs other source accounts), Tags (shown only when at least one tag and one tag group exist), plus AI filter box. Filter state is mirrored in URL query params: `source`, `reviewStatus`, `categorizationMethod` (comma list), `categorizationStatus`, `tags` (comma ids; ids that are unknown or disabled are dropped), `transactionId` (focused entry), plus column filters/sort. [seen]
- **Row editability**: a row is read-only if `creationSource` is `accrual` or `paymentApplication`. Category cell is editable only if every non-source line is editable. Description edits go to the journal entry. Setting a category in the grid sets EVERY non-source line to that ledger (collapses a split) and marks the entry/lines `completed` optimistically. Setting tags sets `tagIds` on every non-source line. Single-cell edits autosave; multi-row edits go through a bulk "save" bar. Success text counts changed rows. [seen]
- **Bulk actions** (selection island): Mark as reviewed (hidden if all already reviewed), Mark as unreviewed (hidden if none reviewed), Delete transactions. Review toggles send `{updates:[{journalEntryId, reviewStatus}]}` only for entries that change; if none change, report "already that status". Delete is disabled with an explanatory tooltip if any selected row belongs to a Mercury-synced source account (Mercury-originated transactions cannot be deleted); entries with non-editable ledger lines also cannot be deleted. After a review toggle while a Review filter is active, rows that no longer match are removed from the list locally and the selection is cleared. [seen]
- **Keyboard shortcuts** [seen]: grid: `R` or Cmd/Ctrl+`R` = mark reviewed, `U` or Cmd/Ctrl+`U` = unreviewed, Cmd/Ctrl+`D` = delete. Entity panel (view mode): Up/Down = previous/next card, Esc = close, Cmd/Ctrl+Enter = full screen, Cmd/Ctrl+`E` = edit, Cmd/Ctrl+`D` = delete, `R`/`U` (no modifiers) = toggle review (only when the entity is a transaction and the toggle changes state; ignored while typing in an input). Edit/create mode: Cmd/Ctrl+`S` = save, Esc = cancel/close card, Cmd/Ctrl+Enter = full screen.
- **Entity side panel (transaction card)**: header with amount and a Money in / Money out badge; two tabs, "Transaction" and "Journal Entry". Transaction tab fields: Date, Description, Memo (source-line memo, max like line memo), Tags (grouped multi-select, hint that tags apply to all associated lines), a Line items grid (Ledger account, Amount, Memo, Tags; add/delete rows in edit mode; the source line is not in the grid; Mercury-synced source rows are locked), linked payment applications, linked accrual source, transfer card, and a read-only Mercury metadata block (To/From, Team member, Card as last four, Category, Notes, attachments as download links). Edit-save is disabled until a change exists and the split validates. [seen]
- **Action bar**: Edit, Duplicate (journal entries only; copies description, datetime, and line ledger/memo/debit/credit; transaction-type entries have no duplicate), Delete, Mark as reviewed/unreviewed, Open in Banking (when the source is a Mercury account), and the match menu. Edit is blocked for `paymentApplication` entries (they must be unmatched first); opening-balance journal entries cannot be edited or deleted. Match menu: for money-in lines with invoicing enabled: "Match invoice" or "Match payroll"; for money-out: "Match bill" or "Match payroll"; without invoicing only "Match payroll". For `paymentApplication` entries the action becomes "Unmatch payment"/"Unmatch payroll" (disabled with a note when the bill was paid via Bill Pay). Permission gates: payment-link/recipient management capability. Matching APIs themselves are `create-payment-applications-for-line-entry` `{lineEntryId, applications:[{accrualSourceId, amount}], adjustments?}` and `delete-payment-applications-for-line-entry` `{lineEntryId}` (returns `{journalEntry}`; creationSource reverts to `transaction`); documented by the accrual section. [seen]
- **Suggestions for matching** (`suggestions-for-payment`) [seen:mock]: type is invoice when the signed transaction amount >= 0, else bill; candidates are `open` accrual sources whose `amountOutstanding` equals |amount| exactly and whose [effectiveDate, dueDate + 14 days] window contains the transaction date; ranked by smallest |dueDate - txDate|, then overdue first, then earliest effective date, then id; `suggestionRank = n - index`.
- **Invoice-match banner**: when the page is opened from an invoice's "find matching transaction" action, a stored `invoiceMatchContext {invoiceNumber, isBannerDismissed}` shows an informational banner that likely matches are shown and filters can be adjusted; dismissal flips `isBannerDismissed`. [seen]

### 2.5 Categorization method semantics
Per-entry derived label (used for badge and the `categorizationMethod` filter) [seen]:
1. `uncategorized` if any line is on a fallback (uncatInflow/uncatOutflow) ledger (takes precedence);
2. `matched` if `creationSource === paymentApplication` (ledger set by a bill/invoice/payroll match);
3. `user` (badge "Manual") if there is no `autocatResult`, or the autocat ledger is no longer among the entry's ledgers (the user changed it);
4. `rule` if `autocatResult.method === rule`;
5. otherwise `ai` (badge "Auto"), i.e. `llmClassifier`, `similarity`, `embedding`, `transfersBetweenAccounts`.

Badge popover per kind: Auto (sparkle) shows a method-specific sentence (similarity: matched to similar already-categorized; embedding: patterns of past categorizations; llmClassifier: bank/card activity with history and metadata; transfersBetweenAccounts: looks like a transfer between your own accounts) and a 4-segment Confidence meter; Rule shows the rule's condition rows and the outcome ledger, "Edit rule" toggles a ledger picker plus "Update rule" and "Delete rule" (deleted rule shows a "rule deleted" state); Matched explains the ledger is set by the matched bill/invoice/payroll run and offers links to open each accrual source; Manual has no popover content. [seen]

**Confidence to label** (`c` = confidence, `method`) [seen]:
- `c < 0.4` -> Low, 1 segment
- else if `method != similarity` or `c < 0.7` -> Medium, 2 segments (so non-similarity methods can never exceed Medium)
- else if `c < 0.9` -> High, 3 segments
- else -> Very high, 4 segments

### 2.6 Autocat progress, banner, polling [seen]
- Banner (sticky, dismissible, persisted server-side by the notification type) is shown only when rules/pipeline are enabled and not dismissed; three blurbs: automatic from start, learns from you, always transparent.
- Toolbar status (priority order): importing (spinner "Importing transactions...") > import complete ("click here to refresh", on click resets list) > pending autocat count from `categorization/metrics.instance.pending` ("Auto-categorizing N transactions", click opens info modal with three explanations) > "Auto-categorization complete" (after pending went from >0 to 0 in this session) with a "View uncategorized" link (hidden when already filtered to uncategorized or when no uncategorized entries exist; existence is checked locally in loaded rows, else by a `limit:1` query with `categorizationMethod:[uncategorized]`).
- Polling: metrics every 2 s while pending > 0 else 30 s; processing tasks every 2 s while any pending else 15 s (30 s for the per-account latest task, 2 s while pending); entries on screen with `categorizationStatus == pending` (max 100 ids) are re-fetched by `journalEntryIds` every 2 s and replaced optimistically, dropping rows that no longer match the active review filter and decrementing `totalCount`. When the tasks list goes non-empty -> empty, the instance data is refetched. A Mercury account sync in progress shows "Syncing your transactions" empty state.
- Empty states: syncing; uncategorized-only filter with nothing -> all caught up (button to clear); To-review with no other filters -> all caught up (button to view all); filtered -> nothing matches; per-type tab empty -> "No <type> transactions yet"; All tab empty -> import call to action.

### 2.7 Import transactions (manual) [seen]
Top-bar "Import transactions" opens a card: choose a source account (importable accounts = business source accounts with a ledger), then a paste/CSV grid with columns Date (>= entries start date, up to 100 years ahead), Description (required), Amount (required, negatives allowed). CSV header auto-match words: date: "date", "posted on"; description: "memo"; amount: "value", "dollars", "cents". The note on the card says whether deposits are positive or negative depending on the account's debit/credit nature and `invertTransactionAmounts`. Validation states: empty (nothing pasted), missing values, errors, pending import (another import for that account is running), checking status. Linked (Plaid-synced) accounts get a duplicate-risk warning. Rows are posted as `create-transactions`; each becomes a journal entry with a single source line and a fallback-ledger line (the import page says each row produces one entry with a single debit and credit). Then the autocat pipeline runs. Journal-entry CSV import (`create-journal-entries-bulk`) accepts columns datetime ("date","posted on"), description ("memo"), debit ledger, credit ledger, amount ("value","dollars","cents"). Sync dates: transactions sync from entries-start, or from the day after the latest journal entry to avoid duplicates. [seen]

### 2.8 Natural-language (AI) filter [seen]
Feature-flagged (`booksAiFilter`). Flow: user types a query -> `infer-transaction-filters` -> `filterPayload` (all optional except `friendlyLabel`): `dateRange {tag: allTime|custom|last30Days|last90Days|thisWeek|lastWeek|thisMonth|lastMonth|thisQuarter|lastQuarter|twoQuartersAgo|threeQuartersAgo|lastSixMonths|thisYear|lastYear, contents:{startDate,endDate} for custom}`, `amount {min?,max?}` (equal when min==max), `searchTerm [{query}]` (first term becomes the description filter only when 3..100 chars; extra terms are reported as dropped), `sortSettings {primary:{tag: date|account|amount|counterparty, contents: asc|desc|absoluteValueAsc|absoluteValueDesc}}` (counterparty and absolute-value sorts are unsupported and dropped), `booksLedgerIds`, `booksSourceLedgerIds`, `booksTagIds` (only when the tag filter is available), `booksReviewStatuses` (applied as a Review filter only when exactly one status), `booksCategorizationMethods`, `booksSource`, `booksFinancialAccountType` (switches the tab if that tab exists), `grouping` (dropped). The translator keeps only IDs that exist, and the UI lists what was dropped. Applying records a "recent" (`record-transaction-filter-recent`) unless the query came from the recent list; thumbs up/down posts feedback (a follow-up can supersede an earlier feedback id). Manual changes to grid filters clear the "AI applied" state. Empty-query suggestions come from `suggest-transaction-filters`, with four canned fallbacks (uncategorized this month, unreviewed over $1,000, software spend last quarter, credit-card charges categorized by AI). Page id for all calls: `booksTransactions`. The model itself is server-side; clients only send text, page, timezone.

### 2.9 Edge cases
- Entry with categories on non-editable ledgers cannot be deleted; Mercury-sourced entries cannot be deleted at all, and their source-line ledger/amount are locked (tooltips explain it is real transaction data).
- Split validation (transaction card): lines are entered as signed numbers relative to the source line: positive = opposite side from the source line, negative = same side; on save `amount = |x|` and `debitCredit = (x<0 ? source side : opposite)`. Sum of signed split amounts must equal the absolute source amount, else the card refuses to save (error code `amountMismatch`; other codes `noChanges`, `missingFields`). New split rows prefill the remaining amount.
- Manual journal entry validation: at least one debit and one credit line, total debits == total credits, every line needs a ledger, non-empty description, date >= entries start; error codes `noChanges`, `debitsCreditsMismatch`, `missingFields`, `missingDebitLine`, `missingCreditLine`. If an affected ledger's period is already reconciled, the user must confirm a "reconciliation discrepancy" dialog before create/update/delete.
- Reviewing is independent of categorizing; categorizing an unreviewed entry leaves it unreviewed. [inferred]
- Deleting a rule does not recategorize entries it already categorized (the badge simply shows the rule as deleted). [seen]

---

## 3. Rules (categorization / predicate rules)

### 3.1 Purpose
A Books rule maps transaction attributes to ONE ledger account, applied automatically (before the AI) to incoming Mercury transactions. Books rules only set the ledger; they cannot mark reviewed, exclude from review or set a banking category. [seen]

### 3.2 Data model [seen]
```
PredicateRule { id, condition: Condition, enrichments: Enrichment[], status: "active"|"invalid", lastApplied?: ISO instant }
Condition = conditionAll{contents: Condition[]}   // AND of leaves, flat (no OR, no nesting in practice)
          | conditionAmount{contents:{operator, amount}}
          | conditionDescription{contents: string}      // case-insensitive substring of raw bank description
          | conditionCounterparty{contents: string}     // To/From name, exact match; Mercury-sourced only
          | conditionDebitCard{contents: cardId} | conditionCreditCard{contents: cardId}
          | conditionUser{contents: userId}             // team member who made the transaction
          | conditionCustomCategory{contents: categoryId} // Mercury custom (banking) category
amount operators: amountLessThan, amountLessThanOrEqualTo, amountGreaterThan, amountGreaterThanOrEqualTo, amountEqualTo
Enrichment = enrichmentSetGlCode{contents: ledgerId}      // the only enrichment in Books
```
- A rule with a single leaf stores the bare leaf; two or more leaves are wrapped in `conditionAll`.
- Amount compares the signed transaction amount (negative = money out) in dollars (sent as decimal). UI exposes inclusive operators only: At most (`<=`), At least (`>=`), Equal, Between (stored as one GTE leaf + one LTE leaf). Strict `<` / `>` exist in the model/display (symbols < <= > >= =) but are not creatable in the form.
- `status = invalid` when the target ledger was deleted: shown greyed with a badge, ignored for matching, user is told to update or delete it. `lastApplied` is set by the engine when the rule fires.
- A rule's ledger must be autocat-eligible (editable, non-system, not a source-account ledger); the AI-assistant tool also validates the ledger name/id pair and that referenced cards are active and of the stated debit/credit kind, team members and categories exist.

### 3.3 API [seen]
| Endpoint | Request | Response |
|---|---|---|
| `predicate-rules/list` | `{}` | `{rules[]}` in priority order |
| `predicate-rules/create` | `{condition, enrichments}` | the new rule (`status: active`), appended at the END (lowest priority) |
| `predicate-rules/update` | `{id, condition?, enrichments?}` | updated rule |
| `predicate-rules/delete` | `{id}` | `{}` |
| `predicate-rules/reorder` | `{ruleId, placement}` where `placement = {tag: placeFirst}` / `{tag: placeLast}` / `{tag: placeBefore, contents: otherRuleId}` / `{tag: placeAfter, contents: otherRuleId}` | `{rules[]}` full new order; unknown sibling -> moved to the end |

Reorder UI: drag handle; moving to index 0 sends `placeFirst`, else `placeAfter` the new previous rule; optimistic local reorder with rollback on failure; disabled when the user lacks manage-books permission or rules are disabled.

### 3.4 Evaluation semantics
- Rules are evaluated top-to-bottom; the first active matching rule wins (table tooltip says exactly this); status `invalid` skipped. [seen]
- All leaves of a rule are ANDed; there is no OR (to cover alternatives, create several rules). [seen]
- Rule firing produces `autocatResult {method: rule, confidence: 1, ruleId}`; the entry's ledger is set to the rule's ledger. [seen:mock]
- Applies to FUTURE transactions only; creating or editing a rule does not recategorize already-categorized entries. The one exception: editing the rule's ledger from a transaction's categorization popover also updates that transaction's matching lines (so this transaction plus future matches). [seen]
- Duplicate guard: UI refuses to save a rule whose normalized condition (flattened leaves, JSON-sorted, description lowercased) equals another ACTIVE rule's. [seen]
- Multiple-leaf restrictions in the creation form: each condition TYPE can appear once (Amount, Description, To/From, Card, Team member, Category; a debit and credit card count as one "Card" type); options with no data (no cards, team members or categories) are disabled. Amount "between" requires min <= max. [seen] The assistant tool allows 1..7 conditions, at most two amount leaves and then only one GTE plus one LTE with min <= max.
- Condition groups in the picker: "All transactions" (Amount, Description) vs "Mercury transactions only" (To/From, Card, Team member, Category). Card options list only ACTIVE cards labeled by default display name; value encoded `kind:cardId`. [seen]
- Description text trimmed, non-empty; counterparty trimmed non-empty exact match. [seen]

### 3.5 UI [seen]
- Rules page (`/rules`, entity param `ruleId`): table columns Priority (1-based index), Input (what is tested, joined by "If" then "&"), Condition (operator + value), Outcome (ledger name, with Invalid badge if applicable), Last applied (relative/empty), drag handle. Empty state offers Create rule. Rows open the entity panel (view/edit/delete via panel; edit disabled with tooltip when user lacks permission).
- Create/edit card: stack of condition rows ("If", then "and"), each with type select, operator segmented control for amount, value inputs; Add condition (hidden when all types used), Remove condition; "Then" ledger select (only autocat-eligible ledgers); footer note "future only". Save disabled while loading, empty/invalid conditions, duplicate rule, or (edit mode) unchanged. Initial conditions/outcome can be pre-filled by callers (e.g. from a transaction).
- From a transaction: the categorization popover for Rule-method entries shows the rule, with Edit rule (change ledger), Update rule, Delete rule; toasts for success/failure.
- Banking-side mirror (not Books): when a user overrides a GL code on a banking transaction a "create rule" suggestion card appears (`onGlCodeOverrideRuleSuggestion`, "in-situ rule"), feeding Banking's rule system below; the shared combobox marks values "Suggested by Mercury" (sparkle) vs "Set by a rule" (bolt).

### 3.6 Relationship to Mercury Banking rules
- Banking has its own autocat V2 rules at `/organizations/{orgId}/categorization-rules-v2/{list,create,update,delete,update-placement}` [seen] with a different shape: `condition = conditionCompare{field, op, value:{tag:text|number, contents}}` or `conditionAll{conditions:[...]}`; fields: `bankDescription` (`contains`), `amount` (`lt|le|eq|ge|gt`, magnitude with a sign-aware "money out" display), `counterpartyName` (`eq`/`contains`), `recipientId`, `customerId`, `expenseCategoryId` (custom category), `mercuryCategory` (merchant type enum of ~38 values such as Software, Restaurants, Airlines), `debitCardId`, `creditCardId`, `userId`, `userBudgetId`, `departmentId`; enrichments `setGlAccount`, `setCustomCategory`, `excludeFromReview`, `markAsReady` (auto-mark ready to sync) [seen], and probably `setGlCode`, `setRutterClass`, `setBudget` [inferred from tags present elsewhere]; list rows carry `glCodeName`, `expenseCategoryCodeName`, `lastApplied`, `status`. Placement uses the same placeFirst/placeLast/placeBefore/placeAfter tags with `autocatRuleId`. Rules are first-match; these drive ERP GL codes, not Books ledgers.
- Mapping into Books: Books rules reference Banking concepts only through conditions: `conditionCustomCategory` (a Mercury custom category), cards, team member, counterparty, bank description; i.e. a banking category does not automatically map to a ledger; the user creates a Books rule if category is X then ledger Y (rule table "Mercury transactions only" group). The file `useMercuryCategoryMappingRules` in the bundle is an unrelated support-chat chunk and contains no mapping logic. [seen]
- Banking also has `/mapping-rules/.../custom-category-rule` and `merchant-rule` endpoints for merchant/category mapping (banking only). [seen: paths only]

### 3.7 Edge cases
- Deleting a ledger makes dependent rules `invalid` rather than deleting them.
- Rules need `categorizationPipeline == mercury` and permission to manage books; otherwise the rules query is not even issued and create/reorder are disabled.
- Changing the rule ledger via the popover issues both a rule update (enrichments only) and a journal entry update (`lineEntryChanges.update` for lines on the old ledger, plus the stored autocat ledgerId rewritten locally).
- Open: whether the server re-runs rules on existing uncategorized entries after create is not visible; UI copy says future only.

---

## 4. Tags and tag groups

### 4.1 Purpose
Dimension labels (e.g. Department, Location, Segment) attached to journal line entries for filtering and reporting. A tag always belongs to exactly one tag group. [seen]

### 4.2 Data model [seen]
```
TagGroup { id, name, ownership: "instance" | (platform-managed), createdAt }
Tag      { id, name, tagGroupId, tagGroupName, enabled: boolean }
LineEntry.tags[] = { id, name, tagGroupId }       // write via lineEntry tagIds[]
```
- Default demo set: groups Department (Engineering, Sales, Marketing, Product, Operations), Location (New York, Chicago, San Francisco, Los Angeles), Segment (SaaS, Professional Services, Hardware); all `ownership: instance`, tags enabled.
- `ownership != instance` groups are platform groups managed by Mercury: cannot be renamed or deleted (UI hides Delete, edit disabled, server rejects).

### 4.3 API [seen]
| Endpoint | Request | Response |
|---|---|---|
| `tags` | `{includeDisabled?: bool}` (UI always passes true and filters client-side) | `{tags[]}` |
| `tag/create` | `{name, tagGroupId}` | `{tag}` (enabled) |
| `tag/{tagId}/update` | `{name?, enabled?}` | `{}` |
| `tag/{tagId}/delete` | `{}` | `{}` (hard delete) |
| `tag-groups` | `{}` | `{tagGroups[]}` |
| `tag-groups/create` | `{name}` | `{tagGroup}` (ownership instance) |
| `tag-groups/update` | `{tagGroupId, name}` | `{tagGroup}`; renaming updates `tagGroupName` on its tags |
| `tag-groups/delete` | `{tagGroupId}` | `{}`; deletes the group AND all its tags |

### 4.4 Validation rules [seen]
- Tag name: non-empty; whitespace typed or pasted is converted to `-`; only Unicode letters, Unicode numbers and `-`; cannot start or end with `-`; no two consecutive `-`; unique within its group (exact match client-side; rename may keep own name). Tag group chosen at creation; if exactly one group exists it is fixed and shown read-only; creation is blocked when no group exists. Tags cannot move between groups (no groupId on update).
- Tag group name: trimmed non-empty; unique case-insensitively among instance-owned groups (self excluded on rename).
- Permissions: an admin-level capability is needed to manage tags/groups, otherwise forms are disabled with a message.

### 4.5 Semantics
- Exclusive per group: a line entry can hold at most one tag from each group. When a user picks a second tag in a group, it replaces the previously selected tag from that group (a new selection wins over the old one). The same rule applies when applying a selection to a line that already has tags: merge by group, new selection replaces same-group existing tags, other groups preserved. [seen]
- Only `enabled` tags are selectable; inactive tags that already sit on entries remain, shown dimmed with an "(inactive)" marker. Deactivate (`enabled:false`) is reversible; the confirm dialog says the tag stays on existing entries/rules but cannot be added to new ones. Delete is permanent and removes the tag from all line entries, transactions and "tag rules" (the product copy mentions tag rules; Books rules currently set only a ledger, so tag rules are not yet visible in the bundle). [seen]
- Tags are applied at line level but shown at transaction level: the Tags cell on the transactions grid shows the union of tags on non-source lines; editing it writes the same `tagIds` to every non-source line (tags apply to all associated line entries). In split editing, each line has its own tags; a top-level tag pick merges into each line by group. [seen]
- Filtering: the transactions page Tags filter and report drilldowns pass `tagIds` to `journal-entries` and line-entries; mock semantics require the entry to carry every selected tag (AND). Selector shows options grouped by tag group, disabled/inactive excluded. Unknown or disabled ids in the URL param are dropped. [seen / AND is mock-only]
- Sorting by tag uses the alphabetically first tag name per entry; entries without tags sort last in ascending order. [seen:mock]
- Tag client sort comparator: case-insensitive name compare, id as tiebreak. [seen]

### 4.6 UI [seen]
- **Tags page** (`/tags`): table columns Tag name (sortable, default asc, chip with dimmed style when inactive), Tag group (sortable), Status (Active/Inactive badge; sortable, inactive-first or active-first), actions menu (Manage, Activate/Deactivate). Row click opens the entity panel (edit name). Top-bar action Create tag (disabled while loading or when no tag group exists). Empty state with different guidance depending on whether groups exist. Deactivate opens a confirm; Activate acts immediately with success/failure toasts; delete (from the panel) opens a destructive confirm.
- **Tag groups page** (`/tag-groups`): columns Name, Created at (date), Tags (chips with inactive styling or "No tags"), actions (Manage tag group, Add tag which opens tag creation with the group preselected, Delete tag group only for instance-owned). Sortable by name, created, tags. Delete confirm warns that all tags are removed from entries and rules.
- Tag selector component: grouped multi-select, clearable, "No tags available" empty text, optional helper line, analytics `books/tag-selector/change` with tagCount. Truncating chip list with "+N" overflow in table cells.

### 4.7 Edge cases / gaps
- Whether the server also enforces one-tag-per-group on write is not visible (clients enforce it); treat as client rule plus server-side validation [inferred].
- Name uniqueness server-side may be case-insensitive for tags; client compares exact strings [inferred].
- Not recovered: exact max length for tag and group names, memo max-length constant, default list page size, server algorithm for tag-filter AND/OR, how autocat classifier methods are chosen or how transfers between accounts are detected on the server (mock picks randomly).

---

## 5. Bills & vendors (AP)

**Tags:** [seen] = read directly in the shipped web bundle (UI code or its built-in mock backend, which mirrors server semantics); [inferred] = deduced from shapes, names or neighbouring code.

### Purpose
Track money the business owes (bills), who it owes it to (vendors), age the debt, and tie bank payments to bills so accrual-basis books show AP correctly. A bill is one kind of "accrual source"; the other kinds are invoices (section 6) and payroll runs (section 13). [seen] The backend is a former acquisition ("Teal"), so API paths contain `tealAccrualSourceId` style names. [seen]

### Data model
**AccrualSource** (shared by bills/invoices) [seen]:
- `id`; `type` enum: `bill` | `invoice` (payroll runs are a separate, richer object); `referenceNumber` (string, optional); `externalPartyId` (tagged union, see below); `effectiveDate` and `dueDate` (ISO dates, server format `YYYY-MM-DD`); `status` enum: `draft` | `open` | `cancelled` (plus `paid`-like states are NOT stored, they are derived); `notes` (string); `files[]` ({id, fileName}); `journalEntryIds[]`.
- Amounts: `grossAmount`, `amountPaid`, `amountOutstanding` (= gross - paid). Decimal-dollar numbers rounded to cents.
- `lines[]`: {id, accrualSourceId, accountId (ledger), lineNumber (1-based, sequential), description, amount, externalId?}.
- `displayStatus` (derived, never written): if `status` is `open` then: gross>0 and outstanding==0 -> `paid`; gross>0 and outstanding<gross -> `partiallyPaid`; else dueDate earlier than today -> `overdue`; else `open`. Any other stored status passes through (`draft`, `cancelled`). [seen]
- `externalPartyId` is a tagged union `{tag, contents}` with tag `vendorId` | `counterpartyId` | `customerId`; bills use the counterparty/vendor tags, invoices the customer tag. [seen] Whether "vendor" and Banking "recipient/counterparty" are the same record: the aging report maps accounts-payable parties to `counterpartyId`, receivable to `customerId`, so a vendor is a Banking counterparty (recipient) viewed from Books. [seen/inferred]

**Vendor** [seen/inferred]: id, name, plus counterparty info (email, address, payment details owned by Banking). The vendors grid shows a vendor with its bill count and outstanding total. Vendor "entity" page lists that vendor's bills and transactions.

### API endpoints (team `mercury-books`, all scoped by `booksId`)
- List: `POST /books/{booksId}/accrual-sources` returns `{records[]}` (cursor `pageToken`; optional expand of `paymentApplications` adds each source's applications). Filters (all optional, ANDed): `type` (bill|invoice, required in practice), `ids[]`, `effectiveDateStart/End`, `dueDateStart/End` (sources with no due date fail any due-date bound), `status[]` (stored), `displayStatus[]` (derived), `referenceNumber` (case-insensitive substring), `grossAmount` (an integer value matches any cents in that dollar; otherwise exact), `minGrossAmount` (inclusive) / `maxGrossAmount` (exclusive), `amountRemaining` (same integer rule on outstanding), `minAmountRemaining` / `maxAmountRemaining` (exclusive), `externalPartyIds[{tag,contents}]`, `keywords` (space-split words; every word must appear in reference number, notes or any line description, case-insensitive). Invoices are hidden entirely when Invoicing is not connected. [seen, mock + UI]
- Create: request {type, referenceNumber, externalPartyId, effectiveDate, dueDate, status (default `open`), notes, lines[{ledgerId, amount, description, externalId?}], fileIds?}. Response the full accrual source with generated ids and line numbers starting at 1. Line `ledgerId` must exist or the call errors ("unable to find ledger"). [seen]
- Update (partial, only present keys applied): `referenceNumber`, `externalPartyId`, `effectiveDate`, `dueDate`, `notes`, `status`; `lineChanges` {create[], update[], delete[ids]}; `fileChanges` {link[fileIds], unlink[fileIds]}. `type` and `cancellationDate` are accepted but ignored by the mock. After any update: grossAmount = sum of line amounts, outstanding = gross - paid, displayStatus recomputed. New lines get lineNumber = max existing + 1. [seen]
- Delete accrual source (removes entirely, used for drafts) and cancel (status -> `cancelled`, creates reversal JE). Mock `delete` throws if the id is unknown. [seen]
- Payment applications: `POST create-payment-applications-for-line-entry` (empty response; body `{lineEntryId, applications:[{accrualSourceId, amount}], adjustments?}`), `POST delete-payment-applications-for-line-entry` `{lineEntryId}` (removes all applications on the line; returns `{journalEntry}`), `POST suggestions-for-payment` `{lineEntryId, type: invoice|bill, plus the list filters, pageToken}` returning `{accrualSources[], suggestions:[{accrualSourceId, suggestionRank}]}`. Suggestion rule: type is invoice when the signed bank amount is >= 0, else bill; candidates are `open` sources whose outstanding equals the absolute payment exactly and whose [effective date, due date + 14 days] window contains the transaction date; ranked by smallest distance between due date and transaction date, then overdue first, then earliest effective date, then id; rank = list length minus index. [seen]
- Aging report: JSON report endpoint plus `GET /books/{booksId}/aging-report.xlsx?q=<json>` for XLSX download. [seen]
- Attachments: files are uploaded separately then linked by id via `fileChanges.link`. [seen]

### Journal entries generated by bills [seen]
- Status `draft`: no JE. Status `open` or `cancelled`: a recognition JE is created, dated at the effective date, `creationSource = accrual`, `reviewStatus = unreviewed`, not editable.
- Bill recognition: one line per bill line on the line's ledger (debit when the line amount is positive, credit when negative), plus one balancing line on the system "Accounts Payable" ledger for the sum of line amounts on the opposite side (credit). Invoices are the mirror image against "Accounts Receivable" (debit AR, credit line ledgers).
- Cancelled: an additional reversal JE with description a reversal description that references the bill's reference number with every side swapped. Both JE ids are stored in `journalEntryIds`.
- Amounts: absolute value per line, sign decides side.

### UI behavior
- Bills page: shared accrual list with tabs/filters by displayStatus (open, overdue, partiallyPaid, paid, draft, cancelled), party filter, date filter, search by reference. Columns: vendor, reference, effective date, due date, status chip, gross, outstanding. [seen/inferred]
- Needs-action banner when bills exist without a matched payment or with unreviewed state (logic near the `needs action` helpers: a bill is "needs action" if open/overdue and outstanding>0). [seen/inferred]
- Create bill form: vendor select (or create), reference, effective date, due date, line items grid (ledger, description, amount, add/remove row), notes, attachments. Defaults: status `open`, effective date today, due date offset by a terms constant. [seen constants, exact term inferred]
- Edit rules: a bill whose stored status is `cancelled` is read-only; bills with payment applications cannot change gross below paid and cannot be deleted, only cancelled. [seen/inferred]
- Delete vs cancel modal: drafts and never-paid bills offer delete (no JE trace once draft); posted bills offer cancel, which keeps history through the reversal JE. If payments are matched the modal warns the user to unmatch first. [seen/inferred]
- Detail panel: header status, lines, linked bank transactions (payment applications), JEs, notes, files.
- Match action bar on entity views: match a bank transaction to bills, and unmatch.

### Payment application and matching [seen]
- A payment application = {bank line entry id, allocations[{accrualSourceId, amount, adjustments[{ledgerId, amount}]?}]}. Adjustments cover discounts/fees/FX writing the remainder to a chosen ledger.
- Effect on source: amountPaid += |allocation| + sum(|adjustment|); amountOutstanding = gross - paid; displayStatus follows the derivation above.
- Effect on the bank JE: the Uncategorized Cash Outflow/Inflow line is replaced by lines against Accounts Payable (bill) or Accounts Receivable (invoice) for each allocation, plus adjustment lines; JE `creationSource` becomes `paymentApplication`.
- Deletion of a payment application reverses all of the above and restores the uncategorized line.
- `suggestions-for-payment`: ranks open sources of the right type (bill for outflow, invoice for inflow) by party match, exact outstanding==payment amount, then due date proximity. [seen intent, scoring inferred]
- Matching table UI (modal): checkbox rows, an editable "apply" amount per row prefilled with min(outstanding, remaining payment), remaining-to-allocate total, and an "add adjustment" modal (ledger + signed amount). Save is blocked while remainder is not fully allocated or adjustments make it negative. [seen/inferred]

### Aging report [seen]
- Params: `asOf` (default today, may not exceed today + 10 years), `periods` integer 1..12 (default 3), `parties` comma list, `view` = `party` | `source`, account type `accountsReceivable` | `accountsPayable`.
- Buckets: index 0 = "current" (not yet due as of asOf), then each period of equal width (default 30 days) overdue: 1-30, 31-60, 61-90... Items bucketed by `asOf - dueDate`. Last bucket is open ended. An "Overdue" column = sum of all buckets after index 0; "All periods" = total.
- Per party row: sourceCount, bucketTotals[], overdue, total; percent-of-total with 1 decimal (`x.x%`). Source view lists each source with bucket index, overdue (=outstanding when bucket>0 else 0) and total.
- XLSX export mirrors the filters.

### Edge cases
- Zero or negative gross (credit memos): paid when outstanding==0 only if gross>0; negative bills never show `paid`. [seen]
- Due date null: never overdue. [seen]
- Updating `status` directly is allowed on the mock; production likely restricts to draft->open and open->cancelled. [inferred]
- Closed books: no client-side check of the books close date was found on bill/invoice/payroll create, edit or cancel (the close date only drives report headers/clamping, the close modal and the Books-details display). Whether the server rejects postings on or before the close date is unknown. Entries before the entries start date are the enforced limit. [seen absence; server inferred]

---

## 6. Invoices & customers

### Purpose
Revenue-side mirror of AP. Invoices are created in Mercury Invoicing (a separate product, team `invoicing`) and mirrored into Books as accrual sources of type `invoice`, so AR, revenue ledgers and cash matching work. [seen]

### Data model
- **Invoicing invoice** (`arInvoiceId`, `invoiceResponse`): customer, line items, amounts, statuses, manual payments. [seen]
- **Customer** (`arCustomerId`): name, email, address, additional emails[], `deletedAt` (soft delete; list defaults to filtering out deleted). [seen]
- **Books invoice** = AccrualSource with `type=invoice` and `externalPartyId = {tag:'customerId', contents}`. Same displayStatus rules as section 5. [seen]
- **GL mapping** (Invoicing -> Books): each Invoicing item/category maps to a Books revenue ledger; a default revenue ledger covers unmapped lines. [seen/inferred]
- **Non-USD count**: a count of invoices in other currencies that Books cannot post; shown as a warning. [seen]

### API endpoints
- `POST /organizations/{organizationId}/create-ar-customer` (team invoicing). Request {name, email, address, additionalEmails?}. Response {customerData} (full detail incl. `arCustomerId`). Error if not found afterwards. [seen]
- `POST /organizations/{organizationId}/get-ar-customers` -> {customerDataList[]}. [seen]
- `/ar-invoice/{arInvoiceId}/delete-manual-payment` -> {invoiceResponse, summary}; removes a manually recorded payment and refreshes list summary. [seen]
- Books side: same accrual-source endpoints as section 5 with `type=invoice`; AR aging with `accountsReceivable`. Invoicing link: `POST /books/{id}/invoicing/connect` with `{config:{ledgers:{revenue: ledgerId (required), salesTax?: ledgerId}}}` returns `{integrationId}`; `POST /books/{id}/invoicing/connection/update` same body returns `{integrationId, config}`; `POST /books/{id}/invoicing/non-usd-invoice-count` `{}` returns `{count}`. The GL-mapping modal offers only editable revenue-type ledgers for the default revenue account (required) and editable liability-type ledgers for the optional sales-tax account; updates apply to future imported invoices only; invoices sync from the entries start date. An imported invoice carries a separate sales-tax line posted to the sales-tax liability ledger when one is mapped. [seen]
- Customer update, delete and unmatch-in-Invoicing endpoint: not recovered. [gap]

### JE behavior [seen]
Invoice recognition: debit Accounts Receivable for sum of lines; credit each revenue ledger per line (negative line flips side). Cancel -> reversal JE. Payment application per section 5 (credit AR, debit cash/clearing).

### UI behavior
- Invoices page = shared accrual list (type invoice). Status filters: open, overdue, partiallyPaid, paid, draft, cancelled. Columns: customer, number, issue date, due date, status, total, outstanding.
- Customers grid: name, email, invoice count, outstanding balance.
- Connect flow: if Invoicing is not connected, page shows connect CTA; after connect, user maps GL; sync pulls invoices. If non-USD invoices exist, a banner shows the count and that they are excluded. [seen/inferred]
- Needs-action banner: invoices with a payment received in Banking that is not matched ("invoice match banner"), with a CTA to match; matching works exactly like bills but with inflows. [seen]
- Unmatch from Books warns that the corresponding Invoicing invoice will revert to unpaid (modal "unmatch in Invoicing"). [seen/inferred]
- Edit/cancel rules mirror bills; invoices originating in Invoicing are mostly read-only in Books (edits happen in Invoicing). [inferred]

### Business rules
- Revenue recognized on effective (issue) date under accrual; cash-basis books recognize on payment date. [inferred from accounting basis flag]
- Outstanding and display status formulas as section 5.
- Customer soft-deleted customers hidden by default (`filterDeleted=true`), still resolvable on old invoices. [seen]

### Edge cases
- Non-USD invoices excluded and counted. Zero-amount invoices never `paid`. Duplicate customer emails allowed; additional emails stored separately. Invoices with manual payment deleted revert amountPaid. [seen/inferred]

---

## 7. Manual journal entries

### Purpose
Let bookkeepers post arbitrary balanced entries, import them in bulk, review them, and edit or delete them, subject to the books start and close dates.

### Data model [seen]
- **JournalEntry**: `id`, `description` (max length constant `Pu`, value not recovered), `datetime` (UTC ISO time), `lineEntryIds[]`, `lineEntries[]`, `isOpeningBalance`, `creationSource` enum `manual` | `transaction` | `paymentApplication` | `accrual`, `reviewStatus` (`unreviewed` | `reviewed`), `categorizationStatus` (`completed` | ...), `creationDate`.
- **LineEntry**: `id`, `ledgerId`, `ledgerName`, `amount` (non-negative dollars), `debitCredit` (`debit`|`credit`), `description`, `datetime`, `editable` (bool), `journalEntryId`, `opposingLedgerIds[]`, `tagIds[]?`.
- Only ledgers with `editable === true` can be used; non-editable system and bank-source ledgers are rejected. [seen]

### API endpoints
- `POST /books/{booksId}/create-journal-entry`: request {datetime, description, lineEntries[{amount, debitCredit, description, ledgerId, tagIds?}]}; response {journalEntry}. [seen]
- `POST /books/{booksId}/create-journal-entries-bulk`: request {journalEntries[{datetime, description, lineEntries[...]}]}; response {journalEntries[]}. Used by the import grid and the AI tool; AI tool schema says amounts are dollars with optional cents (250 = $250). [seen]
- Update (edit card) and delete-journal-entry endpoints exist; delete is also used by the bulk delete action in the grid. [seen names]
- `create-ledgers-bulk` ({ledgers[]}) is a sibling. [seen]
- List: `journal-entries` with filters (date range, ledger, creationSource, reviewStatus, text, tags, amount range), sort, cursor. [seen/inferred]

### UI behavior
- Manual JE page: data grid, columns include date, description, ledger(s), debit, credit, source, review status, tags. Multi-select with bulk delete (confirmation) and bulk mark-reviewed. [seen/inferred]
- Create card: header "JOURNAL ENTRY", date picker (default today UTC), description, line grid with columns Ledger account (required), Debit, Credit, Memo, Tags. Grid supports paste of tags (comma list matched by id or case-insensitive name), copy, inline edit.
- Tags: at most one tag per tag group per line; selecting another from the same group replaces the earlier. Tag ids without a group are dropped. [seen]
- Save button disabled until description is changed; clicking while invalid shows an error that auto-clears after 5s. [seen]
- Success toast on create; editor resets.
- Import: spreadsheet/CSV into an import grid with per-row validation, then bulk create. Export XLSX of the grid. [seen/inferred]
- Review: mark entries reviewed (single and bulk); duplicate: copy an entry as a new draft; recurring/reversing: not found in bundle. [gap]

### Business rules
- Validation order: no lines -> "no line entries"; debit total != credit total -> an unequal-totals error; any line lacking a ledger -> a missing-required-fields error; at least one debit line and one credit line required. Comparison is on parsed cent values. [seen]
- A line with both debit and credit set is treated as a debit; a line with neither contributes 0. [seen]
- Date handling: if the chosen date equals the books entries start day, the saved datetime is the start-of-entries timestamp helper; otherwise the picked day at UTC midnight. [seen]
- Period guards: saving a date on or before the latest completed reconciliation of any touched ledger first asks for confirmation (reconciliation-discrepancy dialog; it flips that period to a discrepancy state). A date before the entries start date is rejected. No client-side rejection based on the books close date was found; the close is soft (section 10). [seen / server enforcement unknown]
- Tags per line optional; rules ("if/then") can later recategorize but never touch manual entries. [inferred]

### Edge cases
- Non-editable ledger in a line -> request rejected with message listing names. Unknown ledger id -> rejected. [seen]
- Opening-balance entries flagged `isOpeningBalance`. Reversal dates: reversal JEs from cancelled sources use the source effective date. [seen]
- Editing a posted JE uses an edit card with the same balance validation; JEs with `creationSource != manual` are read-only. [inferred]

---

## 8. Reconciliation

Source note: UI code is [seen]; the in-bundle mock backend (GlobalData mock / legacyDisclosures chunk) implements server semantics and is the best evidence for server rules. Where only the mock shows a rule it is marked [seen-mock]. Real backend may differ in detail.

### Purpose
Per bank/card ("source account", one ledger each) the user reconciles contiguous, non-overlapping statement periods. A period is a Reconciliation row anchored to a statement ending date and ending balance. Reconciled balance (book side) is compared to the statement ending balance; completion requires difference = 0. Mercury-origin accounts (`sourceAccount.origin === 'mercury'`) are "auto-reconciled": no manual start/cancel/delete; the label "Auto-reconciled" is shown and the start bar says a window is created automatically once the statement is available [seen]. Other origins: `plaid`, commerce platforms, manual/CSV.

### Data model
Reconciliation [seen-mock + UI]:
- id; ledgerId; startDatetime, endDatetime (ISO UTC; period = whole days, start = previous reconciliation end + 1 day, or first entry day for the first one) [seen-mock]
- statementStartingBalance, statementEndingBalance (money); reconciledBalance; finalReconciledBalance (the number the UI uses for "Reconciled Balance")
- progressStatus: `inProgress` | `completed`
- reconciliationStatus: `reconciled` | `unreconciled` (book vs statement match flag)
- completedOnDatetime (set when completed; mock sets "now")
- statementFileId (uploaded PDF, optional); statementReconciliation `{statementId, reviewStatus:{tag:'unreviewed'|...}}` (present when auto-reconciled from a Mercury statement) [seen]
ReconciliationJournalEntry: `{id, reconciliationStatus: 'unreconciled'|'reconciled'|'skipped', reconciliationId?, originalReconciliationId?, journalEntry, statementRunningBalance?}`.
Page state derived: `completed && reconciled` = "Reconciliation complete" (or "Auto-reconciled" if statementReconciliation present and completedOnDatetime); `inProgress` = warning badge "Reconciliation in progress"; `completed && unreconciled` = discrepancy ("Balances no longer match" for manual; a generic error state that directs the user to support for statement-reconciled) [seen].
Notification flags on the instance (`/instance` notificationStatuses): autoReconciliationNotification, completePlaidReconciliationNotification (dismissed once the user acknowledges the Plaid complete-warning) [seen]. `/reconciliations` also returns onboardedToMercuryAccountAutoReconciliationAt and acknowledgedPlaidReconciliationNotification.

### API (all `POST` under `/books/{booksId}`, team mercury-books; bodies JSON) [seen]
- `/reconciliations` req `{sort:['endingDateDesc'], ledgerId?}` -> `{reconciliations[], onboardedToMercuryAccountAutoReconciliationAt?, acknowledgedPlaidReconciliationNotification}`. Client re-sorts newest-first.
- `/create-reconciliation` req `{ledgerId, statementEndingDate:'YYYY-MM-DD', statementEndingBalance, progressStatus:'inProgress'}` -> `{reconciliation}`. Fails "Reconciliation already in progress" if the ledger has an inProgress one; "Could not find ledger". Mock: start = last reconciliation end+1 (else entries start), end = given date, starting balance = last reconciliation's statementEndingBalance (else 0), and all unreconciled/skipped entries dated within [start,end] are attached [seen-mock].
- `/update-reconciliation` req `{reconciliationId, statementEndingBalance?, statementEndingDate?, progressStatus?:'completed'}` -> empty. Used for: edit ending balance, edit date+balance after statement parse, and completion. Completing flips attached entries to `reconciled`, sets completedOnDatetime, recomputes reconciliationStatus [seen-mock].
- `/delete-reconciliation-and-later` req `{reconciliationId}` -> empty. Deletes that reconciliation AND every later one for the ledger; all their entries return to `unreconciled` (reconciliationId cleared) [seen].
- `/last-completed-reconciliation` req `{ledgerIds?}` and `/all-last-completed-reconciliations` req `{}` -> `{reconciliationsByLedgerId:{[ledgerId]:Reconciliation}}` = most recent `completed` reconciliation per ledger (omitted if none). Hook `reconciliationsByLedgerId` (bookkeeper-only) uses the "last-completed" variant; the edit-preflight uses "all-last-completed" [seen].
- `/reconciliation-journal-entries` (reconciled view) req `{reconciliationId, journalEntrySort, filters, expand:['statementRunningBalance'], pageToken}`; `/unreconciled-journal-entries` req `{ledgerId, ...same}` -> `{journalEntries: ReconciliationJournalEntry[], nextPageToken?, prevPageToken?}`. Sorts: dateTime/description/amount/creationDate/transactionSourceAccount/debitLedger/creditLedger/transactionContraLedger/reconciliationContraLedger/tagName, each Asc|Desc (default dateTimeDesc). Filters: startDate,endDate,ledgerIdsFilter,description,descriptionStartsWith,descriptionEndsWith,amount (integer amount matches on floor),minAmount,maxAmount [seen]. Unreconciled view is shown when no reconciliation selected (or period not reconciled).
- `/reconcile-journal-entries` req `{reconciliationId, journalEntryReconciliationUpdates:[{journalEntryId, reconciliationStatus:'reconciled'|'skipped'}]}` -> `{reconciliationResults:[{tag:'booksReconcileJournalEntrySuccess',contents:entry}|{tag:'booksReconcileJournalEntryError',contents:{message}}]}` (index-aligned). Used for "move to period" (see UI). Sets originalReconciliationId on first move; skipped/unreconciled clears reconciliationId and returns entry to the unreconciled pool [seen-mock].
- `/source-accounts/{tealSourceAccountId}/parse-statement` req `{fileName, fileContents}` (contents = file bytes encoded as string, likely base64 [inferred]) -> `{statementFileId, status:'parsed', result:{tag:'booksStatementParsed', contents: Reconciliation(inProgress, statementFileId set)} | {tag:'booksStatementWindowRejected', contents:{reason:'booksStatementWindowGap'|'booksStatementWindowOverlap', lastReconciledEnd?, expectedPeriodStart, statementPeriodStart, statementPeriodEnd, entriesStart, earliestTransactionDate?}}, citations?:{period:{page,x1,y1,x2,y2}}}` (coords normalized 0-1 for highlighting the period/figures on the PDF). Errors: "Reconciliation already in progress"; unreadable PDF -> error text. Gated by feature flag `booksStatementParsing`. File type: PDF only; single file [seen].
- `/reconciliations/{sourceAccountId}/statement-upload` is a UI route (fullscreen review page), not an API [seen]. Client-side routes also: reconciliation index/account/`reconciliation/{id}`.
- `GET /statement-files/{booksStatementFileId}/download` (opens new tab); Mercury statements download through the banking accountStatement download with types StatementMonthly/StatementTreasuryMonthly/StatementCreditPeriod [seen].

### Calculations
- Difference = round2(finalReconciledBalance - statementEndingBalance); shown green if >= 0 else red; displayed only for in-progress, unreconciled or statement-reconciled periods [seen].
- Reconciled balance (server) = statementStartingBalance + sum over the period's entries of signed effect on the source ledger (amount counted +/- by whether the line's debitCredit equals the ledger's normal side); opening-balance entries adjust the running balance by the opening amount but are not shown with a running balance. Next period's statementStartingBalance chains from the prior period's running (book) total, first period from ledger opening balance [seen-mock]. UI hint text: "Beginning balance" = last reconciliation's statementEndingBalance else ledger opening balance.
- reconciliationStatus = (statementEndingBalance == reconciledBalance) [seen-mock]; recomputed after any edit, which is what turns a completed period into a discrepancy.
- statementRunningBalance per row = starting balance + cumulative signed amounts in date order (column "Balance"; not sortable).
- Selected-rows footer: a footer total of the selected rows' signed amounts of selected entries.

### UI behavior
- Reconciliation page per source account: account selector popover (grouped accounts; sublabel "Auto-reconciled" for Mercury, "Reconciled <end date>" when last completed exists, else "Not reconciled"); header actions: Edit source account, pause sync (Plaid/commerce), import transactions, delete from Books; "Sync/Import in progress..." badge while import task pending or `lastSyncedToTealAt` not yet synced (poll every 5s, up to 10 min after Books was created).
- Period picker: year dropdown (all years that have reconciliations + current) and a pill per reconciliation (ordered oldest->newest within the year); pill style by progressStatus; tooltip shows the date range; scrolls selected into view. Disabled while import pending. Year containing the oldest discrepancy highlighted via tooltip. Label rule: whole calendar month -> "Mon" (+year if different from selected year), otherwise "Mon d - Mon d".
- Landing logic: no reconciliation chosen -> redirect to the in-progress one; else to first with statementReconciliation.reviewStatus 'unreviewed'; otherwise the unreconciled view.
- Unreconciled bar ("Needs reconciliation", label "<Month> - Now"): button Start reconciliation (hidden for Mercury). Disabled with tooltips when a discrepancy exists (a tooltip saying the earlier discrepancy must be fixed first) or one is in progress (a tooltip saying the in-progress one must be finished first).
- Start-reconciliation modal: tabs "Start from statement" (PDF drop, default; shows only with flag) and "Manual". Manual: Ending date (calendar; min = beginning day = last end+1 or earliest entry day; max = today; default = last day of previous month if that is >= beginning day else today; helper "Beginning date") and Ending balance (signed money, zero/negative allowed; helper "Beginning balance"). Submit first saves any pending grid edits, then create-reconciliation. Statement tab: pending edits saved first, then parse-statement; upload requirement hint: first reconciliation = statement starting on or before earliest entry day; else statement must start exactly the day after the last reconciled end.
- Statement review page (fullscreen, left rail + PDF viewer with highlighted citations): shows "Reading your statement", then "Review this reconciliation" with editable Ending date (min = period start, max = today) and Ending balance; Save -> update-reconciliation with statementEndingDate + statementEndingBalance and route to the period; Cancel -> delete-reconciliation-and-later on the auto-created one. Window rejection screens: gap (a gap message naming the month that is still unreconciled), overlap (an overlap message naming the month already reconciled), first statement too late (a first-statement-too-late message/a message that the first statement must begin at the start of the books); user re-uploads. Parse failure shows server message + "Contact support"; the pre-created reconciliation is dropped.
- Banner for selected period: shows name, status badge, Reconciled Balance, Ending Balance, Difference; actions: in progress -> Cancel (delete modal "cancel this reconciliation") and Complete (disabled with tooltips: previous discrepancy, completing in flight, action in flight, or a tooltip that the reconciled balance differs from the statement ending balance); completed -> "Reconciled on <date>" + Delete reconciliation (hidden for Mercury); completed+unreconciled -> Delete + Edit ending balance (modal "Update Reconciliation": Current ending balance, Reconciled balance, New ending balance). Download statement button when statementFileId (or Mercury statements; multiple -> menu "Download statements").
- Complete: first saves pending grid edits (bulk update/delete of journal entries), then update-reconciliation progressStatus 'completed'. For Plaid accounts and `completePlaidReconciliationNotification` not yet acknowledged: confirm modal a warning that later provider updates to this period will not sync -> acknowledge and complete. There is NO "complete with non-zero difference" path; the Complete button is disabled until difference is 0.
- Delete modal: if completed and later reconciliations exist: warns that N subsequent reconciliations (date span listed) are also deleted and entries return to unreconciled; confirm button "Delete N reconciliations". Success toast "Reconciliation canceled" / "N Reconciliations deleted".
- Discrepancy banner (when any completed+unreconciled without statement): on that period a banner saying a recent edit caused a balance difference on this period; elsewhere a banner saying an edit affected the named period and all later ones, with a link to it + View Period link (the earliest/last in list order).
- Entries grid: columns Date (editable unless Mercury-synced account or opening balance; skip-clock icon + tooltip when entry was skipped from an earlier period), Description (editable, not for opening balances), Category (contra ledger, editable), Amount, Balance; sort (date, description, category, amount), filters (date between/after/before, category multiselect, description includes/startsWith/endsWith, amount equals/>=/<=/between); infinite scroll; multi-select with toolbar. Edits (date, description, category) autosave or bulk-save via update-journal-entries; deletes via delete-journal-entries (disabled for Mercury accounts and opening balances).
- Toolbar actions: a move-to-next-period action (target = next reconciliation if it exists, else status `skipped` in the current one, which pushes it to the unreconciled pool); a move-to-previous-period action (non-Mercury only; disabled if any selected entry never reconciled (no originalReconciliationId) or is already in its original period; moves with status `reconciled` into previous reconciliation). Error toast an error toast with the failed count with per-row messages.
- Auto-categorization polling: entries with categorizationStatus 'pending' (max 100) re-fetched via journal-entries every 2s until settled.

### Locking / book close interaction
- Nothing is hard-locked once reconciled. Editing a journal entry (date, amounts, ledger) in any form first calls all-last-completed-reconciliations; if the earlier of old/new entry date <= endDatetime of the latest completed reconciliation of any ledger the entry touches (incl. newly proposed ledgers), a confirm step a confirm step explaining the edit touches a reconciled period and will need an adjustment appears (grid variant offers radio: save only entries outside reconciled periods (default, skips those rows) or "Save all entries" (creates discrepancy)). Check is skipped when 0 entries. Deleting entries from a completed period shows the same warning. Saving then flips the affected reconciliations to completed+unreconciled (discrepancy), which blocks starting new reconciliations until fixed by editing ending balance or deleting the reconciliation(and later) [seen].
- Book close date (`instance.latestCloseDatetime`, POST `/books/{id}/close` `{datetime}`) is separate from reconciliation: modal "close the books" asks Closing date (min = last close +1 day or entriesStart, max today, default = most recent last-completed-reconciliation end if after last close, else today); text says entries through the date are "reviewed, categorized, and reconciled" (informational; server enforcement not visible). Reports' includeOnlyClosed clamps to latestCloseDatetime (see section 9).

### Edge cases
- One in-progress reconciliation per ledger; ledger without a financial-account type (`bankAccount, creditCard, prepaidCard, payments, loan, investment, treasury` are allowed; payroll/AR/AP not) has no reconciliation UI.
- Deleting "later" cascades only forward in time; there is no delete of a middle period alone.
- Mercury accounts have no manual start/delete controls; pause-sync prompt warns only manual import remains.
- Missing ledger for a source account triggers a ledger refetch and error report.
- Money inputs allow zero/negative ending balances.

---

## 9. Reports

### Purpose and navigation
Reports index route redirects to Balance Sheet. Pages: Balance Sheet, Profit & Loss, Cash Flow Analysis, General Ledger, AR Aging, AP Aging. Shared period toolbar + collapsible grid + charts (BS/P&L/CF), XLSX export, cell drilldown to underlying line entries [seen].

### Shared request/period model
Endpoints (POST, `/books/{id}/...`): `/income-statement-range`, `/balance-sheet-range`, `/cash-flow-range`. Request `{period?:'yearly'|'quarterly'|'monthly'|'daily', rangeStart, rangeEnd, includeEmpty?:false, tagIds?:string[], includeOnlyClosed?:bool}` [seen; includeOnlyClosed is read by mock and not sent by UI]. Formats: yearly `YYYY`; quarterly `YYYY-Qn`; monthly `YYYY-MM`; daily and custom `YYYY-MM-DD`. P&L and CF: `period` undefined for Custom => one column keyed `"<start> - <end>"`. BS: Custom => period 'daily' with rangeStart=rangeEnd=chosen end date (single as-of column); BS with Annual/Quarterly/Monthly sends the normal period range (rangeStart..rangeEnd) [seen].
Responses: `{incomeStatementPeriods}`, `{balanceSheetPeriods}`, `{cashFlowReportPeriods}` each unwrapped to the object below. All include `periods: string[]` (inclusive, generated client/server side by iterating start..end; invalid ranges throw).
Limits: range longer than 5 years (end+1d > start+5y) is blocked client-side: empty state an empty state saying the range is too long and must be 5 years or less and no request. Year picker: entriesStart year .. max(today, latest journal entry) year; frequencies Annual/Quarterly/Monthly/Custom; period pills (multi-select; at least 1 stays selected; unselected periods are hidden, not re-requested); start/end day pickers in Custom (min entriesStart, max = latestJournalEntryDatetime or today; BS custom has only an as-of end date). Default period range: start year = max(entriesStart year, stored), end year = current year; quarterly/monthly range starts at entriesStart month if year equals start year, ends at current quarter/month if end year is current year else Q4/Dec [seen]. Selection persisted in redux (`selectedTimePeriods`) and URL params (frequency,startYear,endYear,startDay,endDay,tags).
Period header labels: current year "YTD", current quarter "Qn QTD", current month "Mon MTD" (tooltip a tooltip showing the close date when latestCloseDatetime set), otherwise "Mon YYYY"/"Qn YYYY"/"YYYY"; daily/custom = formatted date(s). In-progress = current yearly/quarterly/monthly period (daily never) [seen]. Grid date bounds per column are clamped to [entriesStartDay, entriesEndDay].
Tag filter: Filters menu with tag/tag-group picker -> `tagIds`; empty result text "Nothing matches your filters".

### Record tree (all three accounting reports)
Record `{name, kind:'summary'|'ledger'|'computed', type?, subType?, debitCredit, ledgerId?, sortCode?, requiredLedgerPurpose?, amounts:[per period], totalAmounts:[per period incl. children], children?:Record[]}`. Ledger child nodes use parentId hierarchy. Amount arrays align with `periods`. `type` in asset|liability|equity|revenue|expense; `subType` in currentAssets, nonCurrentAssets, transfersBetweenAccounts, uncategorizedAssets, currentLiabilities, nonCurrentLiabilities, equity, retainedEarnings, operatingRevenues, otherIncome, costOfGoodsSold, operatingExpenses, otherExpenses [seen].

### Profit & Loss
Server (mock shows structure) per period: sum of daily ledger amounts for revenue/expense ledgers dated within [period.start, min(period.end, closeDate if includeOnlyClosed)]. Row order [seen-mock]: Operating revenues (summary with ledger children) -> "Total Net Sales" -> Cost of goods sold -> "Gross Profit" = revenue - COGS -> Operating expenses -> "Total Operating Profit" = revenue - COGS - opex -> Other expenses -> Other income -> "Net Profit" = Operating Profit + (otherIncome - otherExpenses). Missing/empty subtype sections yield zeros. Chart formula (client, from records): Revenue = totalAmounts of subtypes operatingRevenues + otherIncome; Expenses = costOfGoodsSold + operatingExpenses + otherExpenses; Net profit = Revenue - Expenses [seen]. includeEmpty:false drops ledgers with no activity.
Grid: top-level rows with children show blank amounts and an extra bold highlighted "Total <name>" row after children; leaf top-level computed rows are highlighted (Gross Profit etc.). Caret collapses a ledger with children: collapsed row shows totalAmounts, expanded shows own `amounts` + "Total <name>" row. Total column only for Monthly/Quarterly P&L: per-row sum of visible periods (uses totalAmounts when collapsed/leaf else amounts). "Collapse report" toggle shows only highlighted rows, indent 0.
Chart: grouped bars Revenue/Expenses/Net profit by period; rendered only if 2..20 visible periods and not all zero [seen].

### Balance Sheet
Cumulative: each period shows balances as of period end (clamped to closeDate when includeOnlyClosed) for asset/liability/equity ledgers = sum of daily ledger amounts (ledger-natural sign) from the beginning through that date [seen-mock]. Roll-up ledgers: `retainedEarnings` (requiredLedgerPurpose) and `currentYearEarnings` are synthetic: for end date c: totalNet = sum revenue - sum expense of all days <= c; currentYear = same restricted to days >= Jan 1 of c's year; currentYearEarnings = currentYear; retainedEarnings = totalNet - currentYear. Added onto those ledgers' amounts. Response also includes `retainedEarningsMetadata:{calculatedRetainedEarnings[], calculatedCurrentYearEarnings[]}`; UI shows tooltip a tooltip stating the calculated amount included in the cell on those cells.
Tree: type row (names from type map, e.g. Assets/Liabilities/Equity) -> subtype rows -> ledger nodes; type and subtype rows show blank values with "Total ..." rows after them (depth 0/1 bold). Types included: asset, liability, equity only.
Check: total assets = total liabilities + equity (presented via Total Assets / Total ... rows; no client assertion).
Charts: (1) Working capital line = currentAssets total - currentLiabilities total per period (skipped if currentAssets record missing/non-finite); (2) stacked bars: [currentAssets, nonCurrentAssets] and [liabilities(current+nonCurrent), equity(equity+retainedEarnings)] with tooltip subtotals "Total assets" (current+nonCurrent+transfersBetweenAccounts+uncategorizedAssets) and "Liabilities + Equity". Both need 2..20 periods; bars hidden if all zero [seen].

### Cash Flow Analysis
Cash ledgers = ledgers with `reportCashFlow` true. Response `{periods, startingCashBalances[], endingCashBalances[], startingBalances: CashLedger[], endingBalances: CashLedger[], cashFlowLedgers: Flow[]}`; CashLedger `{ledgerId, ledgerName, sortCode, cashBalances[], totalCashBalances[], children?}`; Flow (non-cash counter ledger) `{ledgerId, name, netCashFlows[], totalNetCashFlows[], children?}` [seen].
Mock calculation [seen-mock]: add a synthetic first range FIRST_RANGE_PERIOD from entries start to the day before first period start, which also receives each cash ledger's opening balance. Per cash ledger, running sum of its entries per period: ending[i] = cumulative through period i; starting[i] = cumulative through period i-1. Only journal entries touching at least one cash ledger count. startingCashBalances/endingCashBalances = column sums across cash ledgers. Counter ledgers (non-cash ledgers on those entries) get netCashFlows per period = sum of their line amounts on cash-touching entries (real server presumably signs from cash perspective [inferred]).
Grid order [seen]: Starting Balance (bold highlight) -> per-cash-ledger starting rows (indent 1) -> Movement = ending - starting (client-computed per column) -> cash-flow category tree (net cash flows by ledger, with Total rows) -> Ending Balance -> per-cash-ledger ending rows. Invariant: starting + sum(movement) = ending, validated only implicitly (movement is computed as ending - starting). No Total column. Charts: line of ending cash balance (in-progress period shaded) and bars of movement (end - start); each 2..20 periods; movement bars hidden if all zero [seen].

### General Ledger
Not a range report: it is a line-entries grid. `POST /line-entries` req `{startDate,endDate,ledgerIds?,ids?,debitCredit?,opposingLedgerIds?,description?,amount?,minAmount?,maxAmount?,tagIds?,isCashflow?,sort?[],pageToken?}` -> `{lineEntries[], nextPageToken}` with LineEntry `{id, journalEntryId, ledgerId, ledgerName, datetime, amount, debitCredit, description, opposingLedgerIds, tags, categorizationStatus, editable, ...}`. Default range = first day of the month of entriesEndDay through entriesEndDay. isCashflow keeps only entries on journal entries touching (or not touching) a cash ledger [seen-mock]. Columns: Date (between filter, sortable), Ledger account (multi filter), Contra accounts, Memo, Vendor/customer (only when invoicing enabled), Debit, Credit; sort enum datetimeAsc/Desc (+ others); extra filters tab "Additional filters" with a "Cash Flow" toggle; tag filter. Inline edit of memo and ledger when line editable, not a financial-account ledger, not Mercury-synced; edits post update-journal-entries with lineEntryChanges. Selecting a row opens the journal entry panel. Export: GET `/line-entries.xlsx?q=<json{ledgerIds,startDate,endDate,isCashflow}>` filename `mercury-<org>-generalLedger-<start>-<end>.xlsx`; separate `/journal-entries.xlsx?q=...` for Transactions export.

### Aging (AR/AP)
Routes: ar-aging (invoices, `reportType:'accountsReceivable'`), ap-aging (bills, `'accountsPayable'`); AR hidden unless invoicing enabled; accrual accounting only (cash-basis books have no accrual docs) [seen-mock].
`POST /aging-report` req `{reportType, asOfDate:'YYYY-MM-DD'(default today), externalPartyIds?:[{tag:'customerId'|'counterpartyId',contents}], numberOfPeriods(default 3, UI 1..12 stepper, typed values clamped), daysPerPeriod(default 30, UI fixed 30)}` -> `{reportType, asOfDate, numberOfPeriods, daysPerPeriod, buckets:[{key,label,minDays?,maxDays?}], parties:[{externalPartyId,externalPartyName,bucketTotals[],total,sourceCount,oldestDaysOutstanding}], totals:{bucketTotals[],bucketPercentsOfTotal[],total,sourceCount,partyCount}}`.
Buckets: `current` (label "Current", maxDays 0) then k=0..n-1 `"{k*D+1}-{(k+1)*D}"`, then `"{n*D+1}+"`. daysOutstanding = asOf - (dueDate ?? effectiveDate) in days; bucket = first whose [minDays,maxDays] contains it (<=0 => Current). Included source: status open, amountOutstanding != 0, effectiveDate <= asOf, matching type, party filter. bucket total = round2(sum amountOutstanding). Overdue = sum of all buckets except Current. Percent of total: round to 1 decimal of bucket/total*100, rounding residual added to the largest bucket so the set sums to 100.0; undefined if total<=0 or <2 buckets. Party sort: named alphabetically first, then id-without-name, then none. oldestDaysOutstanding = max positive days among that party's sources.
`POST /aging-report/sources` req `{reportType, asOfDate, externalPartyIds?, externalPartyId?, bucketKey?, sort?[], sortBucketKey?, limit(default 100), pageToken?, includeTotals?, numberOfPeriods, daysPerPeriod}` -> `{records:[{id,externalPartyId,externalPartyName,referenceNumber,status,effectiveDate,dueDate,grossAmount,amountPaid,amountAdjusted,amountOutstanding,daysOutstanding,bucketKey}],nextPageToken,prevPageToken,buckets,totals?}`. Sort enums: referenceNumber|effectiveDate|dueDate|daysOutstanding|amountOutstanding|bucketAmount|overdueAmount x Asc|Desc; default tiebreak party name, daysOutstanding desc, id.
UI: party view (grid: name+source count, one column per bucket, Overdue, Total, footer totals row incl. "% of total" row) vs source view (query param); summary header (total, Overdue, Current, source count) with bar chart per bucket (current = green tone, overdue = primary); party multi-select filter; as-of date picker; clicking a non-zero cell opens a drilldown of sources with party and due-date filter derived from the bucket (due between asOf-max and asOf-min; Overdue = min 1 day). XLSX: `/aging-report.xlsx?q=...` and `/aging-report/sources.xlsx?q=...`.

### Exports / download
BS, P&L, CF export is client-side via exceljs (dynamic import), enabled only when rows exist. Sheet "Report": row1 org name (merged, centered, bold), row2 report title (Balance Sheet / Profit & Loss / Cash Flow Analysis / General Ledger), row3 date range text for non-BS (selected periods collapsed into contiguous "start - end" segments, comma-joined), blank row, header row (blank, then column labels: BS shows each period's end date; others the period header; + "Total" for monthly/quarterly P&L), then rows with 4 spaces of indent per depth, numeric strings parsed to numbers with format `#,##0.00`, bold rows bold, highlighted rows fill F5F5F5, all cells white fill, col A width 40, others 15. Filename `mercury-<org-name lowercased, spaces to dashes>-<reportType>-<range>.xlsx` where range = `as-of-<endDay>` (single BS period), `<firstEnd>-<lastEnd>` (multi BS) or `<startDay>-<endDay>` [seen]. Failure toast "Failed to download report".

### Drilldowns
Clicking a numeric cell (or chart period) opens a side panel of underlying line entries for constraints `{startDay, endDay, ledgerIds (the row's ledger + descendants), isCashflow (true on CF report), tagIds}`; BS cells use entries-start..period end; Total column uses the whole selected span; type/subtype header rows and rows without ledger ids are disabled. Edits in the panel refetch the report.

### Edge cases
- includeOnlyClosed: all period boundaries are clamped to latestCloseDatetime; in-progress header tooltip shows the close date.
- Empty: an empty state prompting to create a journal entry ; error: "Error loading report".
- Fewer than 2 or more than 20 periods => no chart; axis labels thinned by width (min 2, max 12 labels).

---

## 10. Books details/instance

### Purpose
One "instance" per organization holds the accounting basis, entries start date, soft close date and subscription state. A Books details page shows and edits them; a create-instance wizard builds it. [seen]

### Data model
- instance: entriesStart, name, subscription (tier label), earliestJournalEntryDatetime, latestJournalEntryDatetime, latestCloseDatetime?, accountingBasis (cash or accrual, default cash), categorizationPipeline (mercury or disabled). [seen]
- notificationStatuses: array of {notificationType, dismissed, dismissedAt?}. Nine types: auto-reconciliation, complete-Plaid-reconciliation, first-time experience, transactions-page autocat banner, subscription advance notice, command first use, activation spotlight, vendor-recipient relationship notice, bills accrual bill-pay notice. [seen]
- booksActivationState: tag onboarding, or tag available with booksId, externalAccountsConfigured, integrationsConfigured, bookkeeperConfigured, onboardingPath?, accountingPartnerMatchmaking?. [seen]
- Reconciliation record (read for close defaults): id, ledgerId, start/end datetime, reconciled balance, statement starting/ending balance, reconciliationStatus (reconciled, unreconciled, skipped), progressStatus (inProgress, completed), completedOn, finalReconciledBalance, statementReconciliation{statementId, reviewStatus}. [seen]

### API endpoints
- /books/{id}/instance returns {instance, notificationStatuses}. [seen]
- /update-instance {entriesStart?, name?} returns {instance}; error text says the start date must be earlier than all transactions. [seen]
- /close {datetime ISO UTC} returns empty. [seen]
- /notifications/dismiss {notificationType}; client updates optimistically. [seen]
- /last-completed-reconciliation {ledgerIds} and /all-last-completed-reconciliations {} return a map keyed by ledger id. [seen]
- Org-level: /books/{orgId}/create-instance {coaTemplateId required, accountingBasis, entriesStart?} returns {instance, organizationBooksId, booksActivationState}. [seen]
- Onboarding: /complete-connect-bank-accounts and /complete-connect-integrations (empty replies); /books/organizations/{orgId}/choose-onboarding-path {path, contents?} (paths: request matchmaking, do it yourself, bring your own bookkeeper; also an added-by-bookkeeper value) with contents teamMember{userId} or invite{inviteId}; /request-accounting-partner returns state with matchmaking pending. [seen]
- Exports: journal-entries.xlsx and line-entries.xlsx endpoints exist; request shapes not inspected. [seen, shape unknown]

### UI behavior
- The settings route redirects to Books details. The page shows: start date with edit, accounting basis (read-only text; change via support), close date with edit, subscription badge (free trial, active, canceled, never subscribed), users with access, accounting-partner request. [seen]
- Start-date picker only allows dates on or before current start; later requires support. Copy warns earlier dates sync more history and may disturb reconciled periods. [seen]
- Close-date modal: earliest selectable = latest close + 1 day, or entries start if never closed; latest = today (UTC). Default = last completed reconciliation end if after last close, else today. Edit control hidden when close date is already today. Copy explains reports treat entries through the date as reviewed, categorized, reconciled. [seen]
- Create wizard: cash/accrual toggle with explanations; template dropdown filtered by basis (live templates only) with preview and edit buttons and an import option; requires MFA enabled; warns when a third-party ERP is active (bank feed continues, categorization moves to Books); pricing copy (free through 2027-01-01, then monthly fee, otherwise 30-day trial); non-permitted users see a banner. [seen]
- Setup steps in order: accounts, integrations, bookkeeping (bookkeeping step founders only). Bookkeeper candidates need all-account access plus manage-books, code-transactions and manage-integrations rights; admins are not selectable. [seen]
- Accounting-partner request allowed only for the do-it-yourself or bring-your-own paths with no matchmaking yet; request-matchmaking path implies pending. Copy promises a match in 1-2 business days. States: pending match, matched awaiting proposal. [seen]
- Accrual-basis instances show a banner that Mercury bill pay is not available for accrual; dismissible via notification. [seen]

### Business rules
- Close is a soft close, not a lock: entries stay editable; reconciliation not required. [seen]
- Close validation: valid date; not after today UTC; if a prior close exists, strictly after it (cannot move backward or repeat); else on or after entries start. [seen, agent-tool logic]
- A period is "fully closed" if its end <= close date, else "pending close". Report ranges accept an include-only-closed flag that clamps period end to the close date. [seen]
- Editing an entry inside a completed reconciliation raises a discrepancy warning needing an adjustment; nothing blocked. [seen]
- Entries start defaults to today minus 4 years when absent; entries end = max(today, latest journal entry). [seen, mock]
- Accounting basis is immutable after creation in the UI. Cash basis drops accrual-only ledgers and AR/AP flows. [seen]
- Rules are enabled only under the mercury categorization pipeline. [inferred]
- No fiscal-year or timezone setting; all dates UTC, calendar-year reporting. [inferred from absence]
- Changing entries start moves opening-balance entries to the new date (see section 1). [seen, mock]

### Edge cases
- Moving the start date later than existing activity is refused in the UI and routed to support. [seen]
- Close modal with no completed reconciliation falls back to today. [seen]
- Instance without a latest close date shows no close badge; all periods pending. [inferred]
- Activation `onboarding` state means no booksId yet; pages must not call instance endpoints. [inferred]
- Open gaps: header closed-status logic in reports not read; export shapes unknown.

---

## 11. Home dashboard (Insights)

### Purpose
Home route = Insights page: date-range-driven cards Cash, Expenses, Revenue, all fed by one request. Loading/onboarding "takeover" while transactions are importing/categorizing.

### API
`POST /books/{id}/insights` req `{startDate, endDate (YYYY-MM-DD), timeSeriesGranularity, cashInOutGranularity}` (granularity enum daily|weekly|monthly|quarterly|yearly) -> [seen-mock, server presumably equal]:
`{endingBalancesBySourceAccount:[{sourceAccountId?,ledgerId,cashBalance}], totalExpensesBreakdown:[{ledgerId,amount}], totalRevenueBreakdown:[{ledgerId,amount}], totalExpensesPriorPeriod, totalRevenuePriorPeriod, revenueTimeSeries:{granularity,data:[{startDay,endDay,amount}]}, cashFlowIn, cashFlowOut, netCashFlowPriorPeriod, cashFlowTimeSeries:{granularity,data[]}, cashInOutTimeSeries:{granularity,data:[{startDay,endDay,cashIn,cashOut}]}, burnBuildRate?:{type:'burnRate'|'buildRate',avgNetCashFlow,runwayMonths}}`.
Also `POST /categorization/metrics` req `{ledgerIds?}` -> `{instance:{total,pending,delayed,completed,notAttempted}, ledgers:{[id]:same}}` (30s cache) driving the categorizing state.

### Server-side calculations (mock) [seen-mock]
Let range [S,E]; priorWindow = same number of days ending S-1 (start = S-1-(E-S)). Cash ledgers = ledgers with reportCashFlow. For each day's ledger amounts:
- endingBalancesBySourceAccount[ledger] = cumulative cash ledger amount for all days <= E (kept if it has a source account or non-zero).
- cashFlowIn = sum of positive cash-ledger line amounts within [S,E]; cashFlowOut = abs(sum of negative); net cash flow = cashFlowIn - cashFlowOut; netCashFlowPriorPeriod = signed sum within priorWindow.
- Expenses/revenue totals: sum of ledger amounts for ledgers of type expense / revenue within [S,E], with per-ledger breakdown; prior-period totals from priorWindow.
- Time series windows extend from bucket start of S to bucket end of E. revenueTimeSeries and cashFlowTimeSeries: only buckets having activity (not zero-filled), amount = bucket sum (cash flow = signed cash ledger sum); cashInOutTimeSeries zero-fills every bucket and splits cashIn (positives) / cashOut (abs negatives); only returned if any in/out exists.
- Burn/build: M = last full calendar month (the month before today). avgNetCashFlow = (sum of cash-ledger amounts within the three full months ending M) / 3. Returned only if the books' entries-start is not after the first day of that 3-month window (i.e. at least 3 complete months of history) AND avg != 0. type = avg<0 ? 'burnRate' : 'buildRate'. runwayMonths = cashBalanceAtEndOfM >= 0 ? floor(cashBalanceAtEndOfM / |avg|) : 0 (all cash ledgers summed through end of M). All money rounded to cents.

### Client rules [seen]
- Net cash flow card value = cashFlowIn - cashFlowOut; prior comparison via change function: if prior == 0 show absolute delta "+$X"; else percent = (cur - prior)/|prior|*100, 1 decimal, leading "+" when > 0. Favorable direction: cash increase, revenue increase, expenses decrease.
- Cash card extras: Monthly burn (label for burnRate; "Monthly build" for buildRate) = |avgNetCashFlow| whole dollars (tooltip a tooltip stating it uses the last 3 complete months' average net cash flow); Runway (burn) = "<1 mo" when 0 else "N mo", tooltip a tooltip: months of cash left at the current balance and average burn; for buildRate the second metric is "Coverage" with tooltip "months of expenses your current cash could cover, based on last 3 complete months' average expenses" (the mock's runwayMonths formula is the same for both types; real coverage formula is likely cash / average monthly expenses [inferred]). Missing burnBuildRate (insufficient history or avg 0) renders "— mo" and "— $". "By ledger account" list of cash balances sorted by |balance| desc.
- Expenses card: Total expenses = sum of breakdown (breakdown sorted by amount desc; percentage = amount/total*100 if total > 0, label "Unknown ledger" if missing). Net margin = 100 - expenses/revenue*100 and Expense ratio = expenses/revenue*100, only when revenue > 0 (else "—%"); displayed with 0 decimals (helper for values that round below 1% exists: "<1%"). Net profit is not shown separately.
- Revenue card: Total revenue = sum of breakdown; Revenue trend line from revenueTimeSeries (placeholder rising curve when empty); by-ledger list.
- Empty states: "No cash/expense/revenue data yet" when totals undefined (still categorizing) vs an empty-period text/an empty-period text.
- Granularity selection from range: time series: daily if <=31 days, else weekly if <=31 weeks, else monthly if <=12 months, else quarterly if <=20 quarters, else yearly. Cash in/out: same ladder but limit 12 for every step (daily <=12 days, weekly <=12, monthly <=12, quarterly <=12, else yearly).
- Default range: previous calendar month clipped to [entriesStartDay, today]; if that is empty use [entriesStartDay, today]. URL params startDate/endDate are honored when valid and clamped into [entriesStart, today]. A CTA a CTA to view the last N completed months (N = 3, 2 or 1, the largest whose first month >= entries start) appears unless the current range already contains that span. Range picker has presets, All time, custom, and comparison-period dismissal.
- Categorization takeover: shown during first import/categorization (`importing || pending > 0`); categorizingPercent = round((maxPendingSeen - pending)/maxPendingSeen*100) when not importing; takeover released after 20 s at most; 3 s minimum hold; `fromSignup` query param triggers the animated an animated intro (importing, then creating books) intro.
- Drilldowns: clicking bars/rows/trend points opens the line-entry panel for the same date window and ledger ids (isCashflow true for cash trends, false for expenses/revenue).
- Links: "View Cash Flow Analysis" opens the CF report in Custom mode with the same range; a link into the General Ledger opens GL filtered to all expense/revenue ledgers and the date range.
- Not found: no task/checklist widget or "net profit" tile in this page; AI "sections" content (e.g. Runway and cash position) exists only in the Books Command mock.

---

## 12. Command (AI assistant for Books)

Tags: [seen] read in code; [inferred] deduced. Note: `booksCommandReturnPath-*.js` is misnamed. It holds the Books "instance" data hook and a tiny return-path variable; the AI logic is in `legacyDisclosures-*.js` (tool definitions), `emptyStateQuickActions-*.js` (chat transport) and `allOtherRoutes-*.js` (Books page host).

### Purpose
A chat assistant ("Command") scoped to the Books org. It answers questions about the books and proposes writes (create/edit/delete ledgers, journal entries, rules, payment matches, period close). Every write is a "client action": the model proposes it, the browser shows an approval card, and only after the user approves does the browser itself call the normal Books REST API as the user. [seen]

### Surfaces
- Full page: frontend routes `/books/:booksId/command` and `/books/:booksId/command/:conversationId`. These are web routes, not API endpoints. [seen]
- Popover widget in the global help menu. Header: new conversation, history dropdown, expand, minimize. A top drag handle resizes height (min 485px, max 90% of viewport; arrow keys step 20px); only resizable once the conversation is non-empty. Per-conversation draft text, scroll position and unread count are kept in client state. [seen]
- Expand (widget to page): remember the current location as a "return path", then navigate to the conversation (or the index if none). Collapse (page to widget): go back to the return path only if it is inside `/books/:id` (equals the Books home or starts with it plus `/`); otherwise go to Books home. Then clear the return path, set the active conversation and mark the widget's active screen as command. [seen]
- Sidebar entry "Command" (Home group, 2nd). Hidden for Books-only ("business lite") orgs. [seen]
- Deep-link query params on the page: `promptId` and `autoSend`; they prefill (and optionally send) a saved prompt, then are stripped from the URL. [seen]
- First use: the notification `booksCommandFirstUseNotification` is dismissed the first time a message is sent; `hasUsedBooksCommand` is derived from it. [seen]

### Starter prompts (empty state)
Three chips, shown only when the viewer's org kind is `business`; analytics id `command/books/starter-prompt`. [seen]
| promptId | Label (short) | Prompt intent |
|---|---|---|
| books-revenue-summary | revenue | Revenue for the most recent complete month, compared with the prior month, with main drivers |
| books-profit-trend | profit trend | Profit over the last 6 months: direction, biggest changes, likely drivers |
| books-profit-margin | profit margin | Profit margin for the most recent complete month vs recent months, with explanation |
The assistant's text prompt mentions only reads; these are answered by server-side read tools.

### Conversation protocol (shared Mercury Command backend)
- Send: `POST /api/command/conversations/chat/v1` (demo: `/api/command/demo/chat/v1`). Cookie auth, header `X-CSRF-PROTECT: 1`, `X-Frontend-Path` set to the current route. Streaming response (AI-SDK UI message stream). The new conversation id comes back in response header `X-Conversation-Id`. [seen]
- Resume a dropped stream: `.../chat/v1/{conversationId}/stream`. [seen]
- Request body: `{ message (only the LAST message, not history), chatId (conversation id or null), clientActions[] (tool descriptors, see below), clientCanonicals[], clientInlineCanonicals[], pageContext? (flag commandPageContextEnabled), capabilities? (["supportsBackendActions"] when flag command-use-server-powered-actions), supportedVersion, timezone (IANA) }`. First user message gets `metadata.savedPromptId` when its text equals a saved prompt. [seen]
- Status codes: 429 with `Retry-After` (rate limit); 400 `ASK_V2_INVALID_COMPLETION`; 409 `Duplicate message id` or `server_action_approval_expired`; 503 `delegated_authority_unavailable`. [seen]
- Load a conversation: query returning `{conversation{id,title,status,...}, messages[]}`; refetched on an interval while the conversation is generating/resuming; a 404 on the active id clears it with a toast. File upload: multipart `file` to `/openapi/command/uploads` or `/openapi/command/conversations/{id}/uploads` (returns uploadId, fileName, contentType, sizeBytes, previewUrl); resolve a document with GET `.../uploads/{uploadId}` returning `{url}` (https only). [seen]
- Composer disabled while: status not ready, error/recovering, a pending tool approval, a pending client action, or the conversation was handed to a human support agent. A kill-switch flag `commandIsDown` disables suggestions, input and retry. [seen]
- Message parts: `text`, `file`, `step-start`, tool parts, and data parts `data-tool-approval {id,data{name,props}}`, `data-review-state {id,...}` (keyed by toolCallId), `data-canonical`, `data-inline-canonical`, `data-link`. Tool part states: `approval-requested`, `input-available`, `output-available`, `output-error`, `output-denied`. Client tools are named `action_<toolName>` on the wire. [seen]
- API calls made by the browser while executing a tool carry header `X-Command-Conversation-Id` (audit linkage of a write to the AI conversation). [seen]

### Tool execution model (applies to all write tools)
- Definition fields: name, description (for the model), zod input schema converted to a JSON-schema root object (top-level oneOf/anyOf/allOf forbidden), output schema, `isAvailable` (client gate), `isDiscoverable` (offered to the model; defaults to isAvailable), `deferred` (default true: discovered lazily), `readOnly` (default false), `userRejectedMessage`, an approval card component, and a cache `invalidate` hook. [seen]
- Output envelope returned to the model: `{_type:"success", data}`, `{_type:"user_rejected", message, isEdit?}`, or `{_type:"failed", summary, errors:[{field,message}], debugContext?}`. Thrown errors surface as `output-error`. [seen]
- Approval card: heading, review content, buttons Confirm / Cancel, plus a free-text box. Typed text + "make edit" sends the text back as the denial reason with `isEdit` (model should revise); plain cancel returns the tool-specific rejected message. Double-click is guarded by an in-flight lock. [seen]
- Pre-approval validation: the card re-validates against live data (e.g. ledger exists and name matches); on failure it auto-reports a `failed` output with field errors so the model self-corrects, and the user is shown no approve button. Inputs failing schema parse are also auto-reported as failed ("runtime input validation failed"). [seen]
- Every execute: abort if the current org differs from the org the conversation started in ("Organization changed"); require an active Books instance; require `canBookkeeperManageBooks`. After success the relevant React-Query caches are invalidated (ledgers, journal entries, rules, reconciliation, etc.). [seen]
- Money is dollars with at most 2 decimals; descriptions warn "250 not 25000". [seen]
- Reconciliation impact check (journal-entry/line-entry edits): before approval, the card fetches all last-completed reconciliations and the affected entries; if an edit changes amount, direction, date (to earlier), ledger or adds/removes lines inside a completed reconciliation period, an extra confirm screen names that reconciliation before proceeding. [seen]

### Write tools (13, team `mercury-books-command`, all need `canBookkeeperManageBooks`)
1. `booksBulkAssignCategory`: assign one ledger to line entries. Input `{ledgerId, ledgerName, summary, updates[>=1]{journalEntryId,lineEntryIds[]}, journalEntries?[]{...display}}`. Calls update-journal-entries with per-line `ledgerId` change. Impact check applies. Output `{count, ledgerName}`.
2. `closeBooksPeriod`: soft-close. Input `{closeDate: YYYY-MM-DD}`. Rules: not in the future; strictly after latest close; if never closed, on/after `entriesStart`; reconciliations NOT required; it is a soft close, not a lock. Calls POST `/books/:id/close {datetime}`. Card preloads `/instance` and shows the validation message.
3. `createBooksCategorizationRule`, 4. `editBooksCategorizationRule`, 5. `deleteBooksCategorizationRule`: offered only if the Books rules flag is on and instance `categorizationPipeline == "mercury"`. Create input `{conditions[1..7], ledgerId, ledgerName}`; edit adds `ruleId` and replaces everything; delete takes `{ruleId}`. Condition union (`tag`+`contents`): `amount {operator atMost|atLeast|equal, amount signed USD}`; `bankDescription` (case-insensitive substring); `counterparty` (exact To/From, Mercury-sourced only); `debitCard`/`creditCard {contents cardId, cardName}`; `teamMember {contents userId, teamMemberName}`; `customCategory {contents id, customCategoryName}`. Constraints: all ANDed (no OR; use separate rules); each kind at most once (debit and credit card share one slot); amounts are one comparison or one inclusive atLeast/atMost pair with lower <= upper; ledger must be autocat-eligible (editable, non-system); card must exist, be active, match debit vs credit and its display name; team member and category names must match live lists. Maps to `/predicate-rules/create|update|delete` with `condition` (single or `conditionAll` list; amount operators `amountLessThanOrEqualTo|amountGreaterThanOrEqualTo|amountEqualTo`) and `enrichments:[{tag:"enrichmentSetGlCode",contents:ledgerId}]`. Applies to future transactions only; rules only set a ledger (never reviewed/ready/category). Output `{ruleId, viewLink}`.
6. `createJournalEntries`: manual JEs. Input `journalEntries[1..100]{datetime ISO UTC, description 1..512, lineEntries[2..200]{amount>0 2dp, debitCredit, description<=4000, ledgerId, ledgerName, tagIds<=50, tagNames same length}}`. Must contain >=1 debit and >=1 credit and total debits == total credits (cent arithmetic). Every ledger must exist and be `editable`. Calls `create-journal-entries-bulk`. Output `{count, journalEntries[{journalEntryId,description,date,viewLink}]}`. The prompt instructs the model to call getLedgers first and not show a card if any ledger is unknown/non-editable.
7. `createLedgers`: input `ledgers[1..10]{name, type asset|liability|equity|revenue|expense, subType (13 enums: currentAssets, nonCurrentAssets, transfersBetweenAccounts, uncategorizedAssets, currentLiabilities, nonCurrentLiabilities, equity, operatingRevenues, otherIncome, costOfGoodsSold, operatingExpenses, otherExpenses, retainedEarnings), debitCredit, sortCode, parentId, parentLedgerName(display)}`. Model must call getBooksLedgerSortCodesInUse and de-duplicate codes first (snapshot, not reservation). `create-ledgers-bulk`; per-item results `booksCreateLedgerSuccess|booksCreateLedgerError`; partial success allowed, all-fail throws. Output `{createdLedgerCount, ledgers[{ledgerId,name,viewLink}], failedCreates[{index,name,message}]}`. Card pages one ledger at a time (Back/Next, final button "Create N ledgers").
8. `updateLedgers`: `updates[1..10]{ledgerId, name?, type?, subType?, debitCredit?, sortCode?, parentId?, clearFields?:["parentId"], current* display fields}`; sort-code preflight like create; `update-ledgers-bulk`; partial results. Output `{updatedLedgerCount, ledgers, failedUpdates}`.
9. `deleteLedgers`: `ledgers[1..10 unique ids]{ledgerId, display fields}`; `delete-ledgers-bulk`; per-item `booksDeleteLedgerSuccess|Error`. Output `{deletedLedgerCount, ledgers, failedDeletes}`; response length must equal request length.
10. `updateLedgerOpeningBalance`: `{ledgerId, balance}` dollars, 2dp, negative and 0 allowed (0 clears). Client checks the ledger exists and its details say opening balance is settable (loads ledgers with details + source accounts). `set-ledger-opening-balance`. Not via updateLedgers.
11. `updateJournalEntries` (manual JEs only): `updates[1..100]{journalEntryId, datetime?, description?(1..512), lineEntryChanges?{create[1..200], update[1..200], delete[1..200]}, current* display fields}`. Create line: amount, debitCredit, description, ledgerId, sortOrder 0..1000, tagIds. Update line: `lineEntryId` plus any of amount+debitCredit (must come together), description, ledgerId, tagIds ([] clears). At least one change required. Checks that new/changed ledgers exist and are editable. `update-journal-entries`.
12. `recordPaymentApplicationsForLineEntry`: `{lineEntryId, transactionName, applicationType invoice|bill|payroll, applications[1..100 unique]{accrualSourceId, accrualSourceName, amount>0 2dp}}`. Rules: amounts must total exactly the bank line amount (non-payroll); the line must have no existing applications; all accrual sources must be retrievable; payroll runs may be partially applied but not if already fully matched (UI finishes the remainder, possibly with an adjustment). `create-payment-applications-for-line-entry`.
13. `deletePaymentApplicationsForLineEntry`: `{lineEntryId, transactionName, applications[1..100]{accrualSourceId, accrualSourceName, amount?}, applicationType?}`. Removes ALL applications on the line (back to uncategorized); the id set must equal the current set; type must match. `delete-payment-applications-for-line-entry`.

### Read tools (server-side, not in the browser bundle) [inferred]
Referenced by name in descriptions: getLedgers (returns `editable`, `isAutocatCategory`), getLedger, getBooksLedgerSortCodesInUse (`sortCodes[]`), getLineEntries, getLedgerLineEntries, getAccrualSources, getSuggestionsForPayment, getSuggestionsForAccrualSource, getUnmatchedPayrollRuns, getDetailedPayrollRun (has `amountOutstanding`), and a Books categorization-rule lookup. They mirror the Books list endpoints.

### Guardrails summary
Explicit approval for all writes; Books-only scope (descriptions forbid touching Mercury Banking categories/GL codes or non-editable/source-account ledgers); soft-close only; reconciliation impact warning; batch caps (10 ledgers, 100 JEs, 100 applications, 200 lines); stale-data validation at approval time; org-switch abort; stable cancellation messages per tool; related Command flags: `commandCanonicalsEnabled`, `commandInlineCanonicalsEnabled`, `commandPageContextEnabled`, `command-use-server-powered-actions`, `command-schedules`, `commandIsDown`.

### Edge cases
Stream drop resumes via the stream URL; duplicate message id is a 409 the UI swallows as a retry condition; expired approval returns 409; empty-state chips disabled when Command is down; support-agent handoff freezes the composer; cancelled state text is returned to the model as `user_rejected`.

---

## 13. Payroll journal posting

### Purpose
Post payroll runs from a provider (Gusto via Finch) into the books as accrual-style entries, then match the actual bank payment of payroll to the run so cash and liabilities clear.

### Data model [seen]
- **PayrollRun**: `id`, `runType`, `postingDate`, `payPeriodStart`, `payPeriodEnd`, `totalPayroll` (can be negative for reversals), `employerCost`, `amountPaid`, `amountOutstanding`, `matchingStatus`, `lines[]`, `relatedJournalEntries[]`.
- **PayrollRun line**: `sourceLineId`, `description`, `amount`, `matchingStatus`, `matchable`, `contributesToEmployerCost`, `fundsCashRequirement`, `nonCashRequirementAmount`, `journalEntryLines[{ledgerId, debitCredit, amount}]` (one debit expense line, optionally a credit line when the item has a credit ledger e.g. liability).
- `matchingStatus` derivation: outstanding==0 -> `fullyMatched`; paid==0 -> `unmatched`; else `partiallyMatched`. List sorted by postingDate descending. [seen]
- **Finch/Gusto payroll link** states: not linked -> connecting (OAuth) -> needs finalize (choose company/entity) -> linked; also error/reauth. Operations: create link, update link, finalize, disconnect. [seen names, exact enum inferred]

### API endpoints
- payroll-runs list (filters: matching status, date range, outstanding only), payroll-run detail, `create-payment-applications` (payroll variant takes accrualSourceId = run id), finalize-finch, update-finch-payroll-link, link create/delete endpoints under the Finch path group. [seen names; shapes mostly inferred from mocks]

### Journal entry structure [seen]
- Run posting JE: description "Payroll <start> to <end>", `creationSource accrual`, unreviewed; debit expense ledgers per line, credit "Ops / Payroll" clearing/payable (and liability ledgers for withheld items); non-cash items (employer taxes accrued) credit their liability ledger.
- Bank payment JE: cash outflow line on the bank ledger; initially against "Uncategorized Cash Outflow" (or Inflow for negative runs) with `creationSource transaction`. After matching, the uncategorized line is replaced by lines against each run's credit-side ledger (+ adjustment lines), source becomes `paymentApplication`.
- Matching: for each allocation, paid += |amount| + sum|adjustments| (sign flipped for negative runs), outstanding = totalPayroll - paid; run is linked to the bank JE. Extra top-level adjustments (description "Payroll adjustment") also add lines. [seen]

### UI behavior
- Payroll page: link status card with connect/finalize/reconnect; run table with matching chips; detail card per run (lines, JE, matched payments). Match-payroll modal: pick bank transaction, allocate to runs, add adjustments. [seen/inferred]
- Needs-action banner when runs are unmatched. [inferred]

### Business rules
- Cash vs accrual: ledgers flagged `accrualOnly` and system ledgers with a `requiredLedgerPurpose` (payroll, payroll liabilities) exist in the chart; accrual-basis books post the run JE on posting date, cash-basis books should recognize payroll only via the bank transaction (inferred, not seen in code).
- `fundsCashRequirement` false lines (non-cash) do not need cash matching; `matchable` false lines are excluded from matching.

### Edge cases
- Negative total (refund) matches against inflows. Partial matches leave outstanding. Unmatching restores uncategorized line. Server-side enforcement of close dates for payroll posting: not recovered. [gap]

---

## 14a. Integrations/feature flags (partial)

### Purpose
Everything that feeds transactions into Books from outside, plus per-user feature switches. Mostly Mercury infrastructure that OpenBooks does not need. [seen]

### Data model
- Feature flags: aging reports (AR/AP aging and sidebar), statement parsing (upload and reconciliation), AI transaction filter, autocat explainer popover, API token scopes, skip-integration-setup (auto-creates source accounts and ledgers on connect, bypasses setup modal). [seen]
- Source account: id, name, businessPersonal, debitCredit, ledgerId, type (financialAccountType), origin (mercury, plaid, manual, commerce), lastSynced marker (synced time, not yet, not applicable), invertTransactionAmounts. [seen]
- Plaid link: id, nickname, linkedPlaidAccount{account id, party id, item id, name, type depository or credit, institution, item status healthy or erroring}, sourceAccountId?, linkStatus (syncActive, syncInactive, disabled, pending, pendingInitialSync, notConnected), startSyncDate, syncPausedAt?, createdAt, updatedAt, currency USD. [seen]
- Commerce link: id, linkStatus, startSyncDate, linkedCommerceAccount{store name, platform, disabled, display name}, nickname, currency, sourceAccountId?, revenueLedgerId, feeLedgerId, refundLedgerId. [seen]
- Integration health row: integrationId, name, provider (plaid, stripe, paypal, gusto), connectionStatus (autoSynced, syncPaused, setupInProgress, inactive, setupPending), lastSyncedAt?, sourceAccountId?; plus failedChecks. [seen]

### API endpoints
- /source-accounts returns {accounts}; /create-source-account {name, businessPersonal, invertTransactionAmounts, ledgerId or new ledger spec} returns {sourceAccount} with origin manual; /update-source-account {sourceAccountId, name?, invertTransactionAmounts?}. [seen]
- Plaid: /plaid-teal-source-links; /create-and-link-teal-source-account {name, ledgerId, plaidAccountId, startSyncDate, invert?}; /update-plaid-account-link {plaidAccountId, syncEnabled, targetSourceAccountId?, startSyncDate?} (stop, resume, merge); /remove-plaid-account-from-books {plaidAccountId, expectedSourceAccountId}; org-level add-external-accounts {externalAccountIds}; link-token exchange under the organization plaid route. [seen]
- Commerce (Rutter, Stripe and PayPal in UI): org-level create/reconnect link (and draft), list links and drafts, delete link, update link {connectionId, syncEnabled}; books-level /create-commerce-source-account {connectionId, ledgerId, startSyncAt, revenue/fee/refund ledger ids, merge target?}. [seen]
- Payroll (Finch, Gusto only): org-level initialize setup, create link draft, list links and drafts, delete link; books-level /finalize-finch-payroll-setup {linkId, startSyncAt, nickname} and /update-finch-payroll-link {linkId, syncEnabled, nickname?}; payroll-run endpoints. [seen]
- /books/organizations/{orgId}/integrations-health. [seen]
- Billing: cancel under the organization billing route with product books and optional analytics-only feedback. [seen]
- Admin-only: matchmaking and instance-details/enrollment/coa-templates/integrations endpoints. [seen]

### UI behavior
- Source accounts are grouped: credit cards, bank accounts, prepaid cards, loans, payments, others. Manual add form: name (required, max 255), business/personal, type, opening balance, import sign convention (deposits positive or negative) mapped to invertTransactionAmounts: true when (normal debit and negative) or (normal credit and positive). Opening balance editing disabled for Mercury-origin accounts. [seen]
- Plaid account list: non-USD accounts show a currency warning, cannot be added; dismissal is kept in browser local storage. Per-account actions: stop sync, resume, merge into an existing manual account, remove. [seen]
- Commerce connect flow: public token with platform suffix; auto-creates ledgers (Stripe revenue, fees, returns/allowances; PayPal revenue, fees) or matches existing ones by name alias plus subtype. [seen]
- Cancel flow: feedback form; access continues to period end, then locked, data kept. [seen]

### Business rules
- Mercury-origin accounts are auto-synced; sync start = entries start for new accounts; when merging into an existing manual business account of compatible type, start = max(entries start, last entry + 1 day). [seen]
- Remove-from-Books is rejected if the source account changed concurrently (expected id check); mock deletes the account, its ledger, entries and first reconciliation. [seen]
- Skip-integration-setup flag auto-provisions ledgers. [seen]
- Commerce/payroll ledgers are protected from deletion while referenced. [seen]
- QuickBooks, NetSuite and Xero via Rutter are Mercury-banking-level ERP sync with an active-ledger switch (books or third-party); the Books bundle ships only a logo. [seen]

### Edge cases
- Source accounts have no parent ledger in the mock (top-level). [seen]
- Duplicate currency warnings should not reappear after dismissal. [seen]
- Non-USD is unsupported everywhere (currency fixed to USD). [seen]
- Plaid item erroring status shows in health but account stays listed. [inferred]

### What OpenBooks can skip
Mercury billing/subscription and cancel flow, MFA gating, Rutter and QuickBooks/NetSuite/Xero sync, accounting-partner matchmaking and admin endpoints, Finch/Gusto payroll sync, Stripe/PayPal commerce sync, Plaid bank sync. Keep: manual source accounts (with sign-inversion flag), CSV/statement import, feature-flag switches (as simple settings), and the ledger-creation side effects of source accounts. [inferred]

### Open gaps
Server-side default COA and cash/accrual differences, server delete rule, export XLSX shapes, closed-status header logic, real source-ledger parenting.

---

## 14b. Books shell and global UX

### Purpose
Layout, navigation, creation menu, shortcuts, side panel, permissions, onboarding "activation island", subscription and the Accounts page.

### Sidebar (order) [seen]
Home group: Home, Command. Main group: Transactions; Invoices (child: Customers); Bills (child: Vendors); Payroll; Journal Entries; Reports (children: Balance Sheet, Profit and Loss, Cash Flow Analysis, General Ledger, AR Aging, AP Aging); Reconciliation; Chart of Accounts; Rules; Accounts. Divider, then Settings group: Settings (children: Books Details, Tags, Tag Groups). Routes: `/books/:id`, `/command`, `/transactions[/:financialAccountType]`, `/invoices`, `/invoices/customers`, `/bills`, `/bills/vendors`, `/payroll`, `/manual-journal-entries[/:ledgerType]`, `/reports[/:reportType]`, `/reports/ar-aging`, `/reports/ap-aging`, `/reconciliations[/:sourceAccountId[/reconciliation/:id]]`, `/chart-of-accounts[/:ledgerType]`, `/rules`, `/accounts`, `/settings`, `/books-details`, `/tags`, `/tag-groups`, `/plaid-source-account-links/:id`, `/commerce-source-account-links/:id`, `/accounts` highlight param `highlightAccount`. Visibility: Command, Invoices, Bills, Customers, Vendors, Payroll, Rules, AR/AP Aging require a full banking org (business or personal; hidden for Books-only orgs); AR/AP Aging additionally need flag `booksAgingReports`. Clicking Reports opens Balance Sheet. Every item has an analytics id `books/sidebar/<slug>`.

### Top bar
Omnisearch trigger (Cmd/Ctrl+K), keyboard-shortcuts button, Feedback button, and an "add" split button. Menu groups [seen]:
- Create: Journal entry; Invoice and Bill (full orgs only; open the panel full-screen); Rule (disabled unless the org's active general ledger is Books [inferred]); Tag; Tag group.
- Import: Transactions (preselects the source account when on a reconciliation-account route; full-screen on small windows); Journal entries.
- Add: Ledger account; Customer; Vendor (last two full orgs only).
Pages may pass a `primaryAction`; if its id exists, the button becomes a labelled split button with that action (label map: Create journal entry/invoice/bill/rule/tag/tag group, Add a customer/vendor/account/ledger account, Import transactions/journal entries) and that item is removed from the dropdown to avoid duplicates. Default label "Add".

### Omnisearch [seen]
Sections: Pages, Accounts, Ledgers, Recent items (recent entries), Transactions, Journal entries, Invoices, Bills (last two full orgs). Unfiltered: 3 hits per section; once filtered to a section: 10. Empty query shows example prompts (recent transaction, an account, a ledger, "Cashflow Statement"). Query parsing extracts a dollar amount token (whole-dollar amount matches floor of abs amount, decimals match exact). Each section has a "view all" link carrying the query/amount as filters. Data is fetched lazily when the dialog opens.

### Keyboard shortcuts (modal opened by Cmd/Ctrl+S, ignored while the entity panel is open) [seen]
General: search everywhere (mod+K); show shortcuts (mod+S).
Grid: arrows move; shift+arrow extend; mod+arrow jump to edge; mod+shift+arrow extend to edge; PageUp/PageDown jump a page; Home/End first/last column; Tab / shift+Tab next/previous cell; mod+A select all rows; Esc clear selection; Enter or Space edit cell; Backspace clear cell; mod+C/V/X copy/paste/cut; mod+Z undo; mod+shift+Z redo; mod+E open row in side panel; mod+R mark reviewed; mod+U mark unreviewed; mod+D delete selected transactions.
Transaction review: R reviewed, U unreviewed (plus Up/Down between rows in the hover preview).
Side panel: Up/Down previous/next item; mod+E edit; R/U review state; mod+S save; mod+D delete; mod+Enter toggle fullscreen; Esc close.
The modal has a search box filtering by description, section title or key names (cmd/command on Apple, ctrl/control otherwise); a hover/focus popover previews the transaction-review subset with a link to all.

### Entity side panel [seen]
Redux slice `booksEntityPanel`: `isOpen, isFullScreen, fullScreenIfSmallWindow, entitySourcePage, createEntity, singleEntity, singleEntityOpenInEditMode, focusedEntityId, focusedEntity, entities[]`. Modes: carousel of the page's entities (open by id; prev/next via Up/Down), single entity, or creation card. Closing resets all. Entities re-sync only when the source page matches; the panel closes if the focused id disappears from the list. Create types: journalEntry, invoice, bill, customer, vendor, ledger, sourceAccount, importTransactions, importJournalEntries, rule, tag, tagGroup (save labels: Save, Create for invoice/bill, Import for imports). View/edit types add: transaction, invoiceDrilldown, billDrilldown, payrollRun, payrollMatching, paymentMatching, reportDrilldown, preload. A page can bind the focused entity to a query param: transactionId, journalEntryId, invoiceId, billId, payrollId, customerId, vendorId, ledgerId, ruleId (deep links). `fullScreenIfSmallWindow` goes full-screen when viewport <= 2285px. Resize: drag handle on the left edge or keyboard (Left +24px wider, Right -24px, Home min, End max); minimum/default width 584px, max bounded by container; width persisted in browser storage `booksEntityPanelWidth` and exposed as CSS var `--books-entity-panel-width`. Action bar buttons: minimize, full screen, close; edit, delete, duplicate; mark reviewed/unreviewed; post invoice/bill; match invoice/bill/payroll/payment and unmatch variants; open in banking / invoicing; view linked recipient; left/right auxiliary actions; move cards forward/backward; create mode: Save, Save as draft (invoices/bills), Cancel; edit mode: Save, Cancel. Save button can be disabled with a reason and shows loading states.

### Instance + notifications [seen]
- `GET /books/:id/instance` -> `{instance{entriesStart, latestJournalEntryDatetime, latestCloseDatetime?, categorizationPipeline ("mercury"|"disabled"|other), accountingBasis}, notificationStatuses[{notificationType,dismissed,dismissedAt}]}`. Derived: entriesStartDay (default today minus 4 years), entriesEndDay = later of today and latest JE date.
- `POST /books/:id/notifications/dismiss {notificationType}` (empty response; optimistic). Types: autoReconciliationNotification, completePlaidReconciliationNotification, firstTimeUserExperienceNotification, transactionsPageAutocatBannerNotification, subscriptionAdvanceNoticeNotification, booksCommandFirstUseNotification, booksActivationIslandSpotlightNotification, vendorRecipientRelationshipNoticeNotification, billsAccrualBillPayNoticeNotification. Missing status counts as dismissed.
- `POST /books/:id/update-instance` (entries start date; error: must be earlier than all transactions), `POST /books/:id/close {datetime}`.

### Permissions model [seen]
Server flags on the org user: `canManageBooks`, `canCodeTransactions`, `canManageAccountingIntegrations`, `canManageRecipients`, `canManagePaymentLinks`, `accountAccess.tag` (allAccounts vs custom), plus capability strings (`externalAccountIntegration` create/delete). Gates: see Books page = full org kind with `canManageBooks`, org not closed, activation state `onboarding` or `available` (`neverOnboarded`/`inactive` hidden); Books-only orgs also need entitlement `books`. `canBookkeeperManageBooks` = canManageBooks and gates all Books data queries and every Command tool. Onboard = org administrator while state is `onboarding`. Link/unlink external accounts need the capability; integrations settings need admin-or-custom role with API-token permission. Billing and subscription pages need administrator.
Role review (onboarding "invite your accountant"): eligible bookkeeper role needs all-accounts access (required), Accounting permission (required), canCodeTransactions, canManageAccountingIntegrations; recipients and invoicing permissions are optional and listed as missing-but-optional. Default selected role is the one named "accountant". Actions: continue, choose another role, edit role, create role. Invite creates an org-user invite for the chosen role. A "request accounting partner" path (`POST /books/organizations/:org/request-accounting-partner`) sets `accountingPartnerMatchmaking.tag = pendingMatch` on the activation state.

### Activation (onboarding) island [seen]
State `booksActivationState.tag`: neverOnboarded | onboarding | available(contents{booksId, onboardingPath, accountingPartnerMatchmaking?, ...flags}) | inactive. Three steps with completion flags: accounts (`externalAccountsConfigured`: select bank/credit accounts, Mercury accounts already synced), integrations (`integrationsConfigured`: Stripe, PayPal, Gusto), bookkeeping (`bookkeeperConfigured`, only offered in some org cases). Endpoints: `POST /books/:id/complete-connect-bank-accounts`, `/complete-connect-integrations`, `POST /books/organizations/:org/choose-onboarding-path {booksOnboardingPath}`, `POST /books/:org/create-instance {entriesStart?, accountingBasis?}` -> `{instance, organizationBooksId, booksActivationState}`, `GET /books/:org/ledger-templates/bulk`. After setup the island shows live status "importing transactions" then "auto-categorizing". Flag `booksSkipIntegrationSetupEnabled` lets the backend auto-finish setup of newly connected links.

### Subscription (Books-only pricing) [seen/inferred]
Books is a billing add-on `planProduct:"books"` (monthly plan id style `billing-plan-books-monthly`) with trial offers (mock data shows 30-day trial and $35/month; treat figures as unverified mock). Checkout events: subscribe, start trial, back, retry, close, services addendum link. Cancellation (`POST /organizations/:org/billing/cancel {planProduct}` -> `{billingEngineData}`): modal asks reason, most-used features and free-text feedback (feedback is analytics-only; request carries only the product), result sets `pendingCancellationAt` and a toast with the end date; states pending / unavailable; Keep subscription button; resubscribe flow exists while pending. Feature bullets listed in the modal: real-time financial reports, automated bookkeeping, Command for Books, unlimited accountant seats.

### Accounts page (source accounts) [seen]
Table "all accounts" = Books source accounts (Mercury accounts, manual, Plaid-linked, commerce-linked) + pending-removal Plaid links + Gusto payroll links (payroll only when full org). Filter tabs: All, Mercury, Bank, Credit, Payments, Payroll. Columns: Account (name + subtitle "Synced via X" or "Manual account"), Status badge, Type, Reconnect, row menu. Type: Bank vs Credit from Plaid `plaidAccountType` or debit/credit side; commerce = Payments; payroll = Payroll.
Status derivation (first match): pendingBooksRemoval -> "Deletion incomplete"; disabled -> inactive; plaid item erroring or commerce `disabled` -> connection lost (shows Reconnect via Plaid update mode / Rutter / Finch); pendingInitialSync -> setup in progress; syncInactive -> sync paused; syncActive -> Synced; pending -> setup pending; manual account -> "Not connected"; Mercury accounts always Synced. Link statuses: `pending, pendingInitialSync, syncActive, syncInactive, disabled`.
Add menu (banking orgs): Add manual source account (`create-source-account {name, businessPersonal, invertTransactionAmounts, ledger{financialAccountType, openingBalance?}}` -> `{sourceAccount}`; the sign inversion is chosen from account type + statement format); Link bank account; Link credit or other account (both need link capability); Payroll or payment processor (integrations picker: Stripe, PayPal, Gusto).
Row menu: Account settings (edit source account modal); Finish setup (when pendingInitialSync; opens the link page); Edit mapping rules (commerce links with syncActive); Import transactions (manual/non-Mercury; if Plaid link is active, opens link page instead); Resume sync; Pause sync (danger; confirm modal shows when sync was paused); Delete from Books (Plaid, danger; retry label if removal incomplete); Unlink / "Delete from Mercury" (Plaid link also removes the Mercury external account; "Books history was kept" toast); Remove account (only pending link without source account).
Endpoints: `POST /books/:id/update-plaid-account-link {plaidAccountId, syncEnabled}` -> `{plaidAccountLink}`; `POST /books/organizations/:org/update-commerce-account-link {connectionId, syncEnabled, ledger ids...}`; `POST /books/:id/update-finch-payroll-link {finchPayrollLinkId, syncEnabled}`; `POST /books/:id/remove-plaid-account-from-books {plaidAccountId, expectedSourceAccountId}` (fails if changed meanwhile); `POST /books/:id/update-source-account`; `POST /books/:id/create-and-link-teal-source-account` (plaidAccountId, ledgerId, name, invertTransactionAmounts?, startSyncDate); `GET /books/:id/plaid-teal-source-links` -> `{plaidAccountLinks[]}`; `GET /books/:id/source-accounts` -> `{accounts[]}`.
Currency warning: a modal appears when a linked account `currency !== "USD"`; dismissing stores the link id in a client-side list `booksDismissedCurrencyWarnings`. Initial sync start date message: from entries start date, or from the day after the latest journal entry (to avoid duplicates). Edit-source-account modal shows sync badge states: Sync failed, Sync in progress / Import in progress, Import failed, Sync disabled, Not synced yet, or last-synced timestamp; polls `latest-transaction-processing-task` (2s while pending, 30s otherwise); menu mirrors the row actions (mapping rules, resume/pause, unlink) and a delete button with deletability rules.

---

## 14c. Other Books-specific features

### Feature flags (Books) [seen; descriptions paraphrased]
`booksAgingReports` (AR/AP aging reports), `booksAiFilter` (AI filter tab on transactions), `booksApiScopesEnabled` (API tokens may reach Books endpoints that proxy the accounting backend), `booksAutocatAiExplainer` (explainers for AI auto-categorization), `booksSkipIntegrationSetupEnabled`, `booksStatementParsing` (upload a statement PDF to open a reconciliation from its parsed header). Command-related: `commandIsDown`, `commandCanonicalsEnabled`, `commandInlineCanonicalsEnabled`, `commandPageContextEnabled`, `command-use-server-powered-actions`, `command-schedules`, `command-plaid-actions`. Org-level: entitlement `books`, activation state, `accounting.activeGeneralLedger == "books"`.

### Integrations (commerce, payroll)
- Commerce via Rutter: Books supports Stripe and PayPal only (the Rutter platform enum has 18 platforms but only these two have default mapping templates). Org-scoped endpoints under `/books/organizations/:org/`: `commerce-account-links` (list), `create-commerce-account-link-draft` and `create-commerce-account-link` (body `publicToken` formatted as `<token>:<PLATFORM>`), `reconnect-commerce-account-link[-draft]`, `update-commerce-account-link`, `delete-commerce-account-link`. Books-scoped: `POST /books/:id/create-commerce-source-account {connectionId, ledgerId, tealSourceAccountId?, revenueLedgerId, feeLedgerId, refundLedgerId, startSyncAt}`. A link has `linkStatus`, `startSyncDate`, `syncPausedAt/By`, `currency`, `nickname`, and `linkedCommerceAccount{storeName, platform, disabled, lastSuccessfulSync}`.
- Mapping-rules modal maps three ledgers per link: revenue, fee (expense), refund. Defaults: "<Platform> Revenue" (operatingRevenues, credit), "<Platform> Fees" (operatingExpenses, debit), "<Platform> Returns & Allowances" (operatingRevenues, debit); an existing ledger is reused if its name matches common variants (e.g. "stripe sales revenue"), else it is auto-created. Tags "Revenue", "Fee", "Refund".
- Payroll via Finch with Gusto only: `GET .../finch-payroll-links`, `create-finch-payroll-link-draft`, `initialize-finch-payroll-setup`, `POST /books/:id/finalize-finch-payroll-setup`, `update-finch-payroll-link`, `delete-finch-payroll-link`; reauth state `NeedsReAuthentication` -> connection lost. Payroll page endpoints: `/payroll`, `/payroll-runs`, `/payroll-runs/unmatched`, `/payroll-runs/:id/details`, `/match-payroll/:journalEntryId`.
- QuickBooks/NetSuite are NOT Books features: they belong to Mercury's separate accounting integration (Rutter classes list `/organizations/:org/rutter-classes/list`). The `quickbooks` chunk is only a logo asset. Books rules and the Rule creation menu are disabled when the active general ledger is not Books.

### Imports [seen]
- Import transactions (side-panel card, per source account): paste-from-CSV grid (no file picker) with 3 columns: Date (editable, earliest = Books entries start, latest = today + 100 years; non-USD warning is elsewhere), Description (required), Amount (required, negatives allowed). Status machine: empty -> missing values -> errors -> valid; plus "checking for pending import" and "pending import" (blocks while another import task for the account is pending). Save enabled only when valid. `POST /books/:id/create-transactions {sourceAccountId, transactions[{id, amount, datetime ISO UTC, description}]}` -> `{transactionProcessingTask}`; track via `GET latest-transaction-processing-task` (params sourceAccountId; status pending|complete|failed). Debit/credit sign is derived from the source account's `invertTransactionAmounts`. Account selector lists importable accounts only (non-Mercury).
- Import journal entries: paste grid with columns Date (same range rule; paste parses flexible date strings), Description (required, <=512), Debit ledger account (required, editable ledgers only), Credit ledger account (required), Amount (required, >= 0). Each row becomes a balanced two-line entry (both lines use the row description). `POST /books/:id/create-journal-entries-bulk {journalEntries[{datetime, description, lineEntries[debit, credit]}]}`; success toast a success toast with the count, server error text shown if human-readable.
- Chart of accounts import and statement upload are covered by other sections (analytics ids `books/import-coa/*`: upload file, sample download, grid with add/move-up/delete row actions).

### Exports [seen]
Server-side xlsx via authenticated GET with `?q=<JSON of the same list query>`: `/books/:id/journal-entries.xlsx`, `/line-entries.xlsx` (general ledger), `/aging-report.xlsx`, `/aging-report/sources.xlsx`. Client-side xlsx (exceljs, lazy loaded) for Balance Sheet, P&L and Cash Flow: sheet "Report", centered bold merged header rows (org name, report title, period summary), bold header row, indented line names (4 spaces per level), numeric strings converted to numbers with `#,##0.00`, highlighted rows shaded, optional Total column when periods are monthly/quarterly and report is not a balance sheet or cash flow. File name `mercury-<org-name-slug>-<reportType>-<range>.xlsx`.

### Admin matchmaking (staff only) [seen]
Page `/admin/books/matchmaking` with two tabs: matchmaking queue and firms. `GET /admin/books/matchmaking` -> `{clientOrganizations[{organizationId, orgName, callsign, contactEmail, dateEnteredQueue, matchedAgentOrganizationId?, matchedAgentOrganizationName?, industry, expenseRange (bands like tenThousandToOneHundredThousand), employeeCount, entityType, stateOfFormation}], accountingFirms[{agentOrganizationId, name, primaryContactFirstName, primaryContactEmail, bookkeepingMonthlyStartingPrice?}]}`. Actions: `POST /assign {assignments:[{organizationId, agentOrganizationId}]}` (assign or reassign; emails the firm), `/primary-contact {agentOrganizationId, primaryContactFirstName, primaryContactEmail}` (validates first name and email), `/remove {organizationId}` (confirmation: remove founder from queue), `/starting-price {agentOrganizationId, bookkeepingMonthlyStartingPrice|null}` (> $0, 2dp, null clears). Founder-side trigger is request-accounting-partner (above).

### AI transaction filter (feature `booksAiFilter`) [seen]
`POST /books/:id/infer-transaction-filters {search}` -> `{filterPayload}` where payload = `{friendlyLabel, dateRange{tag: thisMonth|lastQuarter|custom{start,end}|allTime...}, amount{min?,max?}, searchTerm[{query}], sortSettings, booksLedgerIds, booksSourceLedgerIds, booksTagIds, booksReviewStatuses (unreviewed...), booksCategorizationMethods (uncategorized|ai|...), booksSource, booksFinancialAccountType}`; the client drops unsupported keys (tags when tag filtering is unavailable, financial type not rendered) and reports dropped facets. Also `POST /books/:id/suggest-transaction-filters` -> `{suggestions[], recents[]}`, `record-transaction-filter-recent`, `record-transaction-filter-feedback` -> `{id}`. Example suggestions: uncategorized this month, unreviewed over $1,000, software spend last quarter, credit-card charges categorized by AI.

### Other surprises worth copying or noting
- Soft period close with no hard lock; reconciliation not required to close.
- Books has its own insights endpoint `GET /books/:id/insights` (revenue/profit trend, used by home) and `GET /books/:id/categorization/metrics`.
- Every Books API supports an `X-Command-Conversation-Id` attribution header (audit of AI writes).
- Bank-link cleanup is explicit and resumable: a link can be "pending Books removal" (retry deletion), with an optimistic-concurrency token (`expectedSourceAccountId`).
- Amounts: UI sends decimal-dollar strings/numbers; all AI validation uses integer cents internally to avoid float drift.
- Agent (accounting firm) portal shows a dismissible "Books" promo banner (`hasDismissedAdvisorPortalBooksPromoBanner`).
- Open gaps: exact Books server enum for `accountingBasis`, `categorizationPipeline` values beyond mercury/disabled, the server-side read-tool schemas, and real (non-mock) Books pricing.

// Item 3.8: US tax page (C-corp path, page header) and the planner's year picker / C-corp duty.
export default {
  "taxUS.sub": "Foreign-owned single-member LLC · what the IRS needs this year",
  "taxUS.year": "Tax year",
  "taxUS.cc.sub": "LLC taxed as a C-corp · what the IRS needs this year",
  "taxUS.cc.autoText": "Official Form 1120 + 5472 from irs.gov, filled from these books and the details on the right.",
  "taxUS.cc.autoTextMissing": {
    one: "Official Form 1120 + 5472 from irs.gov, filled from these books and the details on the right — {n} detail still blank.",
    other: "Official Form 1120 + 5472 from irs.gov, filled from these books and the details on the right — {n} details still blank.",
  },
  "taxUS.cc.income": "Corporate income tax (Form 1120)",
  "taxUS.cc.incomeText": "Taxable income {taxable} × {rate}% = {tax} federal tax. Page 1 is filled from the P&L; Schedules J, K and L are for your preparer.",
  "taxUS.cc.5472": "Form 5472, attached to the 1120",
  "taxUS.cc.5472Text":
    "Part I: total assets at year end {assets} · Parts II–III: you, the foreign owner · Part IV (dividends, loans, payments with you) is for your preparer.",
  "taxUS.cc.fileByText":
    "The 1120 can be e-filed through a provider or your CPA, with the 5472 attached. Form 7004 extends filing to {ext}, not payment: pay the tax by {date}.",
  "taxUS.cc.dividends": "Dividends to you",
  "taxUS.cc.dividendsText": "The corporation withholds {rate}% (treaty rate) on dividends it pays you and reports them on Form 1042 / 1042-S by {date}.",
  "taxUS.cc.israelText":
    "The C-corp is a company: Israel taxes you on the dividends it pays you in {y} (credit for the US withholding), and may treat it as Israeli-resident if it's managed from Israel. Ask an Israeli advisor before filing {y}.",
  "taxUS.cc.ownerTitle": "Transactions with the owner in {y}",
  "planner.year": "Tax year",
  "planner.cc.1120": "Form 1120 + 5472",
  "planner.cc.1120Text": "Federal tax about {tax} ({rate}% of {taxable} taxable income). A missing 5472 costs {amount}.",
  "planner.cc.ilText":
    "The C-corp is taxed as a company; Israel taxes what it pays you as dividends, with credit for the US withholding. Converted at the Bank of Israel rate.",
};

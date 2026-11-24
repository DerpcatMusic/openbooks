// Money across accounts and businesses: transfer pairs, opening balances, loans.
export default {
  "type.loan": "Loans",

  "money.transfers.title": "Transfers between your accounts",
  "money.transfers.sub": "These look like money moving between your own accounts. Confirm to file both sides; a pair you reject isn't suggested again.",
  "money.transfers.out": "Out of",
  "money.transfers.in": "Into",
  "money.transfers.confirm": "Confirm",
  "money.transfers.reject": "Not a transfer",
  "money.transfers.diff": "{pct} apart at the day's rate",
  "money.transfers.as": "Files as: {out} · {in}",

  "money.anchor.col": "Opening balance",
  "money.anchor.set": "Set",
  "money.anchor.edit": "Balance of {account}",
  "money.anchor.title": "Balance of {account}",
  "money.anchor.desc": "The balance at the end of a day, as the bank shows it. Balances before and after that day are worked out from the transactions.",
  "money.anchor.date": "Date",
  "money.anchor.balance": "Balance",
  "money.anchor.known": "Known balances",
  "money.anchor.fromBank": "From the bank",
  "money.anchor.remove": "Remove the balance of {date}",
  "money.anchor.add": "Add balance",
  "lev.title": "Your money as leverage",
  "lev.sub":
    "What all your businesses' accounts show you could keep, from how your money sits and moves. Worked out from your own numbers, in ₪, for this tax year.",
  "lev.total": "about {amount} a year",
  "lev.perYear": "{amount} a year",
  "lev.failed": "Couldn't load your accounts to work this out.",
  "lev.none": "Nothing stands out yet: no idle cash above your buffer and no costly transfers.",
  "lev.idle-cash.title": "Cash that sits idle",
  "lev.idle-cash.body":
    "{idle} never left your accounts in the last 90 days, beyond {buffer} kept for 3 months of spending. At {pct}% a year it would earn this. Better still, put it where growth isn't taxed until you take it out: a keren hishtalmut (up to its yearly cap) or a kupat gemel lehashkaa.",
  "lev.transfer-routes.title": "What moving your own money costs",
  "lev.transfer-routes.body":
    "Wire and exchange-rate costs took {fees} this year. Your cheapest route is {best} ({pct}%). Sending everything that way would have saved this.",
  "lev.route": "{n}× · {sent} sent · {fee} cost ({pct}%)",
  "lev.year-end.title": "Room left under the osek zair ceiling",
  "lev.year-end.body":
    "You've used {pct}% of the ceiling; {headroom} is left. Income counts when it's received, so a payment due late in December can be received in January and count toward next year.",
  "lev.borrow.title": "Borrow against it, don't cash it out",
  "lev.borrow.body":
    "The wealthy rarely sell what grows tax-free; they borrow against it. If you need cash and have a keren hishtalmut, a loan against its balance keeps the tax-free growth going. A withdrawal before 6 years is taxed. Weigh the loan's interest against what the fund earns.",
  "lev.defer.title": "Let a company hold what you don't spend",
  "lev.defer.body":
    "Profit you leave inside a company is taxed at the company rate now. Dividend tax comes only when you take it out. If you keep a lot in the business, compare the Ltd option in the table below.",
  "lev.guardrail": "Legal tax planning, not hiding income. Every move here is reported. Confirm the details with your accountant before acting.",
};

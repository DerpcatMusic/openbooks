---
title: "Refunds shrink spending, card payoffs are not transfers, and a subscription is a steady price on a steady cadence"
author: DerpcatMusic
date: 2026-11-25
branch: fix/refunds-card-payoffs-wise-recurring
cost: { minutes: 1, tokens: 2391 }
id: l-bf6967e8
scope: repo
status: active
src: agent
touches:
  - packages/core/src/reports.ts
  - packages/core/src/recurring.ts
  - packages/core/src/transfers.ts
  - packages/tools/src/money.ts
  - packages/importers/src/connectors/banks.ts
---

## Decided

- Money in / out is decided by what a row is (core inSide), not its sign: a refund filed under spending shrinks money out, a chargeback on income shrinks money in. Totals, merged view, months and insights all go through it; the sankey already netted refunds.
- A same-business card payoff (Mercury Checking -> Mercury Credit autopay) is never a transfer leg in the merged view: not pending, not "moved". The card charges are the spending.
- Subscriptions: a fixed price (within 1%) on a monthly-or-longer cadence needs only 2 charges; a payer can have several plans; a charge one cadence before at another price continues the series as a price change. Varying amounts still need 3 within 35%.
- A series counts as cancelled only when its account shows later activity past the expected charge, never by comparing with the calendar: books that stopped syncing say nothing about a cancelled subscription.

## Tried and ruled out

- Equal amounts among many varying ones (Mercury cashback cents) looked like plans; a fixed series is dropped when the payer charged other amounts more often than the series itself while it ran.

## Watch out

- Wise delivery estimates are one more call per outgoing transfer (same failure budget). Mercury exports without estimatedDeliveryDate have no eta; matching falls back to the 4-day window from the day it left.

In the code: packages/core/src/reports.ts (inSide), packages/core/src/recurring.ts, packages/core/src/transfers.ts (pairs: eta), packages/tools/src/money.ts (legs filter), packages/importers/src/connectors/banks.ts (wiseLink eta).

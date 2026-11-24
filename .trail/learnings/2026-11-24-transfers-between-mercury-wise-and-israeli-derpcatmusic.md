---
title: "Transfers between Mercury, Wise and Israeli banks are paired on what the bank itself reports before any amount guess"
author: DerpcatMusic
date: 2026-11-24
branch: feature/implemented-mercury-credit-auto-dedup-fee-aware-multi-ho
cost: { minutes: 28, tokens: 186045 }
id: l-1ade63df
scope: repo
status: active
src: agent
touches:
  - packages/core/src/leverage.ts
  - packages/core/src/leverage.test.ts
  - apps/web/src/routes/taxximizer/Leverage.svelte
  - packages/schema/src/index.ts
  - packages/importers/src/readers/mercury.ts
  - packages/importers/src/connectors/banks.ts
  - packages/core/src/transfers.ts
  - apps/web/src/lib/txns/TxnDrawer.svelte
---

## Decided

- Readers keep the bank's own facts on a row as `link`: Mercury (currencyExchangeInfo → exact amount and currency that arrives, externalMemo → reference, counterparty and bank name, wire fee, dashboard link and receipt count) and Wise (fetches /v1/transfers/{id} for TRANSFER-<id> lines → targetValue/targetCurrency and reference; senderName and paymentReference on deposits; totalFees).
- The matcher ranks pairs by evidence first: 2 = the bank's stated arriving amount matches (within 0.5%) or the reference appears on the other side, 1 = the counterparty names the other account's bank, 0 = amounts only. A stated arriving amount is compared near-exactly instead of with our BoI conversion, so a Mercury wire pairs with the One Zero deposit Mercury said would arrive, even when another deposit is closer to the BoI-converted amount.
- The fee shown is still sent-at-BoI minus received, so it includes the FX spread, not only the wire fee.

## Watch out

- Wise transfer lookups are one extra call per outgoing transfer per sync. A failure is ignored (that row just has no `to`).
- Auto-sync backs off after failures (30 min × 2^(n-1), capped at the 6 h staleness window) so a bank that's down, or a scraper, isn't hit every 15-minute check.

In the code: packages/schema/src/index.ts (TransferLink), packages/importers/src/readers/mercury.ts (mercuryLink), packages/importers/src/connectors/banks.ts (wiseLink), packages/core/src/transfers.ts (evidence, fit), apps/server/src/autosync.ts (isStaleConnection back-off).

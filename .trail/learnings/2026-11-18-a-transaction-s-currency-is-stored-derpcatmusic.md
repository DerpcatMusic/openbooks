---
title: "A transaction's currency is stored only when it differs from its books' currency, and a missing exchange rate is never 1"
author: DerpcatMusic
date: 2026-11-18
branch: money-core
cost: { minutes: 1, tokens: 1548 }
id: l-93cf5685
scope: repo
status: active
src: agent
touches:
  - packages/core/src/fx.ts
  - packages/storage/src/ingest.ts
  - packages/tools/src/money.ts
  - packages/core/src/transfers.ts
---

## Decided

- Readers set `currency` on a row when they know it (scraper: chargedCurrency, else the account's `currency`, only when not shekels; Mercury: always USD). Ingest then drops it when it equals the entity's currency (core `currencyOf`: meta.currency, else us-llc → USD, else ILS). Absent always means "the books' currency".
- Why: the reader tests compare row-for-row against books.py output (python.json), and one-currency books stay byte-identical in books.db. The golden helper strips `currency` and asserts it separately.
- BoI rates: the latest published rate on or before the date, but at most 7 days back (`MAX_GAP_DAYS`). Past that the rate is missing (null), never 1.0 and never a stale carry-forward. Net worth lists missing currency-days and counts that account 0 that day.

## Watch out

- The rate cache in doc `_app`/"fx" leaves the current day open because the BoI publishes in the afternoon, and it waits an hour per process before asking again for a range that failed. That keeps offline use fast, at the cost of a new rate showing up to an hour late.
- Transfer pairs are stored as "entity/txn id" in each touched entity's "transfers" doc. Confirming files both sides through classify (LLC side equity:owner, other side own:transfer, same entity transfer:internal).

In the code: packages/core/src/fx.ts, packages/storage/src/ingest.ts, packages/tools/src/money.ts, packages/core/src/transfers.ts

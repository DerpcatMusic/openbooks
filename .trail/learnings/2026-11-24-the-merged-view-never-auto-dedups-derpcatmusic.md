---
title: "The merged view never auto-dedups a row you filed as income or spending, and the cost of each transfer is booked as a fee"
author: DerpcatMusic
date: 2026-11-24
branch: feature/implemented-mercury-credit-auto-dedup-fee-aware-multi-ho
cost: { minutes: 1, tokens: 1917 }
id: l-58fb0e4d
scope: repo
status: active
src: agent
touches:
  - packages/core/src/transfers.ts
  - packages/tools/src/money.ts
---

## Decided

- Auto-detected transfer legs (detectMergedTransfers) only come from rows still "ask" or already a non-flow type (transfer/own/equity/personal/loan). A row filed as revenue or an expense is never silently dropped from worldwide totals, even when an equal opposite amount sits in another account within 7 days (rent out of Mercury vs a client payment into One Zero).
- Pairs chain into journeys (Mercury → Wise → One Zero is one journey). A leg continues a journey when it leaves the account the money last landed in, same currency, within 7 days, about the same amount.
- What a leg cost (sent minus received at the BoI rate of the day it left: wire fee plus FX spread) becomes an expense:bank-fees row on the sender's side in the merged txns. So net = in - out already includes transfer costs. Confirmed pairs get their fee booked too, not only detected ones.
- Lifecycle: detected (kept out of totals, "Detected" badge) → Confirm (files both sides via /api/transfers) or "Not a transfer" (rejected pair; both sides count again).

## Watch out

- The implied fee can't go below 0. Receiving more than the BoI rate gives 0, not income.
- A confirmed pair shows only when both sides fall inside the span.

In the code: packages/core/src/transfers.ts (detectMergedTransfers, impliedFee, transferJourneys), packages/tools/src/money.ts (combinedFlow transfers/journeys, fee~ rows), apps/web/src/routes/home/+page.svelte (highlight, journeys card).

---
title: Merged transfer dedup prefers same-currency legs
author: DerpcatMusic
date: 2026-11-24
branch: feature/implemented-mercury-credit-auto-dedup-fee-aware-multi-ho
id: l-7006a50c
scope: repo
status: active
src: agent
touches:
  - "packages/core/src/transfers.ts#detectMergedTransfers"
---

detectMergedTransfers ranks same-currency pairs before cross-currency ones (TransferOptions.preferSame). Without it, Mercury USD -1000 -> Wise USD +992 -> One Zero ILS 3580 matched Mercury directly to One Zero (0.56% off, closer than the real 0.8% USD leg), leaving the Wise in/out unmatched and counting them as fake gross inflow + outflow. Two sides in the same currency differ only by a fee, so they are the trustworthy match; a cross-currency diff mixes FX spread and fee. suggestTransfers keeps the old order by default so the one-off transfer dialog is unchanged.

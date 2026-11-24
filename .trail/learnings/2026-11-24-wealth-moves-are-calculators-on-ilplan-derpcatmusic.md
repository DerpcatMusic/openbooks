---
title: "Wealth moves are calculators on ilPlan, not new playbook entries"
author: DerpcatMusic
date: 2026-11-24
branch: feature/implemented-mercury-credit-auto-dedup-fee-aware-multi-ho
cost: { minutes: 1, tokens: 1465 }
id: l-2b0c49b9
scope: repo
status: active
src: agent
touches:
  - packages/countries/il/src/moves.ts
  - apps/web/src/routes/taxximizer/Moves.svelte
  - apps/web/src/lib/home/Todo.svelte
---

## Decided
The Israeli playbook (playbook.json + advise()) already scores ~50 deductions/credits from the person's answers. The "if you do X you keep Y" moves (trip, borrow vs sell, gemel, UCITS vs US estate tax, amuta, Ltd retention, spouse, rent track, gifts, timing, treaty W-8BEN) live separately in country-il moves.ts as user-driven calculators: every tax figure re-runs ilPlan with and without the move so brackets, points and BL count. Fixed 2026 amounts cite their source inline.

## Watch out
Timing move reuses this year's table for next year. Expense-type moves return 0 on the osek zair track (flat 30% replaces expenses). Research flagged the LLC-managed-from-Israel classification (circular 5/2004) as the foundation question; it stays in the playbook as il-llc-transparency, not a calculator.

In the code: packages/countries/il/src/moves.ts, apps/web/src/routes/taxximizer/Moves.svelte, apps/web/src/lib/home/Todo.svelte

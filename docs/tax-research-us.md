# US federal deduction research (TY2025 / TY2026)

As of 2026-10-29. Machine-readable table: `packages/countries/us/tables/deductions.json` (39 rules, 14 moves). Research only, not tax advice. Federal only; states differ.

Verification legend: **[read]** = primary text opened this session. **[2nd]** = primary doc not opened; figure confirmed by trade press / law-firm summaries. **[memory]** = stable public figure, not re-checked.

## 0. Who the deductions apply to

- **Schedule C sole prop / US freelancer**: all rules below apply (IRC 162, 274, 280A, 179, 199A...).
- **Foreign-owned single-member LLC (disregarded), no US trade or business**: deductions generally have **no US tax effect**. A nonresident alien is taxed on US-source FDAP gross (30% or treaty rate, no deductions, IRC 871(a)/881) and on ECI net. Services performed outside the US are foreign-source (IRC 861/862), so no US tax and nothing to deduct. Deductions against ECI are lost if the 1040-NR/1120-F is not filed on time (IRC 874(a), 882(c)(2)). The pro forma 1120 + Form 5472 carries reportable related-party transactions, not business deductions. The Taxximizer should show "$0 US tax effect" for these entities unless the user attests to a US trade or business. QBI also needs ECI (IRC 199A(c)(3)(A)(i)).
- C-corp (LLC electing corporate treatment): same 162/274 rules; no QBI, SE tax, SEHI or home-office-as-individual (use accountable plan).

## 1. 2025 -> 2026 changes

| Item | TY2025 | TY2026 | Source |
|---|---|---|---|
| Business mileage | 70c | 72.5c (Jan 1-Jun 30), **76c from Jul 1** | Notice 2025-5; Notice 2026-10; IR-2026-29 (IRS rates page read) |
| Sec. 179 limit / phase-out | $2,500,000 / $4,000,000 | $2,560,000 / $4,090,000 | Rev. Proc. 2025-32 [read] |
| 179 heavy-SUV cap | $31,300 | $32,000 | Rev. Proc. 2025-32 [read] / 2024-40 [2nd] |
| Bonus depreciation | 100% for property acquired after 1/19/2025 (permanent); older acquisitions 40% | 100% permanent; older acquisitions 20% | OBBBA sec. 70301; Notice 2026-11 [2nd] |
| Auto caps (280F) yr1 bonus/no bonus | $20,200 / $12,200 | $20,300 / $12,300 | Rev. Proc. 2025-16; 2026-15 [2nd] |
| QBI | 20%, sunset scheduled | **permanent**; $400 minimum if QBI >= $1,000; phase-in range $75k/$150k; threshold $201,750 / $403,500 | OBBBA sec. 70105; Rev. Proc. 2025-32 sec. 4.26 [read] |
| 1099-NEC/MISC threshold | $600 | **$2,000** (payments after 12/31/2025; indexed from 2027) | OBBBA sec. 70433 [2nd] |
| 1099-K threshold | $20,000 / 200 tx (reset by OBBBA, retroactive) | same | OBBBA sec. 70432 [2nd] |
| Employer on-premises / convenience meals (274(o)) | 50% | **0%** | IRC 274(o) |
| 401(k) deferral / catch-up 50+ | $23,500 / $7,500 | $24,500 / $8,000 (60-63: $11,250) | Notice 2025-67 [2nd] |
| 415(c) limit (SEP, Solo 401k) | $70,000 | $72,000 | Notice 2025-67 [2nd] |
| Comp cap 401(a)(17) | $350,000 | $360,000 | [2nd] |
| SS wage base | $176,100 | $184,500 | SSA [2nd] |
| Standard deduction (single) | $15,750 (OBBBA) | $16,100 | Rev. Proc. 2025-32 [read] |
| GSA M&IE standard (CONUS) | $68 | $68 (FY2027 also $68; lodging cap $113) | GSA [2nd] |
| IRS high-low per diem | $319 / $225 (M&IE $86 / $74) | from 10/1/2026 $329 / $230 (M&IE unchanged) | Notice 2025-54; Notice 2026-60 [2nd, number from press] |
| Domestic R&E / software dev | expensed (new IRC 174A, tax years after 2024) | same | OBBBA sec. 70302 [2nd] |

Unchanged by OBBBA: 274(k)/(n) 50% meals, 274(a) no entertainment, 274(b) $25 gift cap, 274(m)(3), 274(c), 280A.

## 2. Rules in short

**Meals.** Business meal with a business associate, business discussed, not lavish: 50% (IRC 274(k),(n); Reg. 1.274-12). 100% only for narrow exceptions (employee parties, meals taxable to employees, items sold to customers, client-reimbursed meals you bill at cost: IRC 274(e)). Entertainment: 0% since 2018 (274(a)); a meal at the event is 50% only if separately stated (Reg. 1.274-11; Notice 2018-76).
**Popular belief that is wrong:** working alone from a cafe and buying coffee/lunch is **personal** (IRC 262; Reg. 1.262-1(b)(5); US v. Correll 389 U.S. 299) - deductible at 50% only when traveling away from home overnight. Likewise "client entertainment is 50%" ended 2017.
Travel meals: 50% of actual or M&IE per diem; self-employed may use M&IE per diem (Rev. Proc. 2019-48), not high-low lodging. First/last day 75% of rate, then 50%.

**Travel.** Transport and lodging 100% when away from home overnight on business (162(a)(2)); lavish limit 274(m)(1). Foreign trips outside the US must be allocated by business days (274(c)) unless trip is <= 7 consecutive days (not counting departure day), < 25% personal, no major control, or vacation not a major consideration (Reg. 1.274-4). Domestic mixed trip: transport 100% if primary purpose is business, lodging/meals only business days (Reg. 1.162-2(b)). **Companion (spouse, partner, girlfriend):** deductible only if a bona fide employee with a real business purpose (274(m)(3); Reg. 1.162-2(c)); otherwise 0%, though a shared room is still deductible at the single rate. Foreign conventions need a reasonableness showing (274(h)(1)); cruises capped at $2,000/yr on US-flag ships with US ports (274(h)(2)).

**Substantiation (274(d)).** Amount, time/date, place, business purpose (and business relationship for meals/gifts), by adequate records or corroborated own statement; receipts for $75+ and all lodging (Reg. 1.274-5(c)(2)(iii)). No Cohan estimate for these items.

**Vehicle.** Standard mileage includes depreciation; add parking and tolls only. Must elect in year 1 to preserve choice (Rev. Proc. 2019-46). Actual method uses business-use % and 280F caps. Commuting is personal. Listed property needs > 50% business use for MACRS/bonus/179.

**Home office.** Regular and exclusive use, principal place of business or client meetings (280A(c)(1)). Simplified $5/sq ft up to 300 = $1,500 (Rev. Proc. 2013-13); or actual with Form 8829. Limited to business income. Employees cannot deduct (67(g) made permanent by OBBBA).

**Equipment/software.** De minimis safe harbor $2,500 per invoice/item without an AFS (Reg. 1.263(a)-1(f)); 179 as above; 100% bonus permanent for post-1/19/2025 acquisitions; MACRS 5-yr computers/cars, 7-yr furniture, 39-yr nonresidential. SaaS subscriptions are ordinary expenses. Phone/internet: business-use % only; cell phones no longer listed property.

**Other.** Gifts $25/recipient/year (274(b)); education must maintain/improve current skills, not qualify for a new trade (Reg. 1.162-5); professional fees and insurance deductible; SEHI above-the-line (162(l)) up to net profit; half of SE tax deductible (164(f)); SEP/Solo 401(k) per table; QBI 20%; startup costs $5,000 + 180-month amortization, phase-out over $50,000 (195); bank/merchant fees deductible (gross-up for 1099-K); contractors need W-9/W-8BEN, 1099-NEC at $2,000 for 2026; state LLC fees deductible.

## 3. Open questions / unverifiable items

1. **Primary IRS PDFs not opened** (only Rev. Proc. 2025-32 and the IRS mileage page were read): Notices 2025-67, 2026-10 (rate confirmed on IRS newsroom/rates page), 2026-11, 2026-60, Rev. Procs. 2025-16 and 2026-15, IR-2026-29 text, OBBBA text for secs. 70301/70302/70432/70433. Several URLs in the JSON are constructed from IRS naming patterns (`irs-drop/n-YY-NN.pdf`); a few may 404.
2. **Notice 2026-60 number and rates** reported by Accounting Today only. GSA FY2027 lodging $113 / M&IE $68 via secondary summaries.
3. **76c mid-2026 mileage rate**: seen on the IRS rates page; the app must switch rate on 2026-07-01 by trip date.
4. **De minimis employee snacks/coffee** and whether 274(n) still limits them: unsettled, defaulted to 50%.
5. **SECURE 2.0 sec. 317** (new solo 401(k) deferrals up to filing deadline): from memory, verify before offering as a move.
6. **Retroactive 174A election** for small businesses (Notice 2025-23): not verified.
7. **State conformity** (bonus, 179, QBI, SALT) is not modeled; California and others differ.
8. **Repo inconsistency:** `tables/2026.json` has `delawareTax: 400`; search shows the Delaware LLC annual tax is $300 (the $400 looks like a corporate franchise figure). Wyoming $60 min confirmed by secondary sources only. `nec1099: 2000` in 2026.json matches OBBBA; a 2025 table would need $600.
9. 2025 QBI thresholds ($197,300 / $394,600) and 401(k) 2025 limits are [memory]/[2nd].
10. Foreign-owned LLC: whether any US trade or business exists (e.g., US-based contractors, US office) is a facts question the app should ask; it flips every deduction from "moot" to "material".

## 4. Suggested wiring

Each `rules[].match` (keywords/MCC) feeds the tag suggester; `incomeTaxPct` is the default deductible share for Schedule C; `cap` needs stateful counters (gifts per recipient, mileage by date, per diem by locality); for `llc-disregarded` multiply by 0 unless `usTradeOrBusiness` is attested. `moves[]` map onto playbook items (`packages/countries/us/playbook.json` currently has 9, all foreign-owner compliance; none of these Schedule C moves exist yet).

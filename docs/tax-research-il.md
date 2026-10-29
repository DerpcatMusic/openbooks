# Israeli deductible-expense rules for smart tags (TY2025, TY2026)

Research note for the OpenBooks "smart tags" and the Taxximizer. Machine-readable table: `packages/countries/il/tables/deductions.json` (40 rules, 14 moves). As of 2026-10-29. Not tax advice.

Source quality, best to worst: **statute** (Income Tax Ordinance, VAT Law), **regulation**, **circular** (Tax Authority notices), **practice** (accountant or ITA practice, no primary text found). The legal texts were read from the consolidated versions on Hebrew Wikisource (`he.wikisource.org`); they carry year-by-year indexed amounts as annotations, which I did not cross-check against Reshumot. Secondary sources (Efraty & Co 2025-2027 guide, BSH CPA, kolzchut, the Technion summary of the ITA travel table) are labelled as such.

## Where popular belief is wrong

| Belief | What the sources say |
|---|---|
| "Osek zair starts in 2026" | No. The reform is Ordinance ss.87ב-87ז, enacted in the 2023-24 Arrangements Law, effective **tax year 2024**. What is new in 2026 is only the ceiling: ₪122,833 (was ₪120,000 in 2024-2025), the same indexation as the VAT patur ceiling. |
| "A business lunch/dinner with a client is deductible" | Hosting in Israel is non-deductible (s.32(1) 'אש"ל' bars the taxpayer's own meals; VAT reg. 16 bars input VAT on hosting). The 80% rule covers only light refreshments consumed at your own place of business. Exception: hosting a guest from abroad. |
| "Coffee in a café while working" | 0%. ITA 2018 position: a stay in cafés and restaurants is not 'office services'; co-working space is. |
| "Mobile phone: 50%, cap ₪1,200" | Stale. The rule is: the non-deductible part is the lower of 50% of cost or **₪1,380 a year** (₪115/month), 2023-2027. Everything above 50% of cost is deductible, and for a big annual bill the disallowed part stops at ₪1,380. |
| "Gifts: ₪230 per client" | ₪230 was 2023. The annotated regulation says **₪240** for 2024-2027 (US$15 for gifts abroad). Efraty's 2025 guide still prints ₪230. Flagged. |
| "My girlfriend's/wife's trip is deductible because the trip is business" | No by default. s.32(2): only money spent wholly and exclusively to produce income. A companion's flight, extra room cost, meals and tours are private. Deductible only if the companion has a genuine, documented working role that required presence. See below. |
| "A donation is a deduction" | It is a 35% credit under s.46 (not an expense) when donations in the year exceed ₪207. |

## Food and hosting

| Rule id | Income tax | VAT | Basis |
|---|---|---|---|
| `il.refreshments` | 80% of light refreshments (hot/cold drinks, cookies, fruit and the like) at the place of business | unclear, kept null | Reg. on deducting certain expenses, reg. 2(1) (regulation) |
| `il.meals-own` | 0% (own meals, anywhere; except hotel breakfast and the travel per-diem) | 0 | Ordinance s.32(1) (statute) |
| `il.hosting-il` | 0% | 0 | s.32(1)-(2); VAT reg. 16 |
| `il.hosting-foreign-guest` | 100%, no ₪ cap, must be reasonable | 100% | VAT reg. 16 exception (regulation); income-tax side practice (BSH) |
| `il.cafe-work` | 0% | 0 | ITA 2018 notice via Efraty fn.91 and BSH (circular) |
| `il.coworking` | 100% | 100% | s.17; ITA 2018 notice distinguishes co-working |

Evidence for foreign-guest hosting (BSH): guest name and country, days and circumstances, relationship to the business, amount. Refreshments: purchase receipts; no attendee list is required by the regulation. Open: whether input VAT on staff-kitchen coffee is allowed (sources conflict), and whether Circular 14/2000 (cited by BSH: refreshments for staff and visitors) says what it is reported to say.

## Vehicle

`il.vehicle.running`, `il.vehicle.purchase`, `il.parking-tolls`, `il.taxi-transit` (Regulations on deducting vehicle expenses 1995; Vehicle benefit regulations 1987; VAT regs. 14 and 18).

- Income tax on a private car (M1/N1 under 3,500 kg): deductible = **max(45% x costs, costs - shovi)**. Costs: licence, compulsory and comprehensive insurance, rent/lease, fuel, oil, repairs, parking away from the place of business, tolls, depreciation (15%). Shovi = months x (price x ~2.48%); price capped at ₪583,100 (2025) and ₪596,860 (2026). Efraty's "563,790 for 2025" is the 2024 figure.
- Special classes: motorcycle 25% floor, taxi/bus M1 90%, tour/desert 80%, driving instruction 77.5% (68%).
- VAT: purchase VAT is not reclaimable (reg. 14, narrow exceptions); VAT on running costs is reclaimed at 2/3 if the car is mainly for business, 1/4 if mainly private (reg. 18(ב)).
- Conditions: odometer reading of each car at 1 Jan and 31 Dec in the annual return (reg. 6). The in-car meter requirement (reg. 5) only starts on a date the Finance Minister sets; I could not verify that it did.
- Taxis, ride-hailing, trains and buses are not covered by the vehicle regulations: deductible when business trips (not the home-to-work commute, s.32(1)). VAT on public-transport fares not verified.
- Zair deemed track: all of this is moot. Ltd: the company deducts the car in full and the owner is taxed on shovi (reg. 3-4).

## Phone, internet, home

- `il.phone.mobile`: non-deductible = min(50% x cost, ₪1,380/year); VAT 2/3 default (reg. 18; for phones this is practice).
- `il.phone.landline-home`: not deductible unless the home is the main place of business; then min(80% x cost, cost - ₪2,700) up to ₪26,600 a year, above that cost - ₪5,300 (2024-2027 amounts). International calls need a per-call log.
- `il.internet`, `il.home-office`: **no regulation or ITA percentage found**. Practice: apportion by area or room share (1/4-1/3 for a dedicated room). Arnona, electricity, water, rent, building fees, and the mortgage interest (not principal) on the business share; purchase VAT on the dwelling is not reclaimable if it is also the business place (VAT reg. 15). Possible loss of the home-sale exemption for the business share (unverified).

## Business travel abroad

Regulation 2(2) (Reg. on deducting certain expenses), amounts indexed every 1 January to US CPI. 2026 values were cross-checked against the Technion HR summary of the ITA table at 1.1.2026; 2025 values rest on the Wikisource annotation.

| Item | 2025 | 2026 |
|---|---|---|
| Lodging, first 7 nights | actual up to $355 | actual up to $365 |
| Lodging, nights 8-90 | up to $156 full; above that 75%, min $156, max $266.25 | up to $160 full; above that 75%, min $160, max about $274 |
| Lodging, trip over 90 nights | $156 | $160 |
| Other expenses (meals, local transport) with lodging | $100 per day | $102 per day |
| Other expenses without lodging | $167 per day | $171 per day |
| Car rental | $78 per day | $80 per day |
| Flights | economy 100%; business or first up to the business fare | same |
| Education abroad (stay over 10 months) | $890 per child per month (under 18 in the regulation; Efraty says 19) | $914 |

The caps rise by 25% in a list of countries (Australia, Austria, Italy, Iceland, Ireland, Angola, Belgium, Germany, Dubai, Denmark, Netherlands, Hong Kong, UK, Taiwan, Greece, Japan, Luxembourg, Norway, Spain, Oman, Finland, France, Qatar, Korea, Cameroon, Canada, Sweden, Switzerland). Efraty's own 2025 table ($335, $97, $162, $76) is the 2024 level and conflicts with the regulation annotations; the JSON uses the regulation.

**Business-purpose test**: reg. 2(2) opens with "the trip and the stay were necessary for producing the income", on top of s.32(2).

**Companion (`il.travel.companion`)**: the default is 0%. s.32(1) (private expenses) and s.32(2) (wholly and exclusively) exclude a partner's flight, extra room cost, meals and tours. The companion's costs are deductible only if he/she works in the business, presence was necessary and it is documented (contract, payslip, meeting minutes), and then only within the same per-night and per-day caps. A double room shared with a non-business companion is deductible only to the single-room price. If the spouse is a genuine co-owner of a joint business (s.66(ד): each spouse's personal exertion is required), the spouse's own business trip follows the normal rules. I found **no ITA circular or Israeli ruling on accompanying partners**; the above is the statute applied to the facts, not a published safe harbour.

**Mixed trips (`il.travel.mixed`)**: lodging and per-diem only for the days that were necessary for the business; vacation days are personal. Flight: practice is full deduction if business is the main purpose, apportioned by days if the trip is mainly leisure. I found no published ITA apportionment rule.

## Gifts, donations, education, clothing

- `il.gifts`: ₪240 per person per year in Israel (US$15 abroad), 100% up to the cap; record the recipient's details, place, and receipts. Companies/NPOs pay a 45%/90% advance on the non-deductible part.
- `il.donations`: credit 35% when donations exceed ₪207 (2024-2027), base capped at min(30% of taxable income, ₪10,354,816); excess carries 3 years; s.46א overall cap 50% of taxable income including R&D. Needs an s.46 receipt.
- `il.training`: s.32(15) denies degree and new-profession studies; maintaining existing skills is deductible. `il.literature`, `il.conference`: ordinary s.17; conference lodging in Israel is exempt from the 100 km and USD limits (reg. 2א(ג)).
- `il.clothing`: 80%; 100% only if the clothes cannot be used outside work. Visible business identification or legal duty to wear is required; plain smart clothes are 0%.

## Equipment and software

`il.depreciation` (Depreciation Regulations): personal computers 33%, other computers 25%, electronic and computerised equipment 15%, general furniture 6%, private car 15%. VAT on equipment reclaimed in full (not cars). Not available on the zair track. `il.software`: 100%; Israeli supplier invoice gives VAT; foreign SaaS carries no Israeli VAT, reverse-charge position for patur/murshe not verified.

## Fees, insurance, pension

- `il.bank-fees`, `il.professional-fees`, `il.insurance.business`: 100%, s.17; practice. Bank fees and insurance carry no VAT (assumed, not verified in a primary text).
- `il.insurance.life-credit`: s.45א 25% credit within a 5% ceiling shared with the pension credit. `il.insurance.disability`: deduction up to 3.5% of business income (s.32(14)(ב)); the income ceiling formula could not be reproduced (playbook says ₪356,100 / ₪12,463).
- `il.pension`: ss.47 and 45א. Deduction of about 11% of income up to ₪232,800 (max ₪25,608), credit 35% on up to 5% of income up to ₪232,800 (max ₪4,074), for a "beneficiary member" depositing at least 16% of the average wage (₪24,069 in 2025; ₪26,436 in 2026). Statutory amounts (₪116,400 and ₪164,400) are fixed for 2024-2027, so 2025 and 2026 are the same.
- `il.keren-hishtalmut`: deduction up to 4.5% of income capped at ₪293,397 (₪13,202), fixed 2024-2027, and kept even on the zair track.
- `il.bl-deduction`: 52% of BL paid (s.47א), unavailable on the zair track.

## Osek zair and osek patur (`il.zair-deemed`, `il.patur-vat`)

- Basis: Ordinance ss.87ב-87ד; ITA notice 2025-000092 of 4 Dec 2025; kolzchut.
- Eligibility: individual resident with turnover up to the VAT-exempt ceiling (₪120,000 in 2024-2025, ₪122,833 in 2026). Exclusions: employees, no accepted books, non-personal-exertion income, income from your own employer, transparent-entity attribution, over 25% of income from relatives or ex-employers (3 years), controlling shareholder in a closely held company, partner in a partnership, kibbutz member.
- Effect: deduct 30% of turnover with no receipts; ss.17-27 do not apply except 17(5א); s.47א BL deduction does not apply; no loss carry-forward; pension s.47 and credits remain. Normally no annual return and no advances. Tax coordination during the year by 25 December; short report after year-end.
- When actual receipts are irrelevant: whenever you are on the track. When switching is better: actual deductible expenses (after the haircuts) above roughly 30% of turnover minus the value of the lost 52% BL deduction, or you expect losses, or you need depreciation. Zair is not patur: a murshe can be zair and still reclaims input VAT.
- Patur: no input VAT (VAT Law s.41); VAT rate 18%.

## Evidence (`il.recordkeeping`)

Tax invoice in the business's name; input VAT must be claimed within 6 months (VAT Law s.38(א)). Allocation number needed above ₪20,000 (2025), ₪10,000 (Jan-May 2026), ₪5,000 (from 1 Jun 2026) per invoice before VAT (s.38(א1)); Efraty adds that the expense itself is then disallowed (not found in the Ordinance text). Payments that break the cash-use law lose the deduction (s.32(16א)) and the VAT (s.38(א2)).

## What changed 2025 to 2026

- VAT patur / zair ceiling: ₪120,000 to ₪122,833.
- Allocation number threshold: ₪20,000 (2025) to ₪10,000 (Jan-May 2026) to ₪5,000 (from 1 Jun 2026).
- Travel abroad caps: lodging $355 to $365; other $100 to $102 (with lodging); $167 to $171 (without); car rental $78 to $80.
- Vehicle benefit price ceiling: ₪583,100 to ₪596,860.
- Average wage: ₪12,536 to ₪13,769, so the 16% pension "beneficiary member" threshold goes from ₪24,069 to ₪26,436.
- Unchanged for 2024-2027: gifts ₪240, mobile ₪1,380, home phone thresholds, donation ₪207 and ceiling, s.47 and 17(5א) ceilings.

## Open questions and things I could not verify

1. VAT on light refreshments at the office (null in JSON). Primary text needed.
2. Gifts: ₪240 (annotated regulation) against ₪230 (Efraty 2025). Using ₪240.
3. 2025 short-report deadline for zair: 31.08.2026 (kolzchut) against a snippet saying 31.05.2026.
4. Home office and internet: no ITA percentage found; also the mortgage-interest claim and sale-exemption interaction.
5. Companion and mixed-trip flights: no published ITA position or case law found.
6. Disability insurance ceiling formula and its availability on the zair track.
7. Exact stacking of the 11%/7%/4% pension bands and the 5% credit base.
8. Missing allocation number: does it also disallow the expense? Only Efraty says so.
9. VAT on public transport, bank fees, imported services, clothing at 80%, and gifts.
10. Vehicle: depreciation ceiling for expensive cars (if any), shovi rate for 2026, whether reg. 5 (meter) is in force.
11. "Circular 78/2024" appears on britcpa; not checked at the ITA. The gov.il service page returned 403 to my fetch.
12. 7-year retention and the 2026 business cash cap (₪6,000 shown in the Schedule text) not verified.
13. Any 2026 amendment to s.32 (the consolidated text shows the latest amendments תשפ"ו-2, including the minimum-tax carve-out); I found nothing that changes expense rules but did not read every amendment.

## Sources

- Income Tax Ordinance (consolidated, Wikisource): https://he.wikisource.org/wiki/פקודת_מס_הכנסה (ss.17(5א), 21, 32, 45א, 46, 47, 47א, 87ב-87ד)
- Reg. on deducting certain expenses: https://he.wikisource.org/wiki/תקנות_מס_הכנסה_(ניכוי_הוצאות_מסויימות)
- Reg. on vehicle expenses: https://he.wikisource.org/wiki/תקנות_מס_הכנסה_(ניכוי_הוצאות_רכב)
- Vehicle benefit regulations: https://he.wikisource.org/wiki/תקנות_מס_הכנסה_(שווי_השימוש_ברכב)
- Depreciation regulations: https://he.wikisource.org/wiki/תקנות_מס_הכנסה_(פחת)
- VAT Law: https://he.wikisource.org/wiki/חוק_מס_ערך_מוסף (ss.1, 38, 41); VAT regulations: https://he.wikisource.org/wiki/תקנות_מס_ערך_מוסף (regs. 14, 15, 16, 18)
- Cash-use law: https://he.wikisource.org/wiki/חוק_לצמצום_השימוש_במזומן
- ITA notice 2025-000092 (4 Dec 2025), small business reform: https://www.gov.il/BlobFolder/policy/represent-info-07122025-1/he/IncomeTax_represent-info-071225-1.pdf
- Kolzchut, small business: https://www.kolzchut.org.il/he/עסק_זעיר
- Technion summary of the ITA travel table at 1.1.2026: https://hr.technion.ac.il/wp-content/uploads/2026/02/הוצאות-מוכרות-בנסיעה-לחול-2026.pdf
- Efraty & Co guide (secondary): https://www.efraty.com/?p=5221
- BSH CPA on refreshments and hosting (secondary): https://www.bshcpa.co.il/כיבודים-ואירוח/
- BRIT CPA on the small-business reform (secondary): https://britcpa.co.il/hozrim/רפורמת-בעל-עסק-זעיר/

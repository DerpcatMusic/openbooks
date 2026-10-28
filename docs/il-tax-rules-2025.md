# Israeli income tax: discharged-soldier credit and refund interest (tax year 2025)

Research note for OpenBooks. The statutory text below was checked against the
Income Tax Ordinance as consolidated on Nevo
(https://www.nevo.co.il/law_html/law00/84255.htm, fetched 2026-10-12).

## 1. Credit points for a discharged soldier (section 39א, not 39ב)

Section **39א** covers the discharged soldier (זיכוי לחייל משוחרר). Section
**39ב** covers combat reservists (זיכוי בעד שירות מילואים כלוחם). Under 39ב
you get ½ to 4 points in a tax year for 30 or more combat-reserve days in the
previous year. It does not apply to this case.

### Statutory rule (Ordinance s.39א, current text)

> בחישוב המס על הכנסתו **מיגיעה אישית** של חייל משוחרר תובא בחשבון חלק מנקודת זיכוי לכל חודש
> משלושים ושישה החודשים הראשונים שלאחר החודש שבו סיים את שירותו הסדיר:
> (1) 1/6 נקודת זיכוי – גבר ≥ 23 חודשים מלאים / אישה ≥ 22;
> (2) 1/12 נקודת זיכוי – פחות מכך.
> "חייל משוחרר" / "שירות סדיר" – per חוק קליטת חיילים משוחררים, התשנ"ד-1994 (min. 12 months of service, or earlier release for health or disability reasons).

- **Points:** 1/6 point per month (2 points a year) for full service. Partial service earns 1/12 per month (1 point a year).
- **Period:** 36 months, starting in the **month after the month of discharge**. Amendment 155 (2007) extended the period from 24 to 36 months. Amendment 157 (2007) added the 1/6 tier for long service.
- **Limit:** the credit applies only against tax on **income from personal exertion** (יגיעה אישית: salary or business). It does not apply against passive income such as rent, interest or provident or capital gains. It is non-refundable.
- **Amendments 2023–2026:** the current consolidated text does not change 39א. No 2024+ "long service" amendment appears in it. The wartime change was the new **39ב** for reservists, effective from tax year 2026 for service in 2025. Confidence: high for the text. Medium on whether a pending bill exists that has not yet been consolidated.
- Sources:
  - Ordinance text (Nevo): https://www.nevo.co.il/law_html/law00/84255.htm
  - Kol Zchut: https://www.kolzchut.org.il/he/נקודות_זיכוי_ממס_הכנסה_לחיילים_משוחררים_ומסיימי_שירות_לאומי-אזרחי
  - CPA summary (BSH): https://www.bshcpa.co.il/נקודת-זיכוי-לחייל-משוחרר/

### Defaults for this case

| Item                       | Points 2025           | Notes                                                                                   |
| -------------------------- | --------------------- | --------------------------------------------------------------------------------------- |
| Resident (s.34 + s.36)     | 2.25                  | 2 + ¼. Offsets all tax, including the 25% special-rate tax                              |
| Single man                 | 0                     | Only women get +0.5 (s.36(א)(2)). No points for a single man by default                 |
| Age 18 / youth             | 0                     | No age-based point for an adult man (the old 16–18 youth ½ point is not relevant)       |
| Academic degree (s.40ג)    | 0 by default          | Only on request, starting the year after the degree is completed                        |
| Discharged soldier (s.39א) | 10 × 1/6 = **1.6667** | Discharged 17/02/2025, so eligible Mar 2025–Feb 2028. 32 months ≥ 23 gives the 1/6 tier |

Credit-point value for 2025: **2,904 ₪/yr (242 ₪/mo)**. The value is frozen
for 2025–2027. 2025 tax brackets: 10% up to 84,120 ₪.

### Worked example and reconciliation of the 8,375 ₪ shown on the site

```
tax on personal exertion (business 18,413 @ 10%)     = 1,841.30
tax on provident gain (3,015 @ 25%)                  =   753.75 (≈ 754 withheld)
gross tax                                            = 2,595   ✓ (matches site)

resident credit      2.25    × 2,904 = 6,534.00
soldier credit       1.6667  × 2,904 = 4,840.00  -> capped at tax on yegia ishit = 1,841.30
credits shown        6,534 + 1,841.30 = 8,375.30 ≈ 8,375  ✓ (8,375/2,904 = 2.884 "points")
tax due              max(0, 1,841 − credits) + 754 = 754
balance              754 due − 754 withheld = 0   (assessment 08.10.2026: "יתרה אפס")
```

**Correction (28.10.2026).** The online calculator offsets the credits against
the whole gross tax and shows a 794 refund, but that refund never comes. The
assessment credited nothing back, and Altshuler confirmed (14.10.2026) that a
lump-sum חיסכון לכל ילד withdrawal is taxed 25% on the real gain as a final
tax, with no withholding certificate and no refund. OpenBooks now offsets
credit points against the bracket tax only and keeps special-rate fund tax as
due, so the withholding in 040 pays it and the balance is 0.

So 2.884 is not a points count. The site shows the resident credit in full
plus the 39א credit **capped at the tax on personal-exertion income**. That cap
is 1,841.30, which is below the uncapped 4,840. The figure matches to the
shekel. Confidence: high. The total and the gross tax both reproduce exactly.

Implementation rule:
`credits_display = resident_pts*CPV + min(soldier_pts*CPV, tax_on_personal_exertion)`
Then `tax_due = max(0, bracket_tax − credits) + special_rate_tax` (see the correction above). Allocation detail: the soldier
credit should only reduce tax on personal-exertion income, and the resident
credit can absorb the 25% tax. The site's figure is consistent with that order.
Other ordering choices give the same tax due here.

Alternative explanations I considered and rejected: 1/12 tier (10 × 1/12 × 2,904
gives 8,954 total, no match), prorating by days from 17/02 (no match), and an
unknown extra point (no match).

## 2. Interest and linkage on an over-withholding refund (s.159א)

### Statutory rule

Ordinance **s.159א(א)** defines הפרשי הצמדה וריבית as the amount × the CPI
rise over the period, **plus 4% per year interest on the linked amount**. The
Minister of Finance may set a different rate with Knesset Finance Committee
approval. I found no regulation that sets a different rate.

**s.159א(ב):** when the tax paid (by withholding or otherwise) exceeds the tax
on the s.131 return, the balance is refunded within 90 days of filing, or by
31 July of the following year, whichever is later.

**s.159א(ג):** the refund carries הפרשי הצמדה וריבית
**"בתקופה שמתום שנת המס או מיום התשלום, לפי המאוחר, ועד ליום ההחזר"**.
That means from the later of (end of tax year, payment date) to the refund
date. Tax withheld during 2025 therefore starts accruing on **31/12/2025**,
not on the withholding date and not on 1 July. s.160 (a refund after an
assessment) uses the same start rule.

Sources:

- Ordinance s.159א, s.160 (Nevo): https://www.nevo.co.il/law_html/law00/84255.htm
- Kol Zchut, refund page (mentions linkage + 4%): https://www.kolzchut.org.il/he/החזר_מס_הכנסה

### CPI data used

- Dec 2025 CPI = **103.6** (base: average 2024 = 100). Flat versus Nov 2025, so the result is the same whether the start index is Nov or Dec. Sources: Calcalist https://www.calcalist.co.il/local_news/article/b1cxhd8rwx and klikatnadlan https://klikatnadlan.co.il/consumerpriceindex/
- Aug 2026 CPI = **105.8**, published 15/09/2026. Rise since the start of the year ≈ 2.1%. Sep 2026 is published on 15/10, so on 12/10/2026 the latest known index is Aug. Source: Funder https://www.funder.co.il/article/209975
- Ratio 105.8 / 103.6 = 1.02124

### Worked example (754 ₪ withheld 13/05/2025, computed 12/10/2026)

This only applies when there is a real refund; the 754 on the חיסכון לכל ילד withdrawal is not one (see the correction above).

```
start = max(31/12/2025, 13/05/2025) = 31/12/2025
days  = 285 (to 12/10/2026)
linkage  = 754 × (105.8/103.6 − 1)          = 16.01
linked   = 770.01
interest = 770.01 × 4% × 285/365             = 24.05   (compound (1.04)^(285/365): 23.95)
total add-on                                 ≈ 40.0  -> refund 754 + 40 = 794 ✓
```

If the start were the withholding date (13/05/2025), the result would be
about 65 ₪. That does not match the site, which confirms the "later of" rule.
I could not determine whether the Tax Authority compounds daily or uses simple
interest. Both give 40 ₪ here.

### Formula for OpenBooks

```
inputs: amount, paid_date, tax_year, calc_date, cpi(month) -> index
start      = max(date(tax_year, 12, 31), paid_date)
idx_start  = latest CPI published on or before start   (Nov or Dec of tax_year; Dec CPI is published ~15 Jan)
idx_end    = latest CPI published on or before calc_date (index for month M is published on the 15th of M+1)
linked     = amount * max(idx_end / idx_start, 1)      # assumption: no negative linkage
interest   = linked * 0.04 * days(start, calc_date) / 365
refund_add = round(linked - amount + interest)
```

If there is no CPI series, approximate the CPI with ~2.5%/yr (the Bank of
Israel target midpoint). Treat the result as an estimate. Refund date ≥
max(filing + 90 days, 31 July of tax_year + 1).

Open points:

- I assumed the "known index" (מדד ידוע) convention for idx_start and idx_end.
  The statute says only "the CPI rise over the period". The convention cannot
  be confirmed from this case because Dec 2025 equals Nov 2025.
- Negative linkage floor: assumed, not verified.
- Whether a refund of 25% withholding on child-savings gains is processed
  under 159א or under a separate regulation. This case's numbers fit 159א.

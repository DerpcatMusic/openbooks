// The Israeli filing calendar for a tax year: what is due, when, and where the date comes from. Pure.
// Dates follow calendar.ts (rest-day rule of VAT Law s.67(b1) / Ordinance s.175(f)). Rows the law text does not settle carry `unverified`.
import type { FilingDeadline } from "@openbooks/core";
import { dueDate, nextWorkday, reportDue, vatPeriods, type VatFrequency } from "./calendar.ts";

const LAW = (law: string, s: string) => `https://he.wikisource.org/wiki/${law}#${s}`;
const VATLAW = (s: number) => LAW("חוק_מס_ערך_מוסף", `סעיף_${s}`);
const ORD = (s: number | string) => LAW("פקודת_מס_הכנסה", `סעיף_${s}`);
const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

export interface IlFacts {
  businessType: string;
  vatFrequency?: VatFrequency;
  /** Income-tax advance schedule from the Assessing Officer's notice; "none" = no advances. Default monthly. */
  taxAdvances?: "monthly" | "bimonthly" | "none";
  /** Pay Bituach Leumi advances (sole proprietors). Default yes. */
  blAdvances?: boolean;
  /** VAT status of an osek zair (an income-tax track only: it can be osek patur or osek murshe for VAT). Default patur. */
  vatStatus?: "patur" | "murshe";
  /** Holdings in foreign entities (Form 150 each year, Circular 7/2025 §3.11). */
  foreignHoldings?: number;
  /** Osek zair is closed to the person (crossborder.ts zairExclusion): the full 1301 instead of the short report. */
  zairExcluded?: boolean;
}

const isVat = (t: string, f: IlFacts) => t === "osek-murshe" || t === "ltd" || (t === "osek-zair" && f.vatStatus === "murshe");
const sole = (t: string) => t.startsWith("osek-");

export function ilDeadlines(year: number, facts: IlFacts): FilingDeadline[] {
  const t = facts.businessType,
    out: FilingDeadline[] = [],
    mm = (m: number) => ({ en: MONTHS_EN[m - 1]!, he: MONTHS_HE[m - 1]! });

  if (isVat(t, facts)) {
    for (const p of vatPeriods(year, facts.vatFrequency ?? "monthly")) {
      const m0 = +p.from.slice(5, 7),
        m1 = +p.to.slice(5, 7),
        span = (l: "en" | "he") => (m0 === m1 ? `${mm(m0)[l]} ${year}` : `${mm(m0)[l]}-${mm(m1)[l]} ${year}`);
      out.push({
        id: `il.vat.${p.key}`,
        date: reportDue(p, 15),
        title: { en: `VAT report and payment, ${span("en")}`, he: `דוח מע"מ ותשלום, ${span("he")}` },
        form: "PCN874",
        url: VATLAW(67),
        source:
          "VAT Law s.67(b): within 15 days after the period. Online filers get until the 19th in Tax Authority practice (not confirmed from a primary source); detailed-reporting filers until the 23rd (s.67א).",
      });
    }
  }

  const adv = facts.taxAdvances ?? "monthly";
  if (adv !== "none" && t !== "ltd") {
    const step = adv === "monthly" ? 1 : 2;
    for (let m = step; m <= 12; m += step) {
      const dueM = m + 1,
        dy = year + (dueM > 12 ? 1 : 0),
        dm = dueM > 12 ? 1 : dueM,
        from = m - step + 1;
      out.push({
        id: `il.adv.tax.${dy}-${pad(dm)}`,
        date: dueDate(`${dy}-${pad(dm)}-15`),
        title: {
          en: `Income-tax advance for ${from === m ? mm(m).en : `${mm(from).en}-${mm(m).en}`} ${year}`,
          he: `מקדמת מס הכנסה עבור ${from === m ? mm(m).he : `${mm(from).he}-${mm(m).he}`} ${year}`,
        },
        url: "https://he.wikisource.org/wiki/תקנות_מס_הכנסה_(קביעת_מקדמות_על_פי_מחזור)",
        source:
          "Income Tax (Determination of Advances by Turnover) Regulations 1982, reg.2: the 15th, rate from the Assessing Officer's notice times the turnover of the preceding month(s).",
      });
    }
  }
  if (sole(t) && facts.blAdvances !== false) {
    for (let m = 1; m <= 12; m++) {
      const dy = year + (m === 12 ? 1 : 0),
        dm = m === 12 ? 1 : m + 1;
      out.push({
        id: `il.adv.bl.${year}-${pad(m)}`,
        date: `${dy}-${pad(dm)}-15`,
        title: { en: `Bituach Leumi advance, ${mm(m).en} ${year}`, he: `מקדמת ביטוח לאומי, ${mm(m).he} ${year}` },
        source: "Bituach Leumi self-employed monthly advance, 15th of the following month (btl.gov.il); rest-day shifts not applied.",
        unverified: true,
      });
    }
  }

  // annual returns for tax year `year`, filed the next year (Ordinance s.132: 30 April; 31 May for double-entry books or an online self-employed report)
  if (t === "ltd") {
    out.push({
      id: `il.1214.${year}`,
      date: nextWorkday(`${year + 1}-05-31`),
      title: { en: `Company tax return ${year}`, he: `דוח שנתי לחברה ${year}` },
      form: "1214",
      url: ORD(132),
      source: "Ordinance s.132(b)(1): 31 May for double-entry books. The Tax Authority often extends: check its notices.",
    });
  } else if (t === "osek-zair" && !facts.zairExcluded) {
    // Ordinary statutory deadline for the osek-zair short report is March 31 of the following year (gov.il/he/service/report-and-payment-for-micro-business-owner).
    // Documented ITA extensions: 2024 → 2025-12-31 (notice 2025-000092), 2025 → 2026-06-30.
    const shortDue = year === 2024 ? "2025-12-31" : year === 2025 ? "2026-06-30" : nextWorkday(`${year + 1}-03-31`);
    out.push({
      id: `il.short.${year}`,
      date: shortDue,
      title: { en: `Short year-end report ${year} (small business, exempt from the annual return)`, he: `דיווח מקוצר ${year} (בעל עסק זעיר, פטור מדוח שנתי)` },
      url: "https://www.gov.il/he/service/report-and-payment-for-micro-business-owner",
      source:
        year === 2024
          ? "Tax Authority notice 2025-000092: extended to 31.12.2025 for tax year 2024."
          : year === 2025
            ? "Tax Authority extension for tax year 2025: 30.06.2026 (ordinary deadline is 31 March)."
            : "ITA micro-business guidance: ordinary deadline is 31 March of the following year (shifted to next workday if on a rest day).",
    });
    out.push({
      id: `il.zair-coordination.${year}`,
      date: `${year}-12-25`,
      title: { en: `Tax coordination to stay in the small-business model for ${year}`, he: `תיאום מס להישארות במודל בעל עסק זעיר ${year}` },
      source: "Tax Authority notice 2025-000092: coordination by 25.12.2025 for tax year 2025, no extension. Date assumed for other years.",
      unverified: true,
    });
  } else if (sole(t)) {
    out.push({
      id: `il.1301.${year}`,
      date: nextWorkday(`${year + 1}-04-30`),
      title: { en: `Annual return 1301 for ${year}`, he: `דוח שנתי 1301 לשנת ${year}` },
      form: "1301",
      url: ORD(132),
      source:
        "Ordinance s.132(a): 30 April; s.132(b)(1),(1א): 31 May for double-entry books or an online self-employed report. The Tax Authority often extends.",
    });
  }
  if (facts.foreignHoldings) {
    out.push({
      id: `il.150.${year}`,
      date: t === "ltd" ? nextWorkday(`${year + 1}-05-31`) : nextWorkday(`${year + 1}-04-30`),
      title: {
        en: `Form 150: holdings in foreign entities, ${year} (attached to the annual return)`,
        he: `טופס 150: החזקה בחבר בני אדם תושב חוץ, ${year} (נספח לדוח השנתי)`,
      },
      form: "150",
      url: "https://www.gov.il/he/service/itc-150",
      source: "Income Tax Circular 7/2025 §3.11: Form 150 is an appendix to the annual return, filed with it every year a foreign entity is held.",
    });
  }
  if (t === "osek-patur") {
    out.push({
      id: `il.patur-declaration.${year}`,
      date: `${year + 1}-01-31`,
      title: { en: `Exempt dealer: annual turnover declaration ${year}`, he: `עוסק פטור: הצהרת מחזור שנתית ${year}` },
      source: "Not confirmed from a primary source: check the date at the Tax Authority.",
      unverified: true,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

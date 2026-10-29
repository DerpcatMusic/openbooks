// US federal (and the state fees the books know) deadlines that FALL IN calendar year `year`, so a calendar or hub page can list a year at a
// time: the previous year's returns, this year's estimated tax, information returns. Every date is moved to the next business day when it
// lands on a weekend or legal holiday (dates.ts). Sources are in `source`; the 6-month extension to file (Form 4868 / 7004) never extends
// the time to pay, and extended dates are listed as their own deadline.
import type { CountryPack } from "@openbooks/core";
import { dueOn, iso } from "./dates.ts";
import { usTrack } from "./entity.ts";

type Deadlines = NonNullable<CountryPack["deadlines"]>;
export type Deadline = ReturnType<Deadlines>[number];
/** What the pack can use beyond the shared `businessType`: pass what the entity's profile knows. */
export interface UsDeadlineFacts {
  businessType: string;
  vatFrequency?: "monthly" | "bimonthly";
  /** State of formation (two letters or name): Delaware and Wyoming deadlines. */
  state?: string;
  /** Formation date YYYY-MM-DD: Wyoming's annual report is due the first day of the anniversary month. */
  formed?: string;
  /** The owner is a US person with foreign financial accounts over $10,000 combined at any time in the year before: FBAR. */
  foreignAccountsOver10k?: boolean;
  /** llc-ccorp / s-corp: the legal form decides which Delaware fee applies (LLC annual tax June 1; corporation franchise tax March 1). */
  entityForm?: "llc" | "corporation";
  /** The company's owner is foreign (a C-corp then attaches Form 5472). */
  foreignOwned?: boolean;
}

const IRS = "https://www.irs.gov";
const SRC = {
  es: "https://www.irs.gov/pub/irs-pdf/f1040es.pdf",
  nec: "https://www.irs.gov/instructions/i1099mec",
  i1040: "https://www.irs.gov/instructions/i1040gi",
  i1120: "https://www.irs.gov/instructions/i1120",
  i1065: "https://www.irs.gov/instructions/i1065",
  i1120s: "https://www.irs.gov/instructions/i1120s",
  i5472: "https://www.irs.gov/instructions/i5472",
  w: "https://www.irs.gov/instructions/i1120w",
  fbar: "https://www.irs.gov/businesses/small-businesses-self-employed/report-of-foreign-bank-and-financial-accounts-fbar",
  de: "https://corp.delaware.gov/alt-entitytaxinstructions/",
  deCorp: "https://corp.delaware.gov/paytaxes/",
  wy: "https://sos.wyo.gov/faqs.aspx?root=BUS",
};

export const usDeadlines = (y: number, f: UsDeadlineFacts): Deadline[] => {
  const track = usTrack(f.businessType),
    p = y - 1,
    out: Deadline[] = [];
  const add = (d: string, id: string, en: string, he: string, form?: string, url?: string, source?: string) =>
    out.push({ date: d, id: `us.${id}`, title: { en, he }, ...(form ? { form } : {}), ...(url ? { url } : {}), ...(source ? { source } : {}) });
  const st = (f.state ?? "").trim().toUpperCase();
  const de = st === "DE" || st === "DELAWARE",
    wy = st === "WY" || st === "WYOMING";

  // information returns every business with contractors files
  if (track !== "foreign-owned")
    add(
      dueOn(y, 1, 31),
      `1099nec.${p}`,
      `Form 1099-NEC for ${p}: file with the IRS and send recipients their copy`,
      `טופס 1099-NEC לשנת ${p}: הגשה ל-IRS ושליחת עותק לנמען`,
      "1099-NEC",
      IRS + "/iris",
      SRC.nec,
    );

  if (track === "individual") {
    add(
      dueOn(y, 1, 15),
      `es.${p}.q4`,
      `Estimated tax payment 4 for ${p} (Form 1040-ES; skip it by filing by Feb 1 and paying the balance)`,
      `תשלום מקדמה 4 לשנת ${p} (1040-ES; אפשר לדלג אם מגישים עד 1 בפברואר ומשלמים את היתרה)`,
      "1040-ES",
      IRS + "/payments",
      SRC.es,
    );
    add(
      dueOn(y, 4, 15),
      `1040.${p}`,
      `Form 1040 with Schedule C and SE for ${p}, and any tax due (an extension to file does not extend the time to pay)`,
      `טופס 1040 עם Schedule C ו-SE לשנת ${p}, ותשלום המס (הארכה להגשה אינה מאריכה את מועד התשלום)`,
      "1040",
      IRS + "/filing",
      SRC.i1040,
    );
    add(
      dueOn(y, 4, 15),
      `es.${y}.q1`,
      `Estimated tax payment 1 for ${y} (Form 1040-ES)`,
      `תשלום מקדמה 1 לשנת ${y} (1040-ES)`,
      "1040-ES",
      IRS + "/payments",
      SRC.es,
    );
    add(
      dueOn(y, 6, 15),
      `es.${y}.q2`,
      `Estimated tax payment 2 for ${y} (Form 1040-ES)`,
      `תשלום מקדמה 2 לשנת ${y} (1040-ES)`,
      "1040-ES",
      IRS + "/payments",
      SRC.es,
    );
    add(
      dueOn(y, 9, 15),
      `es.${y}.q3`,
      `Estimated tax payment 3 for ${y} (Form 1040-ES)`,
      `תשלום מקדמה 3 לשנת ${y} (1040-ES)`,
      "1040-ES",
      IRS + "/payments",
      SRC.es,
    );
    add(
      dueOn(y, 10, 15),
      `1040.${p}.ext`,
      `Form 1040 for ${p} if you filed Form 4868 (extended due date)`,
      `טופס 1040 לשנת ${p} אם הוגשה בקשת הארכה 4868 (מועד מוארך)`,
      "1040",
      IRS + "/filing",
      SRC.i1040,
    );
  } else if (track === "foreign-owned") {
    add(
      dueOn(y, 4, 15),
      `5472.${p}`,
      `Form 5472 with the pro forma Form 1120 for ${p} (fax or mail; penalty $25,000 for late or missing)`,
      `טופס 5472 עם 1120 פרופורמה לשנת ${p} (פקס או דואר; קנס 25,000 דולר על איחור או חוסר)`,
      "5472",
      IRS + "/instructions/i5472",
      SRC.i5472,
    );
    add(
      dueOn(y, 10, 15),
      `5472.${p}.ext`,
      `Form 5472 / pro forma 1120 for ${p} if you filed Form 7004 (extended due date)`,
      `טופס 5472 / 1120 פרופורמה לשנת ${p} אם הוגשה בקשת הארכה 7004 (מועד מוארך)`,
      "5472",
      undefined,
      SRC.i5472,
    );
  } else if (track === "c-corp") {
    add(
      dueOn(y, 4, 15),
      `1120.${p}`,
      `Form 1120 for ${p} (15th day of the 4th month), and any tax due${f.foreignOwned === false ? "" : "; attach Form 5472 for a foreign owner"}`,
      `טופס 1120 לשנת ${p} (היום ה-15 בחודש הרביעי) ותשלום המס${f.foreignOwned === false ? "" : "; לצרף טופס 5472 כשהבעלים זר"}`,
      "1120",
      IRS + "/forms-pubs/about-form-1120",
      SRC.i1120,
    );
    add(
      dueOn(y, 10, 15),
      `1120.${p}.ext`,
      `Form 1120 for ${p} if you filed Form 7004 (extended due date)`,
      `טופס 1120 לשנת ${p} אם הוגשה בקשת הארכה 7004 (מועד מוארך)`,
      "1120",
      undefined,
      SRC.i1120,
    );
    for (const [n, m] of [
      [1, 4],
      [2, 6],
      [3, 9],
      [4, 12],
    ] as const)
      add(
        dueOn(y, m, 15),
        `1120w.${y}.q${n}`,
        `Corporate estimated tax installment ${n} for ${y} (Form 1120-W; deposit through EFTPS)`,
        `מקדמת מס חברות ${n} לשנת ${y} (טופס 1120-W; הפקדה דרך EFTPS)`,
        "1120-W",
        IRS + "/payments/eftps-the-electronic-federal-tax-payment-system",
        SRC.w,
      );
  } else if (track === "partnership") {
    add(
      dueOn(y, 3, 15),
      `1065.${p}`,
      `Form 1065 and Schedules K-1 for ${p} (give each partner their K-1)`,
      `טופס 1065 ו-K-1 לשנת ${p} (מסירת K-1 לכל שותף)`,
      "1065",
      IRS + "/forms-pubs/about-form-1065",
      SRC.i1065,
    );
    add(
      dueOn(y, 9, 15),
      `1065.${p}.ext`,
      `Form 1065 for ${p} if you filed Form 7004 (extended due date)`,
      `טופס 1065 לשנת ${p} אם הוגשה בקשת הארכה 7004 (מועד מוארך)`,
      "1065",
      undefined,
      SRC.i1065,
    );
  } else {
    add(
      dueOn(y, 3, 15),
      `1120s.${p}`,
      `Form 1120-S and Schedules K-1 for ${p} (give each shareholder their K-1)`,
      `טופס 1120-S ו-K-1 לשנת ${p} (מסירת K-1 לכל בעל מניות)`,
      "1120-S",
      IRS + "/forms-pubs/about-form-1120-s",
      SRC.i1120s,
    );
    add(
      dueOn(y, 9, 15),
      `1120s.${p}.ext`,
      `Form 1120-S for ${p} if you filed Form 7004 (extended due date)`,
      `טופס 1120-S לשנת ${p} אם הוגשה בקשת הארכה 7004 (מועד מוארך)`,
      "1120-S",
      undefined,
      SRC.i1120s,
    );
  }

  // states the books know: an LLC pays Delaware's annual tax whatever its federal classification; a corporation pays franchise tax on March 1
  const llc =
    track === "individual"
      ? f.businessType === "llc-us-owner"
      : track === "foreign-owned" || track === "partnership" || (f.entityForm ?? (track === "c-corp" ? "llc" : "corporation")) === "llc";
  if (de && llc)
    add(
      iso(y, 6, 1),
      "de.llc",
      "Delaware LLC annual tax ($300), due June 1",
      "מס שנתי ל-LLC בדלאוור (300 דולר), עד 1 ביוני",
      undefined,
      "https://corp.delaware.gov/paytaxes/",
      SRC.de,
    );
  else if (de && track !== "individual")
    add(
      iso(y, 3, 1),
      "de.corp",
      "Delaware corporation annual report and franchise tax, due March 1",
      "דוח שנתי ומס זיכיון לתאגיד בדלאוור, עד 1 במרץ",
      undefined,
      "https://corp.delaware.gov/paytaxes/",
      SRC.deCorp,
    );
  if (wy && track !== "individual") {
    const m = f.formed && /^\d{4}-(\d{2})-/.test(f.formed) ? f.formed.slice(5, 7) : null;
    if (m)
      add(
        `${y}-${m}-01`,
        "wy.annual",
        "Wyoming annual report and license tax (minimum $60), due the first day of the month the company was formed",
        "דוח שנתי ואגרת רישיון בוויומינג (מינימום 60 דולר), בראשון לחודש שבו נוסדה החברה",
        undefined,
        "https://wyobiz.wyo.gov",
        SRC.wy,
      );
  }

  if (f.foreignAccountsOver10k)
    add(
      dueOn(y, 4, 15),
      `fbar.${p}`,
      `FBAR (FinCEN 114) for ${p}: foreign accounts over $10,000 combined at any time; automatic extension to October 15, e-file only`,
      `FBAR (FinCEN 114) לשנת ${p}: חשבונות בחו"ל מעל 10,000 דולר במצטבר בכל זמן בשנה; הארכה אוטומטית עד 15 באוקטובר, הגשה אלקטרונית בלבד`,
      "FBAR",
      "https://bsaefiling.fincen.treas.gov",
      SRC.fbar,
    );

  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
};

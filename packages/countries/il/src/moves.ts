// Moves: "if you do X, you keep Y". These are the legal plays wealthy people use (borrow instead of selling, wrappers, entities, a
// nonprofit, timing, routing royalties under the treaty), turned into small calculators. Every tax figure re-runs ilPlan with and
// without the move, so brackets, credit points, BL and caps are counted, not guessed. Figures that are fixed amounts (2026) cite their
// source in `src`. Each move only says what it is worth and how to do it; the advisor's playbook covers whether it applies to you.
// ponytail: the year's table T is reused for "next year" in the timing move; pass next year's table when it exists.
import { ilPlan, type PlanInput } from "./calc.ts";
import type { IlRates } from "./schema.ts";

type L = { en: string; he: string };
export type MoveInputKind = "ils" | "usd" | "pct" | "n";
export interface MoveInput {
  key: string;
  kind: MoveInputKind;
  def: number;
  label: L;
}
export interface MoveCtx {
  /** The year's plan as it stands (books or what-if numbers). */
  base: PlanInput;
  T: IlRates;
  /** ILS per USD; null = the dollar moves are not computed. */
  fx: number | null;
}
/** now: tax kept this year (₪). later: what it grows to or avoids in the future (₪). deferred: the saving is a deferral, not for good. */
export interface MoveResult {
  now: number;
  later?: number;
  deferred?: boolean;
}
export interface Move {
  id: string;
  cat: "trip" | "wrapper" | "borrow" | "entity" | "charity" | "family" | "timing" | "cross-border" | "deduction" | "investment";
  title: L;
  how: L;
  risk: L;
  confidence: "high" | "medium" | "low";
  src: string[];
  inputs: MoveInput[];
  calc: (v: Record<string, number>, c: MoveCtx) => MoveResult | null;
}

const total = (c: MoveCtx, p: Partial<PlanInput> = {}) => ilPlan({ ...c.base, ...p }, c.T).total;
/** Tax saved by adding a deductible expense (0 on the zair track, where the flat 30% replaces expenses). */
const expenseSaving = (c: MoveCtx, amount: number) => (c.base.zair ? 0 : total(c) - total(c, { expenses: c.base.expenses + amount }));
const grow = (amount: number, r: number, y: number) => amount * ((1 + r) ** y - 1);
const r0 = (n: number) => Math.max(0, Math.round(n));
const i = (key: string, kind: MoveInputKind, def: number, en: string, he: string): MoveInput => ({ key, kind, def, label: { en, he } });

// US estate tax on a non-resident's US-situs assets (IRC 2001(c) table; unified credit $13,000 = the $60,000 exemption)
const ESTATE = [
  [0, 0.18],
  [10_000, 0.2],
  [20_000, 0.22],
  [40_000, 0.24],
  [60_000, 0.26],
  [80_000, 0.28],
  [100_000, 0.3],
  [150_000, 0.32],
  [250_000, 0.34],
  [500_000, 0.37],
  [750_000, 0.39],
  [1_000_000, 0.4],
] as const;
export function usEstateTaxNra(usd: number): number {
  let tax = 0;
  ESTATE.forEach(([from, rate], k) => {
    const to = ESTATE[k + 1]?.[0] ?? Infinity;
    tax += Math.max(0, Math.min(usd, to) - from) * rate;
  });
  return Math.max(0, tax - 13_000);
}

export const MOVES: readonly Move[] = [
  {
    id: "trip",
    cat: "trip",
    title: { en: "Turn a trip into a business trip", he: "להפוך נסיעה לנסיעת עסקים" },
    how: {
      en: "Book a gig, session, label/client meeting or trade fair (NAMM, ADE, MIDEM) and build the trip around it. The flight, and lodging plus a daily allowance for the business days, become expenses. Keep the agenda, emails and boarding passes; personal days and family members stay yours.",
      he: "לקבוע הופעה, סשן, פגישה עם לייבל/לקוח או תערוכה (NAMM, ADE) ולבנות את הנסיעה סביבם. הטיסה, הלינה ודמי שהייה לימי העסקים הופכים להוצאה. לשמור תוכנית, מיילים וכרטיסי עלייה; ימים פרטיים ובני משפחה לא נכללים.",
    },
    risk: {
      en: "A trip that is mostly a holiday doesn't qualify. Not on the zair track (the flat 30% replaces expenses).",
      he: "נסיעה שהיא בעיקר חופשה לא מוכרת. לא במסלול עסק זעיר (30% קבועים במקום הוצאות).",
    },
    confidence: "medium",
    src: [
      "https://www.dnk-cpa.co.il/%D7%97%D7%95%D7%96%D7%A8%D7%99%D7%9D-%D7%9E%D7%A7%D7%A6%D7%95%D7%A2%D7%99%D7%99%D7%9D/%D7%94%D7%95%D7%A6%D7%90%D7%95%D7%AA-%D7%A0%D7%A1%D7%99%D7%A2%D7%94-%D7%9C%D7%97%D7%95%D7%9C-%D7%94%D7%9E%D7%95%D7%AA%D7%A8%D7%95%D7%AA-%D7%91%D7%A0%D7%99%D7%9B%D7%95%D7%99-%D7%91%D7%A9%D7%A0%D7%AA-2026/",
    ],
    inputs: [
      i("flight", "ils", 3500, "Flight", "טיסה"),
      i("days", "n", 4, "Business days", "ימי עסקים"),
      i("nights", "n", 4, "Nights", "לילות"),
      i("lodging", "usd", 180, "Lodging per night", "לינה ללילה"),
    ],
    calc: (v, c) => {
      if (!c.fx) return null;
      // 2026: $102/day with lodging, $171 without; lodging up to $365 a night for the first 7 nights, 75% of that after
      const nights = Math.max(0, v.nights!),
        cap = (n: number) => Math.min(v.lodging!, 365) * Math.min(n, 7) + Math.min(v.lodging!, 365 * 0.75) * Math.max(0, n - 7);
      const usd = v.days! * (v.lodging! > 0 ? 102 : 171) + cap(nights);
      return { now: r0(expenseSaving(c, v.flight! + usd * c.fx)) };
    },
  },
  {
    id: "borrow",
    cat: "borrow",
    title: { en: "Borrow against your investments instead of selling", he: "הלוואה כנגד ההשקעות במקום מימוש" },
    how: {
      en: "Need cash? Take a loan against the portfolio, keren hishtalmut or gemel instead of selling. A loan isn't income, so the 25% capital-gains tax isn't paid and that money keeps compounding. In Israel the heirs keep your cost basis, so this postpones the tax; it doesn't erase it.",
      he: "צריך מזומן? לקחת הלוואה כנגד תיק ההשקעות, קרן ההשתלמות או קופת הגמל במקום למכור. הלוואה אינה הכנסה, ולכן מס רווחי הון של 25% לא משולם והכסף ממשיך לצבור. בישראל היורשים ממשיכים את עלות הרכישה, כך שזו דחייה ולא ביטול.",
    },
    risk: {
      en: "Interest on a personal loan isn't deductible; a margin call can force a sale at the worst time.",
      he: "ריבית על הלוואה פרטית אינה מוכרת; קריאת מרווח עלולה לכפות מכירה ברגע הגרוע.",
    },
    confidence: "medium",
    src: ["https://www.hon.co.il/gift-securities-portfolio-to-children-tax/"],
    inputs: [
      i("amount", "ils", 100_000, "Cash you need", "כמה מזומן צריך"),
      i("gain", "pct", 40, "Share of it that is gain", "איזה חלק ממנו רווח"),
      i("rate", "pct", 6, "Loan interest", "ריבית ההלוואה"),
      i("ret", "pct", 7, "Yearly return", "תשואה שנתית"),
      i("years", "n", 3, "Years until you repay", "שנים עד ההחזר"),
    ],
    calc: (v) => {
      const tax = v.amount! * (v.gain! / 100) * 0.25;
      return { now: r0(tax), later: Math.round(grow(tax, v.ret! / 100, v.years!) - v.amount! * (v.rate! / 100) * v.years!), deferred: true };
    },
  },
  {
    id: "pension",
    cat: "wrapper",
    title: { en: "Deposit to a self-employed pension by Dec 31", he: "הפקדה לפנסיה כעצמאי עד 31.12" },
    how: {
      en: "Up to 16.5% of qualifying income: 11% comes off your income (and BL), 5.5% earns a 35% credit. The money grows untaxed until retirement.",
      he: "עד 16.5% מההכנסה המזכה: 11% מנוכים מההכנסה (ומביטוח לאומי), ו-5.5% מקבלים זיכוי של 35%. הכסף צובר בלי מס עד הפרישה.",
    },
    risk: { en: "Locked until retirement. On the zair track only the credit part counts.", he: "נעול עד הפרישה. במסלול עסק זעיר רק חלק הזיכוי נחשב." },
    confidence: "high",
    src: ["https://www.bizportal.co.il/financialconsumerism/news/article/20036343"],
    inputs: [i("deposit", "ils", 20_000, "Deposit", "הפקדה")],
    calc: (v, c) => ({ now: r0(total(c) - total(c, { pension: c.base.pension + v.deposit! })) }),
  },
  {
    id: "kh",
    cat: "wrapper",
    title: { en: "Keren hishtalmut: deduct it now, take it out tax-free", he: "קרן השתלמות: ניכוי עכשיו, משיכה פטורה" },
    how: {
      en: "4.5% of income is deductible, and gains on up to ₪20,566 a year of deposits are tax-free after 6 years. You can also borrow against it without selling.",
      he: "4.5% מההכנסה מוכרים בניכוי, והרווחים על הפקדות של עד ₪20,566 בשנה פטורים ממס אחרי 6 שנים. אפשר גם לקחת הלוואה כנגדה בלי למשוך.",
    },
    risk: {
      en: "No deduction on the zair track (the tax-free growth still applies). Withdrawing before 6 years is taxed.",
      he: "אין ניכוי במסלול עסק זעיר (הפטור על הרווחים נשאר). משיכה לפני 6 שנים חייבת במס.",
    },
    confidence: "high",
    src: ["https://www.madadim-c.co.il/resources/pension-training-fund-ceilings-2026/"],
    inputs: [i("deposit", "ils", 20_566, "Deposit", "הפקדה"), i("ret", "pct", 6, "Yearly return", "תשואה שנתית"), i("years", "n", 6, "Years", "שנים")],
    calc: (v, c) => {
      const profit = Math.max(0, c.base.turnover - c.base.expenses);
      const ded = c.base.zair ? 0 : Math.min(v.deposit!, c.T.khPct * Math.min(profit, c.T.khIncomeCap));
      return {
        now: r0(total(c) - total(c, { deductions: (c.base.deductions ?? 0) + ded })),
        later: r0(grow(Math.min(v.deposit!, 20_566), v.ret! / 100, v.years!) * 0.25),
      };
    },
  },
  {
    id: "gemel",
    cat: "investment",
    title: { en: "Invest through a kupat gemel lehashkaa (one per family member)", he: "השקעה דרך קופת גמל להשקעה (לכל בן משפחה)" },
    how: {
      en: "Up to ₪83,641 a person a year (2026). Switching tracks inside is tax-free, and from 60 it can come out as a tax-free annuity instead of paying 25% on the gain.",
      he: "עד ₪83,641 לאדם בשנה (2026). מעבר בין מסלולים בתוכה בלי מס, ומגיל 60 אפשר למשוך כקצבה פטורה במקום 25% על הרווח.",
    },
    risk: { en: "No deduction going in. A lump sum before 60 pays 25% on the real gain.", he: "אין ניכוי בהפקדה. משיכה הונית לפני 60 – 25% על הרווח הריאלי." },
    confidence: "high",
    src: ["https://www.analyst.co.il/wp-content/uploads/2026/01/820-10880015980_tikrot-hafkada-2026.pdf"],
    inputs: [i("deposit", "ils", 50_000, "Deposit", "הפקדה"), i("ret", "pct", 6, "Yearly return", "תשואה שנתית"), i("years", "n", 20, "Years", "שנים")],
    calc: (v) => ({ now: 0, later: r0(grow(Math.min(v.deposit!, 83_641), v.ret! / 100, v.years!) * 0.25) }),
  },
  {
    id: "ucits",
    cat: "investment",
    title: { en: "Hold Irish (UCITS) ETFs, not US ones", he: "להחזיק תעודות סל אירופיות (UCITS) ולא אמריקאיות" },
    how: {
      en: "A non-American's US stocks and ETFs above $60,000 owe US estate tax of 18–40% at death; Israel has no estate treaty with the US. The same index in an Irish fund (CSPX, VWRA) isn't US property, and its dividends are withheld at 15%, not 25%.",
      he: 'מניות ותעודות סל אמריקאיות של מי שאינו אמריקאי חייבות במס עיזבון אמריקאי של 18–40% מעל $60,000. לישראל אין אמנת עיזבון עם ארה"ב. אותו מדד בקרן אירית (CSPX, VWRA) אינו נכס אמריקאי, והדיבידנדים שלה מנוכים ב-15% ולא 25%.',
    },
    risk: {
      en: "Selling US ETFs to switch realises 25% capital-gains tax; switch new money first.",
      he: "מכירת תעודות אמריקאיות כדי לעבור מממשת 25% מס רווחי הון; להתחיל בכסף חדש.",
    },
    confidence: "high",
    src: ["https://www.irs.gov/individuals/international-taxpayers/some-nonresidents-with-us-assets-must-file-estate-tax-returns"],
    inputs: [i("held", "usd", 150_000, "US stocks and ETFs you hold", "מניות ותעודות אמריקאיות שבידך")],
    calc: (v, c) => (c.fx ? { now: 0, later: r0(usEstateTaxNra(v.held!) * c.fx) } : null),
  },
  {
    id: "treaty",
    cat: "cross-border",
    title: { en: "Claim the treaty's 10% on US royalties (W-8BEN)", he: 'לתבוע 10% לפי האמנה על תמלוגים מארה"ב (W-8BEN)' },
    how: {
      en: "US payers keep 30% of US royalties (YouTube US views, US streaming and publishing) unless you file a W-8BEN claiming article 14 of the US–Israel treaty: then 10%. Do it in AdSense and with every US distributor; the 10% is then credited in Israel.",
      he: 'משלמים אמריקאים מנכים 30% מתמלוגים מארה"ב (צפיות ביוטיוב מארה"ב, סטרימינג והוצאה לאור) אלא אם מגישים W-8BEN לפי סעיף 14 לאמנה: אז 10%. לעשות זאת ב-AdSense ומול כל מפיץ אמריקאי; ה-10% מזוכים בישראל.',
    },
    risk: {
      en: "A W-9 for a foreign-owned LLC is a misstatement; the form is the owner's.",
      he: "טופס W-9 ל-LLC בבעלות זר הוא הצהרה שגויה; הטופס הוא של הבעלים.",
    },
    confidence: "high",
    src: ["https://www.irs.gov/pub/irs-trty/israel.pdf"],
    inputs: [i("royalties", "usd", 10_000, "US royalties a year", 'תמלוגים מארה"ב בשנה'), i("withheld", "pct", 30, "Withheld now", "מנוכה היום")],
    calc: (v, c) => (c.fx ? { now: r0(v.royalties! * Math.max(0, v.withheld! / 100 - 0.1) * c.fx) } : null),
  },
  {
    id: "timing",
    cat: "timing",
    title: { en: "Move income across Dec 31", he: "להעביר הכנסה מעבר ל-31.12" },
    how: {
      en: "You are taxed when money is received. Invoicing in January instead of December (or holding a platform payout) moves income to a year with lower brackets, or keeps you under the zair ceiling.",
      he: "המס הוא לפי מועד הקבלה. הוצאת חשבונית בינואר במקום בדצמבר (או דחיית תשלום מפלטפורמה) מעבירה הכנסה לשנה עם מדרגות נמוכות יותר או משאירה אותך מתחת לתקרת עסק זעיר.",
    },
    risk: { en: "Money already available to you counts as received; never backdate.", he: "כסף שכבר זמין לך נחשב כהתקבל; לעולם לא לתארך לאחור." },
    confidence: "high",
    src: ["https://shtar.co.il/guide/tax/tax-brackets-2026"],
    inputs: [
      i("shift", "ils", 30_000, "Income to move into next year", "הכנסה להעביר לשנה הבאה"),
      i("next", "ils", 80_000, "Next year's expected turnover", "מחזור צפוי בשנה הבאה"),
    ],
    calc: (v, c) => {
      const s = Math.min(v.shift!, c.base.turnover),
        nextBase = { turnover: v.next!, expenses: c.base.expenses * (v.next! / Math.max(1, c.base.turnover)) };
      return { now: r0(total(c) + total(c, nextBase) - total(c, { turnover: c.base.turnover - s }) - total(c, { ...nextBase, turnover: v.next! + s })) };
    },
  },
  {
    id: "gear",
    cat: "deduction",
    title: { en: "Buy the gear you need before Dec 31", he: "לקנות את הציוד הדרוש לפני 31.12" },
    how: {
      en: "Computers and peripherals depreciate at 33% a year, other electronics at 15%, from the month they go into use. Plugins and software subscriptions are expensed at once.",
      he: "מחשבים וציוד היקפי מופחתים ב-33% בשנה, ציוד אלקטרוני אחר ב-15%, מהחודש שבו התחילו לשמש. פלאגינים ומנויי תוכנה – הוצאה מיידית.",
    },
    risk: { en: "Only the business-use share; not on the zair track.", he: "רק החלק העסקי; לא במסלול עסק זעיר." },
    confidence: "medium",
    src: ["https://roeahesbon.com/%D7%A9%D7%99%D7%A2%D7%95%D7%A8%D7%99-%D7%A4%D7%97%D7%AA/"],
    inputs: [
      i("cost", "ils", 12_000, "Cost", "עלות"),
      i("rate", "pct", 33, "Depreciation rate", "שיעור פחת"),
      i("months", "n", 1, "Months in use this year", "חודשי שימוש השנה"),
    ],
    calc: (v, c) => ({ now: r0(expenseSaving(c, v.cost! * (v.rate! / 100) * (Math.min(12, v.months!) / 12))) }),
  },
  {
    id: "home-office",
    cat: "deduction",
    title: { en: "Deduct your home studio", he: "לנכות את חדר העבודה/האולפן בבית" },
    how: {
      en: "A room used only for the business: its share of the floor area of rent (or mortgage interest), arnona, electricity, water, va'ad bayit and insurance.",
      he: "חדר שמשמש רק לעסק: החלק היחסי לפי שטח משכר הדירה (או ריבית המשכנתא), ארנונה, חשמל, מים, ועד בית וביטוח.",
    },
    risk: { en: "Mixed use weakens it; not on the zair track.", he: "שימוש מעורב מחליש את הטענה; לא במסלול עסק זעיר." },
    confidence: "medium",
    src: ["https://www.bizportal.co.il/guides/news/article/20039577"],
    inputs: [
      i("room", "n", 12, "Room (m²)", 'שטח החדר (מ"ר)'),
      i("home", "n", 80, "Home (m²)", 'שטח הדירה (מ"ר)'),
      i("costs", "ils", 60_000, "Home costs a year", "עלויות הבית בשנה"),
    ],
    calc: (v, c) => ({ now: r0(expenseSaving(c, v.costs! * Math.min(1, v.room! / Math.max(1, v.home!)))) }),
  },
  {
    id: "donate",
    cat: "charity",
    title: { en: "Give to a §46 charity: 35% back", he: "תרומה למוסד עם סעיף 46: 35% חזרה" },
    how: {
      en: "Donations above ₪207 to approved institutions earn a 35% credit (up to 30% of taxable income), the same at any bracket. Unused credit carries 3 years.",
      he: "תרומות מעל ₪207 למוסדות מאושרים מזכות ב-35% זיכוי (עד 30% מההכנסה החייבת), זהה בכל מדרגה. זיכוי שלא נוצל עובר 3 שנים.",
    },
    risk: {
      en: "Only §46-approved institutions; receipts go through the digital donations system.",
      he: "רק מוסדות עם אישור סעיף 46; הקבלות דרך מערכת התרומות הדיגיטלית.",
    },
    confidence: "high",
    src: [
      "https://www.kolzchut.org.il/he/%D7%96%D7%99%D7%9B%D7%95%D7%99_%D7%9E%D7%9E%D7%A1_%D7%94%D7%9B%D7%A0%D7%A1%D7%94_%D7%91%D7%A9%D7%9C_%D7%AA%D7%A8%D7%95%D7%9E%D7%94_(%D7%A1%D7%A2%D7%99%D7%A3_46)",
    ],
    inputs: [i("amount", "ils", 5_000, "Donation", "תרומה")],
    calc: (v, c) => ({ now: r0(total(c) - total(c, { donations: c.base.donations + v.amount! })) }),
  },
  {
    id: "amuta",
    cat: "charity",
    title: { en: "Start an amuta (e.g. a music-education nonprofit)", he: "להקים עמותה (למשל לחינוך מוזיקלי)" },
    how: {
      en: "Your gifts to it (and other people's) earn the 35% credit once it has §46 status, and it can run workshops, grants and community projects and pay you a market salary for real work. Needs 7+ mostly unrelated members, ₪30,000+ turnover, about a year of activity and a proper-management certificate.",
      he: "התרומות שלך (ושל אחרים) מזכות ב-35% אחרי קבלת סעיף 46, והיא יכולה להפעיל סדנאות, מענקים ופרויקטים קהילתיים ולשלם לך שכר שוק על עבודה אמיתית. נדרשים 7+ חברים ברובם לא קרובים, מחזור ₪30,000+, כשנת פעילות ואישור ניהול תקין.",
    },
    risk: {
      en: "Not a personal shelter: profit can't come back to you, and self-dealing loses the status (and can be criminal).",
      he: "לא מקלט אישי: רווח לא חוזר אליך, והעברת טובות הנאה מבטלת את האישור (ועלולה להיות פלילית).",
    },
    confidence: "medium",
    src: ["https://www.csf.org.il/2022/05/29/46_section_tax_refund/"],
    inputs: [i("give", "ils", 30_000, "You give it a year", "תורם לה בשנה"), i("admin", "ils", 10_000, "Running cost a year", "עלות ניהול בשנה")],
    calc: (v, c) => ({ now: Math.round(total(c) - total(c, { donations: c.base.donations + v.give! }) - v.admin!) }),
  },
  {
    id: "ltd",
    cat: "entity",
    title: { en: "Keep profit in an Ltd at 23%", he: 'להשאיר רווח בחברה בע"מ ב-23%' },
    how: {
      en: "Profit you don't need to live on pays 23% inside a company instead of your top bracket plus BL, and is invested from there. Dividend tax (30%) comes only when you take it out, ideally in a low-income year. All-in a distributed shekel bears ~46%, so this is deferral.",
      he: "רווח שאינו נדרש למחיה משלם 23% בחברה במקום המדרגה העליונה וביטוח לאומי, ומושקע משם. מס דיבידנד (30%) רק במשיכה, רצוי בשנה דלת הכנסה. בסך הכול שקל שחולק נושא כ-46%, כלומר זו דחייה.",
    },
    risk: {
      en: "Accounting ~₪10–20k a year; 2% yearly charge on excess undistributed profit; the wallet-company rule if one client pays 70%+.",
      he: "הנהלת חשבונות ~₪10–20 אלף בשנה; היטל 2% על רווחים עודפים שלא חולקו; כלל חברת ארנק אם לקוח אחד משלם 70%+.",
    },
    confidence: "medium",
    src: ["https://www.guberman.co.il/he/node/5694", "https://www.grantthornton.co.il/insights1/tax-insignths/2025/Locked_profits/"],
    inputs: [
      i("keep", "ils", 100_000, "Profit you'd leave in", "רווח שיישאר בחברה"),
      i("ret", "pct", 6, "Yearly return", "תשואה שנתית"),
      i("years", "n", 5, "Years", "שנים"),
      i("cost", "ils", 15_000, "Extra accounting a year", "עלות הנהלת חשבונות נוספת"),
    ],
    calc: (v, c) => {
      const keep = Math.min(v.keep!, c.base.turnover),
        personal = total(c) - total(c, { turnover: c.base.turnover - keep }),
        gap = personal - 0.23 * keep - v.cost!;
      return { now: Math.round(gap), later: Math.round(grow(Math.max(0, gap), v.ret! / 100, v.years!)), deferred: true };
    },
  },
  {
    id: "spouse",
    cat: "family",
    title: { en: "Pay a spouse who really works in the business", he: "לשלם לבן/בת זוג שעובד/ת בעסק באמת" },
    how: {
      en: "Income split by actual contribution lets each spouse use their own credit points and low brackets (separate calculation, §66(ד)).",
      he: "חלוקת הכנסה לפי תרומה בפועל מאפשרת לכל אחד לנצל נקודות זיכוי ומדרגות נמוכות (חישוב נפרד, סעיף 66(ד)).",
    },
    risk: {
      en: "Must match real work (timesheets, role); an employee ends the zair track.",
      he: "חייב להתאים לעבודה אמיתית (שעות, תפקיד); עובד מבטל מסלול עסק זעיר.",
    },
    confidence: "medium",
    src: ["https://www.kedarcpa.com/%D7%94%D7%A2%D7%A1%D7%A7%D7%AA-%D7%A7%D7%A8%D7%95%D7%91%D7%99-%D7%9E%D7%A9%D7%A4%D7%97%D7%94-%D7%91%D7%A2%D7%A1%D7%A7/"],
    inputs: [i("pay", "ils", 60_000, "Their share a year", "החלק שלו/ה בשנה"), i("points", "n", 2.75, "Their credit points", "נקודות הזיכוי שלו/ה")],
    calc: (v, c) => {
      const pay = Math.min(v.pay!, c.base.turnover);
      const theirs = ilPlan({ turnover: pay, expenses: 0, zair: false, points: v.points!, pension: 0, donations: 0, selfEmployed: true }, c.T).total;
      return { now: Math.round(total(c) - total(c, { turnover: c.base.turnover - pay }) - theirs) };
    },
  },
  {
    id: "rent",
    cat: "investment",
    title: { en: "Pick the cheapest track for rent you receive", he: "לבחור את המסלול הזול למס על שכר דירה" },
    how: {
      en: "Residential rent from an individual tenant: exempt up to ₪5,654 a month (partly up to double that), or a flat 10% of gross, or your bracket on rent less expenses. Choose each year.",
      he: "שכר דירה למגורים מדייר יחיד: פטור עד ₪5,654 לחודש (חלקי עד כפול מזה), או 10% קבוע מהברוטו, או לפי המדרגה על השכירות בניכוי הוצאות. בוחרים כל שנה.",
    },
    risk: {
      en: "The exemption needs an individual tenant; the 10% is paid within 30 days of year end.",
      he: "הפטור מחייב דייר יחיד; את ה-10% משלמים תוך 30 יום מתום השנה.",
    },
    confidence: "high",
    src: ["https://zcpa.co.il/Article/mas-sechar-dira-2026"],
    inputs: [i("rent", "ils", 6_000, "Rent a month", "שכר דירה לחודש"), i("costs", "ils", 8_000, "Expenses a year", "הוצאות בשנה")],
    calc: (v, c) => {
      const m = (total(c, { turnover: c.base.turnover + 1000 }) - total(c)) / 1000,
        R = v.rent!,
        CAP = 5654;
      const exempt = Math.max(0, R - Math.max(0, CAP - Math.max(0, R - CAP))) * 12 * m,
        flat = 0.1 * R * 12,
        regular = Math.max(0, R * 12 - v.costs!) * m;
      return { now: r0(regular - Math.min(exempt, flat, regular)) };
    },
  },
  {
    id: "gift",
    cat: "family",
    title: { en: "Give income-producing assets to adult children", he: "להעביר נכסים מניבים לילדים בגירים" },
    how: {
      en: "Israel has no gift or estate tax and gifts between relatives are exempt. Income from what an adult child owns is taxed at their own (often lower) rate; for children under 18 it is still yours (§64).",
      he: "בישראל אין מס מתנה או עיזבון, ומתנה בין קרובים פטורה. הכנסה מנכס של ילד בגיר ממוסה לפי השיעור שלו (לרוב נמוך יותר); לילד מתחת ל-18 היא עדיין שלך (סעיף 64).",
    },
    risk: { en: "The gift is irrevocable; if you keep control it's attributed back to you.", he: "המתנה בלתי הפיכה; אם השליטה נשארת אצלך ההכנסה מיוחסת אליך." },
    confidence: "medium",
    src: ["https://www.hon.co.il/gift-securities-portfolio-to-children-tax/"],
    inputs: [i("income", "ils", 40_000, "Yearly income from the asset", "הכנסה שנתית מהנכס"), i("theirs", "pct", 10, "Their tax rate", "שיעור המס שלהם")],
    calc: (v, c) => {
      const m = (total(c, { turnover: c.base.turnover + 1000 }) - total(c)) / 1000;
      return { now: r0(v.income! * (m - v.theirs! / 100)) };
    },
  },
];

/** Run one move with its defaults overridden by `v`. */
export function runMove(m: Move, v: Record<string, number>, c: MoveCtx): MoveResult | null {
  const vals = Object.fromEntries(m.inputs.map((x) => [x.key, Number.isFinite(v[x.key]) ? v[x.key]! : x.def]));
  return m.calc(vals, c);
}

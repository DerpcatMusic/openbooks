// How a US business is framed for federal tax: which return, which estimates. The business type the owner picked at setup decides.
// (a) a US person's sole proprietorship or single-member LLC → "individual": Schedule C + SE + QBI (8995) + 1040-ES estimates;
// (b) a foreign-owned disregarded LLC → "foreign-owned": Form 5472 + pro forma 1120 (+ FBAR / BOI notes);
// (c) a C-corporation → "c-corp": Form 1120 at 21% + 1120-W estimates; (d) a partnership → "partnership": Form 1065 + K-1s;
// (e) an S corporation → "s-corp": Form 1120-S + K-1s.
export type UsTrack = "individual" | "foreign-owned" | "c-corp" | "partnership" | "s-corp";
const TRACK: Readonly<Record<string, UsTrack>> = {
  "sole-prop": "individual",
  "llc-us-owner": "individual",
  "llc-disregarded": "foreign-owned",
  "llc-ccorp": "c-corp",
  "llc-partnership": "partnership",
  "s-corp": "s-corp",
};
/** Unknown or unset types are the legacy "us-llc" books: a foreign-owned single-member LLC. */
export const usTrack = (type: string | null | undefined): UsTrack => TRACK[type ?? ""] ?? "foreign-owned";
/** The owner is a US person (or the company is US-owned): no foreign-owner forms (5472, 1042-S). Blank = unknown = assume foreign, as before. */
export const usOwned = (ownerCountry: string | undefined) => /^\s*(u\.?s\.?a?\.?|united states( of america)?)\s*$/i.test(ownerCountry ?? "");

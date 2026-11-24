// Foreign-owned US single-member LLC: what must be filed for tax year y (port of us_tax in mcp_server.py). 5472/1120 field
// mapping onto the IRS PDFs: irs.ts.
import type { Obligation } from "@openbooks/core";
import type { UsTable } from "./schema.ts";

export interface PartVIIAnswers {
  /** Line 37: Does the reporting corporation import goods from a foreign related party? */
  q37?: boolean;
  /** Line 38a (only if 37 is Yes): basis/inventory cost > customs value? */
  q38a?: boolean;
  /** Line 38c (only if 37 is Yes): documents in existence and available in the U.S.? */
  q38c?: boolean;
  /** Line 39: Foreign parent corporation participant in any CSA? */
  q39?: boolean;
  /** Line 40a: Deduction disallowed under section 267A? */
  q40a?: boolean;
  /** Line 41a: FDII / FDDEI transactions with foreign related party? */
  q41a?: boolean;
  /** Line 42a: Loan using safe-haven interest rate (100%–130% AFR)? */
  q42a?: boolean;
  /** Line 42b: Loan using interest rate outside safe-haven range? */
  q42b?: boolean;
  /** Line 43a (corporations only, NOT foreign-owned U.S. DE): covered debt instrument under Reg. §1.385-3? */
  q43a?: boolean;
}

export interface UsProfile {
  legalName?: string;
  ein?: string;
  state?: string;
  formed?: string;
  address?: string;
  cityStateZip?: string;
  naics?: string;
  owner?: string;
  /** English / WinAnsi legal spelling for IRS PDFs (required when `owner` is non-ASCII, e.g. Hebrew). */
  ownerLegalName?: string;
  ownerAddress?: string;
  ownerCountry?: string;
  /** Form 5472 Part II line 4c: principal country(ies) where the 25% foreign shareholder conducts business. */
  ownerBusinessCountry?: string;
  /** Form 5472 Part II line 4d: country of citizenship, organization, or incorporation. */
  ownerCitizenship?: string;
  /** Form 5472 Part II line 4e: country(ies) under whose laws the owner files an income tax return as a resident. */
  ownerResidence?: string;
  ownerTin?: string;
  business?: string;
  /** Form 5472 line 1o: principal country(ies) where the reporting company conducts business (never "worldwide"; i5472). */
  businessCountries?: string;
  /** Form 5472 line 1n: country(ies) under whose laws the company files an income tax return as a resident; blank when none (a DE files none). */
  taxReturnCountry?: string;
  /** Explicit Form 5472 Part VII Yes/No answers (never silently assumed "No"). */
  partVII?: PartVIIAnswers;
  /** Individual track (Schedule C / SE / 1040-ES): the taxpayer as on the 1040, their SSN or ITIN, phone for the 1099-NEC payer box. */
  taxpayerName?: string;
  ssn?: string;
  phone?: string;
}

export const PROFILE_FIELDS: Readonly<
  Record<
    Exclude<
      keyof UsProfile,
      "taxpayerName" | "ssn" | "phone" | "taxReturnCountry" | "ownerLegalName" | "ownerBusinessCountry" | "ownerCitizenship" | "ownerResidence" | "partVII"
    >,
    string
  >
> = {
  legalName: "Legal name",
  ein: "EIN",
  state: "State of formation",
  formed: "Date formed",
  address: "US business street address",
  cityStateZip: "City, ST ZIP",
  naics: "NAICS business code",
  owner: "Owner (Part II)",
  ownerAddress: "Owner address",
  ownerCountry: "Owner citizenship & tax residence",
  ownerTin: "Owner foreign TIN",
  business: "Principal business activity",
  businessCountries: "Principal country(ies) where business is conducted (5472 line 1o)",
};
/** What an individual's return and 1099-NEC payer box need beyond PROFILE_FIELDS (the owner is a US person: no foreign-owner fields). */
export const INDIVIDUAL_FIELDS = ["taxpayerName", "ssn", "address", "cityStateZip", "business", "naics"] as const;
export const missingIndividual = (p: UsProfile) => INDIVIDUAL_FIELDS.filter((k) => !p[k]);

export function llcObligations(y: number, T: UsTable, p: UsProfile = {}): (Obligation & { extendedDue?: string })[] {
  return [
    {
      form: "5472",
      country: "us",
      why: "information return: total assets, the foreign owner, reportable transactions with the owner",
      due: `${y + 1}-${T.dueMonthDay}`,
      extendedDue: `${y + 1}-${T.extendedMonthDay}`,
    },
    {
      form: "1120 (pro forma)",
      country: "us",
      why: "name, address, EIN, item E (initial/final/name/address change); 'Foreign-owned U.S. DE' across the top; 5472 attached; fax or mail",
      due: `${y + 1}-${T.dueMonthDay}`,
      extendedDue: `${y + 1}-${T.extendedMonthDay}`,
    },
    { form: "State annual report", country: "us", why: `depends on the state of formation (${p.state || "not set"})` },
  ];
}
export const missingProfile = (p: UsProfile) =>
  (Object.keys(PROFILE_FIELDS) as (keyof typeof PROFILE_FIELDS)[]).filter((k) => !p[k]).map((k) => PROFILE_FIELDS[k]);

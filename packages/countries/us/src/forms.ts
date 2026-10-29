// Foreign-owned US single-member LLC: what must be filed for tax year y (port of us_tax in mcp_server.py). 5472/1120 field
// mapping onto the IRS PDFs: irs.ts.
import type { Obligation } from "@openbooks/core";
import type { UsTable } from "./schema.ts";

export interface UsProfile {
  legalName?: string;
  ein?: string;
  state?: string;
  formed?: string;
  address?: string;
  cityStateZip?: string;
  naics?: string;
  owner?: string;
  ownerAddress?: string;
  ownerCountry?: string;
  ownerTin?: string;
  business?: string;
  /** Individual track (Schedule C / SE / 1040-ES): the taxpayer as on the 1040, their SSN or ITIN, phone for the 1099-NEC payer box. */
  taxpayerName?: string;
  ssn?: string;
  phone?: string;
}

export const PROFILE_FIELDS: Readonly<Record<Exclude<keyof UsProfile, "taxpayerName" | "ssn" | "phone">, string>> = {
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
      why: "name, address, EIN, total assets; 'Foreign-owned U.S. DE' across the top; 5472 attached; fax or mail",
      due: `${y + 1}-${T.dueMonthDay}`,
      extendedDue: `${y + 1}-${T.extendedMonthDay}`,
    },
    { form: "State annual report", country: "us", why: `depends on the state of formation (${p.state || "not set"})` },
  ];
}
export const missingProfile = (p: UsProfile) => (Object.keys(PROFILE_FIELDS) as (keyof typeof PROFILE_FIELDS)[]).filter((k) => !p[k]).map((k) => PROFILE_FIELDS[k]);

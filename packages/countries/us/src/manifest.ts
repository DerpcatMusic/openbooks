import type { Manifest } from "@openbooks/core";
import en from "../strings/en.json";
import he from "../strings/he.json";

const S = { en: en as Record<string, unknown>, he: he as Record<string, unknown> };
const str = (d: Record<string, unknown>, k: string) => (typeof d[k] === "string" ? (d[k] as string) : undefined);
const label = (k: string) => ({ en: str(S.en, k) ?? k, he: str(S.he, k) ?? str(S.en, k) ?? k });

export const manifest: Manifest = {
  id: "us",
  names: { en: "United States", he: "ארצות הברית" },
  flag: "🇺🇸",
  currency: "USD",
  businessTypes: (
    [
      ["llc-disregarded", "transparent"],
      ["llc-ccorp", "company"],
      ["llc-partnership", "partnership"],
    ] as const
  ).map(([key, treatment]) => ({ key, treatment, label: label(`biz.${key}`), sub: label(`biz.${key}.sub`) })),
  defaultType: "llc-disregarded",
  legacyKinds: { "us-llc": "llc-disregarded" },
  taxYear: { start: "01-01", filingDue: "04-15", extendedDue: "10-15" },
  accounts: [
    "revenue:music-royalties",
    "revenue:plugin-sales",
    "revenue:patreon",
    "revenue:services",
    "other-income:cashback",
    "cogs:ai-models",
    "cogs:hosting",
    "cogs:platform-fees",
    "expense:advertising",
    "expense:software",
    "expense:travel",
    "expense:phone-internet",
    "expense:bank-fees",
    "expense:equipment",
    "expense:meals",
    "expense:professional",
    "expense:games",
    "equity:owner",
    "transfer:internal",
  ],
};

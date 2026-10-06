import type { Manifest } from "@openbooks/core";
import en from "../strings/en.json";
import he from "../strings/he.json";

const S = { en: en as Record<string, unknown>, he: he as Record<string, unknown> };
const str = (d: Record<string, unknown>, k: string) => (typeof d[k] === "string" ? (d[k] as string) : undefined);
const label = (k: string) => ({ en: str(S.en, k) ?? k, he: str(S.he, k) ?? str(S.en, k) ?? k });

/** Israeli business types registered for VAT (osek murshe, ltd): they issue חשבונית מס and charge VAT. */
const VAT_TYPES: ReadonlySet<string> = new Set(["osek-murshe", "ltd"]);
export const vatRegistered = (bizType: string | null | undefined) => !!bizType && VAT_TYPES.has(bizType);

export const manifest: Manifest = {
  id: "il",
  names: { en: "Israel", he: "ישראל" },
  flag: "🇮🇱",
  currency: "ILS",
  businessTypes: (
    [
      ["osek-patur", "sole-proprietor"],
      ["osek-zair", "sole-proprietor"],
      ["osek-murshe", "sole-proprietor"],
      ["ltd", "company"],
    ] as const
  ).map(([key, treatment]) => ({ key, treatment, label: label(`biz.${key}`), sub: label(`biz.${key}.sub`) })),
  defaultType: "osek-zair",
  legacyKinds: { "il-osek-zair": "osek-zair" },
  taxYear: { start: "01-01" }, // filing date: not set until sourced (playbook-style), see docs/architecture.md open items
  accounts: [
    "business:paypal",
    "business:youtube",
    "business:music",
    "business:client",
    "business:other",
    "capital:child-savings",
    "exempt:idf-salary",
    "personal:family",
    "personal:friends",
    "personal:refund",
    "personal:provident-fund",
    "own:savings",
    "own:transfer",
    "own:bit-withdrawal",
  ],
};

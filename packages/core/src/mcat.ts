// The bank's own category (Mercury "Category", txn.mcat) as a signal: a hint for the ledger account and for the deduction rule.
// Hints only ever add to the score of a suggestion; what a user filed under the same bank category before (reports.ts suggest) outranks them.

/** "Food & Dining" -> "food dining": comparable whatever the bank's capitalisation and punctuation. */
export const mcatKey = (c: string | undefined) =>
  (c ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Bank category -> the usual ledger account (the chart's built-in accounts). */
export const MCAT_ACCOUNT: Readonly<Record<string, string>> = {
  software: "expense:software",
  "software subscriptions": "expense:software",
  advertising: "expense:advertising",
  marketing: "expense:advertising",
  travel: "expense:travel",
  "travel airlines": "expense:travel",
  hotels: "expense:travel",
  lodging: "expense:travel",
  restaurants: "expense:meals",
  meals: "expense:meals",
  "food dining": "expense:meals",
  fees: "expense:bank-fees",
  "bank fees": "expense:bank-fees",
  "office supplies": "expense:equipment",
  equipment: "expense:equipment",
  electronics: "expense:equipment",
  entertainment: "expense:games",
  utilities: "expense:phone-internet",
  telecommunications: "expense:phone-internet",
  "professional services": "expense:professional",
  "legal services": "expense:professional",
  legal: "expense:professional",
  accounting: "expense:professional",
};

/** Bank category -> deduction rule ids it points at (any country; ids that aren't in the table are skipped). One rule per family and
 *  deliberately the plain one: "Travel" means flights, not the companion or mixed-trip rules, which only a tag can claim. */
export const MCAT_RULES: Readonly<Record<string, readonly string[]>> = {
  software: ["il.software", "us.software"],
  "software subscriptions": ["il.software", "us.software"],
  travel: ["il.travel.flights", "us.travel.transport"],
  "travel airlines": ["il.travel.flights", "us.travel.transport"],
  airlines: ["il.travel.flights", "us.travel.transport"],
  hotels: ["il.travel.lodging", "us.travel.lodging"],
  lodging: ["il.travel.lodging", "us.travel.lodging"],
  restaurants: ["il.meals-own", "us.meals"],
  meals: ["il.meals-own", "us.meals"],
  "food dining": ["il.meals-own", "us.meals"],
  gifts: ["il.gifts", "us.gifts"],
  "gifts donations": ["il.gifts", "us.gifts"],
  donations: ["il.donations"],
  charity: ["il.donations"],
  phone: ["il.phone.mobile", "us.phone"],
  telecommunications: ["il.phone.mobile", "us.phone"],
  internet: ["il.internet", "us.internet"],
  insurance: ["il.insurance.business", "us.insurance"],
  education: ["il.training", "us.education"],
  training: ["il.training", "us.education"],
  "professional services": ["il.professional-fees", "us.professional"],
  "legal services": ["il.professional-fees", "us.professional"],
  legal: ["il.professional-fees", "us.professional"],
  accounting: ["il.professional-fees", "us.professional"],
  fees: ["il.bank-fees", "us.bankfees"],
  "bank fees": ["il.bank-fees", "us.bankfees"],
  equipment: ["il.depreciation", "us.equipment"],
  "office supplies": ["il.depreciation", "us.equipment"],
  electronics: ["il.depreciation", "us.equipment"],
  parking: ["il.parking-tolls", "us.vehicle.parking-tolls"],
  tolls: ["il.parking-tolls", "us.vehicle.parking-tolls"],
  taxi: ["il.taxi-transit"],
  rideshare: ["il.taxi-transit", "us.travel.transport"],
  transportation: ["il.taxi-transit", "us.travel.transport"],
  "gas fuel": ["il.vehicle.running", "us.vehicle.actual"],
  automotive: ["il.vehicle.running", "us.vehicle.actual"],
  coworking: ["il.coworking", "us.office.coworking"],
  contractors: ["us.contractors"],
};

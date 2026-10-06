// Israeli tax-table shape (tables/<year>.json). Effect Schema is the source; IlRates/IlTable types derive from it.
// Calculations import these as types only.
import { Schema } from "effect";
import { Struct } from "effect";
import { TaxTableBase } from "@openbooks/schema";

const Rate = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));
const Money = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
/** [upTo (null = ∞), rate] */
export const Brackets = Schema.Array(Schema.Tuple([Schema.NullOr(Money), Rate]));

/** Every number the calculations need (a year whose file lacks some, e.g. 2024 without BL, is not "complete"). */
export const IlRates = Schema.Struct({
  ...TaxTableBase.fields,
  point: Money,
  brackets: Brackets,
  zairCeiling: Money,
  capitalRate: Rate,
  vatRate: Rate,
  blRateReduced: Rate,
  blRateFull: Rate,
  healthRateReduced: Rate,
  healthRateFull: Rate,
  pensionRate1: Rate,
  pensionRate2: Rate,
  depositPct: Rate,
  creditPct: Rate,
  donationMin: Money,
  avgWageMonthly: Money,
  blReducedMonthly: Money,
  blMaxMonthly: Money,
  blMinMonthly: Money,
  mezakaMonthly: Money,
  ltd: Schema.Struct({
    corpRate: Rate,
    divRate: Rate,
    surtax: Rate,
    surtaxCapital: Rate,
    surtaxThreshold: Money,
    eeReduced: Rate,
    eeFull: Rate,
    erReduced: Rate,
    erFull: Rate,
  }),
  costs: Schema.optionalKey(Schema.Record(Schema.String, Money)),
  costsNote: Schema.optionalKey(Schema.String),
  ltdNote: Schema.optionalKey(Schema.String),
});
export type IlRates = typeof IlRates.Type;

const later = [
  "vatRate",
  "blRateReduced",
  "blRateFull",
  "healthRateReduced",
  "healthRateFull",
  "pensionRate1",
  "pensionRate2",
  "depositPct",
  "creditPct",
  "donationMin",
  "avgWageMonthly",
  "blReducedMonthly",
  "blMaxMonthly",
  "blMinMonthly",
  "mezakaMonthly",
  "ltd",
] as const;
/** A tables/<year>.json file: older years only carry income-tax numbers. */
export const IlTable = IlRates.mapFields(Struct.mapPick(later, Schema.optionalKey));
export type IlTable = typeof IlTable.Type;

/** Has every number ilPlan/taxximize/advise need. */
export const isComplete = (t: IlTable): t is IlRates => later.every((k) => t[k] !== undefined);

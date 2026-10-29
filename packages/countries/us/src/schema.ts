import { Schema } from "effect";
import { TaxTableBase } from "@openbooks/schema";

const Rate = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));
const Money = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const MonthDay = Schema.String.check(Schema.isPattern(/^\d{2}-\d{2}$/));

const Status = Schema.Struct({ single: Money, mfj: Money, hoh: Money, mfs: Money });
/** [upper bound of the bracket (null = no limit), rate]: the IRS rate tables of §1(j), one list per filing status. */
const Brackets = Schema.Array(Schema.Tuple([Schema.NullOr(Money), Rate]));
/** Federal income / self-employment tax figures of one tax year; every number is sourced in the table's `sources` ("fed.*"). */
export const FedTable = Schema.Struct({
  standardDeduction: Status,
  brackets: Schema.Struct({ single: Brackets, mfj: Brackets, hoh: Brackets, mfs: Brackets }),
  ssWageBase: Money,
  ssRate: Rate,
  medicareRate: Rate,
  seFactor: Rate,
  seMinimum: Money,
  addlMedicare: Schema.Struct({ rate: Rate, threshold: Status }),
  qbi: Schema.Struct({
    threshold: Status,
    phaseIn: Status,
    /** OBBBA (tax years after 2025): at least `amount` when QBI from businesses you materially participate in is `minQbi` or more. */
    minimum: Schema.optionalKey(Schema.Struct({ amount: Money, minQbi: Money })),
  }),
  /** Business standard mileage rate in cents per mile, from `from` (the 2026 rate changed on July 1). */
  mileage: Schema.Array(Schema.Struct({ from: Schema.String, cents: Money })),
  homeOfficeSimplified: Schema.Struct({ perSqft: Money, maxSqft: Money }),
  deMinimis: Money,
  safeHarbor: Schema.Struct({ current: Rate, prior: Schema.Finite, priorHighAgi: Schema.Finite, highAgi: Money, highAgiMfs: Money, minOwe: Money }),
  corpEstimateMin: Money,
});
export type FedTable = typeof FedTable.Type;

/** US tables/<year>.json (foreign-owned LLC obligations, treaty rates, C-corp rate, running costs in $, federal income / SE tax figures). */
export const UsTable = Schema.Struct({
  ...TaxTableBase.fields,
  form5472Penalty: Money,
  dueMonthDay: MonthDay,
  extendedMonthDay: MonthDay,
  delawareTax: Money,
  wyomingMin: Money,
  treatyRoyalty: Rate,
  defaultWithholding: Rate,
  nec1099: Money,
  corpRate: Rate,
  treatyDividend: Rate,
  costs: Schema.Struct({ llc: Money, ccorp: Money }),
  fed: FedTable,
  costsNote: Schema.optionalKey(Schema.String),
});
export type UsTable = typeof UsTable.Type;

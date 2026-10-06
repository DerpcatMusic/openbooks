import { Schema } from "effect";
import { TaxTableBase } from "@openbooks/schema";

const Rate = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));
const Money = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const MonthDay = Schema.String.check(Schema.isPattern(/^\d{2}-\d{2}$/));

/** US tables/<year>.json (foreign-owned LLC obligations, treaty rates, C-corp rate, running costs in $). */
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
  costsNote: Schema.optionalKey(Schema.String),
});
export type UsTable = typeof UsTable.Type;

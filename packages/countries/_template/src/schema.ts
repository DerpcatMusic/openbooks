import { Schema } from "effect";
import { TaxTableBase } from "@openbooks/schema";

export const XxTable = Schema.Struct({
  ...TaxTableBase.fields,
  brackets: Schema.Array(Schema.Tuple([Schema.NullOr(Schema.Finite), Schema.Finite])), // [upTo (null = ∞), rate]
});
export type XxTable = typeof XxTable.Type;

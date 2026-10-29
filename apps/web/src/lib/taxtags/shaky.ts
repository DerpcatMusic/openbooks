import type { DeductionRule } from "@openbooks/schema";

/** A rule we shouldn't present as settled: some field is unconfirmed, or it rests on practice / a circular rather than law. */
export const shaky = (r: DeductionRule) => (r.unverified?.length ?? 0) > 0 || r.confidence === "practice" || r.confidence === "circular";

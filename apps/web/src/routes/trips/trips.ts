// Small helpers of the Trips page (pure, so they run in plain Vitest).
import { daysBetween, type Trip } from "@openbooks/core";

export { uid } from "../invoices/invoices.ts";

/** Days from start to end inclusive; 0 when a date isn't a date or the end is before the start. */
export function daysOf(start: string, end: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return 0;
  return daysBetween(start, end) + 1;
}
/** A new trip starting and ending today: one day, no night, all business. */
export const defaultsFor = (start: string, end: string): Pick<Trip, "start" | "end" | "nights" | "businessDays"> => {
  const d = Math.max(1, daysOf(start, end));
  return { start, end, nights: d - 1, businessDays: d };
};

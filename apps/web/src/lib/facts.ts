// Person facts (doc _app/person, see person.ts): pure helpers, no app state, so they are unit-tested on their own.
import type { Facts, Person } from "@openbooks/core";

type Answer = Facts[string];

/** facts with k set (empty = removed, so the advisor asks again). */
export const withFact = (p: Person, k: string, v: Answer): Person => {
  const facts: Record<string, Answer> = { ...p.facts };
  if (v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v))) delete facts[k];
  else facts[k] = v;
  // the legacy twins (see normalizeFacts) must not outvote a new answer
  if (k === "dischargeDate") delete facts.discharge;
  if (k === "fullService" && facts.serviceMonths !== undefined && +facts.serviceMonths >= 23 !== v) delete facts.serviceMonths;
  if (k === "serviceMonths") {
    if (k in facts) facts.fullService = +facts.serviceMonths! >= 23;
    else delete facts.fullService;
  }
  return { ...p, facts };
};

/**
 * The playbook asks `dischargeDate` / `fullService`; the old 1301 profile (and the server's first-load merge) stored `discharge` /
 * `serviceMonths`. Fill the asked keys from those, so an answered question is never listed as open.
 */
export function normalizeFacts(f: Facts): Facts {
  const o: Record<string, Answer> = { ...f };
  if ((o.dischargeDate === undefined || o.dischargeDate === "") && o.discharge) o.dischargeDate = o.discharge;
  if (o.fullService === undefined && o.serviceMonths !== undefined && o.serviceMonths !== "") o.fullService = +o.serviceMonths >= 23;
  return o;
}
/** The 1301 profile fields that are really person facts (release date, months served): the person's answer wins over the profile. */
export function profileFromPerson<P extends Record<string, unknown>>(profile: P, f: Facts | undefined): P & { discharge?: string; serviceMonths?: number } {
  if (!f) return profile;
  const discharge = String(f.dischargeDate ?? f.discharge ?? "") || (profile.discharge as string | undefined);
  const months = f.serviceMonths !== undefined && f.serviceMonths !== "" ? +f.serviceMonths : (profile.serviceMonths as number | undefined);
  return { ...profile, ...(discharge ? { discharge } : {}), ...(months !== undefined ? { serviceMonths: months } : {}) };
}
/** An answer as the advisor asks it (legacy keys mapped, see normalizeFacts). */
export const answerOf = (f: Facts, k: string): Answer => normalizeFacts(f)[k];

import { expect, test } from "vitest";
import { answerOf, normalizeFacts, profileFromPerson, withFact } from "./facts.ts";

test("legacy discharge/serviceMonths answer the playbook's dischargeDate/fullService; new answers win", () => {
  const old = { discharge: "2024-03-01", serviceMonths: 32 };
  expect(normalizeFacts(old)).toMatchObject({ dischargeDate: "2024-03-01", fullService: true });
  expect(answerOf(old, "dischargeDate")).toBe("2024-03-01");
  const p = { residence: "il", facts: old };
  const moved = withFact(p, "dischargeDate", "2025-01-01").facts;
  expect(moved.discharge).toBeUndefined();
  expect(profileFromPerson({ discharge: "2019-01-01", serviceMonths: 12 }, moved)).toMatchObject({ discharge: "2025-01-01", serviceMonths: 32 });
  expect(withFact(p, "fullService", false).facts.serviceMonths).toBeUndefined(); // 32 months contradicts "not full"
  expect(profileFromPerson({ discharge: "2019-01-01" }, {})).toEqual({ discharge: "2019-01-01" }); // nothing in /you: the profile
});

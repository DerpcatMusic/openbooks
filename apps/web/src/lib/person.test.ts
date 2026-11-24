import { expect, test } from "vite-plus/test";
import { zairExclusion } from "@openbooks/country-il";
import type { Entity } from "./api.ts";
import { answerOf, holdings, ilTreatmentKey, ilTreatmentOf, normalizeFacts, profileFromPerson, typeOf, withFact } from "./facts.ts";

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

test("2025 personal only -> 2026 personal plus US LLC: 2025 has zero foreign holdings and keeps osek-zair open", () => {
  const entities: Partial<Entity>[] = [
    { id: "il-personal", name: "Personal IL", kind: "il-osek-zair", types: { "2025": "osek-zair", "2026": "osek-zair" } },
    { id: "us-llc", name: "Dolmen Gate LLC", kind: "us-llc", formed: "2026-01-15", types: { "2026": "llc-disregarded" } },
  ];
  // 2025: LLC did not exist yet (both via formed date and types starting in 2026) -> zero foreign holdings
  expect(typeOf(entities[1]!, 2025)).toBeUndefined();
  expect(typeOf({ id: "us-llc-no-formed", kind: "us-llc", types: { "2026": "llc-disregarded" } }, 2025)).toBeUndefined();
  const h2025 = holdings(entities, 2025, "il", {});
  expect(h2025.filter((h) => h.foreign)).toEqual([]);
  expect(zairExclusion(h2025, [])).toEqual([]);

  // 2026 with Israeli treatment unresolved: LLC is reported as foreign holding (Form 150) with ilTreatment "unresolved", not silently transparent
  const h2026 = holdings(entities, 2026, "il", {});
  const foreign2026 = h2026.filter((h) => h.foreign);
  expect(foreign2026).toHaveLength(1);
  expect(foreign2026[0]!.ilTreatment).toBe("unresolved");
  expect(
    zairExclusion(
      h2026.filter((h) => !h.foreign),
      foreign2026,
    ),
  ).toEqual([]);

  // Once owner explicitly sets Israeli treatment to "transparent" for 2026, osek-zair is closed
  const facts2026 = { [ilTreatmentKey("us-llc", 2026)]: "transparent" as const };
  expect(ilTreatmentOf(facts2026, "us-llc", 2026, "transparent")).toBe("transparent");
  const h2026Resolved = holdings(entities, 2026, "il", facts2026);
  expect(
    zairExclusion(
      h2026Resolved.filter((h) => !h.foreign),
      h2026Resolved.filter((h) => h.foreign),
    ).map((b) => b.key),
  ).toEqual(["zair"]);
});

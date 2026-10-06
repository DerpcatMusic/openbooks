import { expect, test } from "vitest";
import { entityId } from "./setup.ts";

test("entity id: slug, Hebrew falls back to the kind, free suffix, ≤ 32 chars", () => {
  expect(entityId("Acme Audio LLC", "us-llc", [])).toBe("acme-audio-llc");
  expect(entityId("נועה כהן", "il-osek-zair", ["il", "il-2"])).toBe("il-3");
  expect(entityId("Café Ünïcode", "other", ["cafe-unicode"])).toBe("cafe-unicode-2");
  expect(entityId("x".repeat(60), "other", []).length).toBeLessThanOrEqual(32);
});

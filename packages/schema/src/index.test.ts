import { describe, expect, it } from "vite-plus/test";
import { ClassifyInput, ListTransactionsInput, Schema, StatementRow, jsonSchema, toolSchema } from "./index.ts";

describe("schema", () => {
  it("tool inputs are Standard Schema + Standard JSON Schema (what MCP SDK v2 registerTool takes)", () => {
    const s = toolSchema(ClassifyInput);
    expect(s["~standard"].vendor).toBe("effect");
    const ok = s["~standard"].validate({ ids: ["abc"], category: "expense:software" });
    expect(ok).toEqual({ value: { ids: ["abc"], category: "expense:software" } });
    const bad = s["~standard"].validate({ ids: [], category: "nope" }) as unknown as { issues: { path: unknown[] }[] };
    expect(bad.issues.map((i) => i.path)).toEqual([["ids"], ["category"]]);
    const js = s["~standard"].jsonSchema.input({ target: "draft-2020-12" });
    expect(js).toMatchObject({ type: "object", required: ["ids", "category"] });
  });
  it("JSON Schema for AI providers", () => {
    expect(jsonSchema(ListTransactionsInput)).toMatchObject({ type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 500 } } });
  });
  it("statement rows decode", () => {
    const r = { date: "2025-01-02", amount: 10.5, desc: "x", source: "bank", account: "One Zero", file: "a.pdf", page: 1, key: "k" };
    expect(Schema.decodeUnknownSync(StatementRow)(r)).toEqual(r);
    expect(() => Schema.decodeUnknownSync(StatementRow)({ ...r, date: "02/01/2025" })).toThrow();
  });
});

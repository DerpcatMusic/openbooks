import { describe, expect, it } from "vite-plus/test";
import { vatPeriods } from "./calendar.ts";
import { CLOSING_LENGTH, HEADER_LENGTH, RECORD_LENGTH, checkPcn874, parsePcn874, pcn874 } from "./pcn874.ts";
import { shekel, validVatId, vatReport, type VatSaleDoc } from "./vat.ts";

const jan = vatPeriods(2026, "monthly")[0]!;
const doc = (o: Partial<VatSaleDoc> & { id: string }): VatSaleDoc => ({ kind: "tax", number: o.id, status: "open", issued: "2026-01-10", items: [{ qty: 1, price: 1000 }], vat: 0.18, ...o });
const docs: VatSaleDoc[] = [
  doc({ id: "0001", issued: "2026-01-05", items: [{ qty: 1, price: 10000 }], customerVatId: "123456782", alloc: "123456789" }),
  doc({ id: "0002", issued: "2026-01-20", items: [{ qty: 2, price: 1000 }] }),
  doc({ id: "0003", issued: "2026-01-25" }),
  doc({ id: "0004", issued: "2026-01-28", items: [{ qty: 1, price: 4000 }], noVat: true, vat: 0 }),
  doc({ id: "0006", kind: "receipt", ref: "0001", refKind: "tax", issued: "2026-01-12", items: [{ qty: 1, price: 10000 }] }), // documents a payment only
  doc({ id: "0007", status: "draft" }),
  doc({ id: "0008", kind: "bill" }),
  doc({ id: "0005", issued: "2026-02-01" }), // next period
];
const inputs = [
  { id: "a", date: "2026-01-10", desc: "laptop", gross: 11800, vatReclaimable: 1800, rule: "il.depreciation", supplier: "Dell" },
  { id: "b", date: "2026-01-15", desc: "paper", gross: 590, vatReclaimable: 90 },
  { id: "c", date: "2026-01-20", desc: "car", gross: 1180, vatReclaimable: 120, rule: "il.vehicle.running" },
  { id: "d", date: "2026-01-21", desc: "bank fee", gross: 50, vatReclaimable: 0 },
];
const report = () => vatReport({ period: jan, docs, inputs, rate: 0.18, supplierIds: { Dell: "123456782" } });

describe("vat report", () => {
  it("checks the ID digit", () => {
    expect(validVatId("123456782")).toBe(true);
    expect(validVatId("514290550")).toBe(true);
    expect(validVatId("123456783")).toBe(false);
    expect(validVatId("12a")).toBe(false);
  });
  it("rounds to whole shekels away from zero", () => {
    expect([shekel(2.5), shekel(-2.5), shekel(0.49), shekel(-0.5)]).toEqual([3, -3, 0, -1]);
  });
  it("totals the period like the form", () => {
    const r = report();
    expect(r.issues).toEqual([]);
    expect(r.totals).toEqual({
      taxableSales: 13000,
      outputVat: 2340,
      zeroExempt: 4000,
      salesRecords: 3,
      otherInputsVat: 210,
      equipmentVat: 1800,
      inputRecords: 3,
      payable: 330,
    });
    expect(r.lines.map((l) => l.type)).toEqual(["S", "Y", "L", "T", "K", "K"]);
    expect(r.due).toEqual({ statutory: "2026-02-15", online: "2026-02-19", detailed: "2026-02-23" }); // 15 Feb 2026 is a Sunday
  });
  it("credits are negative and a refund comes out negative", () => {
    const r = vatReport({ period: jan, docs: [doc({ id: "9", items: [{ qty: 1, price: -1000 }], customerVatId: "123456782" })], inputs, rate: 0.18, supplierIds: { Dell: "123456782" } });
    expect(r.totals.outputVat).toBe(-180);
    expect(r.totals.payable).toBe(-180 - 210 - 1800);
    const f = pcn874({ vatId: "514290543", report: r, created: "2026-02-03" });
    expect(f.split("\r\n")[1]).toBe("S123456782202601100000000000009000000180-0000001000000000000");
    expect(checkPcn874(f)).toEqual([]);
  });
  it("flags what the Tax Authority will reject", () => {
    const r = vatReport({
      period: jan,
      docs: [doc({ id: "1", items: [{ qty: 1, price: 6000 }] }), doc({ id: "2", customerVatId: "123456789" }), doc({ id: "3", items: [{ qty: 1, price: 12000 }], customerVatId: "123456782" }), doc({ id: "4", currency: "USD" })],
      inputs: [{ id: "x", date: "2026-01-02", desc: "bulk", gross: 59000, vatReclaimable: 9000 }],
      rate: 0.18,
    });
    expect(r.issues.map((i) => i.code).sort()).toEqual(["allocationNeeded", "badCustomerId", "customerIdNeeded", "noRate", "pettyCashOver"]);
  });
});

describe("PCN874 file", () => {
  const text = pcn874({ vatId: "514290543", report: report(), created: "2026-02-03" });
  const rows = text.split("\r\n");
  const header = ["O", "514290543", "202601", "1", "20260203", "+00000013000", "+000002340", "+00000000000", "+000000000", "000000003", "+00000004000", "+000000210", "+000001800", "000000003", "+00000000330"].join("");
  const rec = (...f: string[]) => f.join("");
  it("is fixed width", () => {
    expect(rows.length).toBe(1 + 6 + 1 + 1);
    expect(rows[0]!.length).toBe(HEADER_LENGTH);
    for (const r of rows.slice(1, 7)) expect(r.length).toBe(RECORD_LENGTH);
    expect(rows[7]!.length).toBe(CLOSING_LENGTH);
    expect(rows[8]).toBe("");
  });
  it("matches the golden file", () => {
    expect(rows.slice(0, 8)).toEqual([
      header,
      rec("S", "123456782", "20260105", "0000", "000000001", "000001800", "+", "0000010000", "123456789"),
      rec("Y", "999999999", "20260128", "0000", "000000004", "000000000", "+", "0000004000", "000000000"),
      rec("L", "000000000", "20260131", "0000", "000000002", "000000540", "+", "0000003000", "000000000"),
      rec("T", "123456782", "20260110", "0000", "000000000", "000001800", "+", "0000010000", "000000000"),
      rec("K", "000000000", "20260115", "0000", "000000001", "000000090", "+", "0000000500", "000000000"),
      rec("K", "000000000", "20260120", "0000", "000000001", "000000120", "+", "0000001000", "000000000"),
      "X514290543",
    ]);
  });
  it("reads back and is self-consistent", () => {
    const p = parsePcn874(text);
    expect(p.header).toMatchObject({ vatId: "514290543", month: "202601", payable: 330, equipmentVat: 1800, salesRecords: 3 });
    expect(p.records.length).toBe(6);
    expect(checkPcn874(text)).toEqual([]);
    expect(checkPcn874(text.replace("+000002340", "+000002341"))).not.toEqual([]);
  });
  it("uses the period's last month for a bimonthly filer", () => {
    const r = vatReport({ period: vatPeriods(2026, "bimonthly")[0]!, docs, inputs, rate: 0.18, supplierIds: { Dell: "123456782" } });
    expect(pcn874({ vatId: "514290543", report: r, created: "2026-03-01" }).slice(10, 16)).toBe("202602");
  });
  it("rejects a bad business number", () => {
    expect(() => pcn874({ vatId: "x", report: report(), created: "2026-02-03" })).toThrow();
  });
});

describe("vat issues carry values, not English sentences", () => {
  it("a receipt's issue names its number and flags the kind; the UI writes 'receipt N' itself", () => {
    const r = vatReport({
      period: jan,
      docs: [doc({ id: "0009", kind: "receipt", customerVatId: "123456783" }), doc({ id: "0010", customerVatId: "123456783" })],
      inputs: [],
      rate: 0.18,
    });
    expect(r.issues.filter((i) => i.code === "badCustomerId")).toEqual([
      { level: "warn", code: "badCustomerId", ref: "0009", receipt: true },
      { level: "warn", code: "badCustomerId", ref: "0010", receipt: false },
    ]);
    expect(r.lines.map((l) => [l.doc, l.receipt])).toEqual([["0009", true], ["0010", false]]);
  });
});

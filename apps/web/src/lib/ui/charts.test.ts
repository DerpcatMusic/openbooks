import { expect, test } from "vite-plus/test";
import { sankey, sankeyHubs, topN, type FlowItem } from "./sankey.ts";
import { hubFlowData } from "../home/flow.ts";
import { squarify } from "./treemap.ts";
import { breakdown, netSeries, rangeStart } from "./networth.ts";

const it = (key: string, value: number): FlowItem => ({ key, label: key, value, color: "red" });
const meta = {
  mid: { key: "mid", label: "In", color: "x" },
  surplus: { key: "~surplus", label: "S", color: "x" },
  deficit: { key: "~deficit", label: "D", color: "x" },
};
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

function conserves(r: ReturnType<typeof sankey>) {
  const mid = r.nodes.find((n) => n.col === 1)!;
  const sum = (c: number) => r.nodes.filter((n) => n.col === c).reduce((a, n) => a + n.value, 0);
  near(sum(0), mid.value);
  near(sum(2), mid.value);
  // every link is as thick as its outer node, links in and out of the middle tile its bar exactly with no gap
  for (const side of [0, 2]) {
    const ls = r.links.filter((l) => (side === 0 ? l.to : l.from) === mid);
    near(
      ls.reduce((a, l) => a + l.w, 0),
      mid.h,
    );
    let y = mid.y;
    for (const l of ls) (near(side === 0 ? l.y1 : l.y0, y), (y += l.w));
  }
  for (const l of r.links) near(l.w, (l.from.col === 0 ? l.from : l.to).h);
  // outer nodes in a column never overlap and stay inside the chart
  for (const c of [0, 2]) {
    const ns = r.nodes.filter((n) => n.col === c);
    for (let i = 1; i < ns.length; i++) expect(ns[i]!.y).toBeGreaterThanOrEqual(ns[i - 1]!.y + ns[i - 1]!.h - 1e-6);
  }
  for (const n of r.nodes) expect(n.y >= -1e-6 && n.y + n.h <= 300 + 1e-6).toBe(true);
}

test("sankey: surplus balances more in than out; every column sums to the middle", () => {
  const r = sankey([it("a", 600), it("b", 400)], [it("x", 500), it("y", 200), it("z", 1)], { width: 600, height: 300, ...meta });
  expect(r.total).toBe(1000);
  expect(r.nodes.find((n) => n.key === "~surplus")?.value).toBe(299);
  conserves(r);
  // the tiny node still gets a label slot: its centre is at least minSlot from its neighbour's
  const R = r.nodes.filter((n) => n.col === 2);
  for (let i = 1; i < R.length; i++) expect(R[i]!.cy - R[i - 1]!.cy).toBeGreaterThanOrEqual(34);
});

test("sankey: deficit when more goes out than came in; nothing in or out is empty", () => {
  const r = sankey([it("a", 100)], [it("x", 150), it("y", 50)], { width: 400, height: 300, ...meta });
  expect(r.nodes.filter((n) => n.col === 0).map((n) => [n.key, n.value])).toEqual([
    ["a", 100],
    ["~deficit", 100],
  ]);
  conserves(r);
  expect(sankey([], [], { width: 400, height: 300, ...meta }).nodes).toEqual([]);
});

test("topN folds the tail into Other", () => {
  expect(topN([it("a", 5), it("b", 4), it("c", 3), it("d", 2), it("e", 0)], 3, { key: "o", label: "O", color: "g" }).map((i) => [i.key, i.value])).toEqual([
    ["a", 5],
    ["b", 4],
    ["o", 5],
  ]);
});

test("treemap: areas proportional to values, no overlaps, fills the box", () => {
  const vals = [500, 260, 140, 90, 60, 30, 12, 5, 2, 1].map((value, i) => ({ value, key: i }));
  const box = { x: 10, y: 20, w: 640, h: 360 };
  const ts = squarify(vals, box);
  const total = vals.reduce((a, v) => a + v.value, 0);
  expect(ts).toHaveLength(vals.length);
  for (const t of ts) {
    near(t.w * t.h, (t.item.value / total) * box.w * box.h);
    expect(t.x >= box.x - 1e-6 && t.y >= box.y - 1e-6 && t.x + t.w <= box.x + box.w + 1e-6 && t.y + t.h <= box.y + box.h + 1e-6).toBe(true);
  }
  for (let i = 0; i < ts.length; i++)
    for (let j = i + 1; j < ts.length; j++) {
      const a = ts[i]!,
        b = ts[j]!;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
        oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      expect(ox <= 1e-6 || oy <= 1e-6).toBe(true);
    }
  // squarified: no sliver worse than 1:8 for this spread of values
  for (const t of ts.slice(0, 6)) expect(Math.max(t.w / t.h, t.h / t.w)).toBeLessThan(8);
  expect(squarify([{ value: 0 }], box)).toEqual([]);
});

test("net worth: liabilities subtract whatever their sign, ranges, breakdown by entity", () => {
  const d = {
    currency: "ILS",
    dates: ["2026-01-01", "2026-01-02"],
    series: [
      { entity: "a", account: "Bank", currency: "ILS", liability: false, values: [100, 200] },
      { entity: "a", account: "Card", currency: "ILS", liability: true, values: [30, -40] },
      { entity: "b", account: "Wise", currency: "USD", liability: false, values: [0, 50] },
    ],
    missing: [],
  };
  expect(netSeries(d)).toEqual([70, 210]);
  expect(breakdown(d, 0)).toEqual([
    {
      entity: "a",
      total: 70,
      accounts: [
        { account: "Bank", value: 100, liability: false },
        { account: "Card", value: -30, liability: true },
      ],
    },
  ]);
  expect(rangeStart("3m", "2026-05-31")).toBe("2026-02-28");
  expect(rangeStart("ytd", "2026-05-31")).toBe("2026-01-01");
  expect(rangeStart("all", "2026-05-31")).toBe("");
});

test("sankeyHubs & hubFlowData: combined multi-bank subtrees conserve flow and expand child accounts", () => {
  const rows = [
    { entity: "llc", entityName: "LLC", flag: "🇺🇸", account: "Mercury Checking", category: "revenue:sales", desc: "Polar", amount: 1000 },
    { entity: "llc", entityName: "LLC", flag: "🇺🇸", account: "Mercury Credit", category: "expense:software", desc: "AWS", amount: -300 },
    { entity: "llc", entityName: "LLC", flag: "🇺🇸", account: "Mercury Credit", category: "expense:software", desc: "AWS Refund", amount: 50 },
    { entity: "llc", entityName: "LLC", flag: "🇺🇸", account: "Mercury Checking", category: "revenue:sales", desc: "Gumroad", amount: 200 },
    { entity: "llc", entityName: "LLC", flag: "🇺🇸", account: "Wise USD", category: "revenue:sales", desc: "Client", amount: 300 },
    { entity: "il", entityName: "IL", flag: "🇮🇱", account: "One Zero", category: "business:royalties", desc: "ASCAP", amount: 500 },
  ];
  // Collapsed: two entity hubs, LLC expandable because it has 2 accounts
  const collapsed = hubFlowData(rows, { scope: "all", mode: "account", label: (k) => k, other: "Other", expandedEntities: new Set() });
  expect(collapsed.hubs.map((h) => [h.key, h.expandable])).toEqual([
    ["ent:llc", true],
    ["ent:il", false],
  ]);
  // Refund ($50) nets against AWS software ($300) → $250 outflow, $0 bogus income
  expect(collapsed.totalIn).toBe(2000);
  expect(collapsed.totalOut).toBe(250);

  // Expanded LLC: splits into its banks; the card's spending runs through Mercury Checking (which pays the card), never its own hub
  const expanded = hubFlowData(rows, { scope: "all", mode: "account", label: (k) => k, other: "Other", expandedEntities: new Set(["llc"]) });
  expect(expanded.hubs.map((h) => [h.key, !!h.isChild])).toEqual([
    ["acct:llc:Mercury Checking", true],
    ["ent:il", false],
    ["acct:llc:Wise USD", true],
  ]);
  expect(expanded.edges.find((e) => e.to === "out:expense:software")).toMatchObject({ from: "acct:llc:Mercury Checking", value: 250 });

  // a chargeback landing in another bank than its revenue still counts, as money out of that bank
  const cb = hubFlowData(
    [...rows, { entity: "llc", entityName: "LLC", flag: "🇺🇸", account: "Wise USD", category: "revenue:sales", desc: "Chargeback", amount: -400 }],
    { scope: "all", mode: "account", label: (k) => k, other: "Other", expandedEntities: new Set(["llc"]) },
  );
  expect(cb.totalIn - cb.totalOut).toBe(2000 - 250 - 400);
  // ...and nets against the income itself, so expanding a business never changes its totals
  const cbFlat = hubFlowData(
    [...rows, { entity: "llc", entityName: "LLC", flag: "🇺🇸", account: "Wise USD", category: "revenue:sales", desc: "Chargeback", amount: -400 }],
    {
      scope: "all",
      mode: "account",
      label: (k) => k,
      other: "Other",
      expandedEntities: new Set(),
    },
  );
  expect([cb.totalIn, cb.totalOut]).toEqual([cbFlat.totalIn, cbFlat.totalOut]);
  expect(cb.totalIn).toBeCloseTo(1600);

  const lay = sankeyHubs(expanded.sources, expanded.hubs, expanded.targets, expanded.edges, {
    width: 720,
    height: 360,
    surplus: meta.surplus,
    deficit: meta.deficit,
  });
  expect(lay.total).toBeGreaterThan(0);
  const sumCol = (c: number) => lay.nodes.filter((n) => n.col === c).reduce((a, n) => a + n.value, 0);
  near(sumCol(0), lay.total);
  near(sumCol(1), lay.total);
  near(sumCol(2), lay.total);
});

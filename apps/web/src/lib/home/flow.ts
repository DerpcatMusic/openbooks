// Sankey data for a period: money in by source → bank/business hubs (with expandable child accounts) → money out by destination.
// Which rows count as money in / out is core's cashIn / cashOut (transfers, owner and own money left out), asked one row at a time
// so this never drifts from the totals shown elsewhere.
import { group, inSide, isCard, isFlow, payerOf } from "@openbooks/core";
import type { Txn } from "@openbooks/schema";
import { topN, type FlowHubEdge, type FlowItem } from "../ui/sankey.ts";

export type FlowMode = "account" | "payer";
const IN = ["var(--color-s3)", "var(--color-s1)", "var(--color-s5)", "var(--color-s4)", "var(--color-s6)", "var(--color-s6)"];
const OUT = ["var(--color-s2)", "var(--color-s4)", "var(--color-s5)", "var(--color-s1)", "var(--color-s3)", "var(--color-s6)", "var(--color-s6)"];
const HUB_COLORS = ["var(--color-s1)", "var(--color-s3)", "var(--color-s4)", "var(--color-s5)", "var(--color-s2)", "var(--color-s6)"];

export const counts = (t: Txn) => t.amount !== 0 && isFlow(t.category);

const EXPENSE_GROUPS = new Set(["expense", "cogs"]);

/** Sources and targets, each the largest few plus "Other". Expense refunds net against their expense category rather than inflating income. */
export function flowData(ts: readonly Txn[], mode: FlowMode, label: (account: string) => string, other: string) {
  const inn = new Map<string, number>(),
    out = new Map<string, number>();
  // When grouping by account, net refunds on expense/cogs categories so a refunded software charge reduces that expense rather than appearing as income.
  if (mode === "account") {
    const netByCat = new Map<string, number>();
    for (const t of ts) {
      if (!counts(t)) continue;
      if (EXPENSE_GROUPS.has(group(t.category))) {
        netByCat.set(t.category, (netByCat.get(t.category) ?? 0) + t.amount);
      } else {
        // by row type (core inSide): a chargeback shrinks its income, never adds to spending
        const isIn = inSide(t),
          m = isIn ? inn : out;
        m.set(t.category, (m.get(t.category) ?? 0) + (isIn ? t.amount : -t.amount));
      }
    }
    for (const [cat, net] of netByCat) {
      if (net < -0.005) out.set(cat, (out.get(cat) ?? 0) + Math.abs(net));
      else if (net > 0.005) inn.set(cat, (inn.get(cat) ?? 0) + net);
    }
  } else {
    for (const t of ts) {
      if (!counts(t)) continue;
      const k = payerOf(t) || "?",
        isIn = inSide(t),
        m = isIn ? inn : out;
      m.set(k, (m.get(k) ?? 0) + (isIn ? t.amount : -t.amount));
    }
  }
  // keys "in:<k>" / "out:<k>": an account can be on both sides (a refund); `flowKey` gives <k> back
  const items = (side: string, m: Map<string, number>, colors: string[], n: number) =>
    topN(
      [...m].filter(([, v]) => v > 0.005).map(([k, value]) => ({ key: `${side}:${k}`, label: mode === "account" ? label(k) : k, value, color: "" })),
      n,
      { key: `${side}:~other`, label: other, color: "" },
    ).map((x, i) => ({ ...x, color: x.key.endsWith(":~other") ? "var(--color-s6)" : colors[i % colors.length]! }) as FlowItem);
  return { sources: items("in", inn, IN, 5), targets: items("out", out, OUT, 7) };
}

export interface HubFlowTxn {
  entity: string;
  entityName: string;
  flag: string;
  account: string;
  category: string;
  desc: string;
  who?: string;
  amount: number;
}

/**
 * Build a multi-hub Sankey flow (sources → business/bank hubs or expanded child accounts → spending targets).
 * - In "all" scope: each business is a hub in the middle; clicking a business expands it into its child bank/card accounts.
 * - In "this" scope: each bank/card account is its own hub in the middle.
 */
export function hubFlowData(
  rawRows: readonly HubFlowTxn[],
  opts: {
    scope: "this" | "all";
    mode: FlowMode;
    label: (account: string) => string;
    other: string;
    expandedEntities: ReadonlySet<string>;
  },
) {
  const { scope, mode, label, other, expandedEntities } = opts;
  // A card is paid off from the bank, so its spending flows through the business's main bank account, not a second "source".
  const bankUse = new Map<string, Map<string, number>>();
  for (const r of rawRows) {
    if (isCard(r.account)) continue;
    let m = bankUse.get(r.entity);
    if (!m) bankUse.set(r.entity, (m = new Map()));
    m.set(r.account, (m.get(r.account) ?? 0) + 1);
  }
  const bankOf = (entity: string) => [...(bankUse.get(entity) ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0];
  const rows = rawRows.map((r) => (isCard(r.account) && bankOf(r.entity) ? { ...r, account: bankOf(r.entity)! } : r));

  // Count distinct accounts per entity so we know which entity hubs can expand into child subtrees.
  const entityAccounts = new Map<string, Set<string>>();
  const entityMeta = new Map<string, { name: string; flag: string }>();
  for (const r of rows) {
    let set = entityAccounts.get(r.entity);
    if (!set) entityAccounts.set(r.entity, (set = new Set()));
    set.add(r.account);
    if (!entityMeta.has(r.entity)) entityMeta.set(r.entity, { name: r.entityName, flag: r.flag });
  }

  // Decide the middle hub key for each row (either entity hub or child account hub).
  const hubKeyOf = (r: HubFlowTxn) => {
    if (scope === "this") return `acct:${r.entity}:${r.account}`;
    const accts = entityAccounts.get(r.entity);
    if (expandedEntities.has(r.entity) && (accts?.size ?? 0) > 1) return `acct:${r.entity}:${r.account}`;
    return `ent:${r.entity}`;
  };

  // Net expense refunds within each (hub, category) when in account mode so refunds shrink expenses instead of inflating income.
  interface NormFlow {
    side: "in" | "out";
    rawKey: string;
    hubKey: string;
    amount: number;
  }
  const raw: NormFlow[] = [];
  if (mode === "account") {
    const expNet = new Map<string, { hubKey: string; cat: string; net: number }>();
    for (const r of rows) {
      const hubKey = hubKeyOf(r);
      if (EXPENSE_GROUPS.has(group(r.category))) {
        const k = `${hubKey}|${r.category}`;
        const cur = expNet.get(k);
        if (cur) cur.net += r.amount;
        else expNet.set(k, { hubKey, cat: r.category, net: r.amount });
      } else if (Math.abs(r.amount) > 0.005) {
        const isIn = inSide(r);
        raw.push({ side: isIn ? "in" : "out", rawKey: r.category, hubKey, amount: isIn ? r.amount : -r.amount });
      }
    }
    for (const { hubKey, cat, net } of expNet.values()) {
      if (net < -0.005) raw.push({ side: "out", rawKey: cat, hubKey, amount: Math.abs(net) });
      else if (net > 0.005) raw.push({ side: "in", rawKey: cat, hubKey, amount: net });
    }
  } else {
    for (const r of rows) {
      if (Math.abs(r.amount) <= 0.005) continue;
      const k = payerOf({ desc: r.desc, who: r.who } as Txn) || "?",
        isIn = inSide(r);
      raw.push({ side: isIn ? "in" : "out", rawKey: k, hubKey: hubKeyOf(r), amount: isIn ? r.amount : -r.amount });
    }
  }

  // a refund or chargeback is signed against its side; net per (side, key, hub) and drop what nets to nothing
  const net = new Map<string, NormFlow>();
  for (const n of raw) {
    const k = `${n.side}|${n.rawKey}|${n.hubKey}`,
      cur = net.get(k);
    if (cur) cur.amount += n.amount;
    else net.set(k, { ...n });
  }
  const normalized = [...net.values()].filter((n) => n.amount > 0.005);

  // Build top-N sources and targets
  const inn = new Map<string, number>(),
    out = new Map<string, number>();
  for (const n of normalized) {
    const m = n.side === "in" ? inn : out;
    m.set(n.rawKey, (m.get(n.rawKey) ?? 0) + n.amount);
  }
  const mkSide = (side: "in" | "out", m: Map<string, number>, colors: string[], maxN: number) =>
    topN(
      [...m].map(([k, value]) => ({ key: `${side}:${k}`, label: mode === "account" ? label(k) : k, value, color: "" })),
      maxN,
      { key: `${side}:~other`, label: other, color: "" },
    ).map((x, i) => ({ ...x, color: x.key.endsWith(":~other") ? "var(--color-s6)" : colors[i % colors.length]! }) as FlowItem);

  const sources = mkSide("in", inn, IN, 5);
  const targets = mkSide("out", out, OUT, 7);
  const keptSrc = new Set(sources.map((s) => s.key));
  const keptDst = new Set(targets.map((d) => d.key));

  // Build hub nodes and folded edges
  const edgeMap = new Map<string, FlowHubEdge>();
  const hubIn = new Map<string, number>(),
    hubOut = new Map<string, number>();
  const hubKeysOrdered: string[] = [];
  const seenHub = new Set<string>();

  for (const n of normalized) {
    if (!seenHub.has(n.hubKey)) {
      seenHub.add(n.hubKey);
      hubKeysOrdered.push(n.hubKey);
    }
    if (n.side === "in") {
      const fromKey = keptSrc.has(`in:${n.rawKey}`) ? `in:${n.rawKey}` : "in:~other";
      const ek = `${fromKey}→${n.hubKey}`;
      const cur = edgeMap.get(ek);
      if (cur) cur.value += n.amount;
      else edgeMap.set(ek, { from: fromKey, to: n.hubKey, value: n.amount });
      hubIn.set(n.hubKey, (hubIn.get(n.hubKey) ?? 0) + n.amount);
    } else {
      const toKey = keptDst.has(`out:${n.rawKey}`) ? `out:${n.rawKey}` : "out:~other";
      const ek = `${n.hubKey}→${toKey}`;
      const cur = edgeMap.get(ek);
      if (cur) cur.value += n.amount;
      else edgeMap.set(ek, { from: n.hubKey, to: toKey, value: n.amount });
      hubOut.set(n.hubKey, (hubOut.get(n.hubKey) ?? 0) + n.amount);
    }
  }

  // Assign stable color per entity so a business and its expanded child accounts share the same color family.
  const entityOrder = [...entityMeta.keys()];
  const entityColor = (entId: string) => HUB_COLORS[Math.max(0, entityOrder.indexOf(entId)) % HUB_COLORS.length]!;

  const hubs: FlowItem[] = hubKeysOrdered
    .map((key) => {
      const val = Math.max(hubIn.get(key) ?? 0, hubOut.get(key) ?? 0);
      if (key.startsWith("ent:")) {
        const entId = key.slice(4);
        const meta = entityMeta.get(entId);
        const count = entityAccounts.get(entId)?.size ?? 0;
        return {
          key,
          label: `${meta?.flag ? `${meta.flag} ` : ""}${meta?.name ?? entId}`,
          sub: count > 1 ? `${count} accts` : [...(entityAccounts.get(entId) ?? [])][0],
          value: val,
          color: entityColor(entId),
          expandable: count > 1,
        } satisfies FlowItem;
      }
      const rest = key.slice(5);
      const sep = rest.indexOf(":");
      const entId = rest.slice(0, sep);
      const acct = rest.slice(sep + 1);
      const meta = entityMeta.get(entId);
      const isChild = scope === "all" && expandedEntities.has(entId);
      return {
        key,
        label: acct,
        sub: isChild ? meta?.name : undefined,
        value: val,
        color: scope === "this" ? HUB_COLORS[hubKeysOrdered.indexOf(key) % HUB_COLORS.length]! : entityColor(entId),
        isChild,
        parentKey: isChild ? `ent:${entId}` : undefined,
      } satisfies FlowItem;
    })
    .filter((h) => h.value > 0)
    .sort((a, b) => {
      // Keep children of the same expanded entity grouped together
      const pa = a.parentKey ?? a.key;
      const pb = b.parentKey ?? b.key;
      if (pa === pb) return b.value - a.value;
      return b.value - a.value;
    });

  return {
    sources,
    hubs,
    targets,
    edges: [...edgeMap.values()],
    totalIn: sources.reduce((a, s) => a + s.value, 0),
    totalOut: targets.reduce((a, d) => a + d.value, 0),
  };
}

/** The account or counterparty of a node key; null for Other, surplus, deficit and the middle. */
export const flowKey = (key: string) => {
  const k = key.slice(key.indexOf(":") + 1);
  return /^(in|out):/.test(key) && k !== "~other" ? k : null;
};

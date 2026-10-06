// The 16 tools of mcp_server.py, same names, inputs, structuredContent, annotations and confirmation rules (port; parity-tested
// against the Python server in apps/server/src/mcp.test.ts). Amounts round like Python (pyRound); labels are the English chart
// of accounts, as before: tool results feed models and MCP clients, the UI translates on its own.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  balances as coreBalances,
  cleanRules,
  classify as coreClassify,
  group,
  haystack,
  inRange,
  isCard,
  payerOf,
  plOf,
  pyRound,
  pyStr,
  TYPES,
} from "@openbooks/core";
import { handle as connectorHandle, status as connectorStatus } from "@openbooks/importers";
import { Books, taxTables } from "@openbooks/storage";
import type { EntityMeta, Txn } from "@openbooks/schema";
import { Effect, Schema } from "effect";
import { decodeArgs, defineTool, inputJsonSchema, type Needs, NeedsConfirm, type Tool, type ToolCtx, ToolError } from "./registry.ts";

const fail = (message: string) => Effect.fail(new ToolError({ message }));
const repr = (v: unknown) => (typeof v === "string" ? `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'` : String(v)); // Python !r for a str
/** round(n + 0, 2) or 0.0: Python rounding, no -0. */
export const r2 = (n: number) => pyRound(n + 0, 2) || 0;
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ---------- chart of accounts (mcp_server.py TYPES / NAMES / BASE) ----------
export const TYPE_LABELS: Record<string, string> = {
  revenue: "Revenue",
  business: "Business income",
  "other-income": "Other income",
  capital: "Savings & fund profits",
  cogs: "Cost of revenue",
  expense: "Operating expenses",
  equity: "Owner's equity",
  transfer: "Transfers",
  exempt: "Exempt (IDF pay & grants)",
  personal: "Personal, family, refunds",
  own: "Your own money moving",
  ask: "Uncategorized",
};
const NAMES: Record<string, string> = {
  "business:paypal": "PayPal",
  "business:youtube": "YouTube / Google",
  "business:music": "Distributors",
  "business:client": "Clients",
  "business:other": "Other business",
  "capital:child-savings": "Child savings plan",
  "exempt:idf-salary": "IDF pay",
  "own:bit-withdrawal": "bit → bank",
  "revenue:music-royalties": "Music Royalties",
  "revenue:plugin-sales": "Audio Plugin Sales",
  "revenue:patreon": "Patreon Membership Revenue",
  "revenue:services": "Services Revenue",
  "other-income:cashback": "Credit Card Rewards and Cashback",
  "cogs:ai-models": "AI Models and Inference",
  "cogs:hosting": "Hosting and Infrastructure",
  "cogs:platform-fees": "Platform Fees",
  "expense:advertising": "Advertising",
  "expense:software": "Software and Subscriptions",
  "expense:travel": "Airfare & Travel",
  "expense:phone-internet": "Utilities, Phone, and Internet",
  "expense:bank-fees": "Bank Fees",
  "expense:equipment": "Equipment & Supplies",
  "expense:meals": "Meals",
  "expense:professional": "Legal & Professional Services",
  "expense:games": "Games & Media (personal?)",
  "equity:owner": "Owner Contributions & Draws",
  "transfer:internal": "Transfers Between Accounts",
  ask: "Uncategorized",
};
const BASE: Record<string, string[]> = {
  "il-osek-zair": [
    "business:paypal",
    "business:youtube",
    "business:music",
    "business:client",
    "business:other",
    "capital:child-savings",
    "exempt:idf-salary",
    "personal:family",
    "personal:friends",
    "personal:refund",
    "personal:provident-fund",
    "own:savings",
    "own:transfer",
    "own:bit-withdrawal",
  ],
  "us-llc": Object.keys(NAMES).filter((k) => /^(revenue|other-income|cogs|expense|equity|transfer):/.test(k)),
};
const ACCOUNT_TYPES = Object.keys(TYPE_LABELS).filter((t) => t !== "ask");
const CATEGORY = new RegExp(`^(?:${ACCOUNT_TYPES.join("|")}):[a-z0-9][a-z0-9-]*$`);
/** Python str.capitalize(): first character upper, the rest lower. */
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
export const label = (c: string) => NAMES[c] ?? capitalize(((c.includes(":") ? c.split(":")[1] : c) || c).replace(/-/g, " "));

const checkCategory = (c: string, allowAsk = false) =>
  c === "ask" && allowAsk
    ? Effect.succeed(c)
    : CATEGORY.test(c)
      ? Effect.succeed(c)
      : fail(
          `category must be "type:name" with type in ${ACCOUNT_TYPES.join(", ")} and name in lowercase letters, digits and dashes (e.g. expense:software)${allowAsk ? ' or "ask"' : ""}; got ${repr(c)}`,
        );

// ---------- entity and ledger helpers ----------
type Entity = { id: string; meta: EntityMeta };
/** The entity a call works on: the app's (ctx) or args.entity, else the first one. */
export const entityOf = (args: { entity?: string | undefined }, ctx: Pick<ToolCtx, "entity">) =>
  Effect.gen(function* () {
    const es = yield* Books.use((b) => b.entities);
    const eid = ctx.entity || args.entity;
    if (!eid) {
      const first = es[0];
      if (!first) return yield* fail("No entities yet: create one in the app first");
      return entityOf$(first);
    }
    const m = es.find((x) => x.id === eid);
    if (!m) return yield* fail(`Unknown entity ${repr(eid)}; see list_entities`);
    return entityOf$(m);
  });
const entityOf$ = ({ id, ...meta }: { id: string } & EntityMeta): Entity => ({ id, meta });

const gone = (e: string) => () => new ToolError({ message: `Unknown entity ${repr(e)}; see list_entities` });
const ledgerOf = (e: Entity) => Books.use((b) => b.ledger(e.id)).pipe(Effect.mapError(gone(e.id)));
const docOf = <A>(e: Entity, name: string, fallback: A) => Books.use((b) => b.doc(e.id, name, fallback)).pipe(Effect.mapError(gone(e.id)));
const putDoc = (e: Entity, name: string, value: unknown) => Books.use((b) => b.putDoc(e.id, name, value)).pipe(Effect.mapError(gone(e.id)));
const rulesOf = (e: Entity) => Books.use((b) => b.rules(e.id)).pipe(Effect.mapError(gone(e.id)));
const setRules = (e: Entity, rs: readonly (readonly [string, string])[]) =>
  Books.use((b) => b.setRules(e.id, rs as [string, string][])).pipe(Effect.mapError(gone(e.id)));
const checksOf = (e: Entity) => Books.use((b) => b.checks(e.id)).pipe(Effect.mapError(gone(e.id)));

const slim = (t: Txn) => ({ ...t, amount: r2(t.amount), categoryLabel: label(t.category) });

/** Cash-basis P&L in mcp_server.py's shape: expenses positive; transfers, equity, personal, own and exempt money left out. */
export function pl(ts: readonly Txn[]) {
  const of = (k: string) => sum(ts.filter((t) => plOf(t.category) === k).map((t) => t.amount));
  const revenue = of("revenue"),
    cogs = -of("cogs"),
    opex = -of("expense"),
    other = of("other"),
    uncat = of("ask");
  const gross = revenue - cogs,
    operating = gross - opex;
  const raw = { revenue, cogs, gross, opex, operating, other, uncategorized: uncat, net: operating + other + uncat };
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, r2(v)])) as Record<keyof typeof raw, number>;
}
function byAccount(ts: readonly Txn[]) {
  const m = new Map<string, { account: string; label: string; amount: number; count: number }>();
  for (const t of ts) {
    const a = m.get(t.category) ?? { account: t.category, label: label(t.category), amount: 0, count: 0 };
    a.amount += t.amount;
    a.count++;
    m.set(t.category, a);
  }
  return [...m.values()].map((a) => ({ ...a, amount: r2(a.amount) })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/** Every bank/card account at the end of day `iso` (port of balances_at). */
export const balancesAt = (e: Entity, iso: string, txns?: readonly Txn[]) =>
  Effect.gen(function* () {
    const ts = txns ?? (yield* ledgerOf(e));
    const { checks } = yield* checksOf(e);
    return Object.fromEntries(Object.entries(coreBalances(ts, checks, iso)).map(([k, v]) => [k, r2(v)]));
  });

const findTxn = (e: Entity, id: string, txns: readonly Txn[]) => {
  const t = txns.find((x) => x.id === id);
  return t ? Effect.succeed(t) : fail(`No transaction ${repr(id)} in ${e.id}`);
};

const isoDate = (s: string, field: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)) : null;
  return d && +m![1]! >= 1 && d.getUTCMonth() === +m![2]! - 1 && d.getUTCDate() === +m![3]! ? Effect.succeed(s) : fail(`${field} must be a date YYYY-MM-DD`);
};
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// ---------- schemas (mcp_server.py's JSON Schema fragments) ----------
const pattern = (re: RegExp, description?: string) => {
  const s = Schema.String.check(Schema.isPattern(re));
  return description ? s.annotate({ description }) : s;
};
const ENTITY = { entity: Schema.optionalKey(pattern(/^[a-z0-9-]+$/u, "Entity id from list_entities. Default: the first entity.")) };
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const ID = pattern(/^[A-Za-z0-9-]{1,64}$/u);
const CAT_DESC = 'Ledger account "type:name", e.g. expense:software (see chart_of_accounts).';
const CONFIRM = Schema.optionalKey(
  Schema.Boolean.annotate({
    description:
      "Set true only after the user agreed to this change. Not needed (and ignored) when the client supports elicitation: the server asks the user itself.",
  }),
);
const FROM = Schema.optionalKey(pattern(PERIOD_RE, "Start, inclusive: YYYY-MM or YYYY-MM-DD"));
const TO = Schema.optionalKey(pattern(PERIOD_RE, "End, inclusive: YYYY-MM or YYYY-MM-DD"));
const input = <F extends Schema.Struct.Fields>(fields: F) => Schema.Struct({ ...fields, ...ENTITY });

// outputs (mcp_server.py OUT): every listed property required unless noted; nullable = Python opt()
const S = Schema.String,
  N = Schema.Number,
  I = Schema.Int,
  B = Schema.Boolean;
const opt = <T extends Schema.Top>(s: T) => Schema.NullOr(s);
const CUR = { currency: opt(S) };
const TXN = Schema.Struct({ id: S, date: S, amount: N, desc: S, account: S, source: S, category: S, categoryLabel: S, why: S });
const PLT = { revenue: N, cogs: N, gross: N, opex: N, operating: N, other: N, uncategorized: N, net: N };
const RULES = Schema.Array(Schema.Tuple([S, S]));
const CONN = Schema.Struct({
  provider: S,
  type: Schema.optionalKey(S),
  connected: B,
  lastSync: Schema.optionalKey(opt(S)),
  lastError: Schema.optionalKey(opt(S)),
  file: Schema.optionalKey(opt(S)),
});

// ---------- tools ----------
const UI_URI = "ui://openbooks/pnl";

const list_entities = defineTool({
  name: "list_entities",
  title: { en: "List entities", he: "רשימת עסקים" },
  description: "List the businesses (entities) in these books: id, name, kind (us-llc, il-osek-zair, ...) and currency.",
  kind: "read",
  input: input({}),
  output: Schema.Struct({
    entities: Schema.Array(Schema.Struct({ id: S, name: opt(S), short: opt(S), kind: opt(S), currency: opt(S), flag: opt(S) })),
  }),
  run: () =>
    Books.use((b) => b.entities).pipe(
      Effect.map((es) => ({
        entities: es.map((m) => ({
          id: m.id,
          name: m.name ?? null,
          short: m.short ?? null,
          kind: m.kind ?? null,
          currency: m.currency ?? null,
          flag: m.flag ?? null,
        })),
      })),
    ),
});

const list_transactions = defineTool({
  name: "list_transactions",
  title: { en: "List transactions", he: "רשימת תנועות" },
  description:
    'List ledger transactions, newest first, with their ledger account (category; "ask" = uncategorized) and why it was assigned (manual, the matching rule text, or journal). Amounts: positive = money in.',
  kind: "read",
  input: input({
    from: FROM,
    to: TO,
    account: Schema.optionalKey(S.annotate({ description: "Bank/card account name exactly as in transactions (e.g. from balances)" })),
    category: Schema.optionalKey(S.annotate({ description: 'Ledger account "type:name", or just a type (e.g. expense) for all its accounts' })),
    uncategorized: Schema.optionalKey(B.annotate({ description: 'Only transactions that need review (category "ask")' })),
    search: Schema.optionalKey(
      S.check(Schema.isMaxLength(200)).annotate({ description: "Case-insensitive text in description, memo, bank category, account or category" }),
    ),
    limit: Schema.optionalKey(I.check(Schema.isBetween({ minimum: 1, maximum: 500 })).annotate({ default: 50 })),
    offset: Schema.optionalKey(I.check(Schema.isGreaterThanOrEqualTo(0)).annotate({ default: 0 })),
  }),
  output: Schema.Struct({ ...CUR, total: I, offset: I, limit: I, sum: N, transactions: Schema.Array(TXN) }),
  run: (a, ctx) =>
    Effect.gen(function* () {
      const e = yield* entityOf(a, ctx);
      const q = (a.search ?? "").toLowerCase(),
        cat = a.category;
      const ts = (yield* ledgerOf(e)).filter(
        (t) =>
          inRange(t.date, a.from, a.to) &&
          (!a.account || t.account === a.account) &&
          (!cat || t.category === cat || (!cat.includes(":") && group(t.category) === cat)) &&
          (!a.uncategorized || t.category === "ask") &&
          (!q || `${t.desc} ${t.memo ?? ""} ${t.mcat ?? ""} ${t.account} ${t.category}`.toLowerCase().includes(q)),
      );
      ts.reverse(); // newest first
      const off = a.offset ?? 0,
        lim = a.limit ?? 50;
      return {
        currency: e.meta.currency ?? null,
        total: ts.length,
        offset: off,
        limit: lim,
        sum: r2(sum(ts.map((t) => t.amount))),
        transactions: ts.slice(off, off + lim).map(slim),
      };
    }),
});

const get_transaction = defineTool({
  name: "get_transaction",
  title: { en: "Get transaction", he: "פרטי תנועה" },
  description: "One transaction with everything known about it, including source statement file/page and attached receipt file names.",
  kind: "read",
  input: input({ id: ID }),
  output: Schema.Struct({ ...CUR, transaction: TXN, attachments: Schema.Array(S) }),
  run: (a, ctx) =>
    Effect.gen(function* () {
      const e = yield* entityOf(a, ctx);
      const t = yield* findTxn(e, a.id, yield* ledgerOf(e));
      const home = yield* Books.use((b) => Effect.succeed(b.home));
      let attachments: string[] = [];
      try {
        attachments = readdirSync(join(home, e.id, "attachments", t.id)).sort();
      } catch {
        /* none */
      }
      return { currency: e.meta.currency ?? null, transaction: slim(t), attachments };
    }),
});

const profit_and_loss = defineTool({
  name: "profit_and_loss",
  title: { en: "Profit and loss", he: "רווח והפסד" },
  description:
    "Cash-basis profit and loss: revenue, cost of revenue, gross profit, operating expenses, operating income, other income, uncategorized, net. Transfers, owner equity, personal, own-money and exempt transactions are excluded. Expenses are positive numbers. Clients with MCP Apps show a monthly chart (best with group_by month).",
  kind: "read",
  input: input({
    from: FROM,
    to: TO,
    group_by: Schema.optionalKey(
      Schema.Literals(["account", "month"]).annotate({ default: "account", description: "Lines per ledger account, or a P&L per month" }),
    ),
  }),
  output: Schema.Struct({
    entity: S,
    ...CUR,
    from: opt(S),
    to: opt(S),
    basis: S,
    total: Schema.Struct(PLT),
    months: Schema.optionalKey(Schema.Array(Schema.Struct({ month: S, ...PLT }))),
    lines: Schema.optionalKey(Schema.Record(S, Schema.Array(Schema.Struct({ account: S, label: S, amount: N, count: I })))),
  }),
  meta: { ui: { resourceUri: UI_URI } }, // MCP Apps: hosts render ui://openbooks/pnl with this tool's result
  run: (a, ctx) =>
    Effect.gen(function* () {
      const e = yield* entityOf(a, ctx);
      const ts = (yield* ledgerOf(e)).filter((t) => inRange(t.date, a.from, a.to));
      const base = { entity: e.id, currency: e.meta.currency ?? null, from: a.from ?? null, to: a.to ?? null, basis: "cash", total: pl(ts) };
      if ((a.group_by ?? "account") === "month") {
        const months = [...new Set(ts.map((t) => t.date.slice(0, 7)))].sort();
        return { ...base, months: months.map((m) => ({ month: m, ...pl(ts.filter((t) => t.date.slice(0, 7) === m)) })) };
      }
      return {
        ...base,
        lines: Object.fromEntries(["revenue", "cogs", "expense", "other", "ask"].map((k) => [k, byAccount(ts.filter((t) => plOf(t.category) === k))])),
      };
    }),
});

const balances = defineTool({
  name: "balances",
  title: { en: "Balances", he: "יתרות" },
  description: "Balance of every bank and card account at the end of a day (cash total excludes credit cards).",
  kind: "read",
  input: input({ date: Schema.optionalKey(pattern(DATE_RE, "YYYY-MM-DD, default today")) }),
  output: Schema.Struct({ ...CUR, date: S, balances: Schema.Record(S, N), cash: N, cards: N }),
  run: (a, ctx) =>
    Effect.gen(function* () {
      const e = yield* entityOf(a, ctx);
      const d = a.date || today();
      const b = yield* balancesAt(e, d);
      const ks = Object.keys(b);
      return {
        currency: e.meta.currency ?? null,
        date: d,
        balances: b,
        cash: r2(sum(ks.filter((k) => !isCard(k)).map((k) => b[k]!))),
        cards: r2(sum(ks.filter((k) => isCard(k)).map((k) => b[k]!))),
      };
    }),
});

const chart_of_accounts = defineTool({
  name: "chart_of_accounts",
  title: { en: "Chart of accounts", he: "מבנה החשבונות" },
  description:
    "The account types (with where they land in the P&L) and every ledger account in use or suggested for this kind of entity, with labels and transaction counts.",
  kind: "read",
  input: input({}),
  output: Schema.Struct({
    types: Schema.Array(Schema.Struct({ type: S, label: S, pl: opt(S) })),
    accounts: Schema.Array(Schema.Struct({ account: S, label: S, type: S, pl: opt(S), transactions: I })),
    uncategorized: I,
  }),
  run: (a, ctx) =>
    Effect.gen(function* () {
      const e = yield* entityOf(a, ctx);
      const n = new Map<string, number>();
      for (const t of yield* ledgerOf(e)) n.set(t.category, (n.get(t.category) ?? 0) + 1);
      const used = [...(BASE[e.meta.kind ?? ""] ?? []), ...n.keys(), ...(yield* rulesOf(e)).map((r) => r[1])];
      const order = Object.keys(TYPE_LABELS);
      const rank = (c: string) => (order.includes(group(c)) ? order.indexOf(group(c)) : 99);
      const cats = [...new Set(used.filter((c) => c !== "ask"))].sort((x, y) => rank(x) - rank(y) || (label(x) < label(y) ? -1 : label(x) > label(y) ? 1 : 0));
      return {
        types: Object.entries(TYPE_LABELS).map(([type, l]) => ({ type, label: l, pl: TYPES[type] ?? null })),
        accounts: cats.map((c) => ({ account: c, label: label(c), type: group(c), pl: plOf(c), transactions: n.get(c) ?? 0 })),
        uncategorized: n.get("ask") ?? 0,
      };
    }),
});

const classify = defineTool({
  name: "classify",
  title: { en: "Classify", he: "סיווג תנועות" },
  description:
    'WRITES: give transactions a ledger account. Without `rule`, saves one-off manual overrides. With `rule`, saves the rule "description contains <rule> → category" at the top of the rules (first match wins) and clears overrides on these ids. Returns the updated transactions. More than 20 ids needs the user\'s confirmation (see `confirm`).',
  kind: "write",
  annotations: { destructive: true, idempotent: false }, // overwrites categories; with `rule`, a repeat call adds the rule again
  input: input({
    ids: Schema.Array(ID).check(Schema.isBetweenLength(1, 500)),
    category: S.annotate({ description: `${CAT_DESC} "ask" resets to uncategorized (no rule).` }),
    rule: Schema.optionalKey(S.check(Schema.isBetweenLength(1, 200)).annotate({ description: "Text the description/memo/[bank category] must contain" })),
    confirm: CONFIRM,
  }),
  output: Schema.Struct({ transactions: Schema.Array(TXN), ruleMatches: Schema.optionalKey(I) }),
  confirm: (a) =>
    Effect.succeed(a.ids.length > 20 ? `Set ${a.category} on ${a.ids.length} transactions${a.rule ? ` and add the rule ${repr(a.rule)}` : ""}?` : null),
  run: (a, ctx) =>
    Effect.gen(function* () {
      const e = yield* entityOf(a, ctx);
      const cat = yield* checkCategory(a.category, !a.rule);
      const ts = yield* ledgerOf(e);
      for (const i of a.ids)
        if ((yield* findTxn(e, i, ts)).source === "journal") return yield* fail(`${i} is a journal line: change the journal entry instead`);
      const rule = (a.rule ?? "").replaceAll(",", " ").trim() || undefined;
      const r = coreClassify(a.ids, cat, yield* rulesOf(e), yield* docOf<Record<string, string>>(e, "overrides", {}), rule);
      if (rule) yield* setRules(e, r.rules);
      yield* putDoc(e, "overrides", r.overrides);
      const after = yield* ledgerOf(e),
        ids = new Set(a.ids);
      const out: { transactions: ReturnType<typeof slim>[]; ruleMatches?: number } = { transactions: after.filter((t) => ids.has(t.id)).map(slim) };
      if (rule) out.ruleMatches = after.filter((t) => t.why === rule).length;
      return out;
    }),
});

const RULE_NOTE = 'First match wins. A rule matches if `match` appears in "<description> <memo> [<bank category>]".';
const list_rules = defineTool({
  name: "list_rules",
  title: { en: "List rules", he: "כללי סיווג" },
  description: "The categorization rules, in order: [match text, ledger account]. First match wins.",
  kind: "read",
  input: input({}),
  output: Schema.Struct({ rules: RULES, note: S }),
  run: (a, ctx) => Effect.map(Effect.flatMap(entityOf(a, ctx), rulesOf), (rules) => ({ rules, note: RULE_NOTE })),
});

const checkRules = (rules: readonly (readonly string[])[]) =>
  Effect.forEach(rules, ([m = "", c = ""]) => (m.trim() ? checkCategory(c.trim()) : fail("every rule needs a non-empty match text")), { discard: true });
const RULE_ITEM = Schema.Tuple([S.check(Schema.isMaxLength(200)), S.check(Schema.isMaxLength(200))]);
const set_rules = defineTool({
  name: "set_rules",
  title: { en: "Set rules", he: "החלפת כללי סיווג" },
  description:
    "WRITES: replace ALL categorization rules with this ordered list (first match wins). Read list_rules first and send the full list back. Needs the user's confirmation (see `confirm`).",
  kind: "write",
  annotations: { destructive: true, idempotent: true },
  input: input({
    rules: Schema.Array(RULE_ITEM).check(Schema.isMaxLength(2000)).annotate({ description: '[[match text, "type:name"], ...]' }),
    confirm: CONFIRM,
  }),
  output: Schema.Struct({ rules: RULES }),
  confirm: (a, ctx) =>
    Effect.gen(function* () {
      yield* checkRules(a.rules);
      const e = yield* entityOf(a, ctx);
      return `Replace all ${(yield* rulesOf(e)).length} categorization rules of ${e.id} with ${a.rules.length} new ones?`;
    }),
  run: (a, ctx) =>
    Effect.gen(function* () {
      const e = yield* entityOf(a, ctx);
      yield* checkRules(a.rules);
      yield* setRules(e, cleanRules(a.rules));
      return { rules: yield* rulesOf(e) };
    }),
});

const MCAT: Record<string, string> = {
  Software: "expense:software",
  Advertising: "expense:advertising",
  Travel: "expense:travel",
  Restaurants: "expense:meals",
  "Food & Dining": "expense:meals",
  Fees: "expense:bank-fees",
  "Office Supplies": "expense:equipment",
  Equipment: "expense:equipment",
  Entertainment: "expense:games",
  Utilities: "expense:phone-internet",
  "Professional Services": "expense:professional",
  Legal: "expense:professional",
};
/** Python {w for w in re.split(r"[\W_]+", s.lower()) if len(w) >= 4} */
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}\p{M}]+/u)
      // oxlint-disable-next-line no-misused-spread -- code points, like Python's len()
      .filter((w) => [...w].length >= 4),
  );
const suggest_category = defineTool({
  name: "suggest_category",
  title: { en: "Suggest category", he: "הצעת סיווג" },
  description:
    "Up to 5 likely ledger accounts for a transaction, best first, scored from similar categorized transactions (same counterparty, shared words, bank category).",
  kind: "read",
  input: input({ id: ID }),
  output: Schema.Struct({ transaction: TXN, suggestions: Schema.Array(Schema.Struct({ account: S, label: S, score: N })) }),
  run: (a, ctx) =>
    Effect.gen(function* () {
      // port of suggest(): same counterparty +5, each shared word (4+ letters) +0.6, Mercury category +3; money out is never revenue and vice versa
      const e = yield* entityOf(a, ctx);
      const txns = yield* ledgerOf(e);
      const t = yield* findTxn(e, a.id, txns);
      const sc = new Map<string, number>(),
        key = payerOf(t),
        ws = words(haystack(t));
      const add = (c: string | undefined, n: number) => void (c && c !== "ask" && sc.set(c, (sc.get(c) ?? 0) + n));
      for (const x of txns) {
        if (x.id === t.id || x.category === "ask") continue;
        if (payerOf(x) === key) add(x.category, 5);
        else {
          const n = [...words(haystack(x))].filter((w) => ws.has(w)).length;
          if (n) add(x.category, n * 0.6);
        }
      }
      add(MCAT[t.mcat ?? ""], 3);
      const bad = t.amount < 0 ? ["revenue", "other"] : t.amount > 0 ? ["cogs", "expense"] : [];
      const best = [...sc]
        .filter(([c]) => !bad.includes(plOf(c) ?? ""))
        .sort((x, y) => y[1] - x[1])
        .slice(0, 5);
      return { transaction: slim(t), suggestions: best.map(([c, s]) => ({ account: c, label: label(c), score: pyRound(s, 2) })) };
    }),
});

const LINE = Schema.Struct({
  account: S.annotate({ description: CAT_DESC }),
  debit: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).annotate({ default: 0 })),
  credit: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).annotate({ default: 0 })),
});
const add_journal_entry = defineTool({
  name: "add_journal_entry",
  title: { en: "Add journal entry", he: "פקודת יומן" },
  description:
    'WRITES: add a manual double-entry journal entry (expenses paid personally, depreciation, corrections). Debits must equal credits; each line becomes a ledger row worth credit − debit on the "Journal" account.',
  kind: "write",
  annotations: { destructive: false, idempotent: false },
  input: input({
    date: pattern(DATE_RE),
    memo: S.check(Schema.isMaxLength(500)),
    lines: Schema.Array(LINE).check(Schema.isBetweenLength(2, 50)),
  }),
  output: Schema.Struct({
    entry: Schema.Struct({ id: S, date: S, memo: S, lines: Schema.Array(Schema.Struct({ account: S, debit: N, credit: N })) }),
    ledgerRows: Schema.Array(Schema.Struct({ account: S, label: S, amount: N })),
  }),
  run: (a, ctx) =>
    Effect.gen(function* () {
      const e = yield* entityOf(a, ctx);
      const date = yield* isoDate(a.date, "date");
      const lines: { account: string; debit: number; credit: number }[] = [];
      for (const l of a.lines) {
        const d = pyRound(l.debit ?? 0, 2),
          c = pyRound(l.credit ?? 0, 2);
        if (!(d || c)) return yield* fail("every line needs a debit or a credit");
        lines.push({ account: yield* checkCategory(l.account), debit: d, credit: c });
      }
      const dr = pyRound(sum(lines.map((l) => l.debit)), 2),
        cr = pyRound(sum(lines.map((l) => l.credit)), 2);
      if (dr !== cr) return yield* fail(`debits (${pyStr(dr)}) must equal credits (${pyStr(cr)})`);
      const je = { id: `je${Date.now().toString(36)}`, date, memo: a.memo.trim(), lines };
      yield* putDoc(e, "journal", [je, ...(yield* docOf<unknown[]>(e, "journal", []))]); // newest first, like the Journal page
      return { entry: je, ledgerRows: lines.map((l) => ({ account: l.account, label: label(l.account), amount: r2(l.credit - l.debit) })) };
    }),
});

type Invoice = {
  id: string;
  customer?: string;
  items?: { qty?: unknown; price?: unknown }[];
  status?: string;
  kind?: string;
  due?: string;
  issued?: string;
  created?: string;
};
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const invTotal = (inv: Invoice) => r2(sum((inv.items ?? []).map((i) => num(i.qty || 0) * num(i.price || 0))));
const invStatus = (inv: Invoice, now: string) =>
  inv.status === "draft" ? "draft" : inv.status === "paid" || inv.kind === "receipt" ? "paid" : inv.due && inv.due < now ? "overdue" : "unpaid";

const list_invoices = defineTool({
  name: "list_invoices",
  title: { en: "List invoices", he: "רשימת חשבוניות" },
  description: "Invoices (US) or bills/receipts (Israel) with customer name, total and state (draft, unpaid, overdue, paid).",
  kind: "read",
  input: input({}),
  output: Schema.Struct({ ...CUR, invoices: Schema.Array(Schema.Struct({ id: S, customerName: opt(S), total: N, state: S })) }),
  run: (a, ctx) =>
    Effect.gen(function* () {
      const e = yield* entityOf(a, ctx);
      const cust = new Map((yield* docOf<{ id: string; name?: string }[]>(e, "customers", [])).map((c) => [c.id, c.name ?? null]));
      const now = today();
      const k = (i: Invoice) => [i.issued || "", i.created || ""] as const;
      const invs = [...(yield* docOf<Invoice[]>(e, "invoices", []))].sort((x, y) => {
        const [a1, a2] = k(x),
          [b1, b2] = k(y);
        return a1 !== b1 ? (a1 < b1 ? 1 : -1) : a2 !== b2 ? (a2 < b2 ? 1 : -1) : 0;
      });
      return {
        currency: e.meta.currency ?? null,
        invoices: invs.map((i) => ({ ...i, customerName: cust.get(i.customer ?? "") ?? null, total: invTotal(i), state: invStatus(i, now) })),
      };
    }),
});

const ITEM = Schema.Struct({
  desc: S.check(Schema.isMaxLength(500)),
  qty: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).annotate({ default: 1 })),
  price: Schema.Finite,
});
const uid8 = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "0123456789abcdefghijklmnopqrstuvwxyz"[b % 36]).join("");
const create_invoice = defineTool({
  name: "create_invoice",
  title: { en: "Create invoice", he: "טיוטת חשבונית" },
  description:
    "WRITES: save a DRAFT invoice (US) or bill (Israel); a new customer name is added to customers. It is never numbered or issued here: the user reviews and issues it in the app.",
  kind: "write",
  annotations: { destructive: false, idempotent: false },
  input: input({
    customer: S.check(Schema.isBetweenLength(1, 200)).annotate({ description: "Customer name (matched case-insensitively)" }),
    items: Schema.Array(ITEM).check(Schema.isBetweenLength(1, 100)),
    issued: Schema.optionalKey(pattern(DATE_RE, "YYYY-MM-DD, default today")),
    due: Schema.optionalKey(pattern(DATE_RE, "YYYY-MM-DD, default issued + 30 days")),
    notes: Schema.optionalKey(S.check(Schema.isMaxLength(2000))),
  }),
  output: Schema.Struct({
    invoice: Schema.Struct({ id: S, kind: S, status: S, customerName: S, total: N, issued: S, due: S }),
    note: S,
  }),
  run: (a, ctx) =>
    Effect.gen(function* () {
      const e = yield* entityOf(a, ctx);
      const name = a.customer.trim();
      if (!name) return yield* fail("customer name is empty");
      const items = a.items.map((i) => ({ desc: i.desc.trim(), qty: i.qty ?? 1, price: i.price })).filter((i) => i.desc || i.price);
      if (!items.length) return yield* fail("add at least one item with a description or a price");
      const issued = yield* isoDate(a.issued || today(), "issued");
      const due = a.due ? yield* isoDate(a.due, "due") : addDays(issued, 30);
      const customers = yield* docOf<{ id: string; name?: string }[]>(e, "customers", []);
      let c = customers.find((x) => (x.name ?? "").toLowerCase() === name.toLowerCase());
      if (!c) {
        c = { id: uid8(), name, email: "", address: "" } as { id: string; name: string };
        yield* putDoc(e, "customers", [...customers, c]);
      }
      const inv = {
        id: uid8(),
        kind: e.meta.kind === "us-llc" ? "invoice" : "bill",
        number: null,
        customer: c.id,
        items,
        issued,
        due,
        currency: e.meta.currency ?? null,
        notes: (a.notes ?? "").trim(),
        method: "",
        status: "draft",
        paidTxn: null,
        paidDate: null,
        ref: null,
        created: new Date().toISOString(),
      };
      yield* putDoc(e, "invoices", [...(yield* docOf<unknown[]>(e, "invoices", [])), inv]);
      return { invoice: { ...inv, customerName: c.name!, total: invTotal(inv) }, note: "Saved as a draft. Review and issue it in the app (Invoices)." };
    }),
});

// ---------- tax ----------
type IlRow = { brackets: [number | null, number][]; point: number; capitalRate?: number; zairCeiling?: number };
const taxTable = (y: number, country = "il") =>
  Effect.gen(function* () {
    const t = (taxTables(yield* Books.use((b) => b.doc("_app", "taxtables", {}).pipe(Effect.orDie)))[country] ?? {}) as Record<string, IlRow>;
    const ys = Object.keys(t)
      .map(Number)
      .sort((a, b) => a - b);
    if (!ys.length) return yield* fail(`taxtables.json has no ${country} tables`);
    const pick = ys.filter((x) => x <= y).at(-1) ?? ys.at(-1)!;
    const row = t[String(pick)]!;
    return { ...row, year: pick, brackets: row.brackets.map(([hi, r]) => [hi ?? Infinity, r] as const) };
  });
function bracketTax(income: number, brackets: readonly (readonly [number, number])[]) {
  let tax = 0,
    lo = 0;
  const rows: { rate: number; income: number; tax: number }[] = [];
  for (const [hi, rate] of brackets) {
    const part = Math.max(0, Math.min(income, hi) - lo);
    if (part > 0) {
      tax += part * rate;
      rows.push({ rate, income: r2(part), tax: r2(part * rate) });
    }
    lo = hi;
  }
  return [tax, rows] as const;
}
/** Discharged soldier: 2 points/yr (1 if service < 23 months) for 36 months, from the month after discharge. */
function soldierPoints(p: Record<string, unknown>, y: number) {
  if (!p.discharge) return 0;
  const [dy = 0, dm = 0] = String(p.discharge as string)
    .split("-")
    .slice(0, 2)
    .map(Number);
  const start = dy * 12 + dm,
    s = y * 12 + 1;
  let months = 0;
  for (let m = s; m < s + 12; m++) if (start < m && m <= start + 36) months++;
  return ((Number(p.serviceMonths || 0) >= 23 ? 2 : 1) * months) / 12;
}
/** float(str(v).replace(",", "") or 0), 0 when Python's float() would raise. */
const pyFloat = (v: unknown) => {
  const s = String(typeof v === "boolean" ? (v ? "True" : "False") : v).replaceAll(",", "");
  if (!s) return 0;
  const n = /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(s) ? Number(s) : NaN;
  return Number.isNaN(n) ? 0 : n;
};
const ilTax = (e: Entity, y: number, txns: readonly Txn[]) =>
  Effect.gen(function* () {
    // port of books(y): osek zair, 30% deemed expenses; form values (Tax page) override the automatic ones
    const T = yield* taxTable(y);
    const f = (yield* docOf<Record<string, Record<string, unknown>>>(e, "form", {}))[String(y)] ?? {};
    const p = yield* docOf<Record<string, unknown>>(e, "profile", {});
    const turnover = sum(txns.filter((t) => plOf(t.category) === "revenue").map((t) => t.amount));
    const auto: Record<string, unknown> = {
      "150": String(pyRound(turnover * 0.7, 0)),
      "020": "X",
      "224": String((p.discharge as string | undefined) ?? "").slice(0, 4) || null,
      "060": "",
      "040": "",
    };
    const v = (k: string) => (f[k] !== undefined && f[k] !== null ? f[k] : auto[k] !== undefined && auto[k] !== null ? auto[k] : "");
    const n = (k: string) => pyFloat(v(k));
    const ord = n("150"),
      cap = n("060");
    const resident = v("020") ? 2.25 : 0,
      soldier = v("224") ? soldierPoints(p, y) : 0,
      points = resident + soldier;
    const [ordTax, rows] = bracketTax(ord, T.brackets);
    const capTax = cap * (T.capitalRate ?? 0.15),
      gross = ordTax + capTax;
    const credits = Math.min(gross, points * T.point),
      due = pyRound(gross - credits, 0) || 0,
      withheld = n("040");
    return {
      regime: "Israeli osek zair (30% deemed expenses), form 1301",
      taxTableYear: T.year,
      turnover: r2(turnover),
      zairCeiling: T.zairCeiling ?? null,
      overCeiling: !!T.zairCeiling && turnover > T.zairCeiling,
      taxable: r2(ord),
      capitalIncome: r2(cap),
      brackets: rows,
      ordinaryTax: r2(ordTax),
      capitalTax: r2(capTax),
      grossTax: r2(gross),
      creditPoints: { resident, dischargedSoldier: pyRound(soldier, 4), total: pyRound(points, 4), pointValue: T.point },
      credits: r2(credits),
      due,
      withheld: r2(withheld),
      balance: r2(due - withheld),
      balanceMeaning: "positive = pay, negative = refund",
      overriddenByForm: Object.keys(f).sort(),
    };
  });
const US_FIELDS: Record<string, string> = {
  legalName: "Legal name",
  ein: "EIN",
  state: "State of formation",
  formed: "Date formed",
  address: "US business street address",
  cityStateZip: "City, ST ZIP",
  naics: "NAICS business code",
  owner: "Owner (Part II)",
  ownerAddress: "Owner address",
  ownerCountry: "Owner citizenship & tax residence",
  ownerTin: "Owner foreign TIN",
  business: "Principal business activity",
};
const usTax = (e: Entity, y: number, txns: readonly Txn[]) =>
  Effect.gen(function* () {
    const p = yield* docOf<Record<string, unknown>>(e, "profile", {});
    const owner = txns.filter((t) => group(t.category) === "equity");
    const contrib = owner.filter((t) => t.amount > 0),
      dist = owner.filter((t) => t.amount < 0);
    const b = yield* balancesAt(e, `${y}-12-31`);
    const assets = sum(
      Object.entries(b)
        .filter(([k]) => !isCard(k))
        .map(([, v]) => v),
    );
    return {
      regime: "Foreign-owned US single-member LLC (disregarded entity)",
      obligations: [
        {
          form: "5472",
          what: "Information return: Part I total assets, Part II the foreign owner, Part V reportable transactions with the owner",
          due: `${y + 1}-04-15`,
          extendedDue: `${y + 1}-10-15`,
          extension: "Form 7004",
          penalty: "25,000 USD for a late or missing 5472",
        },
        {
          form: "1120 (pro forma)",
          what: "Name, address, EIN, total assets only; write 'Foreign-owned U.S. DE' across the top; attach 5472",
          due: `${y + 1}-04-15`,
          filing: "Not e-filed: fax or mail to the IRS (see the app's US tax page)",
        },
        { form: "State annual report", what: `Depends on the state of formation (${(p.state as string | undefined) || "not set"})` },
      ],
      ownerContributions: { count: contrib.length, total: r2(sum(contrib.map((t) => t.amount))) },
      ownerDistributions: { count: dist.length, total: r2(-sum(dist.map((t) => t.amount))) },
      totalAssetsYearEnd: r2(assets),
      missingProfileFields: Object.entries(US_FIELDS)
        .filter(([k]) => !p[k])
        .map(([, l]) => l),
      note: "A checklist, not tax advice.",
    };
  });
const tax_summary = defineTool({
  name: "tax_summary",
  title: { en: "Tax summary", he: "סיכום מס" },
  description:
    "Tax picture for a year. Israeli osek zair: turnover, 70% taxable, brackets, credit points (resident, discharged soldier), credits, tax due vs withheld. US LLC: Form 5472 / pro forma 1120 obligations and due dates, owner contributions and distributions, year-end assets. Not tax advice.",
  kind: "read",
  input: input({ year: I.check(Schema.isBetween({ minimum: 1990, maximum: 2100 })) }),
  output: Schema.Struct({ entity: S, kind: opt(S), year: I, ...CUR, uncategorized: I, regime: S }),
  run: (a, ctx) =>
    Effect.gen(function* () {
      const e = yield* entityOf(a, ctx);
      const y = a.year,
        kind = e.meta.kind ?? null;
      const txns = (yield* ledgerOf(e)).filter((t) => t.date.startsWith(String(y)));
      const out = { entity: e.id, kind, year: y, currency: e.meta.currency ?? null, uncategorized: txns.filter((t) => t.category === "ask").length };
      if (kind === "il-osek-zair") return { ...out, ...(yield* ilTax(e, y, txns)) };
      if (kind === "us-llc") return { ...out, ...(yield* usTax(e, y, txns)) };
      return { ...out, regime: "none built in", profitAndLoss: pl(txns) };
    }),
});

// ---------- bank connections (status and sync only: credentials are entered in the app, never here) ----------
const locked = () => new ToolError({ message: "unlock OpenBooks in the app first" });
const statusOf = (e: Entity) => connectorStatus(e.id);
const bank_status = defineTool({
  name: "bank_status",
  title: { en: "Bank status", he: "מצב חיבורי בנק" },
  description:
    "Bank connections for the entity: key (provider, e.g. hapoalim:2), bank type, connected, last sync, last error, accounts, inbox file. Never shows credentials.",
  kind: "read",
  input: input({}),
  output: Schema.Struct({ connections: Schema.Array(CONN) }),
  run: (a, ctx) => Effect.map(Effect.flatMap(entityOf(a, ctx), statusOf), (connections) => ({ connections })),
});
const bank_sync = defineTool({
  name: "bank_sync",
  title: { en: "Bank sync", he: "סנכרון בנקים" },
  description:
    "WRITES: pull new transactions from connected banks (network call to the bank; writes a statement into the inbox). Banks are connected in the app, not here.",
  kind: "write",
  annotations: { destructive: false, idempotent: false, openWorld: true },
  input: input({
    provider: Schema.optionalKey(
      pattern(/^[A-Za-z][A-Za-z0-9]{1,31}(:\d{1,3})?$/u, "Connection key from bank_status (e.g. mercury, hapoalim:2). Default: every connected bank"),
    ),
  }),
  output: Schema.Struct({ ok: B, error: opt(S), connections: Schema.Array(CONN), transactions: I }),
  palette: { label: { en: "Sync banks", he: "סנכרון בנקים" }, icon: "refresh" },
  run: (a, ctx) =>
    Effect.gen(function* () {
      const e = yield* entityOf(a, ctx);
      const p = a.provider;
      if (!(yield* statusOf(e)).some((c) => c.connected && (!p || c.provider === p)))
        return yield* fail("No connected bank to sync. Connect one in the app (Books → Bank connections).");
      const sync = connectorHandle(e.id, "/api/sync", p ? { provider: p } : {}) as Effect.Effect<unknown, { _tag: string }, Needs>;
      const r = ((yield* sync.pipe(Effect.mapError(locked))) ?? {}) as { error?: string };
      return { ok: !r.error, error: r.error ?? null, connections: yield* statusOf(e), transactions: (yield* ledgerOf(e)).length };
    }),
});

/** Every tool, in mcp_server.py's order. */
export const tools: readonly Tool[] = [
  list_entities,
  list_transactions,
  get_transaction,
  profit_and_loss,
  balances,
  chart_of_accounts,
  classify,
  list_rules,
  set_rules,
  suggest_category,
  add_journal_entry,
  list_invoices,
  create_invoice,
  tax_summary,
  bank_status,
  bank_sync,
];
export { UI_URI };

export const toolByName = (name: string): Tool | undefined => tools.find((t) => t.name === name);

/**
 * One tool, in-process (mcp_server.run_tool): decode the arguments, then run it. A tool with a confirmation rule fails NeedsConfirm
 * unless the caller already has the user's yes (`ctx.confirmed`: the AI's Approve, a ⌘K click) or the args carry `confirm: true`.
 */
export const runTool = (name: string, args: unknown, ctx: ToolCtx & { confirmed?: boolean }) =>
  Effect.gen(function* () {
    const t = toolByName(name);
    if (!t) return yield* new ToolError({ message: `Unknown tool: ${name}` });
    const a = yield* decodeArgs(t, args);
    if (t.confirm && !ctx.confirmed && (a as { confirm?: boolean }).confirm !== true) {
      const q = yield* t.confirm(a, ctx);
      if (q) return yield* new NeedsConfirm({ message: q });
    }
    return (yield* t.run(a, ctx)) as unknown;
  });

/** The tools as a model sees them: `entity` and `confirm` are filled in by the app, not the model. */
export function aiTools(): { name: string; description: string; input_schema: Record<string, unknown> }[] {
  return tools.map((t) => {
    const s = structuredClone(inputJsonSchema(t)) as { properties?: Record<string, unknown>; required?: string[] };
    for (const k of ["entity", "confirm"]) delete s.properties?.[k];
    return { name: t.name, description: t.description, input_schema: s };
  });
}

/** What ⌘K needs: every tool's name and kind, and the palette label/icon of those meant for it. */
export const paletteTools = () => tools.map((t) => ({ name: t.name, kind: t.kind, ...(t.palette ? { palette: t.palette } : {}) }));

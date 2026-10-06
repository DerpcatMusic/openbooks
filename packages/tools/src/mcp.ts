// MCP over the registry (port of mcp_server.py): tools, resources, prompts and the MCP App ui://openbooks/pnl on the SDK's
// McpServer. One factory serves both eras: 2026-07-28 (server/discover, input_required confirmation) and the 2025 initialize
// handshake; stdio via serveStdio, Streamable HTTP via createMcpHandler (stateless, JSON responses).
import { createHash } from "node:crypto";
import {
  CLIENT_CAPABILITIES_META_KEY,
  createMcpHandler,
  inputRequired,
  McpServer,
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  ResourceTemplate,
  type CallToolResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { Books } from "@openbooks/storage";
import { Cause, Effect, Exit, Schema } from "effect";
import { PNL_HTML } from "./pnl.ts";
import { mcpSchema, type Needs, type Tool, type ToolCtx, ToolError } from "./registry.ts";
import { balancesAt, entityOf, pl, r2, tools, UI_URI } from "./tools.ts";

/** Runs an Effect on the app's services (a ManagedRuntime's runPromiseExit). */
export type Run = <A, E>(eff: Effect.Effect<A, E, Needs>) => Promise<Exit.Exit<A, E>>;

const INFO = { name: "openbooks", title: "OpenBooks", version: "0.1.0" };
export const INSTRUCTIONS =
  'Local bookkeeping for small businesses (Israeli osek zair, US single-member LLC). Every tool takes an optional `entity` (see list_entities). Amounts are in the entity\'s currency. Ledger accounts are "type:name" (see chart_of_accounts); "ask" means uncategorized. Tools whose description starts with WRITES change the books.';
const UI_MIME = "text/html;profile=mcp-app";
const JSON_MIME = "application/json";
const MCP_CTX: ToolCtx = { entity: undefined, lang: "en", via: "mcp" };
const log = (...a: unknown[]) => console.error("openbooks-mcp:", ...a); // stderr: stdout is the stdio protocol stream

const text = (t: string, isError = false): CallToolResult => ({ content: [{ type: "text", text: t }], isError });
/** A ToolError's message, else (a defect) only the error's name: an unknown error's message could carry data we don't want in a transcript. */
async function outcome<A>(run: Run, name: string, eff: Effect.Effect<A, ToolError, Needs>): Promise<{ ok: A } | { err: string }> {
  const exit = await run(eff);
  if (Exit.isSuccess(exit)) return { ok: exit.value };
  const e = Cause.squash(exit.cause) as { _tag?: string; message?: string; name?: string };
  if (e?._tag === "ToolError") return { err: e.message ?? "" };
  log(`${name} failed: ${e?._tag ?? e?.name ?? "error"}`);
  return { err: `${name} failed (${e?._tag ?? e?.name ?? "error"}). See the server's stderr.` };
}

/** sha256 of [name, args without confirm] with sorted keys: binds a confirmation to the exact change it was asked for. */
const stable = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, stable((v as Record<string, unknown>)[k])]),
        )
      : v;
const confirmKey = (name: string, args: Record<string, unknown>) => {
  const { confirm: _, ...rest } = args;
  return createHash("sha256")
    .update(JSON.stringify(stable([name, rest])))
    .digest("hex");
};

/**
 * mcp_server.gate(): undefined = go ahead, else what to answer. 2026-07-28 clients that declared form elicitation are asked through
 * an input_required round trip (requestState binds the yes to these arguments); everyone else must pass `confirm: true`.
 */
async function gate(
  run: Run,
  t: Tool,
  args: Record<string, unknown>,
  ctx: ServerContext,
): Promise<CallToolResult | ReturnType<typeof inputRequired> | undefined> {
  if (!t.confirm) return undefined;
  const q = await outcome(run, t.name, t.confirm(args, MCP_CTX));
  if ("err" in q) return text(q.err, true);
  if (!q.ok) return undefined;
  const key = confirmKey(t.name, args);
  const r = ctx.mcpReq.inputResponses?.confirm as { action?: string; content?: { confirm?: unknown } } | undefined;
  if (r !== undefined) {
    if (ctx.mcpReq.requestState() !== key) return text("That confirmation was for other arguments. Call again to be asked again.", true);
    if (r?.action === "accept" && r.content?.confirm === true) return undefined;
    return text("Not done: the user did not confirm.", true);
  }
  const caps = (ctx.mcpReq.envelope as Record<string, unknown> | undefined)?.[CLIENT_CAPABILITIES_META_KEY] as { elicitation?: unknown } | undefined;
  const el = caps?.elicitation;
  if (el && typeof el === "object" && (!Object.keys(el).length || "form" in el))
    // {} means form mode
    return inputRequired({
      inputRequests: {
        confirm: inputRequired.elicit({
          message: q.ok,
          requestedSchema: { type: "object", required: ["confirm"], properties: { confirm: { type: "boolean", title: "Yes, do it", default: false } } },
        }),
      },
      requestState: key,
    });
  if (args.confirm === true) return undefined;
  return text(`${q.ok} This changes many records: ask the user, then call again with confirm: true.`, true);
}

// ---------- resources ----------
type Res = { description: string; read: (e: { id: string }) => Effect.Effect<unknown, ToolError, Needs> };
const ymd = () => new Date().toLocaleDateString("sv-SE"); // local YYYY-MM-DD, like Python's date.today()
const RES: Record<string, Res> = {
  summary: {
    description: "This year's P&L, today's balances and the uncategorized count",
    read: (e) =>
      Effect.gen(function* () {
        const ent = yield* entityOf({ entity: e.id }, { entity: undefined });
        const y = ymd().slice(0, 4);
        const ts = yield* Books.use((b) => b.ledger(e.id)).pipe(Effect.orDie);
        return {
          entity: e.id,
          currency: ent.meta.currency ?? null,
          year: Number(y),
          profitAndLoss: pl(ts.filter((t) => t.date.startsWith(y))),
          balances: yield* balancesAt(ent, ymd(), ts),
          uncategorized: ts.filter((t) => t.category === "ask").length,
        };
      }),
  },
  statements: {
    description: "Statement files and their reconciliation checks",
    read: (e) =>
      Effect.gen(function* () {
        const { checks, unreadable, inbox } = yield* Books.use((b) => b.checks(e.id)).pipe(Effect.orDie); // reads any new statement files first
        const n = (v: unknown) => typeof v === "number";
        return {
          entity: e.id,
          note: "difference = statement total/balance − sum of the transactions read; 0 means reconciled.",
          statements: inbox.map((f) => ({
            file: f,
            readable: !unreadable.includes(f),
            checks: checks.filter((c) => c.file === f).map((c) => ({ ...c, ...(n(c.total) && n(c.parsed) ? { difference: r2(c.total - c.parsed) } : {}) })),
          })),
        };
      }),
  },
  rules: {
    description: "Categorization rules, in order (first match wins)",
    read: (e) => Effect.map(Books.use((b) => b.rules(e.id)).pipe(Effect.orDie), (rules) => ({ entity: e.id, rules })),
  },
};

// ---------- prompts ----------
const monthBefore = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return `${y - (mo === 1 ? 1 : 0)}-${String(mo === 1 ? 12 : mo - 1).padStart(2, "0")}`;
};
type E = { id: string; meta: { name?: string; kind?: string } };
const nameOf = (e: E) => e.meta.name || e.id;
const PROMPTS: Record<
  string,
  { title: string; description: string; args: Record<string, [string, boolean, RegExp]>; text: (e: E, a: Record<string, string>) => string }
> = {
  "monthly-close": {
    title: "Monthly close",
    description: "Close a month: review uncategorized transactions, reconcile statements, compare the P&L with the month before.",
    args: { month: ["YYYY-MM, default last month", false, /^\d{4}-(0[1-9]|1[0-2])$/u] },
    text: (e, a) => {
      const m = a.month || monthBefore(ymd().slice(0, 7)),
        prev = monthBefore(m);
      return (
        `Close ${m} for ${nameOf(e)} (entity "${e.id}").\n` +
        `1. Uncategorized: list_transactions with uncategorized=true, from=${m}, to=${m}. For each, use suggest_category and propose a ledger account; ` +
        "group repeat counterparties into rules. Show me the plan and ask before calling classify.\n" +
        `2. Reconcile: read openbooks://${e.id}/statements and list every check with a non-zero difference and every unreadable file; ` +
        `then show balances on the last day of ${m}.\n` +
        `3. P&L: profit_and_loss for ${m} and for ${prev} (group_by account). Explain the biggest changes by account.\n` +
        "Finish with a short list of what is left before the month is closed."
      );
    },
  },
  "review-uncategorized": {
    title: "Review uncategorized",
    description: "Go through uncategorized transactions with suggestions, proposing accounts and rules.",
    args: {},
    text: (e) =>
      `Review the uncategorized transactions of ${nameOf(e)} (entity "${e.id}").\n` +
      "Use list_transactions with uncategorized=true (page with offset if there are many), chart_of_accounts for the accounts in use, and " +
      "suggest_category for each one. Group them by counterparty and propose, per group, a ledger account and whether a rule fits " +
      "(a rule matches text in the description, memo or [bank category]). Ask me before writing anything; then classify in batches.",
  },
  "tax-prep": {
    title: "Tax prep",
    description: "Year-end checklist: Israeli form 1301 for an osek zair, Form 5472 + pro forma 1120 for a foreign-owned US LLC.",
    args: { year: ["Tax year, e.g. 2025", true, /^\d{4}$/u] },
    text: (e, a) => {
      const y = a.year;
      const head = `Prepare the ${y} tax checklist for ${nameOf(e)} (entity "${e.id}"). Start with tax_summary year=${y}; this is a checklist, not tax advice.\n`;
      if (e.meta.kind === "il-osek-zair")
        return (
          head +
          `Israeli annual return, form 1301, osek zair:\n1. Every ${y} transaction categorized (list_transactions uncategorized=true, from=${y}-01, to=${y}-12).\n` +
          "2. Turnover vs the osek zair ceiling (overCeiling in tax_summary).\n3. Taxable business income: 70% of turnover (30% deemed expenses), field 150.\n" +
          "4. Credit points: resident, discharged soldier (discharge date in the profile).\n5. Capital income (field 060) and tax withheld (field 040) from the year's certificates.\n" +
          "6. Tax due vs withheld: what to pay or get back. List anything missing."
        );
      if (e.meta.kind === "us-llc")
        return (
          head +
          `Foreign-owned US single-member LLC, Form 5472 with a pro forma Form 1120:\n1. Every ${y} transaction categorized (list_transactions uncategorized=true, from=${y}-01, to=${y}-12).\n` +
          "2. Reportable transactions with the owner (Part V): owner contributions and distributions (equity:owner).\n" +
          "3. Total assets at year end (Part I).\n4. Missing profile fields (missingProfileFields).\n" +
          "5. Due dates, extension (Form 7004) and how to file (fax or mail, not e-file).\n6. State annual report. List anything missing."
        );
      return head + "No tax regime is built in for this entity kind: review profit_and_loss for the year and list what an accountant would need.";
    },
  },
  "explain-pl": {
    title: "Explain the P&L",
    description: "Explain the profit and loss for a period in plain language.",
    args: {
      from: ["Start, YYYY-MM or YYYY-MM-DD", true, /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/u],
      to: ["End, YYYY-MM or YYYY-MM-DD", true, /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/u],
    },
    text: (e, a) =>
      `Explain the profit and loss of ${nameOf(e)} (entity "${e.id}") from ${a.from} to ${a.to} in plain language.\n` +
      `Call profit_and_loss from=${a.from} to=${a.to} with group_by account, then with group_by month. Cover where revenue came from, the biggest costs, ` +
      "gross and operating margin, the month-by-month trend, and how much is still uncategorized (it makes the numbers uncertain). " +
      "It is cash basis: transfers, owner equity, personal and exempt money are left out.",
  },
};
const promptArgs = (args: Record<string, [string, boolean, RegExp]>) => {
  const all = { ...args, entity: ["Entity id from list_entities; default the first", false, /^[a-z0-9-]+$/u] as [string, boolean, RegExp] };
  return Schema.Struct(
    Object.fromEntries(
      Object.entries(all).map(([k, [d, req, re]]) => {
        const s = Schema.String.check(Schema.isPattern(re)).annotate({ description: d });
        return [k, req ? s : Schema.optionalKey(s)];
      }),
    ) as Record<string, Schema.Top & { readonly DecodingServices: never }>,
  );
};

/** Register every tool, resource and prompt on `server`; tools run through `run` (the app's services). */
export function registerMcp(server: McpServer, run: Run) {
  for (const t of tools) {
    const title = t.title.en;
    server.registerTool(
      t.name,
      {
        title,
        description: t.description,
        inputSchema: mcpSchema(t.input as never),
        outputSchema: mcpSchema(t.output as never, false),
        annotations: {
          title,
          readOnlyHint: t.kind === "read",
          destructiveHint: t.annotations?.destructive ?? false,
          idempotentHint: t.annotations?.idempotent ?? t.kind === "read",
          openWorldHint: t.annotations?.openWorld ?? false,
        },
        ...(t.meta ? { _meta: t.meta } : {}),
      },
      (async (args: Record<string, unknown>, ctx: ServerContext) => {
        const stop = await gate(run, t, args, ctx);
        if (stop) return stop;
        const r = await outcome(run, t.name, t.run(args, MCP_CTX));
        if ("err" in r) return text(r.err, true);
        return { content: [{ type: "text", text: JSON.stringify(r.ok, null, 1) }], structuredContent: r.ok as Record<string, unknown>, isError: false };
      }) as never,
    );
  }

  const read = async (uri: string, eff: Effect.Effect<unknown, ToolError, Needs>) => {
    const r = await outcome(run, "resources/read", eff);
    if ("err" in r) throw new ResourceNotFoundError(uri);
    return { contents: [{ uri, mimeType: JSON_MIME, text: JSON.stringify(r.ok, null, 1) }] };
  };
  server.registerResource("entities", "openbooks://entities", { title: "Entities", description: "The businesses in these books", mimeType: JSON_MIME }, (uri) =>
    read(uri.href, tools[0]!.run({}, MCP_CTX)),
  );
  for (const [k, r] of Object.entries(RES))
    server.registerResource(
      k,
      new ResourceTemplate(`openbooks://{entity}/${k}`, {
        list: async () => {
          const ex = await run(Books.use((b) => b.entities));
          const es = Exit.isSuccess(ex) ? ex.value : [];
          return {
            resources: es.map((m) => ({
              uri: `openbooks://${m.id}/${k}`,
              name: `${m.id}-${k}`,
              title: `${m.short || m.id}: ${k}`,
              description: r.description,
              mimeType: JSON_MIME,
            })),
          };
        },
      }),
      { title: k.charAt(0).toUpperCase() + k.slice(1), description: r.description, mimeType: JSON_MIME },
      (uri, vars) => {
        const id = String(vars.entity ?? "");
        if (!/^[a-z0-9-]+$/.test(id)) throw new ResourceNotFoundError(uri.href);
        return read(
          uri.href,
          Effect.flatMap(entityOf({ entity: id }, { entity: undefined }), (e) => r.read(e)),
        );
      },
    );
  server.registerResource("pnl-chart", UI_URI, { title: "P&L chart", description: "MCP Apps view for profit_and_loss", mimeType: UI_MIME }, (uri) => ({
    contents: [{ uri: uri.href, mimeType: UI_MIME, text: PNL_HTML, _meta: { ui: { csp: {}, prefersBorder: true } } }],
  }));

  for (const [name, p] of Object.entries(PROMPTS))
    server.registerPrompt(name, { title: p.title, description: p.description, argsSchema: mcpSchema(promptArgs(p.args) as never) }, (async (
      a: Record<string, string>,
    ) => {
      const r = await outcome(run, name, entityOf(a, { entity: undefined }));
      if ("err" in r) throw new ProtocolError(ProtocolErrorCode.InvalidParams, r.err);
      return { description: p.description, messages: [{ role: "user", content: { type: "text", text: p.text(r.ok, a) } }] };
    }) as never);
}

/** A fresh McpServer with everything registered (the SDK's factories call this per connection / request). */
export function makeMcpServer(run: Run) {
  const server = new McpServer(INFO, {
    capabilities: { tools: { listChanged: false }, resources: {}, prompts: {}, extensions: { "io.modelcontextprotocol/ui": {} } } as never,
    instructions: INSTRUCTIONS,
  });
  registerMcp(server, run);
  return server;
}

/** Streamable HTTP for /mcp (the caller guards Origin/Host first): both eras, stateless, per request. */
export const mcpHttpHandler = (run: Run) => createMcpHandler(() => makeMcpServer(run), { onerror: (e) => log(`http: ${e.name}`) });

/** `openbooks mcp`: stdio until stdin closes. Logs go to stderr; nothing else may write to stdout. */
export const serveMcpStdio = (run: Run) => serveStdio(() => makeMcpServer(run), { onerror: (e) => log(`stdio: ${e.name}`) });

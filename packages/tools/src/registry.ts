// The tool registry (docs/architecture.md § Tool registry): one definition per tool drives MCP (stdio + /mcp), the in-app AI and ⌘K.
// Inputs are Effect Schemas decoded once with excess properties rejected; MCP gets the same schema as Standard Schema + JSON Schema
// (`additionalProperties: false`, like mcp_server.py's tool table).
import type { ConnectionStore, ConnectionVault, Scraper } from "@openbooks/importers";
import type { Books, Vault } from "@openbooks/storage";
import { Data, Effect, Schema } from "effect";

export type Lang = "en" | "he";
export type Bilingual = { readonly en: string; readonly he: string };
/** What tools may use: the books, the vault, and the bank connectors (bank_status / bank_sync). */
export type Needs = Books | Vault | ConnectionStore | ConnectionVault | Scraper;

/** A failure the caller should see (mcp_server.py ToolError): MCP isError, an AI tool_result with is_error, a ⌘K toast. */
export class ToolError extends Data.TaggedError("ToolError")<{ readonly message: string }> {}
/** A write that needs the user's yes first (MCP: elicitation or `confirm: true`). */
export class NeedsConfirm extends Data.TaggedError("NeedsConfirm")<{ readonly message: string }> {}

export interface ToolCtx {
  /** The entity the caller is on (in-app AI, ⌘K); wins over `args.entity`. MCP: undefined (args.entity or the first entity). */
  entity: string | undefined;
  lang: Lang;
  via: "mcp" | "ai" | "palette";
}

export interface Tool<I extends Schema.Top = Schema.Top, O extends Schema.Top = Schema.Top> {
  name: string;
  title: Bilingual;
  /** For models; English. Writes start with "WRITES". */
  description: string;
  input: I;
  output: O;
  kind: "read" | "write";
  annotations?: { destructive?: boolean; idempotent?: boolean; openWorld?: boolean };
  /** Non-null = needs the user's yes (classify > 20 ids, set_rules). An Effect because set_rules names the current rule count. */
  confirm?: (args: I["Type"], ctx: ToolCtx) => Effect.Effect<string | null, ToolError, Needs>;
  run: (args: I["Type"], ctx: ToolCtx) => Effect.Effect<O["Type"], ToolError, Needs>;
  palette?: { label: Bilingual; icon: string };
  /** MCP tool `_meta` (profit_and_loss: the MCP Apps view). */
  meta?: Record<string, unknown>;
}

export const defineTool = <I extends Schema.Top, O extends Schema.Top>(t: Tool<I, O>): Tool => t as unknown as Tool;

// ---------- schemas ----------
/** mcp_server.py validate(): a null value counts as absent. Applied at the top level only, like Python's object pass. */
const dropNulls = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined)) : v;

const STRICT = { onExcessProperty: "error" } as const;
type JsonSchema = Record<string, unknown>;
const jsonOf = (s: Schema.Top, strict: boolean): JsonSchema => {
  const d = Schema.toJsonSchemaDocument(s, strict ? STRICT : {});
  return Object.keys(d.definitions ?? {}).length ? { ...d.schema, $defs: d.definitions } : (d.schema as JsonSchema);
};

/**
 * Standard Schema + Standard JSON Schema for McpServer.registerTool / registerPrompt. Effect's own toStandardJSONSchemaV1 takes no
 * options, so this builds the pair: inputs (`strict`) decode with excess properties rejected and emit `additionalProperties: false`;
 * outputs stay open (mcp_server.py's outputSchemas are, and results carry more fields than they list).
 */
export function mcpSchema<S extends Schema.Top & { readonly DecodingServices: never }>(s: S, strict = true) {
  const std = Schema.toStandardSchemaV1(s, strict ? { parseOptions: STRICT } : {})["~standard"];
  const json = () => jsonOf(s, strict);
  return {
    "~standard": {
      ...std,
      validate: (v: unknown) => std.validate(strict ? dropNulls(v) : v),
      jsonSchema: { input: json, output: json },
    },
  } as unknown as { readonly "~standard": typeof std & { jsonSchema: { input: () => JsonSchema; output: () => JsonSchema } } };
}

/** The JSON Schema of a tool's input (draft 2020-12, `additionalProperties: false`). */
export const inputJsonSchema = (t: Tool) => jsonOf(t.input, true);
export const outputJsonSchema = (t: Tool) => jsonOf(t.output, false);

/** Decode tool arguments the way MCP does (nulls dropped, excess properties rejected); a bad argument is a ToolError naming it. */
export const decodeArgs = (t: Tool, args: unknown) =>
  Schema.decodeUnknownEffect(t.input as Schema.Top & { readonly DecodingServices: never })(dropNulls(args ?? {}), STRICT).pipe(
    Effect.mapError((e) => new ToolError({ message: `Invalid arguments for ${t.name}: ${e.message}` })),
  );

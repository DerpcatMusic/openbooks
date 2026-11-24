// The tool registry: one definition per tool, served to MCP (stdio + Streamable HTTP), the in-app AI and the ⌘K bar.
// API: docs/architecture.md § Tool registry.
export * from "./registry.ts";
export { aiTools, label, paletteTools, pl, r2, runTool, toolByName, tools } from "./tools.ts";
export { INSTRUCTIONS, makeMcpServer, mcpHttpHandler, registerMcp, type Run, serveMcpStdio } from "./mcp.ts";
export * from "./ai.ts";
export {
  BadPair,
  combinedFlow,
  decideTransferPair,
  ensureRates,
  netWorth,
  ratesFor,
  transferSearch,
  transferSuggestions,
  withBase,
  type CombinedFlow,
  type CombinedFlowTxn,
  type NetWorth,
} from "./money.ts";
export { allLawSources, listLawSources, refreshLawSources, type LawCatalogEntry, type LawCatalogResponse, type RefreshLawsOptions } from "./laws.ts";

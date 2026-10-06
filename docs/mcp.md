# MCP

OpenBooks ships an MCP server, `openbooks mcp`, so Claude (or any MCP client) can read and work on your books.
It needs only Python 3 (stdlib) and reads the same `books.db` as the app. Two transports:

- **stdio**: `openbooks mcp` (or `bun apps/server/src/main.ts mcp` from source), launched by the client.
- **Streamable HTTP**: `http://127.0.0.1:8765/mcp`, served by the app while it runs. Local only: it listens on
  127.0.0.1 and answers 403 to any request whose `Origin` or `Host` isn't localhost (DNS-rebinding protection).

It speaks the current stateless protocol (2026-07-28) and the older `initialize` handshake (2024-11-05 to 2025-11-25).
Books live in `OPENBOOKS_HOME` (default: `entities/` in the current folder); `OPENBOOKS_PORT` changes the app's port.

## AI: MCP or in-app

The same tool table serves two kinds of AI:

- **In Claude, ChatGPT or any MCP client** (this page): the client runs the model, OpenBooks runs the tools.
- **In the app** (⌘K, then Tab): `ai.py` runs an agent loop with your own API key (Anthropic, OpenAI, OpenRouter, any
  OpenAI-compatible server) or a local Ollama model, set up in Settings → AI. It calls these tools in-process through
  `runTool(name, args)` in `packages/tools`. Read tools run on their own; every tool marked **writes** below waits for the user's
  Approve / Deny in the app (not only the big ones). The model can't pick another business: `entity` is always the one open in the app.
  Keys stay in `books.db` and never reach the browser. At most 8 model calls per question.

## Claude Code

```sh
# over HTTP, while the app runs:
claude mcp add --transport http openbooks http://127.0.0.1:8765/mcp
# or over stdio (no app needed):
claude mcp add openbooks -- /path/to/openbooks mcp
claude mcp add openbooks -e OPENBOOKS_HOME=/path/to/books -- /path/to/openbooks mcp
```

## Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "openbooks": {
      "command": "/path/to/openbooks",
      "args": ["mcp"],
      "env": { "OPENBOOKS_HOME": "/path/to/books" }
    }
  }
}
```

## Tools

Every tool takes an optional `entity` (default: the first one). Amounts are in the entity's currency.
Every tool has annotations (read-only, destructive, idempotent, open-world) and an `outputSchema`; results come as
`structuredContent` plus the same JSON as text for older clients.

| Tool | What it does |
|---|---|
| `list_entities` | Businesses in the books |
| `list_transactions` | Filter by period, bank account, ledger account, uncategorized, text; paged |
| `get_transaction` | One transaction, its source statement and attachments |
| `profit_and_loss` | Cash-basis P&L by ledger account or by month (with a chart in clients that support MCP Apps) |
| `balances` | Bank and card balances on a date |
| `chart_of_accounts` | Account types and ledger accounts in use |
| `classify` | **Writes.** Set a ledger account on transactions, optionally as a rule |
| `list_rules` / `set_rules` | Categorization rules (`set_rules` **writes**, replacing all rules) |
| `suggest_category` | Likely ledger accounts for a transaction |
| `add_journal_entry` | **Writes.** A balanced manual journal entry |
| `list_invoices` / `create_invoice` | Invoices; `create_invoice` **writes** a draft (never numbered or issued) |
| `tax_summary` | Israeli osek zair estimate, or US LLC Form 5472 / 1120 checklist |
| `bank_status` / `bank_sync` | Bank connection status; `bank_sync` **writes** new statements from connected banks (the only tool that reaches the internet) |

**Confirmation.** `set_rules`, and `classify` on more than 20 transactions, need the user's yes. Clients that support
elicitation (2026-07-28, form mode) get a confirmation form from the server. Other clients must pass `confirm: true`
after asking the user; without it the call fails and says so.

There is no tool to read or set bank credentials: connect banks in the app (Books → Bank connections).

## Resources

| URI | Contents |
|---|---|
| `openbooks://entities` | The businesses |
| `openbooks://{entity}/summary` | This year's P&L, today's balances, uncategorized count |
| `openbooks://{entity}/statements` | Statement files and their reconciliation checks (`difference` 0 = reconciled) |
| `openbooks://{entity}/rules` | Categorization rules, in order |
| `ui://openbooks/pnl` | MCP Apps view for `profit_and_loss`: monthly revenue, expenses and net as a bar chart. Self-contained, no network |

## Prompts

| Prompt | Arguments |
|---|---|
| `monthly-close` | `month` (YYYY-MM, default last month): uncategorized review, reconciliation, P&L vs the month before |
| `review-uncategorized` | categorize what's left, with suggestions and rules |
| `tax-prep` | `year`: form 1301 checklist (Israeli osek zair) or Form 5472 + pro forma 1120 (US LLC) |
| `explain-pl` | `from`, `to`: the P&L in plain language |

All prompts also take an optional `entity`.

Check it: `bun run test` (apps/server/src/mcp.test.ts covers stdio, HTTP and the guards).

# OpenBooks next: architecture

The contract every phase 2–5 agent builds against. If code and this file disagree, fix one of them in the same commit.
The Python app (`books.py`, `web/`, `app/`) stays runnable in this repo until phase 5 and is the behavioural reference.

## Stack

| Concern                    | Choice                                                                                                 | Notes                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime, package manager   | Bun 1.4 workspaces                                                                                     | `bun install` at the root. No build step for packages: they export `.ts` sources.                                                                                                                                                                                                                                                     |
| Dev/build/test/lint/format | Vite+ 1.0 (`vp`), project-local                                                                        | `bun run test` = `vp test` (Vitest 5.0.1), `bun run check` = `vp check` (Oxfmt + Oxlint, type-aware), `bun run typecheck` = `tsc` (TS 7). Root `vite.config.ts` holds `test`, `fmt`, `lint`; legacy paths are ignored there. `overrides` in `package.json` pin `vite` → vite-plus-core and `vitest` 5.0.1, as the Vite+ docs require. |
| Language                   | Strict TypeScript everywhere                                                                           | one root `tsconfig.json` (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`); packages extend it.                                                                                                                                                                                                                            |
| UI                         | SvelteKit 3.0 SPA (`adapter-static`, fallback page) + Svelte 5.57 runes + Tailwind 4                   | served by the local server, embedded in the binary.                                                                                                                                                                                                                                                                                   |
| I/O, concurrency           | Effect 4.0                                                                                             | importers' connectors, sync, storage service, AI loop, server services. **Never** in `core` or country calculations.                                                                                                                                                                                                                  |
| Schemas                    | Effect Schema                                                                                          | the single source for statement rows, tax-table shapes, tool inputs/outputs.                                                                                                                                                                                                                                                          |
| MCP                        | `@modelcontextprotocol/server` 2.3 (+ `@modelcontextprotocol/node` only if a Node transport is needed) | `McpServer.registerTool` takes any `StandardSchemaWithJSON`.                                                                                                                                                                                                                                                                          |

## Packages and boundaries

```
packages/schema          Effect Schema contracts (rows, txns, entity meta, CSV profiles, table base, tool inputs) + toolSchema()/jsonSchema()
packages/core            pure TS: ledger, rules, reports, periods, counterparties, privacy inflate, i18n helpers, country-pack interface, Python-compat rounding
packages/countries/il    Israel pack (osek patur/zair/murshe, Ltd; residence pack)            ┐ pure calculations + JSON data;
packages/countries/us    United States pack (LLC disregarded / C-corp / partnership)         │ Effect only for the table Schema
packages/countries/_template  copy to start a country                                          ┘
packages/importers       statement readers (pure parsers) + bank connectors (Effect)          phase 2
packages/storage         books.db via bun:sqlite, ingest, vault, change events (Effect)        phase 2
packages/tools           tool registry → MCP stdio/HTTP, in-app AI, ⌘K                        phase 4 (⌘K metadata phase 3)
apps/server              Bun.serve on 127.0.0.1: /api/*, /api/events, /mcp, static app; `openbooks mcp` stdio entry
apps/web                 SvelteKit 3 SPA                                                      phase 3
```

Dependency direction (no cycles, enforced by package.json deps): `schema ← core ← countries/* ← importers ← storage ← tools ← apps/*`.
`core` and pack calculation files import `@openbooks/schema` with `import type` only (no runtime Effect). The web app imports `core` and packs, never `storage`/`tools`.

### What exists after phase 1

- `@openbooks/schema` (`packages/schema/src/index.ts`): `StatementRow`, `StoredTxn`, `Txn`, `StatementCheck`, `Rule`, `JournalEntry`, `EntityMeta`, `CsvProfile`, `Source`, `TaxTableBase`, `ListTransactionsInput`, `ClassifyInput`, `toolSchema(s)`, `jsonSchema(s)`.
- `@openbooks/core`:
  ```ts
  ledger(stored: StoredTxn[], overrides: Record<id, account>, rules: Rule[], journal?: JournalEntry[]): Txn[]  // = books.py ledger()
  classify(ids, category, rules, overrides, rule?): { rules, overrides }; cleanRules(rules); haystack(t)
  TYPES, group, plOf, isBiz, isCard, pl(ts): PL, byAccount(ts), cashIn/cashOut(ts), accounts(txns), balances(txns, checks, iso)
  yearPeriod, inPeriod, priorPeriod, monthsIn, inRange, cashSeries(txns, period)
  payerOf, suggestRule, payers(txns), suggest(ts, all)
  pyRound(x, n=2), pyStr(x, isInt?)            // Python round() and str() for parity (-0.0 kept, as Python does)
  inflate(n, salt)                              // privacy mode
  translate(dicts, lang, key, vars?), bidi, ltr, localeOf, dirOf, checkDictionaries(en, other)
  CountryPack, Manifest, BusinessType, PlaybookItem, Person, Facts, EntityYear, CrossBorder, Obligation, FormHook, pickTable
  ```
- `@openbooks/country-il`: `il` (the pack), `ilPlan`, `bands`, `reservistPoints`, `mandatoryPension`, `soldierPoints`, `company`, `taxximize`, `extraPoints`, `advise`, `form1301`, `form1301Auto`, `bracketRows`, `ilCrossBorder`, `IlRates`/`IlTable`/`isComplete`.
- `@openbooks/country-us`: `us`, `llcObligations`, `missingProfile`, `UsTable`.

## Storage: books.db (identical to books.py)

One SQLite file, `$OPENBOOKS_HOME/books.db` (default `./entities`), created with mode `0600`, opened with `pragma journal_mode=wal`, `pragma busy_timeout=10000` and `pragma secure_delete=on` (freed space is zeroed, so a disconnected or re-sealed secret leaves no plaintext behind). The schema is byte-for-byte books.py's, so the same file opens in both apps during phases 2–4:

```sql
create table if not exists entity (id text primary key, meta text not null);
create table if not exists doc    (entity text, name text, value text not null, primary key (entity, name));
create table if not exists rule   (entity text, pos integer, match text, category text, primary key (entity, pos));
create table if not exists secret (entity text, provider text, value text not null, primary key (entity, provider));
create table if not exists txn    (entity text, id text, date text, amount real, account text, desc text, source text, data text not null, primary key (entity, id));
create index if not exists txn_date on txn (entity, date);
create table if not exists statement (entity text, file text, sig text, checks text, ok integer, primary key (entity, file));
```

No new tables, no new columns. App-level rows use pseudo-entities whose ids can't be real entity ids (`[a-z0-9-]` only): `_ai` (AI config, as today), `_vault` (vault parameters), `_app` (app settings, e.g. tax-table overrides: `doc(_app, "taxtables")`, merged over pack tables; books.py keeps editing its `taxtables.json`, the two don't sync).

Folders per entity are unchanged: `<home>/<id>/inbox/`, `proofs/<year>/`, `attachments/<txn>/`, `data/` (generated proof packs). JSON-era folders (`entity.json`, `data/*.json`, `rules.csv`) migrate exactly as `_migrate` does.

Rules that keep both apps agreeing on the same file:

- **Ingest** (`books.py ingest`): statement files = inbox entries with suffix `.pdf/.csv/.json` (case-insensitive), sorted by name; `sig = "<st_mtime_ns>:<st_size>"` (Bun: `statSync(f, { bigint: true }).mtimeNs`). Re-ingest only when the `{file: sig}` map differs from the `statement` table; then delete + insert both tables for the entity in one transaction. A file that fails to parse is listed with `ok = 0`, `checks = "[]"`.
- **uid** = first 12 hex chars of `sha1("{source}|{date}|{amount}|{desc}|{key}")` where `amount` is Python's `str()` of the value: `pyStr(amount, isInt)`. Readers that take amounts straight from JSON (Mercury JSON `amount`, One Zero sync `chargedAmount`) must know whether the JSON literal was an integer: parse with `JSON.parse(text, (k, v, ctx) => …)` and test `ctx.source` against `/^-?\d+$/`. Every other reader produces floats (`isInt = false`). Rounding uses `pyRound`.
- **txn.data** = `JSON.stringify({ id: uid, ...rowWithoutKey })`, non-ASCII kept as is. First occurrence of a uid wins (overlapping statements).
- **Ordering**: `order by date, rowid`, then journal lines appended and a stable sort by date (`core.ledger`).
- Write paths mirror books.py: `put(name, null)` deletes a doc; saving `csv-profiles` clears the entity's `statement` rows; `write_rules` replaces all rules in a transaction via `cleanRules`.

### Storage service (phase 2)

```ts
// packages/storage/src/index.ts
// entity-scoped calls fail with UnknownEntity (books.py KeyError → 404); doc/putDoc also take pseudo-entities (_app, _ai, _vault)
export class Books extends Context.Service<Books, {
  home: string
  entities: Effect.Effect<readonly ({ id: string } & EntityMeta)[]>
  createEntity: (id: string, meta: EntityMeta) => Effect.Effect<void, BadInput>
  setMeta: (e: string, patch: Partial<EntityMeta>) => Effect.Effect<void, UnknownEntity>
  ingest: (e: string) => Effect.Effect<void, UnknownEntity>                         // no-op when sigs match
  ledger: (e: string) => Effect.Effect<readonly Txn[], UnknownEntity>               // ingest + core.ledger
  checks: (e: string) => Effect.Effect<{ checks: StatementCheck[]; unreadable: string[]; inbox: string[] }, UnknownEntity>
  doc: <A>(e: string, name: string, fallback: A) => Effect.Effect<A, UnknownEntity>
  putDoc: (e: string, name: string, value: unknown | null) => Effect.Effect<void, UnknownEntity>
  rules: (e: string) => Effect.Effect<readonly Rule[], UnknownEntity>
  setRules: (e: string, rules: readonly Rule[]) => Effect.Effect<void, UnknownEntity>
  state: (e: string) => Effect.Effect<State, UnknownEntity>                         // byte-compatible with GET /api/state
}>()("openbooks/Books") {}
export const booksLayer: (opts: { home: string; read: Read /* importers read() */; db?: Database }) => Layer<Books, never, Changes>
export class Vault extends Context.Service<Vault, { … see below … }>()("openbooks/Vault") {}
export class Changes extends Context.Service<Changes, { publish: (c: Omit<Change, "v">) => Effect.Effect<void>; subscribe: Stream.Stream<Change>; version: Effect.Effect<number> }>()("openbooks/Changes") {}
// connectors' view of storage (packages/storage/src/connect.ts): the entity's secret rows, and the Vault's reveal/conceal
export const connectionStoreLayer: (home: string, db: Database) => Layer<ConnectionStore, never, Changes>; // putRows publishes "secrets"
export const connectionVaultLayer: Layer<ConnectionVault, never, Vault>;
```

The server (`apps/server/src/services.ts` `defaultLayer({ home })`) builds all of these over **one** `openDb(home)` connection: Books, Vault and ConnectionStore write through it, so `pollExternal` (`pragma data_version`) only fires for other processes. The same layer's scope runs `pollExternal(db)` and one `watchInbox` per entity; entities created later get a watcher when Books publishes `entities`. Secret rows have no Books method: the vault and the connectors go through `secret` directly.

`State` is exactly what `books.py state(e)` returns (`entity, entities, txns, checks, form, profile, rules, years, proofs, unreadable, docs, attachments, taxTables, inbox, connections`). Phase 3 may add fields, never rename.

## Secrets: the vault

Bank credentials (`secret` rows: `{secret, pending, lastSync, lastError, accounts}`) and AI keys (`secret(_ai, config)`: `{provider, model, base, keys}`) get encrypted with a master passphrase. Only the sensitive fields are sealed, so non-secret status still shows while locked and books.py keeps working on the same file.

- **KDF**: scrypt via `node:crypto` (`scrypt`, async) in Bun: `N = 2^17, r = 8, p = 1`, 32-byte key, 16-byte random salt, passphrase NFKC-normalized. (~0.9 s on a laptop: paid once per unlock.) Argon2id is not used: `Bun.password` only produces encoded hashes, not raw keys.
- **Cipher**: AES-256-GCM via WebCrypto (`crypto.subtle`), key imported non-extractable. Fresh 12-byte random IV per seal. AAD = UTF-8 of `openbooks|<entity>|<provider>` so a sealed blob can't be moved to another row.
- **Formats** (JSON in `secret.value`):
  ```jsonc
  // secret(_vault, kdf)
  { "v": 1, "kdf": "scrypt", "N": 131072, "r": 8, "p": 1, "salt": "<b64>", "check": { "v": 1, "iv": "<b64>", "ct": "<b64>" } }  // check = seal("openbooks-vault-check"), AAD openbooks|_vault|kdf
  // a bank connection after sealing: plaintext status + one envelope holding {secret, pending}
  { "lastSync": "…", "lastError": null, "accounts": [...], "sealed": { "v": 1, "iv": "<b64>", "ct": "<b64 ciphertext‖tag>" } }
  // AI config after sealing: { "provider": "anthropic", "model": "…", "base": "", "sealed": { … {keys} … } }
  ```
- **scrypt memory**: scrypt needs 128·N·r bytes (128 MiB at the default); node's 32 MiB `maxmem` default refuses it, so `derive` passes `maxmem: 256·N·r`. A kdf row read from the file is bounds-checked (N ≤ 2^20, r ≤ 16, p ≤ 4) before deriving.
- **No plaintext left in the file**: every vault rewrite (setup, unlock sealing books.py's plaintext, change, reset) commits, then runs `pragma wal_checkpoint(TRUNCATE)`; with `secure_delete` the old page images are overwritten in the main file and the WAL is emptied. A long reader in another process can keep the checkpoint from completing: the WAL is then scrubbed at the next full checkpoint. Test: `vault.test.ts` greps `books.db` + `books.db-wal` for synthetic tokens.
- **Lifecycle**: no `_vault` row = plaintext mode (exactly today's behaviour; the UI nags). `POST /api/vault/setup {passphrase}` derives the key, writes `_vault/kdf`, and seals every row with plaintext secret fields, all in one transaction. `POST /api/vault/unlock {passphrase}` derives + verifies `check`; the `CryptoKey` lives in server memory only (never on disk, never sent to the browser). Lock on process exit or `POST /api/vault/lock`. Wrong passphrase: 1 s delay. `POST /api/vault/change` re-seals everything in one transaction. "Forgot passphrase" = `POST /api/vault/reset`: drops `sealed` fields and the kdf row; books are untouched, banks need reconnecting.
- **Locked**: everything works except connect/sync/AI with a cloud key; those fail with `VaultLocked` (HTTP 423, MCP tool error "unlock OpenBooks in the app first"). The UI shows the unlock prompt where needed.
- **Migration / coexistence**: books.py reads `c.get("secret")`; a sealed row has none, so Python shows it as not connected and won't sync it (no crash). If Python writes a plaintext secret into a sealed DB (user reconnects in the old app), the TS server seals it on the next unlock.

```ts
interface VaultApi {
  // packages/storage/src/vault.ts makeVault(db, { N?, failDelay?, changed? })
  status: Effect.Effect<"plaintext" | "locked" | "unlocked">;
  setup(passphrase: string): Effect.Effect<void, VaultExists>;
  unlock(passphrase: string): Effect.Effect<void, WrongPassphrase | NoVault>;
  lock: Effect.Effect<void>;
  change(old: string, next: string): Effect.Effect<void, WrongPassphrase | NoVault | Tampered>;
  reset: Effect.Effect<void>;
  seal(entity: string, provider: string, fields: object): Effect.Effect<Envelope, VaultLocked>;
  open(entity: string, provider: string, env: Envelope): Effect.Effect<object, VaultLocked | Tampered>;
  reveal(entity: string, provider: string, row: Row): Effect.Effect<Row, VaultLocked | Tampered>; // a stored row, opened
  conceal(entity: string, provider: string, row: Row): Effect.Effect<Row, VaultLocked>; // the row to store (plaintext mode: as is)
}
```

## Importers (phase 2)

```ts
// packages/importers/src/readers/*.ts — pure functions over bytes/text (+ pdftotext output for PDFs); no Effect
type Reader = (file: { name: string; bytes: Uint8Array; text?: string }, ctx: ReadContext) => { rows: StatementRow[]; checks: StatementCheck[] };
interface ReadContext {
  meta: EntityMeta;
  profile: { bitName?: string };
  csvProfiles: CsvProfile[];
  siblingPdfPeriods: () => [string, string][];
}
export function read(file, ctx): { rows; checks; uidAmount: (r) => string }; // dispatch exactly like books.py read()
// readers: onezeroPdf, onezeroJson, bitCsv, mercuryJson, mercuryCsv, scraperJson, mappedCsv, csvPreview + helpers csvDecode/csvTable/csvDate/money
// packages/importers/src/connectors/*.ts — Effect: Mercury API (fetch), israeli-bank-scrapers (in-process `Scraper.direct`, or the
// `Scraper.bridge` subprocess), One Zero OTP
export const handle: (
  e: string,
  path: string,
  body: object,
) => Effect.Effect<{ error: string } | {} | null, VaultLocked | Tampered, ConnectionStore | ConnectionVault | Scraper>; // books.py connectors.handle
```

The server answers `/api/connect|sync|disconnect` with `handle()`: `{error}` → 400, `{}` → state, VaultLocked → 423. `OPENBOOKS_MERCURY_API` overrides the Mercury base URL for tests (a local fake); nothing else sets it.

One Zero PDFs keep using `pdftotext -layout` (poppler), like today, for byte-identical parsing. A pure-JS replacement is a separate item with its own parity proof. Sync writes the inbox file atomically (`.<name>.tmp` then rename), like `connectors._write_inbox`.

## Tool registry (phase 4; ⌘K metadata in phase 3)

One definition per tool drives MCP stdio, MCP HTTP (`/mcp`), the in-app AI and ⌘K.

```ts
// packages/tools/src/registry.ts
export interface Tool<I extends Schema.Top, O extends Schema.Top> {
  name: string; // snake_case, the MCP name (16 today: list_entities … bank_sync)
  title: { en: string; he: string };
  description: string; // for models; English
  input: I; // Effect Schema, the only definition of the arguments
  output: O; // structuredContent schema (MCP outputSchema)
  kind: "read" | "write";
  annotations?: { destructive?: boolean; idempotent?: boolean; openWorld?: boolean }; // readOnlyHint = kind === "read"
  confirm?: (args: I["Type"], ctx: ToolCtx) => Effect.Effect<string | null, ToolError, Needs>; // non-null = needs the user's yes (classify > 20 ids, set_rules); an Effect: set_rules names the current rule count
  run: (args: I["Type"], ctx: ToolCtx) => Effect.Effect<O["Type"], ToolError, Needs>; // Needs = Books | Vault | ConnectionStore | ConnectionVault | Scraper
  palette?: { label: { en: string; he: string }; icon: string }; // shown in ⌘K
  meta?: Record<string, unknown>; // MCP tool _meta (profit_and_loss → ui://openbooks/pnl)
}
export interface ToolCtx {
  entity: string | undefined;
  lang: "en" | "he";
  via: "mcp" | "ai" | "palette";
}
export const tools: readonly Tool<any, any>[];
export function runTool(name: string, args: unknown, ctx: ToolCtx & { confirmed?: boolean }): Effect.Effect<unknown, ToolError | NeedsConfirm, Needs>;
// adapters (Run = a ManagedRuntime's runPromiseExit)
export function registerMcp(server: McpServer, run: Run): void; // also makeMcpServer(run), mcpHttpHandler(run) for /mcp, serveMcpStdio(run) for `openbooks mcp`
export function aiTools(): { name: string; description: string; input_schema: JsonSchema }[]; // jsonSchema(input) for Anthropic/OpenAI
```

- Input validation happens once, from the Effect Schema: MCP via `toolSchema()` (Standard Schema + Standard JSON Schema, verified against `McpServer` + `Client` in phase 1), AI and ⌘K via `Schema.decodeUnknown`.
- Effect's JSON Schema output has `additionalProperties: true`; the Python tools send `false` and test_mcp.py checks rejection of unknown keys. Phase 4 decodes tool args with `onExcessProperty: "error"` and emits `false` in the JSON Schema (`toJsonSchemaDocument` option). Fallback if the SDK path can't carry that: `fromJsonSchema(jsonSchema(input))` from `@modelcontextprotocol/server`.
- Confirmation: MCP uses the SDK's `inputRequired` elicitation flow (same as `mcp_server.gate`; legacy clients pass `confirm: true`). In-app AI shows Approve/Deny for every `write` (SSE event `confirm`, `POST /api/ai/confirm`). ⌘K runs `write` tools only from an explicit click.
- Resources, prompts and the MCP App `ui://openbooks/pnl` move over unchanged (docs/mcp.md is the spec); test_mcp.py and test_ai.py are ported to Vitest against the TS server (apps/server/src/mcp.test.ts, ai.test.ts), plus a structuredContent parity run against mcp_server.py.
- Tool input schemas live in packages/tools (not packages/schema); the in-app AI is packages/tools/src/ai.ts (settings in the vault-sealed `secret` row `_ai`/`config`; system prompt, Approve cards and errors in he/en by the request's `lang`).
- ⌘K: `GET /api/tools` (name, kind, palette) and `POST /api/tools/run {name, entity, args?, lang}` → `{ok, result}` (the click is the user's yes); apps/web/src/lib/ai.ts registers them and the Ask AI backend.
- Where the SDK differs from mcp_server.py (accepted): unknown resource on a 2025-era request is -32602 (was -32002); HTTP answers it with 200; resources/prompts capabilities say `listChanged: true`; a bogus `cursor` is ignored; an unparseable stdio line gets no reply; 2025-era HTTP answers are SSE-framed; argument errors read "Input validation error: …" (Effect's wording, not Python's "bad format").

## Live updates

Every write goes through `Books`/`Vault`, which publish a `Change` after commit:

```ts
type Topic = "entities" | "meta" | "txns" | "rules" | "docs" | "statements" | "secrets" | "external";
interface Change {
  v: number;
  entity: string | null;
  topics: Topic[];
  docs?: string[];
} // v: server-wide monotonic counter
```

- Sources: API/MCP/AI writes; inbox watcher (`fs.watch` per entity inbox, 300 ms debounce → `Books.ingest`, which publishes `txns`/`statements` only when a statement's sig changed; the watcher itself publishes nothing, so one drop = one event); external writers (books.py, a second process): poll `pragma data_version` every 1 s → `external`.
- Transport: `GET /api/events` (SSE). On connect: `event: hello` with `{ v }`. Then `event: change` per change; `: ping` every 25 s. Same Origin/Host guard as `/api`.
- Client (`apps/web/src/lib/stores/books.svelte.ts`): one `EventSource`; on `change` for the open entity (or `entity: null`) re-fetch `/api/state` (phase 3 keeps whole-state refresh; finer slices later without changing events). On reconnect, a newer `hello.v` than the last seen triggers a refresh. Optimistic local edits (`saveDoc`) stay as today.

## HTTP API

Phase 2 reproduces books.py's endpoints and JSON exactly (`GET /api/state`, `/api/pack`, `/files/...`; `POST /api/entity|attach|upload|csv-preview|category|rules|form|profile|meta|doc|year|taxtables|connect|sync|disconnect`, `/api/ai*`), plus `/api/events`, `/api/vault/*`. Listen on `127.0.0.1` only; refuse a foreign `Origin` or `Host` (port `Handler.foreign`). `/mcp` uses the SDK's host/origin validation (`localhostAllowedOrigins`).

## Country packs

Contract: `packages/core/src/country.ts`. A pack = `manifest` + `tables` (validated `tables/<year>.json`) + `table(y)` (closest earlier year) + `playbook` + `strings` + pure calculation exports + optional `crossBorder`.

- **Manifest**: id, names he/en, flag, currency, business types (`key`, he/en `label`/`sub`, `treatment`: sole-proprietor | company | transparent | partnership), default type, legacy `kind` mapping (`il-osek-zair`, `us-llc`), tax-year dates (only when sourced), default chart of accounts.
- **Tables**: numbers stay exactly as in `taxtables.json` (a test proves the split changed nothing); each file adds `sources: { "<field.path>": { url, effective, note? } }`. The IL schema distinguishes `IlTable` (a file; 2024 lacks BL) from `IlRates` (complete; `isComplete(t)`).
- **Entity ↔ pack**: `entity.meta.types[year]` holds the business type; the pack is the one whose manifest lists that type (or `legacyKinds[meta.kind]`). New entities store `kind` too so books.py still opens them.
- **Person level** ("you"): `Person { residence, facts }`. `facts` is today's doc `advisor` (answers: `isWoman`, `childBirthYears`, `parentRole`, `degree*`, `combatReserveDaysPrevYear`, …) plus `profile` facts (`discharge`, `serviceMonths`). Phase 3 stores it once per books (`doc(_app, "person")`), migrating the per-entity `advisor` doc.
- **Cross-border hook**: the residence pack's `crossBorder(person, y, home, foreign, fx)` gets `EntityYear` results from every entity (each computed by its own pack) and returns `{ attributedIncome, foreignTaxCredit, blocked, obligations }`. IL implementation (`ilCrossBorder`): transparent/partnership foreign entities' profit × fx is added to Israeli business income after the zair 30% (`ilPlan.foreign`), so the 30% never applies to it (`blocked: zair, §87ה`), BL applies; foreign tax credit = min(foreign tax × fx, extra Israeli tax caused); obligations 1301, 1324 (when income/credit), 150 per foreign entity. Companies (C-corp) are not attributed (dividends are, later).
- **Forms**: `FormHook<Ctx>` returns `{ field: string }`; IL `form1301` (box numbers as in `app/form` layout), US `llcObligations` now and the 5472/1120 field maps (from `web/src/lib/irs.js`) in phase 3.
- **Tests**: worked examples with literal numbers; IL asserts bit-identity with the old JS via `fixtures/old-js.json` (generated by running `web/src/lib/planner.js`/`advisor.js`).

## i18n and RTL

- Dictionaries stay flat dotted keys (`"nav.home"`), English is the reference, Hebrew must have every key with the same `{vars}` and plural shape (`checkDictionaries`, a Vitest test over the shipped dictionaries + every pack's `strings`). Plurals: `{ one, two?, other }` via `Intl.PluralRules`. Missing → English → the key.
- Phase 3 moves `web/src/lib/locales/**` to `apps/web/src/lib/locales/` unchanged, then merges pack strings at load (`{...app, ...il.strings[lang], ...us.strings[lang]}`); pack keys are `biz.<type>*`, `taxximizer.*`, and new pack keys are prefixed `<packId>.`.
- `apps/web/src/lib/i18n.svelte.ts` wraps `core.translate` with a reactive `lang` (`$state`), sets `<html lang dir>`, remembers the choice (`ob-lang`), and auto-picks Hebrew when the first loaded entity is Israeli and nothing was chosen.
- In templates: user values inside translated sentences go through `bidi()`; amounts and numbers through `ltr()` (in Hebrew); numeric inputs get `dir="ltr"`; dates/numbers via `Intl` with `localeOf(lang)`. Playbook items carry their own `_en`/`_he` fields.
- CSS uses logical properties only (`ms-/me-/ps-/pe-`, `start/end`, `text-start`); direction-implying icons flip with `rtl:-scale-x-100`.

## Privacy mode

Screenshot mode, client-only: amounts are shown inflated 3–9× per value (`core.inflate(n, salt)`, fresh salt each time it's switched on), chart axes scale by one session factor, names and typed numbers are blurred by CSS on `html[data-private]`. Toggle: eye button, `Ctrl/⌘ ⇧ E`, ⌘K; remembered in `localStorage` (`ob-private`). Every amount on screen goes through one formatter (`fmt`/`parts`) that applies it; the server, MCP and AI never see it. Nothing in the books changes.

## UI component standards

- Text never overflows or gets clipped: pills/badges `whitespace-nowrap` and size to content; labels inside controls (buttons, segmented, selects) never truncate; let the control grow or wrap the row instead.
- Tables scroll horizontally inside their own container (`overflow-x-auto`), headers on one line; never clip columns.
- Layouts stack at narrow widths (grid → one column below the breakpoint); side panels move above content.
- Phone width (375 px) works with no horizontal page scroll; every page is checked at 375 px in Hebrew and English.
- Numbers right-aligned with tabular figures (`.num`); money always via `fmt` (privacy, `ltr`).
- Accessibility kept from today: visible focus, labels on inputs, keyboard shortcuts documented in ⌘K, Esc closes drawers.
- `apps/web/src/routes/dev/ui` holds a gallery of every component in both languages for these checks.

## Parity test plan (phase 2 exit)

Real data never leaves the machine and is never read by agents directly. The main session made two copies of the real books folder into a temp dir (`$P/py`, `$P/ts`) and runs the harness with `OPENBOOKS_PARITY_HOME=$P`. Without that variable the harness runs on `examples/demo` (CI).

1. **Dump (Python)**: `OPENBOOKS_HOME=$P/py python3 packages/storage/test/parity/dump.py` imports `books`, and for each entity prints JSON: ledger rows `(id, date, amount, account, desc, source, category, why)`, statements `(file, ok, checks)`, years, and per year: `pl()` lines (revenue, cogs, opex, other, uncat, net), turnover, count, `ask` count, balances at 12-31, 1301 fields (IL) via the old JS run in Bun.
2. **Dump (TS)**: same JSON from `@openbooks/storage` on `$P/ts`, from scratch (delete `books.db`; full ingest) and again on a copy of the Python-made `books.db` (open existing, no re-ingest expected).
3. **Compare**: identical ids, order, categories, `why`, statement checks; amounts and totals equal after `pyRound(x, 2)`. The report prints ids, field names and counts only, never descriptions or amounts.
4. **Round trip**: after TS ingest, books.py opens the TS-written `books.db` and produces the same dump without re-ingesting (statement sigs equal); and vice versa.
5. Phase 4 adds: every MCP tool's `structuredContent` equal between `mcp_server.py` and the TS server on the same copy.

## Phase plan

| Phase                    | Scope                                                                                                                                                                                              | Exit                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1 (done)                 | workspace, schema, core, IL/US/template packs, skeletons, this doc                                                                                                                                 | `bun run test`, `bun run check`, `bun run typecheck` green; old app runs                                             |
| 2 (integrated on `next`) | importers, storage, vault, events, HTTP API parity, distribution spike. All items merged; the server runs on the real packages (no adapters). Demo-mode parity harness and endpoint parity green   | parity harness green on the real-data copy (main session); old web UI (`app/`) works against the TS server unchanged |
| 3                        | SvelteKit screens on the new stores, packs' form hooks, person level, ⌘K (no AI)                                                                                                                   | every view of `web/` ported; 375 px + Hebrew pass; UI standards gallery                                              |
| 4                        | tool registry → MCP stdio/HTTP + in-app AI; port test_mcp.py / test_ai.py / test_connectors.py                                                                                                     | MCP parity on the copy; Claude Desktop + an HTTP client work                                                         |
| 5                        | retire Python: delete books.py, mcp_server.py, ai.py, connectors.py, layout.py (or keep layout.py as a dev tool), web/, app/, taxtables.json, playbook.json, test_*.py; README/docs/mcp.md updated | single binary released                                                                                               |

## Distribution: one file, nothing to install

`bun build --compile --minify apps/server/src/main.ts --outfile dist/openbooks` (targets `bun-linux-x64`, `bun-darwin-arm64`, `bun-darwin-x64`, `bun-windows-x64`). The SvelteKit static build is embedded (`import … with { type: "file" }` / `Bun.embeddedFiles`) and served from memory; pack JSON is bundled by import. `openbooks` starts the server and opens the browser; `openbooks mcp` is the stdio MCP server for Claude Desktop. Still external, same as today: Chrome/Chromium for israeli-bank-scrapers and the proof-pack cover, `pdftotext` for One Zero PDFs (`pdfunite` is replaced by pdf-lib). **Spike resolved (2.10)**: israeli-bank-scrapers + puppeteer-core bundle into the binary and drive system Chrome; the embedded `scrape.js` fallback (`BUN_BE_BUN=1`) works too. Binaries are ~70–94 MB per target. `apps/server/build.ts` builds, `openbooks selftest` (and `scripts/release/smoke.ts`) checks static serving, bun:sqlite, the scrapers import, Chrome and the fallback.

## Open items

- `§87ה` (zair relief blocked on attributed foreign income) and the IL filing date come from the brief, not a cited source: add sources (playbook style) before showing them as advice.
- SvelteKit 3 declares `typescript ^6` as a peer; the root uses TS 7, which has no JS API. Kit's tsconfig validation crashes on it (`ts.sys` undefined), so `apps/web` has no own `tsconfig.json` (the root one covers its `.ts`; kit then skips validation). Pinning `typescript@6` in `apps/web` doesn't help because Bun hoists kit to the root. `.svelte` files are type-checked by `svelte-check` in `bun run check` (`apps/web` `check:svelte`): `apps/web/scripts/svelte-check.cjs` resolves `typescript` to `apps/web`'s TS 6 and uses `apps/web/tsconfig.check.json` (extends kit's generated `$app/tsconfig`; not named `tsconfig.json` so kit's validation stays off).
- SvelteKit 3 dropped `svelte.config.js`: its config is the `sveltekit({...})` plugin argument in `apps/web/vite.config.ts` (3.1 owns that instead), and `$lib` became `#lib` (package.json `imports`).
- books.py's own connection doesn't set `secure_delete`: a secret it deletes or rewrites can leave plaintext in free space until our next vault rewrite/checkpoint. Goes away with books.py in phase 5.
- Oxlint's `number-arg-out-of-range` flags `toFixed(100)` (valid since ES2018); suppressed at the one call site.

## Work items (file ownership, so parallel agents don't collide)

Phase 2 — interfaces above are fixed; each item ships with Vitest tests on synthetic fixtures (never real data).

| #    | Item                                                                                                                                                                | Owns                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 2.1  | Israeli readers: One Zero PDF (pdftotext) + sync JSON, israeli-bank-scrapers JSON (`_local_day` Asia/Jerusalem), bit CSV                                            | `packages/importers/src/readers/{onezero,scraper,bit}.ts`         |
| 2.2  | Mercury JSON/CSV + mapped CSV (`csvDecode/csvTable/csvDate/money/csvRows/mappedCsv/csvPreview`)                                                                     | `packages/importers/src/readers/{mercury,csv}.ts`                 |
| 2.3  | `read()` dispatch, uid (`sha1`, `pyStr`, JSON int detection), `ReadContext`                                                                                         | `packages/importers/src/{read,uid}.ts`, `src/index.ts`            |
| 2.4  | Connectors (Effect): Mercury API, scrape.mjs bridge, One Zero OTP, `status()`, atomic inbox write; port test_connectors.py                                          | `packages/importers/src/connectors/**`                            |
| 2.5  | books.db: open/WAL/0600, schema, JSON-era migration, `Books` service (docs, rules, meta, entities, ingest, ledger, state)                                           | `packages/storage/src/{db,books,ingest,state}.ts`, `src/index.ts` |
| 2.6  | Vault: scrypt + AES-GCM, seal/open, setup/unlock/lock/change/reset, plaintext migration                                                                             | `packages/storage/src/vault.ts`                                   |
| 2.7  | Change events: PubSub, inbox watcher, `data_version` poll                                                                                                           | `packages/storage/src/changes.ts`                                 |
| 2.8  | Server: Bun.serve, guard, every books.py endpoint, `/files`, upload/attach, `/api/pack` (Chrome cover + pdf-lib), `/api/vault/*`, `/api/events` SSE, serving `app/` | `apps/server/src/**` (except `build.ts`)                          |
| 2.9  | Parity harness (dump.py, TS dump, compare, round trip) + demo-data CI mode                                                                                          | `packages/storage/test/parity/**`                                 |
| 2.10 | Distribution spike: `bun build --compile`, embedded static files, scrapers in the binary                                                                            | `apps/server/build.ts`, `scripts/release/**`                      |

Phase 3 — 3.1 lands first (a day), the rest build on its stores and kit; each item owns its routes.

| #    | Item                                                                                                                                                        | Owns                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 3.1  | App shell: SvelteKit SPA config, layout/nav/entity switcher/theme, `api.ts`, books store + SSE, i18n (move dictionaries, merge pack strings), privacy store | `apps/web/{svelte.config.js,vite.config.ts,src/app.html,src/app.css}`, `src/routes/+layout.*`, `src/lib/{api,stores,i18n,privacy}*` |
| 3.2  | UI kit per the UI standards + `/dev/ui` gallery (375 px, he/en)                                                                                             | `apps/web/src/lib/ui/**`, `src/routes/dev/**`                                                                                       |
| 3.3  | Home, Reports (P&L, balance sheet, cash flow, GL), Accounts                                                                                                 | `src/routes/{home,reports,accounts}/**`                                                                                             |
| 3.4  | Transactions + detail drawer, Review queue (shortcuts), Counterparties, Rules                                                                               | `src/routes/{transactions,review,counterparties,rules}/**`                                                                          |
| 3.5  | Setup, Settings (tax tables editor → `_app` overrides, AI setup), Documents, Connections (OTP flow, vault setup/unlock)                                     | `src/routes/{setup,settings,documents,connections}/**`                                                                              |
| 3.6  | Invoices + invoice document, Journal                                                                                                                        | `src/routes/{invoices,journal}/**`                                                                                                  |
| 3.7  | Israeli tax: Tax/1301 return, checks, print (proof-pack cover, 1301 overlay) on `form1301`                                                                  | `src/routes/tax/il/**`, `src/routes/print/**`                                                                                       |
| 3.8  | US tax: TaxUS, 5472/1120 field maps moved from `web/src/lib/irs.js` into `packages/countries/us/src/irs.ts` as FormHooks, Planner page                      | `src/routes/tax/us/**`, `src/routes/planner/**`, `packages/countries/us/src/irs.ts`                                                 |
| 3.9  | Taxximizer + advisor UI, person level ("You": residence, facts; migrate `advisor` docs), cross-border panel                                                 | `src/routes/{taxximizer,you}/**`, `src/lib/person.ts`                                                                               |
| 3.10 | ⌘K bar: pages, transactions, counterparties, quick actions from tool `palette` metadata (AI tab stubbed for phase 4)                                        | `src/lib/ui/CommandBar.svelte`, `src/lib/palette.ts`                                                                                |

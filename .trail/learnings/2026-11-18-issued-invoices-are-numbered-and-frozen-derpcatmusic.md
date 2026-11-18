---
title: "Issued invoices are numbered and frozen by the server inside the doc write's transaction; a stale tab's write is refused, not merged"
author: DerpcatMusic
date: 2026-11-18
branch: books-integrity
cost: { minutes: 21, tokens: 407902 }
id: l-5fa4b2f2
scope: repo
status: active
src: agent
touches:
  - apps/server/src/ai.test.ts
  - apps/server/src/mcp.test.ts
  - apps/server/src/integrity.test.ts
  - apps/server/src/server.ts
  - apps/web/src/lib/IntegrityNotice.svelte
  - apps/web/src/lib/api.ts
  - apps/web/src/lib/locales/en.ts
  - apps/web/src/lib/locales/he.ts
  - apps/web/src/lib/locales/parts/b.en.ts
  - apps/web/src/lib/locales/parts/b.he.ts
---

## Decided

- Numbering, the no-edit/no-delete/no-backdate rules and credit (cancellation) documents run inside writeDoc's SQLite immediate transaction, against the stored list read in that same transaction. That is what makes two tabs issuing at once safe across processes too (MCP stdio, books.py), not just in-process.
- The client's `number` is ignored on issue; prints and cancelledBy are server-kept and taken from the stored copy, so a stale client can't reset them.
- A whole-doc write from a tab that hasn't seen another tab's issue is refused ("Document N is issued: it can't be deleted"), not merged. Refusing is the safe default; the app reloads on refusal.
- Ingest under a close date keeps the stored closed rows byte-for-byte (added, removed and changed rows inside the period are dropped) and records the attempt in the audit log, instead of failing the whole import.
- Audit rows hold only the changed items of a doc (by id or key), capped at 8,000 chars per side (past that, sha256 plus a summary). Pseudo-entities (_ai, _app, _vault) are never audited because they can hold keys. Connection changes record provider names only.

## Watch out

- The audit `to` filter compares UTC ISO timestamps with "YYYY-MM-DD~", so day filters are UTC days.
- The print count goes up when the print dialog opens (beforeprint). A cancelled dialog still counts, which errs toward marking later prints as copies.

In the code: packages/core/src/documents.ts (issueDocs, billProblem), packages/storage/src/books.ts (docRules, writeDoc, recordPrint), packages/storage/src/audit.ts, packages/storage/src/ingest.ts (IngestOptions.close).

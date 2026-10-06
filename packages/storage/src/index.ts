// books.db (bun:sqlite, schema identical to books.py), ingest, the secret vault, change events. API: docs/architecture.md "Storage".
export { BadInput, Books, booksLayer, makeBooks, UnknownEntity, type BooksApi, type BooksOptions } from "./books.ts";
export { isEntityId, migrate, openDb, SCHEMA } from "./db.ts";
export { ingest, KINDS, sigOf, uid, type Read, type ReadContext, type StatementFile } from "./ingest.ts";
export { connections, RESERVED, taxTables, type Connection, type State } from "./state.ts";
export * from "./vault.ts";
export * from "./changes.ts";
export { connectionStoreLayer, connectionVaultLayer } from "./connect.ts";

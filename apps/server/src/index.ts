// The local server (Bun.serve on 127.0.0.1): /api/*, /api/events (SSE), /files, the built web app; /mcp in phase 4.
export { embeddedStatic, startServer, type ServerOptions } from "./server.ts";
export { foreign } from "./guard.ts";
export { buildPack, merge } from "./pack.ts";
export * from "./services.ts";

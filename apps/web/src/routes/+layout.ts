import { installDemo } from "#lib/demo.ts";

// SPA: every page is rendered in the browser from the fallback page (adapter-static); nothing is prerendered.
export const ssr = false;
export const prerender = false;

if (import.meta.env.VITE_DEMO) installDemo();
// dynamic: the books-in-IndexedDB code (statement readers, pdf-lib) ships only in the VITE_LOCAL build
if (import.meta.env.VITE_LOCAL) (await import("#lib/local/index.ts")).installLocal();

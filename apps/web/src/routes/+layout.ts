import { installDemo } from "#lib/demo.ts";

// SPA: every page is rendered in the browser from the fallback page (adapter-static); nothing is prerendered.
export const ssr = false;
export const prerender = false;

if (import.meta.env.VITE_DEMO) installDemo();

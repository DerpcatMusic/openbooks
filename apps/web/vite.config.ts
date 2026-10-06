import { defineConfig, lazyPlugins } from "vite-plus";

// SvelteKit 3 reads its config from the plugin options here (svelte.config.js is no longer supported).
// SPA: adapter-static with a fallback page, ssr off in routes/+layout.ts. The server serves build/ and falls back to index.html.
// Dev: `OPENBOOKS_API=http://127.0.0.1:8903 bun run dev` proxies the API to a running server (books.py or apps/server).
const api = process.env.OPENBOOKS_API ?? "http://127.0.0.1:8765";

export default defineConfig({
  plugins: lazyPlugins(async () => {
    const [{ sveltekit }, { default: adapter }, { default: tailwindcss }] = await Promise.all([
      import("@sveltejs/kit/vite"),
      import("@sveltejs/adapter-static"),
      import("@tailwindcss/vite"),
    ]);
    // OPENBOOKS_BASE: serve under a sub-path (the GitHub Pages demo is /openbooks/demo); GitHub Pages answers unknown paths with 404.html.
    const out = process.env.OPENBOOKS_OUT ?? "build";
    const base = (process.env.OPENBOOKS_BASE ?? "") as "" | `/${string}`;
    return [
      tailwindcss(),
      await sveltekit({ adapter: adapter({ pages: out, assets: out, fallback: base ? "404.html" : "index.html" }), paths: { base, relative: !base } }),
    ];
  }),
  server: { proxy: { "/api": api, "/files": api } },
});

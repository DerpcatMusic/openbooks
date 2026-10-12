// Type-checks .svelte files (and the .ts they import) with svelte-check. svelte-check needs the TypeScript 6 JS API, but Bun
// hoists it to the workspace root, where `typescript` is 7 (no JS API): resolve "typescript" to apps/web's own TS 6 instead.
// Run: bun run --cwd apps/web check:svelte   (root: bun run check)
// Only hook when needed (hoisted linker): under Bun's isolated linker (CI's default) svelte-check already gets TS 6, and any
// _resolveFilename hook makes Bun fail to resolve symlinked deps such as vite-plus's native binding, so the vite.config never loads.
const Module = require("node:module");
const path = require("node:path");
const web = path.join(__dirname, "..");
const checkDir = path.dirname(require.resolve("svelte-check/package.json", { paths: [web] }));
const tsMajor = require(require.resolve("typescript/package.json", { paths: [checkDir] })).version.split(".")[0];
if (tsMajor !== "6") {
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (request === "typescript" || request.startsWith("typescript/"))
      return resolve.call(this, request, { ...parent, paths: [path.join(web, "node_modules")] }, ...rest);
    return resolve.call(this, request, parent, ...rest);
  };
}
process.argv.push("--workspace", web, "--tsconfig", path.join(web, "tsconfig.check.json"), "--threshold", "warning");
require(require.resolve("svelte-check/bin/svelte-check", { paths: [web] }));

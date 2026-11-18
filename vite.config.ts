import { defineConfig } from "vite-plus";

// Workspace root: lint/format for every package, and `vp test` runs every *.test.ts under packages/ and apps/.
// The Python app and its web/ + app/ build are legacy until phase 5: not formatted or linted here. graft/ is the local trail code map (git-ignored).
const legacy = [
  "web/**",
  "app/**",
  "graft/**",
  "examples/**",
  "connectors/**",
  "docs/mcp.md",
  "README.md",
  "playbook.json",
  "taxtables.json",
  "**/fixtures/**",
];
// Research docs and the sourced rule/tax tables keep their hand-set layout (one fact per line, long source strings): fmt only.
const keepLayout = ["docs/*.md", "packages/countries/*/tables/*.json"];

export default defineConfig({
  // tests never reach the real Bank of Israel: rates come from a fake server the test starts, or stay missing
  test: { include: ["packages/**/*.test.ts", "apps/**/*.test.ts"], env: { OPENBOOKS_BOI_API: "http://127.0.0.1:9/EXR" } },
  fmt: { printWidth: 160, ignorePatterns: [...legacy, ...keepLayout] },
  lint: { ignorePatterns: legacy, options: { typeAware: true, typeCheck: true } },
});

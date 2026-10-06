import { defineConfig } from "vite-plus";

// Workspace root: lint/format for every package, and `vp test` runs every *.test.ts under packages/ and apps/.
// The Python app and its web/ + app/ build are legacy until phase 5: not formatted or linted here.
const legacy = ["web/**", "app/**", "examples/**", "connectors/**", "docs/mcp.md", "README.md", "playbook.json", "taxtables.json", "**/fixtures/**"];

export default defineConfig({
  test: { include: ["packages/**/*.test.ts", "apps/**/*.test.ts"] },
  fmt: { printWidth: 160, ignorePatterns: legacy },
  lint: { ignorePatterns: legacy, options: { typeAware: true, typeCheck: true } },
});

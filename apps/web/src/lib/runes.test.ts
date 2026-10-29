import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

// Svelte only compiles runes in .svelte and .svelte.ts files; in a plain .ts file `$state` is an undefined global at runtime ("$state is not defined").
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

test("no runes in plain .ts files", () => {
  const bad = walk(new URL("..", import.meta.url).pathname)
    .filter((f) => /\.ts$/.test(f) && !/\.svelte\.ts$/.test(f) && !/\.test\.ts$/.test(f))
    .filter((f) => /\$(state|derived|effect|props|bindable)\b/.test(readFileSync(f, "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")));
  expect(bad).toEqual([]);
});

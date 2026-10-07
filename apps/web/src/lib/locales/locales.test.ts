import { checkDictionaries } from "@openbooks/core";
import { il } from "@openbooks/country-il";
import { us } from "@openbooks/country-us";
import { expect, test } from "vite-plus/test";
import en from "./en.ts";
import he from "./he.ts";

// The same merge i18n.svelte.ts does at load: app dictionaries, then every pack's strings.
test("Hebrew has every English key with the same {vars} and plural shape (app + packs)", () => {
  const packs = [il, us];
  expect(checkDictionaries(en, he)).toEqual([]);
  for (const p of packs) expect(checkDictionaries(p.strings.en, p.strings.he)).toEqual([]);
  const merged = (l: "en" | "he") => Object.assign({}, l === "en" ? en : he, ...packs.map((p) => p.strings[l]));
  expect(checkDictionaries(merged("en"), merged("he"))).toEqual([]);
});

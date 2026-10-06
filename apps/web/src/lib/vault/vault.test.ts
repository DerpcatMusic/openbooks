import { checkDictionaries } from "@openbooks/core";
import { expect, test } from "vitest";
import en from "../locales/parts/3-5.en.ts";
import he from "../locales/parts/3-5.he.ts";

test("3.5 strings: Hebrew has every English key with the same {vars}", () => {
  expect(checkDictionaries(en, he)).toEqual([]);
});

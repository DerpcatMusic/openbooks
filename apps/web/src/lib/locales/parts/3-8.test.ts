import { checkDictionaries } from "@openbooks/core";
import { expect, test } from "vitest";
import en from "./3-8.en.ts";
import he from "./3-8.he.ts";

test("3.8 strings: Hebrew matches English keys, {vars} and plurals", () => expect(checkDictionaries(en, he)).toEqual([]));

// Drilldowns into other screens, in the old app's #/view/arg shape: /transactions/cat:expense:software, /transactions/month:2026-04,
// /transactions/type:equity, /transactions/account:Mercury Credit, /transactions/ask (the root layout maps old #/ links the same way).
import { goto } from "#lib/nav.ts";

export const go = (view: string, arg = "") => goto(`/${view}${arg ? `/${encodeURIComponent(arg)}` : ""}`);

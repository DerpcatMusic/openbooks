// The in-app AI (port of ai.py): an agent loop over the same tool registry MCP serves. Providers: Anthropic (Messages API) and
// anything OpenAI-compatible (OpenAI, OpenRouter, Ollama, a custom base URL). Settings are the `secret` row ("_ai", "config"); its
// `keys` field is sealed by the vault (locked → VaultLocked → 423). Keys go only to the provider in a header: never to the browser
// (masked), never into a URL, never logged, scrubbed from provider errors. Read tools run on their own; every write waits for the
// user's Approve (decide()). The system prompt, Approve cards and user-facing errors follow the app's language (he/en).
import { ConnectionStore, type Conn } from "@openbooks/importers";
import { Vault } from "@openbooks/storage";
import { Cause, Data, Effect, Exit } from "effect";
import type { Lang, Needs } from "./registry.ts";
import { aiTools, entityOf, runTool, toolByName } from "./tools.ts";

export const MAX_STEPS = 8; // model calls per question
const MAX_RESULT = 20000; // characters of one tool result sent back to the model
const CONFIRM_WAIT = 600_000; // ms a write waits for Approve/Deny before it counts as denied
const IDLE = 120_000; // ms without a byte from the provider before giving up

export class AIError extends Data.TaggedError("AIError")<{ readonly message: string }> {}

type Provider = { label: string; api: "anthropic" | "openai"; base: string; model: string; models: string[]; key: boolean | null };
export const PROVIDERS: Record<string, Provider> = {
  anthropic: {
    label: "Anthropic",
    api: "anthropic",
    base: "https://api.anthropic.com/v1",
    model: "claude-sonnet-5-5",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"],
    key: true,
  },
  openai: { label: "OpenAI", api: "openai", base: "https://api.openai.com/v1", model: "gpt-5", models: [], key: true },
  openrouter: { label: "OpenRouter", api: "openai", base: "https://openrouter.ai/api/v1", model: "openai/gpt-5", models: [], key: true },
  ollama: { label: "Ollama (local)", api: "openai", base: "http://localhost:11434/v1", model: "", models: [], key: false },
  custom: { label: "Custom OpenAI-compatible", api: "openai", base: "", model: "", models: [], key: null }, // key optional
};

const T = {
  en: {
    unknownProvider: "unknown provider",
    badBase: "base URL must start with http:// or https://",
    notReady: "Pick a provider and model, and add a key if it needs one.",
    notSetUp: "AI isn't set up: pick a provider in Settings → AI.",
    locked: "unlock OpenBooks in the app first",
    unknownEntity: "unknown entity",
    nothing: "nothing to answer",
    unreachable: (h: string, why: string) => `can't reach ${h}: ${why}`,
    answered: (h: string, code: number) => `${h} answered ${code}`,
    providerError: "provider error",
    failed: (why: string) => `AI request failed (${why})`,
    stopped: `\n\n_Stopped after ${MAX_STEPS} steps. Ask again to continue._`,
  },
  he: {
    unknownProvider: "ספק לא מוכר",
    badBase: "כתובת הבסיס חייבת להתחיל ב-http:// או ב-https://",
    notReady: "בחרו ספק ומודל, והוסיפו מפתח אם הספק דורש.",
    notSetUp: "ה-AI לא מוגדר: בחרו ספק בהגדרות ← AI.",
    locked: "פתחו קודם את הנעילה של OpenBooks באפליקציה",
    unknownEntity: "עסק לא מוכר",
    nothing: "אין על מה לענות",
    unreachable: (h: string, why: string) => `אין גישה אל ${h}: ${why}`,
    answered: (h: string, code: number) => `${h} החזיר ${code}`,
    providerError: "שגיאה אצל הספק",
    failed: (why: string) => `בקשת ה-AI נכשלה (${why})`,
    stopped: `\n\n_נעצר אחרי ${MAX_STEPS} צעדים. שאלו שוב כדי להמשיך._`,
  },
} as const;
export const langOf = (v: unknown): Lang => (v === "he" ? "he" : "en");
const fail = (message: string) => new AIError({ message });

// ---------- settings ----------
type Cfg = { provider?: string; model?: string; base?: string; keys?: Record<string, string> };
type Active = { provider: string; api: Provider["api"]; base: string; model: string; key: string };

/** The settings, keys opened (VaultLocked when sealed and locked). */
export const loadAi = Effect.gen(function* () {
  const row = (yield* ConnectionStore.use((s) => s.rows("_ai"))).config;
  return row ? ((yield* Vault.use((v) => v.reveal("_ai", "config", row as Record<string, unknown>))) as Cfg) : {};
});
const save = (cfg: Cfg) =>
  Vault.use((v) => v.conceal("_ai", "config", cfg)).pipe(Effect.flatMap((row) => ConnectionStore.use((s) => s.putRows("_ai", { config: row as Conn }))));

export const mask = (k: string) => (k.length >= 12 ? `${k.slice(0, 3)}…${k.slice(-4)}` : "…set");

/** What a request uses; null when nothing usable is set up. */
export function active(cfg: Cfg): Active | null {
  const p = cfg.provider && Object.hasOwn(PROVIDERS, cfg.provider) ? PROVIDERS[cfg.provider] : undefined;
  if (!p || !cfg.provider) return null;
  const out = {
    provider: cfg.provider,
    api: p.api,
    base: (cfg.base || p.base).replace(/\/+$/, ""),
    model: cfg.model || p.model,
    key: cfg.keys?.[cfg.provider] ?? "",
  };
  return out.base && out.model && (out.key || !p.key) ? out : null;
}

/** What the browser may see: never a key, only whether one is set (masked). */
export const publicAi = (cfg: Cfg) => ({
  provider: cfg.provider ?? null,
  model: cfg.model ?? "",
  base: cfg.base ?? "",
  ready: active(cfg) !== null,
  keys: Object.fromEntries(Object.entries(cfg.keys ?? {}).flatMap(([p, k]) => (k ? [[p, mask(k)]] : []))),
  providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, { label, base, model, models, key }]) => [k, { label, base, model, models, key }])),
});

const httpUrl = (s: string) => {
  try {
    return ["http:", "https:"].includes(new URL(s).protocol);
  } catch {
    return false;
  }
};
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** {provider, model?, base?, key?, clearKey?}: the key is only replaced when a new one is typed. */
export const configureAi = (b: Record<string, unknown>, lang: Lang) =>
  Effect.gen(function* () {
    const provider = str(b.provider);
    if (!Object.hasOwn(PROVIDERS, provider)) return yield* fail(T[lang].unknownProvider);
    const base = str(b.base);
    if (base && !httpUrl(base)) return yield* fail(T[lang].badBase);
    const keys = { ...(yield* loadAi).keys };
    if (b.clearKey) delete keys[provider];
    const k = str(b.key);
    if (k) keys[provider] = k;
    const cfg = { provider, model: str(b.model), base, keys };
    yield* save(cfg);
    return publicAi(cfg);
  });

// ---------- HTTP ----------
/** POST JSON (GET without a body); yields the response's lines. Errors carry the provider's message, never our headers. */
async function* lines(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal, lang: Lang, idle = IDLE): AsyncGenerator<string> {
  const host = new URL(url).hostname;
  const ac = new AbortController();
  const stop = () => ac.abort();
  signal.addEventListener("abort", stop);
  let timer = setTimeout(stop, idle);
  try {
    let r: Response;
    try {
      r = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: ac.signal,
      });
    } catch (x) {
      throw fail(T[lang].unreachable(host, signal.aborted ? "aborted" : ac.signal.aborted ? "timed out" : (x as Error).message));
    }
    if (!r.ok) {
      let msg: unknown;
      try {
        const j = (await r.json()) as { error?: unknown; message?: unknown };
        msg = j.error && typeof j.error === "object" ? (j.error as { message?: unknown }).message : (j.error ?? j.message);
      } catch {}
      throw fail(T[lang].answered(host, r.status) + (msg ? `: ${(typeof msg === "string" ? msg : JSON.stringify(msg)).slice(0, 300)}` : ""));
    }
    let buf = "";
    for await (const chunk of r.body!.pipeThrough(new TextDecoderStream())) {
      clearTimeout(timer);
      timer = setTimeout(stop, idle);
      buf += chunk;
      const parts = buf.split("\n");
      buf = parts.pop()!;
      for (const l of parts) yield l.replace(/\r$/, "");
    }
    if (buf) yield buf;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

/** Server-sent events → each data payload as JSON ([DONE] ends the stream). */
async function* sse(ls: AsyncIterable<string>): AsyncGenerator<Record<string, any>> {
  for await (const l of ls) {
    if (!l.startsWith("data:")) continue;
    const d = l.slice(5).trim();
    if (d === "[DONE]") return;
    if (d) yield JSON.parse(d);
  }
}
const scrub = (s: string, cfg: Active) => (cfg.key ? s.split(cfg.key).join("…") : s);
const argsOf = (s: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(s || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

// ---------- providers: provider-neutral messages in, (text, calls) out ----------
type Call = { id: string; name: string; args: Record<string, unknown> };
type Msg = { role: "user" | "assistant"; content: string; calls?: Call[] } | { role: "tool"; id: string; name: string; content: string; error: boolean };
type AiTool = ReturnType<typeof aiTools>[number];
type Chat = (
  cfg: Active,
  system: string,
  msgs: Msg[],
  tools: AiTool[],
  onText: (t: string) => void,
  lang: Lang,
  signal: AbortSignal,
  maxTokens?: number,
) => Promise<[string, Call[]]>;

const anthropic: Chat = async (cfg, system, msgs, tools, onText, lang, signal, maxTokens = 4096) => {
  const out: { role: string; content: unknown }[] = [];
  for (const m of msgs) {
    if (m.role === "tool") {
      const block = { type: "tool_result", tool_use_id: m.id, content: m.content, ...(m.error ? { is_error: true } : {}) };
      const last = out.at(-1);
      if (last?.role === "user" && Array.isArray(last.content)) last.content.push(block);
      else out.push({ role: "user", content: [block] });
    } else if (m.role === "assistant") {
      const c = [
        ...(m.content ? [{ type: "text", text: m.content }] : []),
        ...(m.calls ?? []).map((x) => ({ type: "tool_use", id: x.id, name: x.name, input: x.args })),
      ];
      out.push({ role: "assistant", content: c.length ? c : [{ type: "text", text: "…" }] });
    } else out.push({ role: "user", content: m.content });
  }
  const body: Record<string, unknown> = { model: cfg.model, max_tokens: maxTokens, system, messages: out, stream: true };
  if (tools.length) body.tools = tools;
  let text = "";
  const blocks = new Map<number, { id: string; name: string; json: string }>();
  for await (const ev of sse(lines(`${cfg.base}/messages`, { "x-api-key": cfg.key, "anthropic-version": "2023-06-01" }, body, signal, lang))) {
    if (ev.type === "error") throw fail(ev.error?.message || T[lang].providerError);
    if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use")
      blocks.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, json: "" });
    else if (ev.type === "content_block_delta") {
      const d = ev.delta ?? {};
      if (d.type === "text_delta") {
        text += d.text;
        onText(d.text);
      } else if (d.type === "input_json_delta" && blocks.has(ev.index)) blocks.get(ev.index)!.json += d.partial_json ?? "";
    }
  }
  return [text, [...blocks.entries()].sort(([a], [b]) => a - b).map(([, b]) => ({ id: b.id, name: b.name, args: argsOf(b.json) }))];
};

const openai: Chat = async (cfg, system, msgs, tools, onText, lang, signal, maxTokens) => {
  const out: Record<string, unknown>[] = [{ role: "system", content: system }];
  for (const m of msgs) {
    if (m.role === "tool") out.push({ role: "tool", tool_call_id: m.id, content: m.content });
    else if (m.role === "assistant")
      out.push({
        role: "assistant",
        content: m.content || null,
        ...(m.calls?.length
          ? { tool_calls: m.calls.map((x) => ({ id: x.id, type: "function", function: { name: x.name, arguments: JSON.stringify(x.args) } })) }
          : {}),
      });
    else out.push({ role: "user", content: m.content });
  }
  const body: Record<string, unknown> = { model: cfg.model, messages: out, stream: true };
  if (maxTokens) body.max_completion_tokens = maxTokens;
  if (tools.length) body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  let text = "";
  const calls = new Map<number, { id: string; name: string; json: string }>();
  for await (const ev of sse(lines(`${cfg.base}/chat/completions`, cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}, body, signal, lang))) {
    if (ev.error) throw fail(String(typeof ev.error === "object" ? ev.error.message : ev.error));
    for (const ch of ev.choices ?? []) {
      const d = ch.delta ?? {};
      if (d.content) {
        text += d.content;
        onText(d.content);
      }
      for (const tc of d.tool_calls ?? []) {
        const i = tc.index ?? 0;
        const c = calls.get(i) ?? { id: "", name: "", json: "" };
        calls.set(i, c);
        c.id = tc.id || c.id;
        c.name += tc.function?.name ?? "";
        c.json += tc.function?.arguments ?? "";
      }
    }
  }
  return [text, [...calls.entries()].sort(([a], [b]) => a - b).map(([i, c]) => ({ id: c.id || `call${i}`, name: c.name, args: argsOf(c.json) }))];
};
const API = { anthropic, openai };

/** A failed provider call as an AIError with the key scrubbed; anything else is a defect named by type. */
const chat = (cfg: Active, lang: Lang, ...a: [string, Msg[], AiTool[], (t: string) => void, number?]) =>
  Effect.tryPromise({
    try: (signal) => API[cfg.api](cfg, a[0], a[1], a[2], a[3], lang, signal, a[4]),
    catch: (x) => (x instanceof AIError ? fail(scrub(x.message, cfg)) : fail(T[lang].failed((x as Error)?.name ?? "error"))),
  });

/** The saved settings answer "OK" (Settings → AI → Test). */
export const testAi = (lang: Lang) =>
  Effect.gen(function* () {
    const cfg = active(yield* loadAi);
    if (!cfg) return yield* fail(T[lang].notReady);
    const [text] = yield* chat(cfg, lang, "Reply with the single word OK.", [{ role: "user", content: "ping" }], [], () => {}, 16);
    return { ok: true, model: cfg.model, reply: text.trim().slice(0, 80) };
  });

/** Model names from a local Ollama (/api/tags lives beside /v1). */
export const ollamaModels = (base: unknown, lang: Lang) =>
  Effect.tryPromise({
    try: async (signal) => {
      const b = (str(base) || PROVIDERS.ollama!.base).replace(/\/+$/, "").replace(/\/v1$/, "");
      if (!httpUrl(b)) throw fail(T[lang].badBase);
      let s = "";
      for await (const l of lines(`${b}/api/tags`, {}, undefined, signal, lang, 5000)) s += l;
      return { models: ((JSON.parse(s || "{}").models ?? []) as { name: string }[]).map((m) => m.name) };
    },
    catch: (x) => (x instanceof AIError ? x : fail(T[lang].failed((x as Error)?.name ?? "error"))),
  });

// ---------- prompts ----------
type Meta = { name?: string; kind?: string; currency?: string; types?: Record<string, string> };
const bizType = (m: Meta, year: number) => {
  const past = Object.keys(m.types ?? {})
    .filter((k) => Number(k) <= year)
    .sort();
  return past.length ? m.types![past.at(-1)!]! : ({ "il-osek-zair": "osek-zair", "us-llc": "llc-disregarded" } as Record<string, string>)[m.kind ?? ""] || "";
};
const PAGES = "home, transactions, invoices, review, reports, counterparties, rules, accounts, journal, documents, connections, tax, planner, settings";
const ymd = () => new Date().toLocaleDateString("sv-SE");

export function systemPrompt(e: { id: string; meta: Meta }, year: number, lang: Lang) {
  const m = e.meta,
    name = m.name || e.id,
    bt = bizType(m, year);
  if (lang === "he")
    return (
      `אתה העוזר בתוך OpenBooks, אפליקציית הנהלת חשבונות מקומית. היום ${ymd()}.\n` +
      `העסק הנוכחי: ${name} (מזהה עסק "${e.id}"), סוג ${m.kind}, סוג העסק ב-${year}: ${bt || "לא הוגדר"}, מטבע ${m.currency}. שנת המס שנבחרה: ${year}.\n` +
      "השתמש בכלים כדי לבדוק מספרים; לעולם אל תנחש או תמציא סכומים. כלים שכותבים מבקשים מהמשתמש אישור קודם; אמור מה תשנה לפני שאתה קורא לאחד מהם.\n" +
      "היה תמציתי. ענה בשפת המשתמש (עברית או אנגלית). ממשק האפליקציה בעברית: ענה בעברית אלא אם המשתמש כותב בשפה אחרת. " +
      "השתמש בפסקאות קצרות, רשימות, **הדגשה** וטבלאות פשוטות. כתוב סכומים עם סימן המטבע ומפרידי אלפים.\n" +
      "כשאתה מזכיר תנועה מסוימת, כלול את המזהה שלה בתוך backticks, למשל `a1b2c3d4e5f6`, כדי שהאפליקציה תקשר אליה. " +
      `אפשר לקשר לעמודי האפליקציה כקישורי markdown אל #/<page>, העמודים: ${PAGES}.\n` +
      "זו עזרה בהנהלת חשבונות, לא ייעוץ מס או ייעוץ משפטי: אמור זאת כשאתה נותן נתוני מס, והצע לפנות לאיש מקצוע בהחלטות על הגשת דוחות."
    );
  return (
    `You are the assistant inside OpenBooks, a local bookkeeping app. Today is ${ymd()}.\n` +
    `Current business: ${name} (entity id "${e.id}"), kind ${m.kind}, business type in ${year}: ${bt || "not set"}, currency ${m.currency}. Selected tax year: ${year}.\n` +
    "Use the tools to look up numbers; never guess or invent amounts. Tools that write ask the user to approve first; say what you will change before calling one.\n" +
    "Be concise. Answer in the user's language (Hebrew or English). The app's interface is in English: use English unless the user writes in another language. " +
    "Use short paragraphs, lists, **bold** and simple tables. Write amounts with the currency symbol and thousands separators.\n" +
    "When you mention a specific transaction, include its id in backticks, e.g. `a1b2c3d4e5f6`, so the app can link it. " +
    `You can link app pages as markdown links to #/<page>, pages: ${PAGES}.\n` +
    "This is bookkeeping help, not tax or legal advice: say so when giving tax figures, and suggest a professional for filing decisions."
  );
}

/** One line for the Approve/Deny card, in the app's language. */
export function describe(name: string, a: Record<string, unknown>, lang: Lang): string {
  const n = (k: string) => (Array.isArray(a[k]) ? (a[k] as unknown[]).length : 0);
  const v = (k: string) => (typeof a[k] === "string" || typeof a[k] === "number" ? String(a[k]) : "");
  const he = lang === "he";
  switch (name) {
    case "classify":
      return he
        ? `לסווג ${n("ids")} תנועות כ-${v("category")}` + (v("rule") ? `, ולהוסיף את הכלל "${v("rule")}"` : "")
        : `Set ${v("category")} on ${n("ids")} transaction(s)` + (v("rule") ? `, and add the rule "${v("rule")}"` : "");
    case "set_rules":
      return he ? `להחליף את כל כללי הסיווג ב-${n("rules")} כללים` : `Replace all categorization rules with ${n("rules")} rule(s)`;
    case "add_journal_entry":
      return he
        ? `להוסיף פקודת יומן ב-${v("date")}: ${v("memo")} (${n("lines")} שורות)`
        : `Add a journal entry on ${v("date")}: ${v("memo")} (${n("lines")} lines)`;
    case "create_invoice":
      return he ? `לשמור טיוטת חשבונית עבור ${v("customer")} (${n("items")} פריטים)` : `Save a draft invoice for ${v("customer")} (${n("items")} item(s))`;
    case "bank_sync":
      return he ? `לסנכרן את ${v("provider") || "כל הבנקים המחוברים"} (פנייה לבנק)` : `Sync ${v("provider") || "every connected bank"} (contacts the bank)`;
  }
  return `${name} ${JSON.stringify(a).slice(0, 200)}`;
}

// ---------- the agent loop ----------
const PENDING = new Map<string, (ok: boolean) => void>(); // confirmation id → resolve: a write waiting for Approve/Deny

/** /api/ai/confirm: false when the id is unknown or already used. */
export function decide(id: string, ok: boolean) {
  const r = PENDING.get(id);
  if (!r) return false;
  r(ok);
  return true;
}
export const pendingCount = () => PENDING.size;

const askUser = (emit: (ev: AiEvent) => void, name: string, args: Record<string, unknown>, lang: Lang) =>
  Effect.callback<boolean>((resume) => {
    const id = crypto.randomUUID().replaceAll("-", "");
    const done = (ok: boolean) => {
      clearTimeout(t);
      PENDING.delete(id);
      resume(Effect.succeed(ok));
    };
    const t = setTimeout(() => done(false), CONFIRM_WAIT);
    PENDING.set(id, done);
    emit({ type: "confirm", id, name, summary: describe(name, args, lang), args });
    return Effect.sync(() => {
      clearTimeout(t);
      PENDING.delete(id);
    });
  });

export type AiEvent =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; args: Record<string, unknown> }
  | { type: "confirm"; id: string; name: string; summary: string; args: Record<string, unknown> }
  | { type: "tool_done"; id: string; ok: boolean; error?: string; txns?: string[] }
  | { type: "error"; error: string }
  | { type: "done" };

/**
 * One question (POST /api/ai). body: {messages: [{role: user|assistant, content}], entity, year?, lang?}. Never fails: everything,
 * including a locked vault, ends as an `error` event; interrupting the fiber (the user closed the bar) aborts the provider request.
 */
export const ask = (body: Record<string, unknown>, emit: (ev: AiEvent) => void) =>
  Effect.gen(function* () {
    const lang = langOf(body.lang),
      t = T[lang];
    const saved = yield* Effect.exit(loadAi);
    if (Exit.isFailure(saved)) return emit({ type: "error", error: t.locked });
    const cfg = active(saved.value);
    if (!cfg) return emit({ type: "error", error: t.notSetUp });
    const found = yield* Effect.exit(entityOf({}, { entity: typeof body.entity === "string" && body.entity ? body.entity : "-" }));
    if (Exit.isFailure(found)) return emit({ type: "error", error: t.unknownEntity });
    const e = found.value;
    const history = Array.isArray(body.messages) ? body.messages.slice(-30) : [];
    const msgs: Msg[] = history.flatMap((m: { role?: unknown; content?: unknown }) =>
      m && (m.role === "user" || m.role === "assistant") && m.content
        ? [{ role: m.role, content: (typeof m.content === "string" ? m.content : JSON.stringify(m.content)).slice(0, 20000) }]
        : [],
    );
    if (msgs.at(-1)?.role !== "user") return emit({ type: "error", error: t.nothing });
    const year = Number.parseInt(`${body.year as number | string}`, 10) || new Date().getFullYear();
    const system = systemPrompt(e as { id: string; meta: Meta }, year, lang),
      ts = aiTools();
    for (let step = 0; step < MAX_STEPS; step++) {
      const [text, calls] = yield* chat(cfg, lang, system, msgs, ts, (d) => emit({ type: "text", text: d }));
      msgs.push({ role: "assistant", content: text, calls });
      if (!calls.length) return emit({ type: "done" });
      for (const c of calls) {
        const { confirm: _, ...rest } = c.args;
        const args = { ...rest, entity: e.id }; // the app's current business, whatever the model says
        emit({ type: "tool", id: c.id, name: c.name, args: c.args });
        let res: unknown, err: string | undefined;
        if (toolByName(c.name)?.kind === "write" && !(yield* askUser(emit, c.name, args, lang)))
          err = "The user declined this change. Don't retry it unless they ask.";
        else {
          const x = yield* Effect.exit(runTool(c.name, args, { entity: e.id, lang, via: "ai", confirmed: true }));
          if (Exit.isSuccess(x)) res = x.value;
          else {
            const f = Cause.squash(x.cause) as { _tag?: string; message?: string; name?: string };
            err = f?._tag === "ToolError" ? f.message : `${c.name} failed (${f?._tag ?? f?.name ?? "error"})`; // never the message of unknown errors
          }
        }
        const r = (res ?? {}) as { transactions?: { id?: string }[]; transaction?: { id?: string } };
        const ids = [
          ...(Array.isArray(r.transactions) ? r.transactions.flatMap((x) => (x?.id ? [x.id] : [])) : []),
          ...(r.transaction?.id ? [r.transaction.id] : []),
        ];
        emit({ type: "tool_done", id: c.id, ok: err === undefined, ...(err ? { error: err } : {}), ...(ids.length ? { txns: ids.slice(0, 50) } : {}) });
        msgs.push({ role: "tool", id: c.id, name: c.name, error: err !== undefined, content: err ?? JSON.stringify(res).slice(0, MAX_RESULT) });
      }
    }
    emit({ type: "text", text: t.stopped });
    emit({ type: "done" });
  }).pipe(
    Effect.catchTag("AIError", (x) => Effect.sync(() => emit({ type: "error", error: x.message }))),
    Effect.catchCause((c) =>
      Cause.hasInterruptsOnly(c)
        ? Effect.failCause(c)
        : Effect.sync(() => emit({ type: "error", error: T[langOf(body.lang)].failed((Cause.squash(c) as Error)?.name ?? "error") })),
    ),
  ) as Effect.Effect<void, never, Needs>;

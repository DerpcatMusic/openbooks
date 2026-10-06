// Phase 4 wiring for ⌘K: the "Ask AI" backend (POST /api/ai as SSE, /api/ai/confirm) and the tool registry's palette items
// (GET /api/tools, POST /api/tools/run). installAi() once at startup; refreshAi() after Settings → AI changes the provider.
import { request } from "./api.ts";
import { I, t } from "./i18n.svelte.ts";
import { registerTools, setAiBackend, type AiEvent, type PaletteTool } from "./palette.ts";
import { S } from "./stores/books.svelte.ts";
import { toast } from "./ui/toast.svelte.ts";

let ready = false;
/** Re-read whether a provider is configured (ready() must answer synchronously when the bar opens). */
export const refreshAi = () =>
  request<{ ready: boolean }>("/api/ai/config").then(
    (c) => void (ready = c.ready),
    () => void (ready = false), // locked vault (423) or no server: the tab shows the setup hint
  );

async function ask(req: object, on: (e: AiEvent) => void, signal: AbortSignal) {
  const r = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req), signal });
  if (!r.ok || !r.body) throw new Error((await r.json().catch(() => null))?.error || r.statusText);
  let buf = "";
  for await (const chunk of r.body.pipeThrough(new TextDecoderStream())) {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (line.startsWith("data: ")) on(JSON.parse(line.slice(6)) as AiEvent);
    }
  }
}

async function runTool(name: string) {
  try {
    const r = await request<{ result: { ok?: boolean; error?: string | null } }>("/api/tools/run", { name, entity: S.e, lang: I.lang });
    if (r.result?.ok === false && r.result.error) toast(r.result.error, { tone: "bad" });
    else toast(t("common.done")); // the books refresh through /api/events
  } catch (e) {
    toast((e as Error).message, { tone: "bad" });
  }
}

export function installAi() {
  setAiBackend({
    ready: () => ready,
    ask,
    decide: (id, approve) => request("/api/ai/confirm", { id, approve }).then(() => {}),
  });
  void refreshAi();
  void request<{ tools: PaletteTool[] }>("/api/tools").then(
    (r) => registerTools(r.tools, (name) => void runTool(name)),
    () => {},
  );
}

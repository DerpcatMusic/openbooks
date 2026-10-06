// ⌘K palette: the item shape, fuzzy ranking, recent items, the registry phase 4 feeds from the tool registry's `palette`
// metadata, the AI backend slot the "Ask AI" tab talks to, and the markdown-lite renderer for its answers.
// Pure (no runes, no stores) so it runs in plain Vitest; CommandBar.svelte binds it to the books store.

export type Lang = "en" | "he";
/** A label in both interface languages: shown in the current one, searched in both (Hebrew users type English and back). */
export type Label = Readonly<Record<Lang, string>>;

export interface PaletteItem {
  /** Stable id, remembered in "Recent": page:/home, act:theme:dark, tool:<name>, txn:<id>, payer:<key>, cat:<c>, acct:<a>. */
  id: string;
  label: Label;
  /** A UI kit icon name (lib/ui/icons.ts). */
  icon: string;
  /** Extra search text (never shown), e.g. the raw account key. */
  extra?: string;
  /** Secondary text at the row's end (a date, a count, "✓"). */
  sub?: string;
  /** Shown through fmt (privacy mode) at the row's end. */
  amount?: number;
  /** User text (names, descriptions): rendered dir="auto", blurred in privacy mode. */
  user?: boolean;
  /** Keep the bar open after running (file picker, switching to AI). */
  keep?: boolean;
  /** "write" items run only on an explicit Enter/click on that row (they're never auto-run). */
  kind?: "read" | "write";
  run: () => void;
}

// ---------- registry (phase 4: the tool registry's palette metadata) ----------

/** The slice of packages/tools' Tool that ⌘K reads (docs/architecture.md § Tool registry). */
export interface PaletteTool {
  name: string;
  kind: "read" | "write";
  palette?: { label: Label; icon: string };
}
const registry = new Map<string, PaletteItem>();
/** Add tools that carry `palette` metadata; `run(name)` executes one (phase 4: runTool(name, {}, { via: "palette", … })). Returns an unregister function. */
export function registerTools(tools: readonly PaletteTool[], run: (name: string) => void): () => void {
  const ids: string[] = [];
  for (const t of tools)
    if (t.palette) {
      const id = `tool:${t.name}`;
      registry.set(id, { id, label: t.palette.label, icon: t.palette.icon, kind: t.kind, extra: t.name.replace(/_/g, " "), run: () => run(t.name) });
      ids.push(id);
    }
  return () => ids.forEach((id) => registry.delete(id));
}
/** Registered tool items, in registration order (ponytail: read on every keystroke, not reactive; register before the bar opens). */
export const registered = (): PaletteItem[] => [...registry.values()];

// ---------- fuzzy ranking ----------

/** Lowercase; Hebrew final letters → regular forms and niqqud dropped, so "חשבון" matches "חשבונ…" and pointed text. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[֑-ׇ]/g, "")
    .replace(/[ךםןףץ]/g, (c) => ({ ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" })[c]!);

/** Fuzzy score: substring beats word-prefix beats in-order letters; 0 = no match. Every word of the query must match. */
export function score(query: string, text: string): number {
  const s = norm(text);
  let total = 0;
  for (const w of norm(query).split(/\s+/).filter(Boolean)) {
    const i = s.indexOf(w);
    if (i >= 0) {
      total += 100 - Math.min(i, 50) + (i === 0 || /[\s\p{P}\p{S}]/u.test(s[i - 1]!) ? 30 : 0);
      continue;
    }
    // in-order letters, within a window of 2× the word's length (so "rpt" finds "Reports" but letters scattered over a long label don't count)
    let best = 0;
    for (let st = s.indexOf(w[0]!); st >= 0; st = s.indexOf(w[0]!, st + 1)) {
      let j = 0,
        run = 0,
        pts = 0,
        k = st;
      for (; k < s.length && k - st < w.length * 2 && j < w.length; k++)
        if (s[k] === w[j]) {
          j++;
          pts += ++run;
        } else run = 0;
      if (j === w.length) best = Math.max(best, pts);
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}
/** Best n items for the query, matched against both languages' labels and the extra text. */
export function rank(query: string, items: readonly PaletteItem[], n: number): PaletteItem[] {
  return items
    .map((x) => [score(query, `${x.label.en} ${x.label.he} ${x.extra ?? ""}`), x] as const)
    .filter(([s]) => s > 0)
    .sort((a, b) => b[0] - a[0])
    .slice(0, n)
    .map(([, x]) => x);
}

const QUESTION =
  /\?\s*$|^(what|how|why|when|who|which|where|show|list|explain|did|do|does|is|are|can|should|summari[sz]e|compare|מה|איך|למה|כמה|מתי|מי|איזה|האם|הראה|תסביר)(\s|$)/i;
/** A query that reads like a question puts "Ask AI" first. */
export const looksLikeQuestion = (s: string) => QUESTION.test(s.trim()) || s.trim().split(/\s+/).length >= 5;

// ---------- recent items (per browser) ----------

const RECENT = "ob-cmd-recent";
export function recent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export function remember(id: string, max = 5) {
  try {
    localStorage.setItem(RECENT, JSON.stringify([id, ...recent().filter((x) => x !== id)].slice(0, max)));
  } catch {}
}

// ---------- Ask AI (phase 4 plugs the backend; the chat UI is in CommandBar.svelte) ----------

/** Server-sent events of POST /api/ai (ai.py today): text, tool, confirm, tool_done, error, done. */
export type AiEvent =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; args?: Record<string, unknown> }
  | { type: "confirm"; id: string; name: string; summary: string }
  | { type: "tool_done"; id: string; ok: boolean; error?: string; txns?: string[] }
  | { type: "error"; error: string }
  | { type: "done" };
export interface AiRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  entity: string;
  year: number;
  lang: Lang;
}
export interface AiBackend {
  /** A provider is configured (else the tab shows the setup hint with a link to Settings). */
  ready(): boolean;
  /** Stream one answer; call `on` per event; resolve when done; reject on failure; honour `signal` (Stop / Esc). */
  ask(req: AiRequest, on: (e: AiEvent) => void, signal: AbortSignal): Promise<void>;
  /** The user's Approve/Deny on a `confirm` event (POST /api/ai/confirm). */
  decide(id: string, approve: boolean): Promise<void>;
}
let backend: AiBackend | null = null;
/** Phase 4: setAiBackend({ ready, ask, decide }) once at startup. Until then the tab says AI is coming. */
export const setAiBackend = (b: AiBackend | null) => void (backend = b);
export const aiBackend = () => backend;

// ---------- markdown-lite for answers: paragraphs, lists, **bold**, *italic*, `code`, tables, /page links. Escaped first. ----------
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function inline(s: string, isTxn: (id: string) => boolean) {
  return esc(s)
    .replace(/`([^`]+)`/g, (_, c: string) => (isTxn(c) ? `<button type="button" data-txn="${c}" class="md-txn">${c}</button>` : `<code>${c}</code>`))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*)[*_](?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(#?(\/[\w/:.%?=&;-]*)\)/g, '<a href="$2">$1</a>'); // old #/view links become /view
}
const LIST = /^\s*([-*•]|\d+[.)])\s+/;
export function md(text: string, isTxn: (id: string) => boolean = () => false): string {
  const out: string[] = [],
    lines = text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length;) {
    const l = lines[i]!;
    if (!l.trim()) {
      i++;
      continue;
    }
    if (LIST.test(l)) {
      const ordered = /^\s*\d/.test(l),
        items: string[] = [];
      while (i < lines.length && LIST.test(lines[i]!)) items.push(lines[i++]!.replace(LIST, ""));
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((x) => `<li>${inline(x, isTxn)}</li>`).join("")}</${tag}>`);
    } else if (/^\s*\|/.test(l)) {
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) rows.push(lines[i++]!);
      const cells = (r: string) =>
        r
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|?\s*$/.test(r)).map(cells);
      const num = (c: string) => /^[−\-+]?[₪$€]?[\d,.]+%?$/.test(c);
      out.push(
        `<div class="md-t"><table><thead><tr>${(body[0] ?? []).map((c) => `<th>${inline(c, isTxn)}</th>`).join("")}</tr></thead><tbody>${body
          .slice(1)
          .map((r) => `<tr>${r.map((c) => `<td${num(c) ? ' class="r"' : ""}>${inline(c, isTxn)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
    } else if (/^#{1,4}\s/.test(l)) {
      out.push(`<p class="md-h">${inline(l.replace(/^#+\s/, ""), isTxn)}</p>`);
      i++;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i]!.trim() && !/^\s*([-*•]|\d+[.)])\s+|^\s*\||^#{1,4}\s/.test(lines[i]!)) para.push(lines[i++]!);
      out.push(`<p>${para.map((x) => inline(x, isTxn)).join("<br>")}</p>`);
    }
  }
  return out.join("");
}

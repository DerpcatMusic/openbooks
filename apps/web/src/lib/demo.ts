// The GitHub Pages demo: no server, so /api/* is answered in the browser from a snapshot the real server produced
// (scripts/demo/build.ts → <base>/demo/data.json). Edits (classify, rules, invoices, forms, profile) change the snapshot
// in memory, so every report recomputes from them; nothing is saved. Anything needing a server (bank sync, uploads,
// the vault, AI) answers 403 with a pointer to the real app.
import { BASE } from "#lib/nav.ts";

type St = Record<string, any>;
interface Data {
  default: string;
  state: Record<string, St>;
  get: Record<string, unknown>; // other GET endpoints by path
}

const READONLY = "This is the demo with sample data. Install OpenBooks to connect banks, upload files or use AI.";
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

export function installDemo() {
  const data: Promise<Data> = fetch(`${BASE}/demo/data.json`).then((r) => r.json());
  const real = window.fetch.bind(window);
  const fake = async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (!u.pathname.startsWith("/api/")) return real(input, init);
    const D = await data;
    const st = D.state[u.searchParams.get("e") || D.default];
    if (!init?.method || init.method === "GET") {
      if (u.pathname === "/api/state") return st ? json(st) : json({ error: "unknown entity" }, 404);
      return u.pathname in D.get ? json(D.get[u.pathname]) : json({ error: READONLY }, 403);
    }
    const b = typeof init.body === "string" ? JSON.parse(init.body) : null;
    if (!st || !b) return json({ error: READONLY }, 403);
    switch (u.pathname) {
      case "/api/category": {
        const ids = new Set<string>(b.ids);
        for (const t of st.txns) if (ids.has(t.id)) Object.assign(t, { category: b.category, why: b.rule ? `rule: ${b.rule}` : "you" });
        if (b.rule) st.rules = [[b.rule, b.category], ...st.rules];
        break;
      }
      case "/api/rules":
        st.rules = b.rules;
        break;
      case "/api/doc":
        st.docs[b.name] = b.value;
        break;
      case "/api/profile":
        Object.assign(st.profile, b);
        break;
      case "/api/form": {
        const y = (st.form[b.year] ??= {});
        for (const [k, v] of Object.entries(b.values)) v === null ? delete y[k] : (y[k] = v);
        break;
      }
      case "/api/meta":
        Object.assign(st.entity, b);
        break;
      case "/api/year":
        st.years = b.remove ? st.years.filter((y: number) => y !== b.year) : [...new Set([...st.years, b.year])].sort((x, y) => x - y);
        break;
      case "/api/person":
        D.get["/api/person"] = { person: b, saved: true };
        return json(D.get["/api/person"]);
      default:
        return json({ error: READONLY }, 403);
    }
    return json(st);
  };
  window.fetch = fake as typeof fetch;
}

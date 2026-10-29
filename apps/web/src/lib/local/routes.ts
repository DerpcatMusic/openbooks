// /api/* and /files/* answered from the browser's books (store.ts). Same paths, JSON and status codes as apps/server/src/server.ts.
// Anything that needs a server or the network (bank sync, AI, the vault, ⌘K tools) answers 403 with a pointer to the installed app.
import { isRuleInput } from "@openbooks/schema";
import { Bad, type Local } from "./store.ts";

export const NEEDS_APP = "Needs the installed OpenBooks app. This browser version keeps your books on this device only.";
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const types: Record<string, string> = { ".csv": "text/csv; charset=utf-8", ".json": "application/json" };
const fileResponse = (name: string, bytes: Uint8Array) => {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return new Response(bytes.slice().buffer, {
    headers: {
      "Content-Type": types[ext] ?? "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name.split("/").pop()!)}`,
    },
  });
};

export async function route(db: Local, method: string, u: URL, body: BodyInit | null | undefined): Promise<Response> {
  try {
    return await dispatch(db, method, u, body);
  } catch (x) {
    if (x instanceof Bad) return json({ error: x.message }, x.status);
    console.error(x);
    return json({ error: "internal error" }, 500);
  }
}

async function dispatch(db: Local, method: string, u: URL, body: BodyInit | null | undefined): Promise<Response> {
  const path = u.pathname,
    q = u.searchParams;
  const entity = (id: string | null) => {
    if (!id || !db.entities().some((x) => x.id === id)) throw new Bad("unknown entity", 404);
    return id;
  };
  const person = () => {
    const p = db.doc<{ residence: string; facts: Record<string, unknown> } | null>("_app", "person", null);
    return p ? { person: p, saved: true } : { person: { residence: "", facts: {} }, saved: false };
  };

  if (path.startsWith("/files/")) {
    // /files/<entity>/inbox/<name>, /files/<entity>/proofs/<year>/<name>, /files/<entity>/attachments/<txn>/<name>
    const key = decodeURIComponent(path.slice("/files/".length));
    const bytes = /^[a-z0-9-]+\/(inbox|proofs|attachments)\//.test(key) ? await db.blob(key) : undefined;
    return bytes ? fileResponse(key, bytes) : json({ error: "not found" }, 404);
  }
  if (method === "GET") {
    switch (path) {
      case "/api/events":
        return json({ error: "no live updates here" }, 404); // the app falls back to refreshing on focus
      case "/api/state": {
        const es = db.entities();
        const e = es.find((x) => x.id === q.get("e")) ?? es[0];
        return e ? json(db.state(e.id)) : json({ entities: [], setup: true });
      }
      case "/api/person":
        return json(person());
      case "/api/vault":
        return json({ status: "none" });
      case "/api/ai/config":
        return json({ ready: false });
      case "/api/tools":
        return json({ tools: [] });
      case "/api/pack": {
        const e = entity(q.get("e")),
          year = Number.parseInt(q.get("year") ?? "", 10);
        if (!Number.isInteger(year)) throw new Bad("bad year");
        const pdf = await db.pack(e, year);
        return new Response(pdf.slice().buffer, { headers: { "Content-Type": "application/pdf" } });
      }
    }
    return json({ error: NEEDS_APP }, 403);
  }
  if (method !== "POST") return json({ error: "method not allowed" }, 501);

  const raw = body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : new Uint8Array();
  const obj = (): Record<string, any> => {
    try {
      const b = JSON.parse(typeof body === "string" ? body : "");
      if (typeof b !== "object" || b === null) throw 0;
      return b;
    } catch {
      throw new Bad("bad JSON");
    }
  };
  if (/^\/api\/(ai|vault|tools|connect|sync|disconnect)(\/|$)/.test(path)) return json({ error: NEEDS_APP }, 403);

  if (path === "/api/entity") {
    const { id = "", ...meta } = obj();
    await db.createEntity(String(id), meta as never);
    return json(db.state(String(id)));
  }
  if (path === "/api/person") {
    const { residence, facts } = obj();
    const ok = (v: unknown) => ["string", "number", "boolean"].includes(typeof v);
    if (
      typeof residence !== "string" ||
      !/^[a-z]{2}$/.test(residence) ||
      typeof facts !== "object" ||
      !facts ||
      Array.isArray(facts) ||
      !Object.values(facts).every(ok)
    )
      throw new Bad("bad person");
    await db.putDoc("_app", "person", { residence, facts });
    return json(person());
  }
  const e = entity(q.get("e"));
  if (path === "/api/attach") {
    await db.attach(e, q.get("txn") ?? "", (q.get("name") ?? "").split(/[/\\]/).pop()!, raw);
    return json(db.state(e));
  }
  if (path === "/api/upload") {
    await db.upload(e, (q.get("name") ?? "").split(/[/\\]/).pop()!, raw, q.get("to") ?? "", Number.parseInt(q.get("year") ?? "", 10));
    return json(db.state(e));
  }
  const b = obj();
  switch (path) {
    case "/api/csv-preview":
      try {
        if (typeof b.text !== "string") throw 0;
        return json(db.csvPreview(b.text, b.profile ?? undefined));
      } catch {
        throw new Bad("can't read that as CSV");
      }
    case "/api/category":
      if (!Array.isArray(b.ids)) throw new Bad("bad request");
      await db.classify(e, b.ids, String(b.category), b.rule || undefined);
      break;
    case "/api/rules":
      // [match, account] tuples and/or { when, then } rules, as the server
      if (!Array.isArray(b.rules) || !b.rules.every(isRuleInput)) throw new Bad("bad request");
      await db.setRules(e, b.rules);
      break;
    case "/api/form": {
      const form = db.doc<Record<string, Record<string, unknown>>>(e, "form", {});
      const y = (form[String(b.year)] ??= {});
      for (const [k, v] of Object.entries(b.values as Record<string, unknown>)) {
        if (v === null) delete y[k];
        else y[k] = v;
      }
      await db.putDoc(e, "form", form);
      break;
    }
    case "/api/profile":
      await db.putDoc(e, "profile", { ...db.doc(e, "profile", {}), ...b });
      break;
    case "/api/meta":
      await db.setMeta(e, Object.fromEntries(Object.entries(b).filter(([k]) => ["name", "short", "flag", "currency", "types"].includes(k))));
      break;
    case "/api/doc":
      if (typeof b.name !== "string" || !/^[a-z0-9-]+$/.test(b.name) || ["form", "profile", "overrides"].includes(b.name)) throw new Bad("bad name");
      await db.putDoc(e, b.name, b.value ?? null);
      break;
    case "/api/year": {
      const y = Math.trunc(Number(b.year));
      if (!Number.isFinite(y)) throw new Bad("bad request");
      await db.addYear(e, y, !!b.remove);
      break;
    }
    case "/api/taxtables": {
      const t = db.doc<Record<string, Record<string, unknown>>>("_app", "taxtables", {});
      (t[String(b.country)] ??= {})[String(b.year)] = b.table ?? null;
      await db.putDoc("_app", "taxtables", t);
      break;
    }
    default:
      return json({ error: "not found" }, 404);
  }
  return json(db.state(e));
}

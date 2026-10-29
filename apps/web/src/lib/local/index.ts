// Browser-only OpenBooks (VITE_LOCAL): window.fetch answers /api/* and /files/* from IndexedDB, so the whole app runs on GitHub Pages
// with no server. Links to /files/* and /api/pack are plain navigations, so a click handler opens them from the same store.
import { route } from "./routes.ts";
import { Local, type Backup } from "./store.ts";

let db: Promise<Local> | undefined;
const books = () => (db ??= Local.open());

export function installLocal() {
  const real = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (!u.pathname.startsWith("/api/") && !u.pathname.startsWith("/files/")) return real(input, init);
    return route(await books(), init?.method ?? (input instanceof Request ? input.method : "GET"), u, init?.body);
  }) as typeof fetch;

  // a click on <a href="/files/…"> or "/api/pack?…" opens the blob in a new tab (opened now, filled in when the bytes are ready)
  document.addEventListener(
    "click",
    (ev) => {
      const a = (ev.target as Element | null)?.closest?.("a[href]");
      const u = a && new URL((a as HTMLAnchorElement).href, location.href);
      if (!u || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || !(u.pathname.startsWith("/files/") || u.pathname === "/api/pack")) return;
      ev.preventDefault();
      const w = window.open("", "_blank");
      void fetch(u.pathname + u.search)
        .then(async (r) => {
          if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || r.statusText);
          return URL.createObjectURL(await r.blob()) + u.hash;
        })
        .then((url) => w && (w.location.href = url))
        .catch((x) => (w?.close(), alert((x as Error).message)));
    },
    true,
  );
  // keep the data: browsers may evict an origin's storage under pressure unless it's persistent
  void navigator.storage?.persist?.();
}

/** Download everything (books + uploaded files) as one JSON file. */
export async function exportBackup() {
  const b = await (await books()).export();
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([JSON.stringify(b)], { type: "application/json" })),
    download: `openbooks-backup-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Replace everything in this browser with a backup file, then reload. */
export async function importBackup(f: File) {
  await (await books()).import(JSON.parse(await f.text()) as Backup);
  location.reload();
}

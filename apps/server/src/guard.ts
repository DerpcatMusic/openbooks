// books.py Handler.foreign(): another website (CSRF via Origin) or a DNS-rebound name (Host) must not reach the books.
const LOCAL = new Set(["127.0.0.1", "localhost", "::1"]);

/** Python urlparse(...).hostname for a netloc: userinfo dropped, IPv6 brackets stripped, lowercased; "" → null. */
function hostname(netloc: string): string | null {
  const h = netloc.slice(netloc.lastIndexOf("@") + 1);
  const name = h.startsWith("[") ? h.slice(1, h.indexOf("]") < 0 ? undefined : h.indexOf("]")) : h.split(":")[0]!;
  return name ? name.toLowerCase() : null;
}
/** netloc of a URL the way urlparse finds it: only after "scheme://" or a leading "//". */
const netloc = (u: string) => /^(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/([^/?#]*)/.exec(u)?.[1] ?? "";

export function foreign(headers: Headers): boolean {
  const o = headers.get("origin");
  const oh = o === null ? null : hostname(netloc(o));
  const hh = hostname(netloc("//" + (headers.get("host") ?? "")));
  return (o !== null && !LOCAL.has(oh ?? "")) || !LOCAL.has(hh ?? "");
}

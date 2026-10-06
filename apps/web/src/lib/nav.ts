// App paths under the configured base (empty for the local app, "/openbooks/demo" for the GitHub Pages demo).
// Code writes absolute app paths ("/home"); these add the base. Use this goto instead of $app/navigation's.
import { goto as kitGoto } from "$app/navigation";
import { resolve } from "$app/paths";

export const BASE = (resolve as (id: string) => string)("/").replace(/\/$/, "");
/** "/home" → "<base>/home"; anything not starting with one "/" is returned as is. */
export const url = (p: string) => (p.startsWith("/") && !p.startsWith("//") ? BASE + p : p);
/** page.url.pathname without the base. */
export const appPath = (pathname: string) => (BASE && pathname.startsWith(BASE) ? pathname.slice(BASE.length) || "/" : pathname);
export const goto = (to: string, opts?: Parameters<typeof kitGoto>[1]) => kitGoto(url(to), opts);

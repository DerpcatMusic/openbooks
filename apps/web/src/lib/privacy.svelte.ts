// Privacy mode for screenshots: amounts on screen are inflated 3–9× (core.inflate, per value, new salt each time it's switched on),
// names and typed numbers are blurred by CSS on html[data-private] (app.css). Nothing in the books changes; client only.
import { inflate } from "@openbooks/core";

const KEY = "ob-private";
const salt = () => (Math.random() * 2 ** 31) | 0;
let on = false;
try {
  on = localStorage.getItem(KEY) === "1";
} catch {}
export const PV = $state({ on, salt: salt() });

const apply = () => {
  if (typeof document !== "undefined") document.documentElement.toggleAttribute("data-private", PV.on);
};
apply();

/** Toggle (or set) privacy mode. Eye button, Ctrl/⌘ ⇧ E, ⌘K. */
export function setPrivate(v = !PV.on) {
  PV.on = v;
  if (v) PV.salt = salt();
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {}
  apply();
}
/** What an amount shows on screen. */
export const scramble = (n: number) => (PV.on ? inflate(n, PV.salt) : n);
/** One factor per privacy session for chart axes, so ticks stay evenly spaced. */
export const axis = (v: number) => (PV.on ? v * (3 + (PV.salt % 6000) / 1000) : v);

// The vault (docs/architecture.md § Secrets): bank logins and AI keys sealed with a passphrase the server keeps in memory only.
// Status: "plaintext" (no passphrase yet), "locked", "unlocked"; "none" = this server has no vault (books.py).
// Any API call that answers 423 (VaultLocked) opens the unlock prompt and, once unlocked, is sent again: guard() wraps
// window.fetch so every caller (the books store, the AI client, …) gets that without knowing about the vault.
// Passphrases go straight into the request body; nothing here keeps, logs or echoes them.
import { request, ApiError } from "../api.ts";

export type VaultStatus = "none" | "plaintext" | "locked" | "unlocked";

export const V = $state({
  status: "" as "" | VaultStatus,
  /** The unlock prompt (VaultPrompt.svelte) is open. */
  prompt: false,
});

type Answer = { status: VaultStatus };
const post = async (path: string, body: Record<string, string> = {}) => {
  V.status = (await request<Answer>(path, body)).status;
};

/** GET /api/vault. A server without one (books.py: 404) → "none". */
export async function refresh() {
  try {
    V.status = (await request<Answer>("/api/vault")).status;
  } catch (x) {
    V.status = x instanceof ApiError && x.status !== 423 ? "none" : V.status;
  }
  return V.status;
}
export const setup = (passphrase: string) => post("/api/vault/setup", { passphrase });
export const lock = () => post("/api/vault/lock");
export const change = (passphrase: string, newPassphrase: string) => post("/api/vault/change", { passphrase, newPassphrase });
/** "Forgot passphrase": drops every sealed secret (banks must be reconnected); the books are untouched. */
export const reset = () => post("/api/vault/reset");

let waiting: ((ok: boolean) => void)[] = [];
/** Unlock with the passphrase; settles every pending ask(). Throws ApiError (401 wrong passphrase). */
export async function unlock(passphrase: string) {
  await post("/api/vault/unlock", { passphrase });
  settle(true);
}
/** Open the unlock prompt; resolves true once unlocked, false if the user closes it. Concurrent callers share one prompt. */
export function ask(): Promise<boolean> {
  V.prompt = true;
  return new Promise((r) => waiting.push(r));
}
/** The prompt closed (or unlocked): answer everyone waiting. */
export function settle(ok: boolean) {
  V.prompt = false;
  const w = waiting;
  waiting = [];
  for (const r of w) r(ok);
}

/** Wrap window.fetch once: a 423 from /api/* (not /api/vault/*) → ask() → resend. Returns an uninstall function. */
export function guard(): () => void {
  const orig = window.fetch;
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, location.href).pathname;
    if (!path.startsWith("/api/") || path.startsWith("/api/vault")) return orig(input, init);
    const again = () => orig(input instanceof Request ? input.clone() : input, init);
    let r = await again();
    // ponytail: a streamed body (ReadableStream) can't be resent; none of our callers send one
    while (r.status === 423) {
      V.status = "locked";
      if (!(await ask())) return r;
      r = await again();
    }
    return r;
  };
  window.fetch = Object.assign(wrapped, { preconnect: orig.preconnect }) as typeof fetch;
  return () => {
    if ((window.fetch as unknown) === wrapped) window.fetch = orig;
  };
}

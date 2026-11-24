// Periodic background bank sync: checks on server start and then on a timer, syncing one stale connection at a time.
// Never runs two syncs of the same connection at once (SyncLock is shared with manual POST /api/sync and OAuth callbacks).
// Skips connections that need a human (pending OTP/Link/OAuth, expired consent/token, or errors classified as "needs you").
import type { NeedsYou } from "@openbooks/importers";

export const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours
export const DEFAULT_CHECK_EVERY_MS = 15 * 60 * 1000; // 15 minutes

export interface SyncCandidate {
  entity: string;
  provider: string;
  connected: boolean;
  pending: boolean;
  lastSync: string | null;
  needsYou?: NeedsYou | null;
  expiresAt?: string;
  /** Recent runs, newest first (connector status). Failures in a row back off so a bank that's down isn't hit every check. */
  history?: readonly { startedAt: string; ok: boolean }[];
}

export interface AutoSyncConfig {
  enabled: boolean;
  maxAgeMs: number;
  checkEveryMs: number;
}

export type AutoSyncOverride = boolean | { maxAgeMs?: number; checkEveryMs?: number };

const OFF = new Set(["0", "false", "off", "no"]);
const ON = new Set(["1", "true", "on", "yes"]);

/** Parses "6h", "30m", "90s", "500ms", "1d", or a plain number of seconds. Returns null if invalid. */
export function parseDurationMs(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] ?? "s").toLowerCase();
  const mult = unit === "ms" ? 1 : unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return Math.round(n * mult);
}

/**
 * Reads OPENBOOKS_AUTOSYNC / OPENBOOKS_AUTOSYNC_INTERVAL / OPENBOOKS_AUTOSYNC_INTERVAL_MS / OPENBOOKS_AUTOSYNC_CHECK.
 * OPENBOOKS_AUTOSYNC=0 disables it; OPENBOOKS_AUTOSYNC=6h (or OPENBOOKS_AUTOSYNC_INTERVAL=6h) sets the staleness interval.
 * Under Vitest, defaults to disabled unless explicitly opted in via env or override.
 */
export function parseAutoSyncConfig(env: Readonly<Record<string, string | undefined>> = process.env, override?: AutoSyncOverride): AutoSyncConfig {
  if (override === false) return { enabled: false, maxAgeMs: DEFAULT_MAX_AGE_MS, checkEveryMs: DEFAULT_CHECK_EVERY_MS };

  const flag = (env.OPENBOOKS_AUTOSYNC ?? "").trim().toLowerCase();
  let enabled: boolean;
  if (override === true || (override && typeof override === "object")) {
    enabled = true;
  } else if (OFF.has(flag)) {
    enabled = false;
  } else if (flag) {
    enabled = true;
  } else {
    enabled = !env.VITEST;
  }

  const fromMs = env.OPENBOOKS_AUTOSYNC_INTERVAL_MS ? Number(env.OPENBOOKS_AUTOSYNC_INTERVAL_MS) : NaN;
  const envMaxAge =
    (Number.isFinite(fromMs) && fromMs > 0 ? Math.round(fromMs) : null) ??
    parseDurationMs(env.OPENBOOKS_AUTOSYNC_INTERVAL) ??
    (!ON.has(flag) && !OFF.has(flag) ? parseDurationMs(flag) : null);

  const maxAgeMs = (typeof override === "object" && override.maxAgeMs && override.maxAgeMs > 0 ? override.maxAgeMs : null) ?? envMaxAge ?? DEFAULT_MAX_AGE_MS;
  const envCheck = parseDurationMs(env.OPENBOOKS_AUTOSYNC_CHECK);
  const checkEveryMs =
    (typeof override === "object" && override.checkEveryMs && override.checkEveryMs > 0 ? override.checkEveryMs : null) ??
    envCheck ??
    Math.min(DEFAULT_CHECK_EVERY_MS, maxAgeMs);

  return { enabled, maxAgeMs, checkEveryMs };
}

/** True when a connection is eligible for automatic sync and its lastSync is missing or older than maxAgeMs. */
export function isStaleConnection(c: Omit<SyncCandidate, "entity">, nowMs: number, maxAgeMs = DEFAULT_MAX_AGE_MS): boolean {
  if (!c.connected || c.pending) return false;
  if (c.needsYou) return false;
  if (c.expiresAt) {
    const exp = Date.parse(c.expiresAt);
    if (Number.isFinite(exp) && exp <= nowMs) return false;
  }
  // n failures in a row: wait 30 min × 2^(n-1) after the last one (never longer than maxAgeMs)
  const fails = c.history ? c.history.findIndex((r) => r.ok) : -1,
    n = fails === -1 ? (c.history?.length ?? 0) : fails;
  const tried = n ? Date.parse(c.history![0]!.startedAt) : NaN;
  if (Number.isFinite(tried) && nowMs - tried < Math.min(maxAgeMs, 30 * 60_000 * 2 ** (n - 1))) return false;
  if (!c.lastSync) return true;
  const last = Date.parse(c.lastSync);
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= maxAgeMs;
}

/** Filters to connections that should be auto-synced right now, preserving order. */
export function pickStaleConnections<T extends SyncCandidate>(connections: readonly T[], nowMs: number, maxAgeMs = DEFAULT_MAX_AGE_MS): T[] {
  return connections.filter((c) => isStaleConnection(c, nowMs, maxAgeMs));
}

/** In-process lock ensuring two syncs of the same (entity, provider) never overlap (shared between manual and automatic sync). */
export class SyncLock {
  private readonly active = new Map<string, Promise<unknown>>();
  private readonly entityAll = new Map<string, Promise<unknown>>();

  /** True if this connection (or an all-connections sync for the entity) is already running. */
  isBusy(entity: string, provider?: string): boolean {
    if (this.entityAll.has(entity)) return true;
    if (!provider) {
      const prefix = `${entity}:`;
      for (const k of this.active.keys()) if (k.startsWith(prefix)) return true;
      return false;
    }
    return this.active.has(`${entity}:${provider}`);
  }

  /** Run immediately if free, or skip without waiting when already in flight. */
  async tryRun<T>(entity: string, provider: string, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
    if (this.isBusy(entity, provider)) return { ran: false };
    const key = `${entity}:${provider}`;
    const p = fn();
    this.active.set(key, p);
    try {
      return { ran: true, value: await p };
    } finally {
      if (this.active.get(key) === p) this.active.delete(key);
    }
  }

  /** Wait for any conflicting in-flight sync on the same connection (or entity) before running. */
  async runSerialized<T>(entity: string, provider: string | undefined, fn: () => Promise<T>): Promise<T> {
    const p = provider?.trim() || "";
    if (!p) {
      while (this.isBusy(entity)) {
        const wait: Promise<unknown>[] = [];
        const all = this.entityAll.get(entity);
        if (all) wait.push(all);
        const prefix = `${entity}:`;
        for (const [k, v] of this.active) if (k.startsWith(prefix)) wait.push(v);
        if (!wait.length) break;
        await Promise.allSettled(wait);
      }
      const run = fn();
      this.entityAll.set(entity, run);
      try {
        return await run;
      } finally {
        if (this.entityAll.get(entity) === run) this.entityAll.delete(entity);
      }
    }
    const key = `${entity}:${p}`;
    while (this.isBusy(entity, p)) {
      const wait = [this.entityAll.get(entity), this.active.get(key)].filter((x): x is Promise<unknown> => !!x);
      if (!wait.length) break;
      await Promise.allSettled(wait);
    }
    const run = fn();
    this.active.set(key, run);
    try {
      return await run;
    } finally {
      if (this.active.get(key) === run) this.active.delete(key);
    }
  }
}

export interface AutoSyncDeps {
  list: () => Promise<SyncCandidate[]>;
  syncOne: (entity: string, provider: string) => Promise<void>;
  isLocked?: () => Promise<boolean>;
  lock?: SyncLock;
  maxAgeMs?: number;
  checkEveryMs?: number;
  now?: () => number;
}

export interface AutoSyncHandle {
  /** Start checking immediately, then on the periodic timer. */
  start: () => void;
  /** Stop scheduling future checks. */
  stop: () => void;
  /** Run one pass over all currently stale connections (one at a time). */
  runOnce: () => Promise<{ entity: string; provider: string }[]>;
}

/** Creates a sequential background bank-sync scheduler. */
export function createAutoSync(deps: AutoSyncDeps): AutoSyncHandle {
  const lock = deps.lock ?? new SyncLock();
  const maxAgeMs = deps.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const checkEveryMs = deps.checkEveryMs ?? Math.min(DEFAULT_CHECK_EVERY_MS, maxAgeMs);
  const now = deps.now ?? (() => Date.now());
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function runOnce(): Promise<{ entity: string; provider: string }[]> {
    if (stopped || running) return [];
    running = true;
    const synced: { entity: string; provider: string }[] = [];
    try {
      if (deps.isLocked && (await deps.isLocked())) return [];
      const candidates = await deps.list();
      const due = pickStaleConnections(candidates, now(), maxAgeMs);
      for (const c of due) {
        if (stopped) break;
        if (deps.isLocked && (await deps.isLocked())) break;
        const r = await lock.tryRun(c.entity, c.provider, async () => {
          try {
            await deps.syncOne(c.entity, c.provider);
          } catch {
            // connector errors are recorded on the connection itself; never kill the scheduler loop
          }
        });
        if (r.ran) synced.push({ entity: c.entity, provider: c.provider });
      }
      return synced;
    } catch {
      return synced;
    } finally {
      running = false;
    }
  }

  function scheduleNext() {
    if (stopped) return;
    // poll-ok: periodic bank sync
    timer = setTimeout(() => {
      timer = undefined;
      void loop();
    }, checkEveryMs);
    timer.unref?.();
  }

  async function loop() {
    if (stopped) return;
    await runOnce();
    scheduleNext();
  }

  return {
    start() {
      if (stopped || timer) return;
      void loop();
    },
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    runOnce,
  };
}

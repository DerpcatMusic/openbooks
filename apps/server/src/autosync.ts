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

/**
 * In-process lock: one sync per entity at a time (shared between manual and automatic sync). Per entity, not per connection, because
 * connector load/save reads and rewrites every connection of the entity: two providers syncing at once would overwrite each other's
 * status, history and credentials, and a running sync could resurrect a connection disconnected meanwhile.
 */
export class SyncLock {
  private readonly running = new Map<string, Promise<unknown>>();

  /** True if any sync of this entity is running (the provider is accepted for callers' clarity; the lock is per entity). */
  isBusy(entity: string, _provider?: string): boolean {
    return this.running.has(entity);
  }

  private async hold<T>(entity: string, fn: () => Promise<T>): Promise<T> {
    const run = fn();
    this.running.set(entity, run);
    try {
      return await run;
    } finally {
      if (this.running.get(entity) === run) this.running.delete(entity);
    }
  }

  /** Run immediately if free, or skip without waiting when this entity is already syncing. */
  async tryRun<T>(entity: string, _provider: string, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
    if (this.isBusy(entity)) return { ran: false };
    return { ran: true, value: await this.hold(entity, fn) };
  }

  /** Wait for this entity's in-flight sync, then run. */
  async runSerialized<T>(entity: string, _provider: string | undefined, fn: () => Promise<T>): Promise<T> {
    for (let cur = this.running.get(entity); cur; cur = this.running.get(entity)) await Promise.allSettled([cur]);
    return this.hold(entity, fn);
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

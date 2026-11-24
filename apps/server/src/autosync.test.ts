import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { createAutoSync, DEFAULT_MAX_AGE_MS, isStaleConnection, parseAutoSyncConfig, pickStaleConnections, SyncLock, type SyncCandidate } from "./autosync.ts";

const HOUR = 60 * 60 * 1000;
const BASE = Date.parse("2026-11-24T12:00:00Z");
const ago = (hours: number) => new Date(BASE - hours * HOUR).toISOString();

describe("autosync scheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("picks only stale connected connections and skips fresh, pending, expired, and needs-you ones", () => {
    const conns: SyncCandidate[] = [
      { entity: "us", provider: "mercury", connected: true, pending: false, lastSync: ago(7) },
      { entity: "us", provider: "wise", connected: true, pending: false, lastSync: null },
      { entity: "us", provider: "plaid", connected: true, pending: false, lastSync: ago(2) }, // fresh
      { entity: "il", provider: "onezero", connected: false, pending: true, lastSync: null, needsYou: { reason: "otp", action: "code" } }, // pending OTP
      { entity: "il", provider: "hapoalim", connected: true, pending: false, lastSync: ago(12), needsYou: { reason: "otp", action: "code" } }, // needs you
      { entity: "il", provider: "leumi", connected: true, pending: false, lastSync: ago(48), needsYou: { reason: "expired", action: "reconnect" } }, // needs you
      { entity: "eu", provider: "enablebanking", connected: true, pending: false, lastSync: ago(10), expiresAt: ago(1) }, // consent expired
      { entity: "eu", provider: "simplefin", connected: false, pending: false, lastSync: ago(24) }, // disconnected
    ];

    const picked = pickStaleConnections(conns, BASE, DEFAULT_MAX_AGE_MS);
    expect(picked.map((c) => `${c.entity}:${c.provider}`)).toEqual(["us:mercury", "us:wise"]);
  });

  test("runs one connection at a time and never runs two syncs of the same connection concurrently", async () => {
    const lock = new SyncLock();
    const conns: SyncCandidate[] = [
      { entity: "us", provider: "mercury", connected: true, pending: false, lastSync: ago(8) },
      { entity: "us", provider: "wise", connected: true, pending: false, lastSync: ago(9) },
      { entity: "il", provider: "max", connected: true, pending: false, lastSync: ago(10), needsYou: { reason: "password", action: "reconnect" } },
    ];

    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    let releaseManual!: () => void;
    const manualDone = new Promise<void>((r) => (releaseManual = r));

    // Start a manual sync on us:mercury before the scheduler ticks
    const manual = lock.runSerialized("us", "mercury", async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push("manual:us:mercury:start");
      await manualDone;
      order.push("manual:us:mercury:end");
      active--;
    });

    const sched = createAutoSync({
      lock,
      now: () => BASE,
      list: async () => conns,
      syncOne: async (e, p) => {
        active++;
        maxActive = Math.max(maxActive, active);
        order.push(`auto:${e}:${p}:start`);
        await Promise.resolve();
        order.push(`auto:${e}:${p}:end`);
        active--;
      },
    });

    // Trigger two overlapping runOnce calls while manual sync holds us:mercury
    const [r1, r2] = await Promise.all([sched.runOnce(), sched.runOnce()]);
    // us:mercury was skipped (manual sync held its lock), il:max skipped (needsYou), us:wise ran once
    expect(r1).toEqual([{ entity: "us", provider: "wise" }]);
    expect(r2).toEqual([]); // second overlapping tick was ignored

    releaseManual();
    await manual;

    // Now manual sync is done: next tick picks up us:mercury, strictly sequentially with us:wise
    let seqActive = 0;
    let seqMax = 0;
    const sched2 = createAutoSync({
      lock,
      now: () => BASE,
      list: async () => conns,
      syncOne: async (e, p) => {
        seqActive++;
        seqMax = Math.max(seqMax, seqActive);
        await new Promise((r) => setTimeout(r, 5));
        seqActive--;
        order.push(`seq:${e}:${p}`);
      },
    });
    const r3 = await sched2.runOnce();
    expect(r3).toEqual([
      { entity: "us", provider: "mercury" },
      { entity: "us", provider: "wise" },
    ]);
    expect(seqMax).toBe(1);
    expect(maxActive).toBe(2); // manual(mercury) + auto(wise) are different connections; same connection never overlapped
    expect(order.filter((x) => x.startsWith("auto:us:mercury"))).toEqual([]);
  });

  test("checks on start and repeats on a timer with fake clock, skipping when vault is locked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);

    let locked = true;
    const synced: string[] = [];
    const conns: SyncCandidate[] = [{ entity: "us", provider: "mercury", connected: true, pending: false, lastSync: ago(7) }];

    const sched = createAutoSync({
      maxAgeMs: 6 * HOUR,
      checkEveryMs: HOUR,
      isLocked: async () => locked,
      list: async () => conns,
      syncOne: async (e, p) => {
        synced.push(`${e}:${p}`);
        conns[0]!.lastSync = new Date(Date.now()).toISOString();
      },
    });

    sched.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(synced).toEqual([]); // skipped while vault is locked

    locked = false;
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(synced).toEqual(["us:mercury"]); // synced once unlocked

    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(synced).toEqual(["us:mercury"]); // still fresh (< 6h)

    await vi.advanceTimersByTimeAsync(4 * HOUR);
    expect(synced).toEqual(["us:mercury", "us:mercury"]); // stale again at 6h

    sched.stop();
    await vi.advanceTimersByTimeAsync(12 * HOUR);
    expect(synced).toEqual(["us:mercury", "us:mercury"]); // stopped cleanly
  });

  test("parseAutoSyncConfig handles OPENBOOKS_AUTOSYNC=0 and custom intervals", () => {
    expect(parseAutoSyncConfig({ OPENBOOKS_AUTOSYNC: "0" }).enabled).toBe(false);
    expect(parseAutoSyncConfig({ OPENBOOKS_AUTOSYNC: "false" }).enabled).toBe(false);
    expect(parseAutoSyncConfig({ VITEST: "true" }).enabled).toBe(false);
    expect(parseAutoSyncConfig({ VITEST: "true", OPENBOOKS_AUTOSYNC: "1" })).toMatchObject({ enabled: true, maxAgeMs: 6 * HOUR });
    expect(parseAutoSyncConfig({ OPENBOOKS_AUTOSYNC: "2h" })).toMatchObject({ enabled: true, maxAgeMs: 2 * HOUR });
    expect(parseAutoSyncConfig({ OPENBOOKS_AUTOSYNC: "1", OPENBOOKS_AUTOSYNC_INTERVAL: "30m" })).toMatchObject({
      enabled: true,
      maxAgeMs: 30 * 60_000,
    });
  });
});

test("a connection that keeps failing backs off: 30 min after one failure, 1 h after two", () => {
  const now = Date.parse("2026-11-24T12:00:00Z"),
    ago = (min: number) => new Date(now - min * 60_000).toISOString();
  const c = { provider: "mercury", connected: true, pending: false, lastSync: ago(60 * 24) };
  expect(isStaleConnection({ ...c, history: [{ startedAt: ago(20), ok: false }] }, now)).toBe(false);
  expect(isStaleConnection({ ...c, history: [{ startedAt: ago(40), ok: false }] }, now)).toBe(true);
  expect(
    isStaleConnection(
      {
        ...c,
        history: [
          { startedAt: ago(40), ok: false },
          { startedAt: ago(100), ok: false },
        ],
      },
      now,
    ),
  ).toBe(false);
  expect(
    isStaleConnection(
      {
        ...c,
        history: [
          { startedAt: ago(40), ok: false },
          { startedAt: ago(100), ok: true },
        ],
      },
      now,
    ),
  ).toBe(true);
});

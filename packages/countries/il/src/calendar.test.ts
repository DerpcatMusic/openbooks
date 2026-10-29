import { describe, expect, it } from "vite-plus/test";
import { dueDate, isRestDay, periodOf, reportDue, restDays, vatPeriods } from "./calendar.ts";

describe("rest days (ICU Hebrew calendar)", () => {
  it("2026 holidays fall where the calendar says", () => {
    const r = restDays(2026);
    for (const d of ["2026-04-02", "2026-04-08", "2026-05-22", "2026-09-12", "2026-09-13", "2026-09-21", "2026-09-26", "2026-10-03"]) expect(r.has(d), d).toBe(true); // Pesach 1/7, Shavuot, RH 1-2, YK, Sukkot 1, Shmini Atzeret
    for (const d of ["2026-04-03", "2026-04-07", "2026-09-27", "2026-10-02"]) expect(r.has(d), `chol hamoed ${d}`).toBe(true);
    for (const d of ["2026-04-09", "2026-04-10", "2026-10-04", "2026-11-19"]) expect(r.has(d) && d !== "2026-04-11", d).toBe(false); // Fridays and the day after are working days
    expect(r.has("2026-04-22")).toBe(true); // Independence Day: 5 Iyar 5786 is a Wednesday
    expect(r.has("2026-01-03")).toBe(true); // a Saturday
  });
  it("Independence Day moves off Friday/Saturday and Monday", () => {
    expect(restDays(2024).has("2024-05-14")).toBe(true); // 5 Iyar 5784 = Tue 14 May 2024
    expect(restDays(2025).has("2025-05-01")).toBe(true); // 5 Iyar 5785 = Sat 3 May -> Thursday 1 May
    expect(restDays(2025).has("2025-05-03")).toBe(true); // (it is a Saturday anyway)
    expect(restDays(2023).has("2023-04-26")).toBe(true); // 5 Iyar 5783 = Wed 26 Apr
    expect(restDays(2027).has("2027-05-12")).toBe(true); // 5 Iyar 5787 = Wed 12 May
  });
});

describe("deadlines", () => {
  it("a deadline on a rest day moves to the next weekday", () => {
    expect(dueDate("2026-11-14")).toBe("2026-11-15"); // Saturday -> Sunday
    expect(dueDate("2026-11-19")).toBe("2026-11-19");
  });
  it("three rest days in the five days before: the fourth weekday after the run (s.67(b1))", () => {
    // deadline 15 Oct 2026? window 10-14 Oct has only a Saturday -> unchanged
    expect(dueDate("2026-10-15")).toBe("2026-10-15");
    // Pesach 5787 = Thu 22 - Wed 28 Apr 2027 (+ Saturday 24th)
    expect(dueDate("2027-04-24")).toBe("2027-04-29"); // only two rest days before it: just off the rest day
    expect(dueDate("2027-04-27")).toBe("2027-05-03"); // five rest days before; weekdays after the run (ends 28th): Thu 29, Fri 30, Sun 2, Mon 3
  });
});

describe("periods", () => {
  it("monthly and bimonthly", () => {
    expect(vatPeriods(2026, "monthly")).toHaveLength(12);
    const b = vatPeriods(2026, "bimonthly");
    expect(b.map((p) => p.from)).toEqual(["2026-01-01", "2026-03-01", "2026-05-01", "2026-07-01", "2026-09-01", "2026-11-01"]);
    expect(b[0]!.to).toBe("2026-02-28");
    expect(b[5]!.to).toBe("2026-12-31");
    expect(periodOf("2026-04-30", "bimonthly").key).toBe("2026-03");
  });
  it("report due dates: 15th statutory, 19th online, 23rd detailed", () => {
    const p = periodOf("2026-09-10", "bimonthly");
    expect(reportDue(p, 15)).toBe(dueDate("2026-11-15"));
    expect(reportDue(periodOf("2026-12-05", "monthly"), 19)).toBe("2027-01-19");
    expect(reportDue(periodOf("2026-10-05", "monthly"), 23)).toBe("2026-11-23");
    expect(isRestDay("2027-01-19")).toBe(false);
  });
});

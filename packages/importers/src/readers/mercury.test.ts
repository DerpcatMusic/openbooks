// Expected values below were produced by books.py (Python 3.14) on the same inputs.
import { describe, expect, it } from "vite-plus/test";
import { uid, uidAmount } from "../uid.ts";
import { mercuryCsv, mercuryJson, pySum } from "./mercury.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const DUMP = JSON.stringify({
  accounts: [
    { id: "a1", name: "Checking", currentBalance: 1000.25 },
    { id: "a2", name: "Savings", currentBalance: 0 },
  ],
  transactions: [
    {
      id: "t1",
      amount: 1000,
      kind: "externalTransfer",
      accountId: "a1",
      createdAt: "2025-01-02T00:00:00Z",
      postedAt: "2025-01-03T09:00:00Z",
      status: "sent",
      counterpartyName: "Client",
      bankDescription: "WIRE IN",
      note: null,
      externalMemo: "inv 7",
      mercuryCategory: null,
    },
    {
      id: "t2",
      amount: 0.25,
      kind: "other",
      accountId: "a1",
      createdAt: "2025-01-31T00:00:00Z",
      postedAt: null,
      counterpartyName: null,
      bankDescription: "Interest",
      mercuryCategory: "Interest",
    },
    { id: "t3", amount: -50, kind: "debitCardTransaction", accountId: "a1", createdAt: "2025-01-05T00:00:00Z", status: "failed" },
    { id: "t4", amount: 12, kind: "x", accountId: "zz", createdAt: "2025-01-04T00:00:00Z" },
  ],
}).replace('"amount":12,', '"amount":12.0,'); // a float literal: Python hashes "12.0"

describe("mercuryJson", () => {
  it("reads posted transactions, reconciles per account, ids match books.py", () => {
    const { rows, checks } = mercuryJson({ name: "mercury.json", bytes: enc(DUMP), text: DUMP });
    expect(rows[0]).toEqual({
      date: "2025-01-03",
      amount: 1000,
      desc: "Client",
      memo: "WIRE IN inv 7",
      mcat: "",
      kind: "externalTransfer",
      source: "mercury",
      account: "Checking",
      file: "mercury.json",
      page: 1,
      key: "t1",
    });
    expect(rows.map((r) => [r.date, r.desc, r.memo, r.account, r.page, uidAmount(r), uid(r)])).toEqual([
      ["2025-01-03", "Client", "WIRE IN inv 7", "Checking", 1, "1000", "8b8d17af14f4"],
      ["2025-01-31", "Interest", "Interest", "Checking", 2, "0.25", "9d719bb87c85"],
      ["2025-01-04", "", "", "Mercury", 4, "12.0", "6047f8a2c778"],
    ]);
    expect(checks).toEqual([
      { file: "mercury.json", label: "Checking", period: ["2025-01-03", "2025-01-31"], parsed: 1000.25, total: 1000.25, balance: true },
      { file: "mercury.json", label: "Savings", period: ["2025-01-03", "2025-01-31"], parsed: 0, total: 0, balance: true },
    ]);
  });
  it("throws on a dump without accounts (ingest lists the file as unreadable)", () =>
    expect(() => mercuryJson({ name: "x.json", bytes: enc("{}"), text: "{}" })).toThrow());
});

describe("pySum", () => {
  it("matches Python 3.12+ compensated sum()", () => {
    expect(pySum([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1], () => false)).toBe(1); // naive: 0.9999999999999999
    expect(pySum([1e16, 1, -1e16], (i) => i === 1)).toBe(1);
  });
});

describe("mercuryCsv", () => {
  it("reads the export: skips failed and blank lines, M-D-Y or M/D/Y dates, reference/timestamp keys", () => {
    const csv =
      '﻿Date (UTC),Description,Amount,Status,Source Account,Reference,Bank Description,Mercury Category,Timestamp\r\n01-15-2025,"Acme, Inc","-1,234.50",Sent,Mercury Checking ••1234,,ACH OUT,Software,01-15-2025 10:00:00\r\n1/5/2025,Client,500,Failed,,,,,\r\n\r\n2/3/2025 10:00,Client,500,,,R9,,,\r\n';
    const { rows, checks } = mercuryCsv({ name: "m.csv", bytes: enc(csv) });
    expect(checks).toEqual([]);
    expect(rows).toEqual([
      {
        date: "2025-01-15",
        amount: -1234.5,
        desc: "Acme, Inc",
        memo: "ACH OUT",
        mcat: "Software",
        kind: "",
        source: "mercury",
        account: "Mercury Checking ••1234",
        file: "m.csv",
        page: 1,
        key: "01-15-2025 10:00:00",
      },
      {
        date: "2025-02-03",
        amount: 500,
        desc: "Client",
        memo: "",
        mcat: "",
        kind: "",
        source: "mercury",
        account: "Mercury",
        file: "m.csv",
        page: 3,
        key: "R9",
      },
    ]);
    expect(rows.map((r) => uid(r))).toEqual(["200e837a7651", "6f17178373b6"]);
  });
  it("is strict UTF-8 like Python's open()", () => expect(() => mercuryCsv({ name: "m.csv", bytes: Uint8Array.of(0x44, 0xff) })).toThrow());
});

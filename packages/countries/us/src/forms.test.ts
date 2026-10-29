// Golden tests for the official IRS blanks: (1) each blank is the exact file pdfs.ts names (sha-256), (2) every field a hook can write
// exists in it at the position pinned in fixtures/irs-fields.json together with the label printed beside it, (3) a filled form reads back
// the values at the right lines. Regenerate the fixture after replacing a blank with:  OPENBOOKS_GOLDEN=write bun --bun vp test packages/countries/us/src/forms.test.ts
// (needs pdftotext; read the labels it records before committing).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { PDFCheckBox, PDFDocument, PDFTextField } from "pdf-lib";
import { describe, expect, it } from "vite-plus/test";
import golden from "../fixtures/irs-fields.json";
import {
  ES_WORKSHEET,
  F8995_LINES,
  IRS_PDFS,
  IRS_PREFIX,
  SCHED_C_LINES,
  SCHED_C_PART3,
  SCHED_SE_LINES,
  VOUCHER,
  form1040ES,
  form1099NEC2025,
  form1099NEC2026,
  form8995,
  formScheduleC,
  formScheduleSE,
  qbiDeduction,
  scheduleC,
  seTax,
  us,
  type IrsPdf,
  type SchedCResult,
} from "./index.ts";

const dir = new URL("../../../../apps/web/src/routes/tax/us/", import.meta.url);
const bytes = (f: IrsPdf) => readFileSync(new URL(f.file, dir));
const pdf = (id: IrsPdf["id"]) => IRS_PDFS.find((p) => p.id === id)!;
const load = (id: IrsPdf["id"]) => PDFDocument.load(bytes(pdf(id)));

/** Hook output → field values read back after writing, as the web writer does. */
async function fill(id: IrsPdf["id"], values: Readonly<Record<string, string>>, page?: number) {
  const doc = await load(id),
    form = doc.getForm();
  for (const [name, v] of Object.entries(values)) {
    const f = form.getField(IRS_PREFIX + name);
    if (f instanceof PDFCheckBox) f.check();
    else {
      const tf = form.getTextField(IRS_PREFIX + name);
      if (v.includes("\n")) tf.enableMultiline();
      tf.setText(v);
    }
  }
  const back = Object.fromEntries(
    form
      .getFields()
      .flatMap((f) =>
        f instanceof PDFTextField && f.getText()
          ? [[f.getName().slice(IRS_PREFIX.length), f.getText()!]]
          : f instanceof PDFCheckBox && f.isChecked()
            ? [[f.getName().slice(IRS_PREFIX.length), "X"]]
            : [],
      ),
  );
  void page;
  return { doc, back };
}

// ---------- full contexts: every field each hook can write ----------
const profile = {
  taxpayerName: "Jane Q Doe",
  ssn: "123456789",
  legalName: "Doe Design",
  ein: "12-3456789",
  business: "Graphic design",
  naics: "541430",
  address: "1 Main St",
  cityStateZip: "Austin, TX 78701",
  state: "TX",
  formed: "2026-02-01",
  phone: "5125550100",
};
const lines = Object.fromEntries(Object.keys(SCHED_C_LINES).map((l, k) => [l, 1000 + k]));
const full: SchedCResult = {
  year: 2026,
  lines,
  sources: [],
  partV: Array.from({ length: 9 }, (_, k) => ({ label: `Item ${k + 1}`, amount: 10 + k })),
  partIII: Object.fromEntries(Object.keys(SCHED_C_PART3).map((l, k) => [l, 500 + k])),
  vehicle: { method: "standard", businessMiles: 12345, commutingMiles: 1000, otherMiles: 2000, placedInService: "2024-03-09", deduction: 1, bands: [] },
  homeOffice: { sqft: 200, deduction: 1000, limited: false },
  netProfit: -5,
  warnings: [],
  disallowed: 0,
};
const ctxC = { ...profile, year: 2026, result: full, needs1099: true, homeTotalSqft: 1800 };
const se = seTax(us.table(2025).fed, "single", { netProfit: 100000, w2SsWages: 20000 });
const qbi = qbiDeduction(us.table(2025).fed, "single", { qbi: 90000, taxableBefore: 80000 });
const inst = [1, 2, 3, 4].map((n) => ({ n: n as 1 | 2 | 3 | 4, due: `2026-0${n + 3}-15`, amount: 1000 * n }));
const es = form1040ES({ ...profile, installments: inst, worksheet: Object.fromEntries(Object.keys(ES_WORKSHEET).map((l, k) => [l, 100 + k])) });
const nec = {
  year: 2026,
  payer: { name: "Acme LLC", tin: "12-3456789", tinType: "ein" as const, address: "9 Biz Rd", city: "Austin", state: "TX", zip: "78701", phone: "5125550100" },
  recipient: { name: "Ana Designer", tin: "123456789", tinType: "ssn" as const, street: "1 Main St", city: "Austin", state: "TX", zip: "78701", country: "" },
  box1a: 2500.5,
};

const HOOKS: Record<string, { id: IrsPdf["id"]; values: Readonly<Record<string, string>> }> = {
  "schedule-c": { id: "schedule-c", values: formScheduleC({ ...ctxC, year: 2025 }) },
  "schedule-se": { id: "schedule-se", values: formScheduleSE({ ...profile, se }) },
  "8995": { id: "8995", values: form8995({ ...profile, qbi }) },
  "1040-es": { id: "1040-es", values: es },
  "1099-nec-2026": { id: "1099-nec-2026", values: form1099NEC2026(nec) },
  "1099-nec-2025": { id: "1099-nec-2025", values: form1099NEC2025({ ...nec, year: 2025 }) },
};

type G = Record<string, Record<string, { p: number; x: number; y: number; w: number; label: string }>>;
async function geometry(id: IrsPdf["id"], names: readonly string[]) {
  const doc = await load(id),
    refs = doc.getPages().map((p) => String(p.ref)),
    out: Record<string, { p: number; x: number; y: number; w: number }> = {};
  for (const n of names) {
    const w = (
      doc.getForm().getField(IRS_PREFIX + n) as {
        acroField: { getWidgets(): { getRectangle(): { x: number; y: number; width: number; height: number }; P(): unknown }[] };
      }
    ).acroField.getWidgets()[0]!;
    const r = w.getRectangle(),
      p = refs.indexOf(String(w.P())) + 1,
      h = doc.getPage(p - 1).getHeight();
    out[n] = { p, x: Math.round(r.x), y: Math.round(h - r.y - r.height), w: Math.round(r.width) };
  }
  return out;
}
/** Words printed left of the field on its row and just above it (pdftotext -bbox): what a person reads to know which line it is. */
function labels(file: string, g: Record<string, { p: number; x: number; y: number; w: number }>) {
  const html = execFileSync("pdftotext", ["-bbox", new URL(file, dir).pathname, "-"], { maxBuffer: 1 << 28 }).toString();
  const pages = [...html.matchAll(/<page width="[\d.]+" height="[\d.]+">([\s\S]*?)<\/page>/g)].map((m) =>
    [...m[1]!.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g)].map((w) => ({
      x0: +w[1]!,
      y0: +w[2]!,
      x1: +w[3]!,
      y1: +w[4]!,
      t: w[5]!
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">"),
    })),
  );
  return Object.fromEntries(
    Object.entries(g).map(([n, f]) => {
      const ws = pages[f.p - 1]!,
        mid = f.y + 6;
      const left = ws
        .filter((x) => Math.abs((x.y0 + x.y1) / 2 - mid) < 6 && x.x1 <= f.x + 2)
        .sort((a, b) => a.x0 - b.x0)
        .map((x) => x.t)
        .filter((t) => !/^\.+$/.test(t))
        .slice(-9)
        .join(" ");
      const above = ws
        .filter((x) => x.y1 <= f.y + 1 && x.y1 > f.y - 14 && x.x0 <= f.x + f.w && x.x1 >= f.x - 2)
        .sort((a, b) => a.x0 - b.x0)
        .map((x) => x.t)
        .join(" ")
        .slice(0, 70);
      return [n, { ...f, label: `${left} || ${above}`.replace(/\.{2,}/g, "") }];
    }),
  );
}

if (process.env.OPENBOOKS_GOLDEN === "write") {
  it("writes fixtures/irs-fields.json", async () => {
    const out: G = {};
    for (const [k, h] of Object.entries(HOOKS)) out[k] = labels(pdf(h.id).file, await geometry(h.id, Object.keys(h.values)));
    // every field the maps could write, not only this context's
    const all: Record<string, string[]> = {
      "schedule-c": [...Object.values(SCHED_C_LINES), ...Object.values(SCHED_C_PART3)],
      "schedule-se": Object.values(SCHED_SE_LINES),
      "8995": Object.values(F8995_LINES),
      "1040-es": [...Object.values(ES_WORKSHEET), ...Object.values(VOUCHER).flatMap((v) => Object.values(v))],
    };
    for (const [k, names] of Object.entries(all)) {
      const extra = names.filter((n) => !(n in out[k]!));
      Object.assign(out[k]!, labels(pdf(HOOKS[k]!.id).file, await geometry(HOOKS[k]!.id, extra)));
    }
    writeFileSync(new URL("../fixtures/irs-fields.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
  });
}

describe("the blanks are the files pdfs.ts names", () => {
  for (const f of IRS_PDFS)
    it(`${f.file} (${f.revision}) from ${f.url}`, () => {
      expect(createHash("sha256").update(bytes(f)).digest("hex")).toBe(f.sha256);
      expect(f.url.startsWith("https://www.irs.gov/")).toBe(true);
    });
});

describe("every field a hook writes is where the golden fixture says, next to the line it is", () => {
  for (const [k, g] of Object.entries(golden as unknown as G))
    it(k, async () => {
      const now = await geometry(HOOKS[k]!.id, Object.keys(g));
      for (const [n, f] of Object.entries(g)) expect(now[n], `${k} ${n} (${f.label})`).toEqual({ p: f.p, x: f.x, y: f.y, w: f.w });
    });
  it("the fixture covers every field the context writes", () => {
    for (const [k, h] of Object.entries(HOOKS)) for (const n of Object.keys(h.values)) expect((golden as unknown as G)[k]?.[n], `${k} ${n}`).toBeDefined();
  });
});

describe("the printed line number beside each field is the line the map says it is", () => {
  const g = golden as unknown as G;
  // pdftotext's label of a field ends with the line number printed in its box column ("... Subtract line 28 from line 7 29")
  const lineOf = (form: string, field: string) => g[form]![field]!.label.split(" || ")[0]!.trim().split(" ").at(-1);
  const check = (form: string, map: Readonly<Record<string, string>>) => {
    for (const [line, field] of Object.entries(map)) expect(lineOf(form, field), `${form} line ${line} -> ${field}`).toBe(line);
  };
  it("Schedule C lines 1-31 and Part III 35-42", () => {
    check("schedule-c", SCHED_C_LINES);
    check("schedule-c", SCHED_C_PART3);
  });
  it("Schedule SE", () => check("schedule-se", SCHED_SE_LINES));
  it("Form 8995", () => check("8995", F8995_LINES));
  it("1040-ES worksheet", () => check("1040-es", ES_WORKSHEET));
});

describe("filled forms read back at the right lines", () => {
  it("Schedule C", async () => {
    const r = scheduleC({
      year: 2025,
      fed: us.table(2025).fed,
      txns: [
        { id: "r", date: "2025-03-01", amount: 90000, category: "revenue:services" },
        { id: "a", date: "2025-03-02", amount: -4000, category: "expense:advertising" },
        { id: "m", date: "2025-03-03", amount: -1000, category: "expense:meals" },
        { id: "s", date: "2025-03-04", amount: -1200, category: "expense:software" },
      ],
      deductions: [
        { id: "a", category: "expense:advertising", gross: 4000, deductible: 4000 },
        { id: "m", category: "expense:meals", gross: 1000, deductible: 500, rule: "us.meals" },
        { id: "s", category: "expense:software", gross: 1200, deductible: 1200 },
      ],
      inputs: { homeSqft: 100 },
    });
    const { back } = await fill("schedule-c", formScheduleC({ ...profile, year: 2025, result: r, homeTotalSqft: 1500 }));
    expect(back[SCHED_C_LINES["1"]!]).toBe("90,000");
    expect(back[SCHED_C_LINES["7"]!]).toBe("90,000");
    expect(back[SCHED_C_LINES["8"]!]).toBe("4,000");
    expect(back[SCHED_C_LINES["24b"]!]).toBe("500");
    expect(back[SCHED_C_LINES["27b"]!]).toBe("1,200");
    expect(back[SCHED_C_LINES["28"]!]).toBe("5,700");
    expect(back[SCHED_C_LINES["29"]!]).toBe("84,300");
    expect(back[SCHED_C_LINES["30"]!]).toBe("500");
    expect(back[SCHED_C_LINES["31"]!]).toBe("83,800");
    expect(back["Page2[0].PartVTable[0].Item1[0].f2_15[0]"]).toBe("Software");
    expect(back["Page2[0].PartVTable[0].Item1[0].f2_16[0]"]).toBe("1,200");
    expect(back["Page2[0].f2_33[0]"]).toBe("1,200");
    expect(back["Page1[0].f1_1[0]"]).toBe("Jane Q Doe");
    expect(back["Page1[0].f1_2[0]"]).toBe("123-45-6789");
    expect(back["Page1[0].BComb[0].f1_4[0]"]).toBe("541430");
    expect(back["Page1[0].DComb[0].f1_6[0]"]).toBe("123456789");
    expect(back["Page1[0].c1_1[0]"]).toBe("X");
    expect(back["Page1[0].c1_4[1]"]).toBe("X"); // no 1099s
  });
  it("Schedule SE", async () => {
    const { back } = await fill("schedule-se", formScheduleSE({ ...profile, se }));
    expect(back[SCHED_SE_LINES["2"]!]).toBe("100,000");
    expect(back[SCHED_SE_LINES["4a"]!]).toBe("92,350");
    expect(back[SCHED_SE_LINES["8d"]!]).toBe("20,000");
    expect(back[SCHED_SE_LINES["9"]!]).toBe("156,100");
    expect(back[SCHED_SE_LINES["12"]!]).toBe(se.line12.toLocaleString("en-US"));
    expect(back[SCHED_SE_LINES["13"]!]).toBe(se.line13.toLocaleString("en-US"));
    const small = formScheduleSE({ ...profile, se: seTax(us.table(2025).fed, "single", { netProfit: 300 }) });
    expect(small[SCHED_SE_LINES["12"]!]).toBeUndefined(); // under $400: stops at line 4c
  });
  it("Form 8995", async () => {
    const { back } = await fill("8995", form8995({ ...profile, qbi }));
    expect(back[F8995_LINES["5"]!]).toBe("18,000");
    expect(back[F8995_LINES["14"]!]).toBe("16,000");
    expect(back[F8995_LINES["15"]!]).toBe("16,000");
  });
  it("1040-ES vouchers: amounts on the vouchers of their own quarter; past ones skipped", async () => {
    const { back } = await fill("1040-es", es);
    expect(back[VOUCHER[1]!.amount]).toBe("1,000");
    expect(back[VOUCHER[2]!.amount]).toBe("2,000");
    expect(back[VOUCHER[3]!.amount]).toBe("3,000");
    expect(back[VOUCHER[4]!.amount]).toBe("4,000");
    expect(back[VOUCHER[4]!.first]).toBe("Jane Q");
    expect(back[VOUCHER[4]!.last]).toBe("Doe");
    expect(back[VOUCHER[2]!.state]).toBe("TX");
    const late = form1040ES({ ...profile, installments: inst, from: "2026-06-01" });
    expect(late[VOUCHER[1]!.amount]).toBeUndefined();
    expect(late[VOUCHER[3]!.amount]).toBe("3,000");
  });
  it("1099-NEC copy B, both revisions", async () => {
    const a = await fill("1099-nec-2026", form1099NEC2026(nec));
    expect(a.back["CopyB[0].LeftCol[0].f2_12[0]"]).toBe("Ana Designer");
    expect(a.back["CopyB[0].LeftCol[0].f2_11[0]"]).toBe("123-45-6789");
    expect(a.back["CopyB[0].RightCol[0].f2_20[0]"]).toBe("2,500.50");
    const b = await fill("1099-nec-2025", form1099NEC2025({ ...nec, year: 2025 }));
    expect(b.back["CopyB[0].LeftCol[0].f2_5[0]"]).toBe("Ana Designer");
    expect(b.back["CopyB[0].RightCol[0].f2_9[0]"]).toBe("2,500.50");
  });
});

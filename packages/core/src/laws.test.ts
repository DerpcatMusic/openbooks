import { describe, expect, test } from "vite-plus/test";
import { collectLawSources, inspectLawDocument, summarizeLawVerification } from "./laws.ts";
import type { CountryPack } from "./country.ts";

const mockPack = (id: string, url: string): CountryPack => ({
  manifest: {
    id,
    names: { en: id.toUpperCase(), he: id.toUpperCase() },
    currency: id === "us" ? "USD" : "ILS",
    flag: "",
    defaultType: "sole",
    taxYear: { start: "01-01" },
    businessTypes: [],
    legacyKinds: {},
    accounts: [],
  },
  tables: {
    2026: {
      year: 2026,
      form5472Penalty: 25000,
      sources: {
        form5472Penalty: { url, effective: "2026-01-01", note: "Form 5472 instructions" },
      },
    } as any,
  },
  table: () => ({ year: 2026 }),
  playbook: [
    {
      id: "us-5472",
      country: id,
      title_en: "Form 5472",
      title_he: "5472",
      applies_to: ["llc-disregarded"],
      kind: "compliance",
      ask: [],
      rule: "penalty $25,000",
      saving: "25000",
      values: {},
      how_en: "File",
      how_he: "הגש",
      risk: "none",
      source: `${url}#part-iv`,
      verified: true,
    },
  ],
  strings: { en: {}, he: {} },
});

describe("official law-source registry & verifier", () => {
  test("collectLawSources deduplicates URLs, classifies primary authority, and extracts expected signals", () => {
    const sources = collectLawSources([mockPack("us", "https://www.irs.gov/instructions/i5472")]);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      url: "https://www.irs.gov/instructions/i5472",
      authority: "Internal Revenue Service (IRS)",
      primary: true,
      jurisdiction: "us",
      verifiedInPack: true,
    });
    expect(sources[0]!.topics).toEqual(["us-5472", "us.table.form5472Penalty"]);
    expect(sources[0]!.expectedSignals).toContain("25,000");
  });

  test("inspectLawDocument detects matched signals and flags statutory drift when official text changes", () => {
    const [src] = collectLawSources([mockPack("us", "https://www.irs.gov/instructions/i5472")]);
    const first = inspectLawDocument(src!, "<html><body><h1>Form 5472</h1><p>The penalty is $25,000 per form.</p></body></html>", {
      fetchedAt: "2026-11-01T10:00:00Z",
      httpStatus: 200,
      lastModified: "Wed, 01 Oct 2026 00:00:00 GMT",
    });
    expect(first.status).toBe("verified");
    expect(first.matchedSignals).toContain("25,000");
    expect(first.detectedChanges).toEqual([]);

    const updated = inspectLawDocument(src!, "<html><body><h1>Form 5472</h1><p>The penalty is now $30,000 per form.</p></body></html>", {
      fetchedAt: "2026-11-24T10:00:00Z",
      httpStatus: 200,
      lastModified: "Mon, 23 Nov 2026 00:00:00 GMT",
      previous: first,
    });
    expect(updated.status).toBe("changed");
    expect(updated.detectedChanges.length).toBeGreaterThanOrEqual(2);

    const summary = summarizeLawVerification([src!], { [src!.url]: updated }, "2026-11-24T12:00:00Z");
    expect(summary).toMatchObject({ total: 1, primary: 1, changed: 1, verified: 0, stale: 0 });
  });
});

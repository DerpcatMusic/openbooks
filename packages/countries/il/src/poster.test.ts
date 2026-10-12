import { describe, expect, it } from "vite-plus/test";
import { posterBookmarklet, posterFields, posterScript } from "./poster.ts";

// runs the generated script against a stand-in for the Tax Authority page
function run(script: string, ids: Record<string, { type?: string; value?: string; checked?: boolean }>, path = "/shdochshana1301/frmTofes1301_2025.aspx") {
  const els = Object.fromEntries(
    Object.entries(ids).map(([id, e]) => [
      id,
      {
        type: "text",
        value: "",
        checked: false,
        ...e,
        focus() {},
        dispatchEvent() {},
        click() {
          this.checked = !this.checked;
        },
      },
    ]),
  );
  const said: string[] = [];
  // eslint-disable-next-line no-implied-eval -- the point is to run the generated script
  new Function("location", "document", "alert", "Event", script)(
    { hostname: "secapp.taxes.gov.il", pathname: path },
    { getElementById: (id: string) => els[id] ?? null },
    (m: string) => said.push(m),
    class {},
  );
  return { els, said };
}

describe("tax poster", () => {
  const fields = {
    last: "x",
    id: "1",
    "150": "18,413",
    "157": "3015",
    "040": "754",
    "060": "",
    "020": "X",
    zair: "X",
    "224": "2025",
    "224m": "2",
    "024": "32",
    "note:157": "n",
  };
  it("posts form numbers and named boxes only", () => {
    expect(posterFields(fields)).toEqual({
      "150": "18,413",
      "157": "3015",
      "040": "754",
      "060": "",
      "020": "X",
      zair: "X",
      "224": "2025",
      "224m": "2",
      "024": "32",
    });
  });
  it("fills boxes, ticks check boxes, reports the rest, never sends", () => {
    const s = posterScript(2025, fields, { balance: -754 });
    const { els, said } = run(s, {
      txt150: {},
      txt157: {},
      txt040: {},
      txt060: { value: "5026" },
      chk020: { type: "checkbox" },
      chkEsekZahirBZR: { type: "checkbox" },
    });
    expect([els.txt150!.value, els.txt157!.value, els.txt040!.value]).toEqual(["18413", "3015", "754"]);
    expect(els.txt060!.value).toBe(""); // a stale value in the saved draft is cleared
    expect(els.chk020!.checked && els.chkEsekZahirBZR!.checked).toBe(true);
    expect(said[0]).toContain("Not found on this page (enter by hand): 224, 224m, 024");
    expect(said[0]).toContain("a refund of 754");
    expect(s).not.toMatch(/שידור\b.*click|btnShidur/);
  });
  it("sets the discharged-soldier drop-downs", () => {
    const sel = { tagName: "SELECT" };
    const { els } = run(posterScript(2025, fields, { balance: 0 }), { ddl224: sel, ddlHodeshRashum: sel, ddl024: sel });
    expect([els.ddl224!.value, els.ddlHodeshRashum!.value, els.ddl024!.value]).toEqual(["2025", "2", "32"]);
  });
  it("refuses other pages and years", () => {
    expect(run(posterScript(2025, fields, { balance: 0 }), {}, "/shdochshana1301/frmTofes1301_2024.aspx").said[0]).toContain("open your 2025 form 1301");
  });
  it("bookmarklet", () => expect(posterBookmarklet(2025, fields, { balance: 0 })).toMatch(/^javascript:\(\(\)/));
});

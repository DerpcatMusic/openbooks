// bit CSV export (= books.py bit): money received from other people.
import type { StatementRow } from "@openbooks/schema";
import { num, pyStrip, utf8, type ReaderFile, type ReaderOut } from "./onezero.ts";

/**
 * Python csv.reader (excel dialect, strict=False) over a file opened in text mode (universal newlines: \r\n and \r become \n).
 * Empty lines are empty records; a quote inside an unquoted field is literal; text after a closing quote joins the field.
 */
export function pyCsv(text: string, delim = ","): string[][] {
  const s = text.replace(/\r\n?/g, "\n"),
    out: string[][] = [];
  let rec: string[] = [],
    f = "",
    st: "record" | "field" | "in" | "quoted" | "quote" = "record";
  const save = () => {
    rec.push(f);
    f = "";
  };
  const end = () => {
    out.push(rec);
    rec = [];
    st = "record";
  };
  for (const c of s) {
    if (st === "quoted") {
      if (c === '"') st = "quote";
      else f += c;
    } else if (c === "\n") {
      if (st !== "record") save();
      end();
    } else if (c === delim && st !== "quote") {
      save();
      st = "field";
    } else if (st === "quote") {
      // after a closing quote: "" is a literal quote, the delimiter ends the field, anything else joins it
      if (c === delim) {
        save();
        st = "field";
      } else {
        f += c;
        st = c === '"' ? "quoted" : "in";
      }
    } else if (st === "in") f += c;
    else if (c === '"') st = "quoted";
    else {
      f += c;
      st = "in";
    }
  }
  if (st !== "record") {
    save(); // last line without a newline, or EOF inside quotes (non-strict: kept)
    end();
  }
  return out;
}

/** Money received from other people; transfers from yourself (named `bitName` in the profile) are skipped. */
export function bitCsv(file: ReaderFile, ctx: { profile: { bitName?: string } }): ReaderOut {
  const owner = ctx.profile.bitName ?? "",
    rows: StatementRow[] = [];
  pyCsv(utf8(file.bytes, true)).forEach((raw, i) => {
    const r = raw.map(pyStrip);
    if (r.length >= 8 && r[0] === "Done" && r[5] === "Credit" && r[3] && r[6] !== owner) {
      const p = r[7]!.split(".");
      if (p.length !== 3) throw new Error(`bad bit date ${r[7]}`);
      const [d, m, y] = p;
      rows.push({
        date: `20${y}-${m}-${d}`,
        amount: num(r[3]),
        desc: `bit: ${r[6]} ${r[1]}`,
        source: "bit",
        account: "bit",
        who: r[6]!,
        file: file.name,
        page: i + 1,
        key: r[1]!,
      });
    }
  });
  if (!rows.length) throw new Error("not a bit export");
  return { rows, checks: [] };
}

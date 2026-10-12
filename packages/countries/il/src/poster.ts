// Tax poster: a script that fills the Tax Authority's online 1301 (secapp.taxes.gov.il/shdochshana1301/frmTofes1301_<year>.aspx)
// from the books. Run it on that page (bookmarklet or console) while signed in. It sets each box the way typing would (input,
// change, blur so the page's own validation runs), lists what it couldn't place, and never presses חישוב or שידור: the person
// checks the site's calculation against OpenBooks and sends the report themselves.

/** Site element ids: numeric boxes are txtNNN, check boxes chkNNN, drop-downs ddlNNN; a few have names instead of numbers. */
const NAMED: Record<string, string> = { zair: "chkEsekZahirBZR", "224m": "ddlHodeshRashum" };
/** Profile / bookkeeping keys the site fills itself (name, id, file) or that aren't boxes. */
const SKIP = new Set(["last", "first", "id", "file", "mine", "assessed", "inquiry"]);

/** The fields to post: form numbers and named boxes, notes dropped. Empty ones go too, to clear stale values in a saved draft. */
export function posterFields(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([k, v]) => v != null && !k.startsWith("note:") && !SKIP.has(k) && (/^\d{3}$/.test(k) || k in NAMED))
      // the site takes whole shekels only (a decimal fails its numeric check): round amounts, keep flags as they are
      .map(([k, v]) => [k, /^-?[\d,]*\.\d+$/.test(v) ? String(Math.round(+v.replace(/,/g, ""))) : v]),
  );
}

/** JavaScript that fills the open 1301 for `year`. `expect` is OpenBooks' result, shown so the person can compare after חישוב. */
export function posterScript(year: number, fields: Record<string, string>, expect: { balance: number }): string {
  const data = JSON.stringify({ year, f: posterFields(fields), named: NAMED, balance: Math.round(expect.balance) });
  return `(()=>{const D=${data};
if(!/secapp\\.taxes\\.gov\\.il$/.test(location.hostname)||!location.pathname.includes("frmTofes1301_"+D.year)){alert("OpenBooks: open your "+D.year+" form 1301 on secapp.taxes.gov.il first");return}
const set=[],miss=[];
for(const[k,v]of Object.entries(D.f)){const e=document.getElementById(D.named[k]||"txt"+k)||document.getElementById("chk"+k)||document.getElementById("ddl"+k);
if(!e){if(v!=="")miss.push(k);continue}
if(e.type==="checkbox"){const on=!!v&&v!=="0";if(e.checked!==on)e.click()}else if(e.tagName==="SELECT"){e.value=String(v);e.dispatchEvent(new Event("change",{bubbles:true}))}else{e.focus();e.value=String(v).replace(/,/g,"");["input","change","blur"].forEach(t=>e.dispatchEvent(new Event(t,{bubbles:true})))}
if(v!=="")set.push(k)}
alert("OpenBooks filled "+set.length+" fields: "+set.join(", ")+(miss.length?"\\nNot found on this page (enter by hand): "+miss.join(", "):"")+"\\n\\nOpenBooks expects "+(D.balance<0?"a refund of "+(-D.balance):D.balance>0?"tax to pay of "+D.balance:"nothing to pay")+" ₪ before the site adds indexation. Press חישוב and compare. Nothing was sent.")})()`;
}

/** The same script as a bookmarklet URL. */
export const posterBookmarklet = (...a: Parameters<typeof posterScript>) => "javascript:" + encodeURIComponent(posterScript(...a));

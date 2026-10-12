// Tax poster: a script that fills the Tax Authority's online 1301 (secapp.taxes.gov.il/shdochshana1301/frmTofes1301_<year>.aspx)
// from the books. Run it on that page (bookmarklet or console) while signed in. It sets each box the way typing would (input,
// change, blur so the page's own validation runs), lists what it couldn't place, and never presses חישוב or שידור: the person
// checks the site's calculation against OpenBooks and sends the report themselves.

/** Site element ids: numeric boxes are txtNNN, check boxes chkNNN; a few have names instead of numbers. */
const NAMED: Record<string, string> = { zair: "chkEsekZahirBZR" };
/** Profile / bookkeeping keys the site fills itself (name, id, file) or that aren't boxes. */
const SKIP = new Set(["last", "first", "id", "file", "mine", "assessed", "inquiry"]);

/** The fields to post: form numbers (and named check boxes) with a value, notes dropped. */
export function posterFields(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).filter(([k, v]) => v !== "" && v != null && !k.startsWith("note:") && !SKIP.has(k) && (/^\d{3}$/.test(k) || k in NAMED)),
  );
}

/** JavaScript that fills the open 1301 for `year`. `expect` is OpenBooks' result, shown so the person can compare after חישוב. */
export function posterScript(year: number, fields: Record<string, string>, expect: { balance: number }): string {
  const data = JSON.stringify({ year, f: posterFields(fields), named: NAMED, balance: Math.round(expect.balance) });
  return `(()=>{const D=${data};
if(!/secapp\\.taxes\\.gov\\.il$/.test(location.hostname)||!location.pathname.includes("frmTofes1301_"+D.year)){alert("OpenBooks: open your "+D.year+" form 1301 on secapp.taxes.gov.il first");return}
const set=[],miss=[];
for(const[k,v]of Object.entries(D.f)){const e=document.getElementById(D.named[k]||"txt"+k)||document.getElementById("chk"+k);
if(!e){miss.push(k);continue}
if(e.type==="checkbox"){const on=!!v&&v!=="0";if(e.checked!==on)e.click()}else{e.focus();e.value=String(v).replace(/,/g,"");["input","change","blur"].forEach(t=>e.dispatchEvent(new Event(t,{bubbles:true})))}
set.push(k)}
alert("OpenBooks filled "+set.length+" fields: "+set.join(", ")+(miss.length?"\\nNot found on this page (enter by hand): "+miss.join(", "):"")+"\\n\\nOpenBooks expects "+(D.balance<0?"a refund of "+(-D.balance):D.balance>0?"tax to pay of "+D.balance:"nothing to pay")+" ₪ before the site adds indexation. Press חישוב and compare. Nothing was sent.")})()`;
}

/** The same script as a bookmarklet URL. */
export const posterBookmarklet = (...a: Parameters<typeof posterScript>) => "javascript:" + encodeURIComponent(posterScript(...a));

// Tax and legal fixes: missing exchange rates, osek zair exclusions, Form 150 / 1324, zair VAT status, US 5472 settings.
export default {
  "fx.missing": "No Bank of Israel rate for {cur} yet",
  "taxximizer.why.noRate": "No dollar rate: type one to compare",
  "taxximizer.fxMissing": "There's no dollar rate for these dollar books yet. Type one in Dollar rate to compare structures.",
  "legal.fxMissingDates": {
    one: "{n} amount in {cur} has no Bank of Israel rate yet, so the numbers below leave it out. Nothing is converted at a guessed rate.",
    other: "{n} amounts in {cur} have no Bank of Israel rate yet, so the numbers below leave them out. Nothing is converted at a guessed rate.",
  },
  "legal.confirmAccountant": "Based on Income Tax Circular 7/2025 §3.3 (Ordinance §87ב–87ז). Confirm with an Israeli accountant before you file.",
  "you.cb.blocked.zairCompany": "Osek zair: you control a company",
  "legal.zairExcluded": "Osek zair doesn't apply to you this year",
  "legal.zairExcludedText":
    "{why} Under Income Tax Circular 7/2025 §3.3 (Ordinance §87ב–87ז) you can't be an osek zair, so the 30% deemed expenses don't apply: the return uses your actual expenses, the zair box stays empty, and you file the full 1301. Confirm with an Israeli accountant.",
  "legal.zairWhy.zair": "Part of your business income is attributed to you from a transparent foreign entity (your US LLC).",
  "legal.zairWhy.zairCompany": "You control a company.",
  "legal.f150": { one: "Form 150 for your foreign entity", other: "Form 150 for each of your {n} foreign entities" },
  "legal.f150Text":
    "Declaration of a holding in a foreign entity, attached to the 1301 every year you hold it (Circular 7/2025 §3.11). Put the signed form in Proofs.",
  "legal.f1324": "Foreign income on the return (appendix 1324)",
  "legal.f1324Loading": "Reading your foreign business's books…",
  "legal.f1324NoRate": {
    one: "{n} amount in {cur} has no Bank of Israel rate yet, so your foreign income is not on this return. It has to be converted at the representative rate of each transaction's date.",
    other:
      "{n} amounts in {cur} have no Bank of Israel rate yet, so your foreign income is not on this return. It has to be converted at the representative rate of each transaction's date.",
  },
  "legal.f1324Text": "{income} of foreign business income is in the taxable income; foreign tax credit {credit}.",
  "legal.f1324Company": "Your foreign company's profit is not attributed to you; its dividends are taxed when paid.",
  "legal.ret.foreign": "Foreign business income (appendix 1324)",
  "legal.ret.deduction": "Deduction, box {no}",
  "legal.ret.credits": "Credits for payments (boxes {boxes})",
  "legal.ret.ftc": "Foreign tax credit (appendix 1324)",
  "legal.vatStatus": "VAT status",
  "legal.vatStatus.patur": "Osek patur (no VAT)",
  "legal.vatStatus.murshe": "Osek murshe (charges VAT)",
  "taxUS.f.businessCountries": "Countries where the LLC does business",
  "taxUS.f.taxReturnCountry": "Country where the LLC files a tax return as a resident",
  "legal.hint.businessCountries":
    "Form 5472 line 1o: the principal country or countries where the business is run (for example the US and Israel). Not \u201cworldwide\u201d.",
  "legal.hint.taxReturnCountry":
    "Form 5472 line 1n. Leave blank if the LLC files no income tax return as a resident anywhere (a disregarded LLC usually files none).",
  "legal.unfilled": "The {form} was not downloaded: these fields could not be filled: {list}. Nothing was left out silently; please report this.",
  "legal.noBlank": "The {form} for tax year {y} is not bundled yet (the IRS form changes each year). Download it from irs.gov when it is published.",
  "legal.relatedTag": "Related party (owner)",
  "legal.partVOther": "{n} other transactions with you (net {total}) are tagged as related-party and go on Part V too.",
  "legal.receivedFromOwner": "Received from owner",
  "legal.paidToOwner": "Paid to owner",
  "legal.otherOwner": "Other transactions with the owner",
  "legal.relatedHint":
    "Other dealings with you (rent, services, loans, expenses you paid for the LLC) also go on Part V: give those transactions the related-party tag.",
  "legal.relatedHintNone":
    "Other dealings with you (rent, services, loans, expenses you paid for the LLC) also go on Part V. Add a related-party tag, then tag those transactions with it.",
  "legal.relatedAdd": "Add related-party tag",
};

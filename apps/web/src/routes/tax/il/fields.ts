// Form 1301 boxes the Tax page shows, by section (from web/src/lib/fields.js). `key` matches packages/countries/il/form/layout.json and the IL
// pack's form1301 fields; `no` is the box number printed on the form; `he` is the form's own wording (shown as is).
// Explanations: "fields.<key>.help", section titles: "fields.section.<n>" (1-based) in the dictionaries.
export interface Field1301 {
  key: string;
  no?: string;
  he: string;
  check?: boolean;
}
export const SECTIONS: { he: string; profile?: boolean; fields: Field1301[] }[] = [
  {
    he: "פרטים אישיים",
    profile: true,
    fields: [
      { key: "last", he: "שם משפחה" },
      { key: "first", he: "שם פרטי" },
      { key: "id", he: "מספר זהות" },
      { key: "file", he: "מספר תיק" },
      { key: "mine", he: "הדוח הוא על: הכנסותי בלבד", check: true },
      { key: "zair", he: "בעל עסק זעיר העומד בתנאים לניכוי 30%", check: true },
    ],
  },
  {
    he: "ג. הכנסות מיגיעה אישית",
    fields: [
      { key: "150", no: "150", he: "מיגיעה אישית מעסק או משלח יד" },
      { key: "186", no: "186", he: "הפסדים שקוזזו כנגד הכנסות מעסק" },
      { key: "238", no: "238", he: 'סך מחזור מעסק או משלח יד (ללא מע"מ)' },
    ],
  },
  { he: "ה. הכנסות בשיעורי מס מיוחדים", fields: [{ key: "060", no: "060", he: "ריבית ורווחים מקופות גמל — 15%" }] },
  {
    he: "יג. נקודות זיכוי",
    fields: [
      { key: "020", no: "020", he: "תושב", check: true },
      { key: "224", no: "224", he: "חייל משוחרר — שנת שחרור" },
      { key: "224m", no: "224", he: "חייל משוחרר — חודש שחרור" },
      { key: "024", no: "024", he: "מספר חודשי שירות מלאים" },
    ],
  },
  {
    he: "טו. מחזור למקדמות, ניכויים במקור",
    fields: [
      { key: "294", no: "294", he: 'סך המחזור ללא מע"מ, לרבות ריבית' },
      { key: "040", no: "040", he: 'סה"כ סכומים שנוכו במקור מהכנסות אחרות' },
    ],
  },
];

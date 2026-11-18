// מחברי בנקים: SimpleFIN / Lunch Flow, Wise, Enable Banking.
export default {
  "banks.g.agg": "מאגדים ובנקאות פתוחה",
  "connect.p.simplefin": "SimpleFIN / Lunch Flow",
  "connect.p.wise": "Wise",
  "connect.p.enablebanking": "Enable Banking (אירופה / בריטניה)",
  "connect.f.setupToken": "טוקן התקנה",
  "connect.f.wiseToken": "טוקן API אישי",
  "connect.f.appId": "מזהה אפליקציה",
  "connect.f.privateKey": "מפתח פרטי (PEM)",
  "connect.f.country": "מדינת הבנק (2 אותיות)",
  "connect.f.bank": "שם הבנק",
  "banks.what.simplefin": "כל החשבונות שהשירות מגיע אליהם: תנועות מאז הסנכרון האחרון (שנה בפעם הראשונה) והיתרה הנוכחית.",
  "banks.what.wise": "חשבון אחד לכל יתרת מטבע, עם התנועות והיתרה שלו. המרות מופיעות כיציאה ממטבע אחד וכניסה למטבע השני.",
  "banks.what.enablebanking": "החשבונות שאישרת בבנק: תנועות שנקלטו והיתרה, עד שההסכמה מסתיימת.",
  "banks.hint.simplefin":
    "עובד עם SimpleFIN Bridge (ארה״ב וקנדה) ועם Lunch Flow (מדינות רבות). יוצרים טוקן התקנה בלוח הבקרה של הספק ומדביקים כאן. OpenBooks מממש אותו פעם אחת ושומר רק את כתובת הגישה שהתקבלה; אי אפשר להשתמש בטוקן פעמיים.",
  "banks.hint.wise":
    "ב-Wise: הגדרות ← אינטגרציות וכלים ← טוקנים ל-API: יוצרים טוקן אישי (קריאה בלבד מספיקה). פרופילים בבריטניה ובאזור הכלכלי האירופי לא יכולים לספק דפי חשבון לטוקן אישי; במקרה כזה מורידים דף חשבון ב-CSV מ-Wise ומשתמשים ב״ייבוא CSV״.",
  "banks.hint.enablebanking":
    "רושמים אפליקציה משלכם באתר enablebanking.com (מצב מוגבל, בחינם לחשבונות שלכם), מוסיפים לה את כתובת ההפניה של OpenBooks ומדביקים את מזהה האפליקציה ואת המפתח הפרטי שהורדתם. השלב הבא מעביר לבנק לאישור גישת קריאה; ההסכמה נמשכת עד 180 יום.",
  "banks.pill.auth": "ממתין לבנק",
  "banks.authLink": "מאשרים גישת קריאה בבנק. אחר כך חוזרים ל-OpenBooks והסנכרון הראשון רץ מעצמו.",
  "banks.authOpen": "מעבר לבנק",
  "banks.expires": "ההסכמה מסתיימת",
  "banks.daysLeft": "נותרו {n} ימים",
  "banks.expired": "פגה",
  "banks.reconnect": "התחברות מחדש",
};

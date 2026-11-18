// Bank connectors: SimpleFIN / Lunch Flow, Wise, Enable Banking.
export default {
  "banks.g.agg": "Aggregators and open banking",
  "connect.p.simplefin": "SimpleFIN / Lunch Flow",
  "connect.p.wise": "Wise",
  "connect.p.enablebanking": "Enable Banking (EU / UK)",
  "connect.f.setupToken": "Setup token",
  "connect.f.wiseToken": "Personal API token",
  "connect.f.appId": "Application ID",
  "connect.f.privateKey": "Private key (PEM)",
  "connect.f.country": "Bank's country (2 letters)",
  "connect.f.bank": "Bank name",
  "banks.what.simplefin": "Every account the service can reach: transactions since the last sync (a year the first time) and the current balance.",
  "banks.what.wise": "One account per currency balance, with its transactions and balance. Conversions show as money out of one currency and into the other.",
  "banks.what.enablebanking": "The accounts you approved at the bank: booked transactions and the balance, until the consent ends.",
  "banks.hint.simplefin":
    "Works with SimpleFIN Bridge (US and Canada) and Lunch Flow (many countries). Create a setup token in your provider's dashboard and paste it here. OpenBooks claims it once and keeps only the resulting access URL; a token can't be used twice.",
  "banks.hint.wise":
    "Wise → Settings → Integrations and tools → API tokens: create a personal token (read-only is enough). UK and EEA profiles can't release statements to a personal token; for those, download a CSV statement from Wise and use “Import a CSV”.",
  "banks.hint.enablebanking":
    "Register your own app at enablebanking.com (restricted mode, free for your own accounts), add this redirect URL to it, and paste the application ID and the private key you downloaded. The next step takes you to your bank to approve read access; the consent lasts up to 180 days.",
  "banks.pill.auth": "Waiting for the bank",
  "banks.authLink": "Approve read access at your bank. You'll come back to OpenBooks afterwards, and the first sync runs on its own.",
  "banks.authOpen": "Go to the bank",
  "banks.expires": "Consent ends",
  "banks.daysLeft": "{n} days left",
  "banks.expired": "Expired",
  "banks.reconnect": "Reconnect",
};

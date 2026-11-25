// SimpleFIN (incl. SimpleFIN Bridge and Lunch Flow), Wise and Enable Banking connectors.
// Every sync writes the israeli-bank-scrapers file shape (`source: "scraper"`, accounts[{accountNumber, balance, currency, txns}]) like
// Plaid does, so the scraper reader ingests it and reconciles each account against its balance with no reader of its own.
// Docs read 2026-11-18:
//   SimpleFIN protocol  https://www.simplefin.org/protocol.html
//   Wise                https://docs.wise.com/api-reference/balance/balancelist.md ,
//                       https://docs.wise.com/api-reference/balance-statement/balancestatementget.md
//   Enable Banking      https://enablebanking.com/docs/api/reference/
// Secrets (access URL, token, private key, session) live in the vault-sealed `secret` field of the row and never reach errors or logs.
import { createPrivateKey, createSign, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { Effect } from "effect";
import { fail, last4, now, readJson, str, writeInbox, type Json } from "./index.ts";

type Txn = {
  date: string;
  chargedAmount: number;
  chargedCurrency: string;
  description: string;
  memo?: string;
  identifier?: string;
  status: "completed";
  /** What the bank says about the other side (see TransferLink in @openbooks/schema). */
  link?: { to?: { amount: number; currency: string }; ref?: string; party?: string; fee?: number };
};
type Acct = { accountNumber: string; balance: number | null; currency: string; txns: Txn[] };

const DAY = 86400;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clean = (s: unknown, n = 200) =>
  Array.from(str(s))
    .filter((c) => c >= " " && c !== "\x7f")
    .slice(0, n)
    .join("");
const cur = (c: unknown) => (/^[A-Za-z]{3}$/.test(str(c)) ? str(c).toUpperCase() : "XXX"); // SimpleFIN allows a URL for custom currencies
const amount = (v: unknown) => {
  const n = Number(str(v));
  return Number.isFinite(n) ? n : null;
};

/** One HTTP call; only the status, headers and parsed JSON (or {}) come back. Never puts the URL in an error (it may carry credentials). */
const call = (label: string, url: string, init: RequestInit = {}) =>
  Effect.tryPromise({
    try: async () => {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
      const text = await r.text();
      let json: Json = {};
      try {
        const j = JSON.parse(text) as unknown;
        if (j && typeof j === "object") json = j as Json;
      } catch {
        // not JSON: claim answers are plain text
      }
      return { status: r.status, ok: r.ok, headers: r.headers, text, json };
    },
    catch: (x) => fail(`Can't reach ${label}: ${clean((x as Error)?.message ?? "network error", 100)}`),
  });

/** Keeps what an earlier sync saw before `startDay` (per account or global) and wasn't seen again. */
const keepOld = (prev: Json | null, accts: Acct[], startDay: string | ReadonlyMap<string, string>) => {
  const old = Array.isArray(prev?.accounts) ? (prev.accounts as Acct[]) : [];
  const sig = (acctNum: string, t: Txn) => (t.identifier ? `${acctNum}|id:${t.identifier}` : `${acctNum}|row:${t.date}|${t.chargedAmount}|${t.description}`);
  const fresh = new Set(accts.flatMap((a) => a.txns.map((t) => sig(a.accountNumber, t))));
  for (const oa of old) {
    const cut = typeof startDay === "string" ? startDay : (startDay.get(oa.accountNumber) ?? "");
    const keep = (oa.txns ?? []).filter((t) => (!cut || t.date < cut) && !fresh.has(sig(oa.accountNumber, t)));
    const na = accts.find((a) => a.accountNumber === oa.accountNumber);
    if (na) na.txns = [...keep, ...na.txns];
    else accts.push({ ...oa, txns: keep });
  }
};
const file = (name: string, companyId: string, accounts: Acct[], extra: Json = {}) => ({
  source: "scraper",
  companyId,
  name,
  syncedAt: now(),
  ...extra,
  accounts,
});
const labels = (name: string, accts: Acct[]) => accts.map((a) => `${name} ••${last4(a.accountNumber)}`);

// ---------- SimpleFIN ----------
const SF = "SimpleFIN";
/** Setup token (base64 of the claim URL) -> access URL, by POSTing the claim URL once. A token works only once. */
export const simplefinClaim = (setupToken: string) =>
  Effect.gen(function* () {
    let claim: URL;
    try {
      claim = new URL(Buffer.from(setupToken.replace(/\s/g, ""), "base64").toString("utf8").trim());
    } catch {
      return yield* fail("That isn't a SimpleFIN setup token");
    }
    if (claim.protocol !== "https:") return yield* fail("That isn't a SimpleFIN setup token");
    const r = yield* call(SF, claim.href, { method: "POST" });
    if (r.status === 403) return yield* fail("SimpleFIN doesn't know this setup token or it was already claimed. Create a new one (each works once).");
    if (!r.ok) return yield* fail(`SimpleFIN claim failed (${r.status})`);
    const url = r.text.trim();
    try {
      const u = new URL(url);
      if (u.protocol === "https:" && u.username) return url;
    } catch {
      // falls through
    }
    return yield* fail("SimpleFIN answered the claim with something that isn't an access URL");
  });

const sfGet = (accessUrl: string, params: Record<string, string | number>) =>
  Effect.gen(function* () {
    const u = new URL(accessUrl);
    const auth = "Basic " + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64");
    u.username = u.password = ""; // fetch refuses credentials in the URL; the spec sends them as Basic auth
    const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const r = yield* call(SF, `${u.href.replace(/\/$/, "")}/accounts?${q}`, { headers: { Authorization: auth, Accept: "application/json" } });
    if (r.status === 403) return yield* fail("SimpleFIN refused the access URL (revoked or wrong credentials). Disconnect and connect with a new setup token.");
    if (r.status === 402) return yield* fail("SimpleFIN says payment is required: renew the subscription with your SimpleFIN / Lunch Flow provider.");
    if (!r.ok) return yield* fail(`SimpleFIN ${r.status} on /accounts`);
    return r.json;
  });

/** First sync: a year in 90-day windows (servers cap the range per request); later syncs: since the last one, 14 days back for late postings. */
export const simplefinSync = (dir: string, s: Record<string, string>, fileName = "simplefin-sync.json") =>
  Effect.gen(function* () {
    const prev = yield* Effect.promise(() => readJson(path.join(dir, "inbox", fileName)));
    const nowS = Math.floor(Date.now() / 1000);
    const lastS = prev?.syncedAt ? Math.floor(Date.parse(str(prev.syncedAt)) / 1000) : NaN;
    const floor = Number.isFinite(lastS) ? lastS - 14 * DAY : nowS - 365 * DAY;
    const byId = new Map<string, Acct>();
    const errs: string[] = [];
    for (let end = nowS + 1, i = 0; end > floor && i < 6; end -= 90 * DAY, i++) {
      // pending rows are left out (default): they arrive on the sync after they post
      const d = yield* sfGet(s.accessUrl ?? "", { "start-date": Math.max(end - 90 * DAY, floor), "end-date": end });
      const list = Array.isArray(d.errlist)
        ? (d.errlist as Json[]).map((e) => clean(e.msg || e.code))
        : Array.isArray(d.errors)
          ? (d.errors as unknown[]).map((e) => clean(e))
          : [];
      for (const m of list) if (m && !errs.includes(m)) errs.push(m);
      for (const a of (Array.isArray(d.accounts) ? d.accounts : []) as Json[]) {
        const id = str(a.id),
          c = cur(a.currency);
        const acct = byId.get(id) ?? { accountNumber: id, balance: amount(a.balance), currency: c, txns: [] }; // the newest window's balance wins
        for (const t of (Array.isArray(a.transactions) ? a.transactions : []) as Json[]) {
          const posted = Number(t.posted),
            amt = amount(t.amount);
          if (t.pending || !posted || amt === null) continue;
          if (acct.txns.some((x) => x.identifier === str(t.id))) continue;
          acct.txns.push({
            date: isoDay(posted * 1000),
            chargedAmount: amt,
            chargedCurrency: c,
            description: clean(t.description, 300),
            identifier: str(t.id),
            status: "completed",
          });
        }
        byId.set(id, acct);
      }
    }
    const accts = [...byId.values()];
    if (!accts.length && errs.length) return yield* fail(`${SF}: ${errs.join("; ")}`);
    keepOld(prev, accts, isoDay(floor * 1000));
    yield* writeInbox(dir, fileName, file(SF, "simplefin", accts, { startDate: isoDay(floor * 1000) }));
    // the data is saved even when the server reported a problem (a bank needing re-login, incomplete data): show it, retry next sync
    if (errs.length) return yield* fail(`${SF}: ${errs.join("; ")}`);
    return labels(SF, accts);
  });

// ---------- Wise ----------
const WISE = "https://api.wise.com";
const SCA =
  "Wise wouldn't release balance statements to a personal API token. Profiles in the UK and the EEA need strong customer authentication for statements, which a personal token can't give. Download a CSV statement from Wise (Account → Statements) and import it with “Import a CSV”.";
const wiseGet = (token: string, p: string, params: Record<string, string> = {}) =>
  Effect.gen(function* () {
    const q = new URLSearchParams(params).toString();
    const r = yield* call("Wise", `${WISE}${p}${q ? `?${q}` : ""}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    return r;
  });
const wiseOk = (r: { status: number; ok: boolean }, p: string) =>
  r.status === 401 ? fail("Wise refused the API token. Check it's an active personal token.") : r.ok ? Effect.void : fail(`Wise API ${r.status} on ${p}`);

/** Connect-time check: lists the profiles, so a wrong token is refused before anything is saved. */
export const wiseCheck = (token: string) => wiseGet(token, "/v2/profiles").pipe(Effect.flatMap((r) => wiseOk(r, "/v2/profiles")));

const money = (x: unknown) => {
  const m = (x ?? null) as Json | null,
    v = amount(m?.value),
    c = str(m?.currency).toUpperCase();
  return v !== null && /^[A-Z]{3}$/.test(c) ? { amount: Math.abs(v), currency: c } : undefined;
};
/**
 * What Wise says about a statement line: its fee, who sent it (deposits) and their reference, the target amount of a conversion, and
 * for money sent out (TRANSFER-<id>) the exact amount and currency the recipient got, from the transfer itself. A transfer Wise won't
 * show is left without it (the amount match still works).
 */
const wiseLink = (token: string, t: Json, v: number, budget: { lookups: boolean; eta: boolean }) =>
  Effect.gen(function* () {
    const d = (t.details ?? null) as Json | null,
      ref = str(t.referenceNumber);
    let to = v < 0 ? money(d?.targetAmount) : undefined;
    let reference = str(d?.paymentReference).trim();
    let party = str(d?.senderName).trim();
    let eta = "";
    const m = /^TRANSFER-(\d+)$/.exec(ref);
    // one failed lookup (Wise down, timing out) stops the rest for this sync: the amount match still works without them
    if (v < 0 && m && budget.lookups) {
      const r = yield* wiseGet(token, `/v1/transfers/${m[1]}`).pipe(Effect.orElseSucceed(() => null));
      if (!r) budget.lookups = false;
      const x = r?.ok ? ((r.json ?? {}) as Json) : null;
      const tv = amount(x?.targetValue),
        tc = str(x?.targetCurrency).toUpperCase();
      if (tv !== null && /^[A-Z]{3}$/.test(tc)) to = { amount: Math.abs(tv), currency: tc };
      reference ||= str(((x?.details ?? null) as Json | null)?.reference).trim();
      // when Wise expects it to land: the other bank's deposit is looked for around this day, not the day it left
      if (r?.ok && budget.eta) {
        const e = yield* wiseGet(token, `/v1/delivery-estimates/${m[1]}`).pipe(Effect.orElseSucceed(() => null));
        if (!e) budget.eta = false; // one failed estimate stops the rest for this sync, like the transfer lookups
        const when = e?.ok ? str((e.json as Json | undefined)?.estimatedDeliveryDate) : "";
        if (/^\d{4}-\d{2}-\d{2}/.test(when)) eta = when.slice(0, 10);
      }
    }
    if (!party && v < 0)
      party = str(d?.description)
        .replace(/^Sent money to\s+/i, "")
        .trim();
    const fee = amount((t.totalFees as Json | undefined)?.value);
    const link = {
      ...(to && to.currency !== str((t.amount as Json | undefined)?.currency).toUpperCase() ? { to } : {}),
      ...(reference ? { ref: clean(reference, 140) } : {}),
      ...(party ? { party: clean(party, 140) } : {}),
      ...(fee !== null && fee > 0 ? { fee: Math.abs(fee) } : {}),
      ...(eta ? { eta } : {}),
    };
    return Object.keys(link).length ? link : undefined;
  });

export const wiseSync = (dir: string, s: Record<string, string>, fileName = "wise-sync.json") =>
  Effect.gen(function* () {
    const budget = { lookups: true, eta: true };
    const token = s.token ?? "";
    const pr = yield* wiseGet(token, "/v2/profiles");
    yield* wiseOk(pr, "/v2/profiles");
    const profiles = (Array.isArray(pr.json) ? pr.json : JSON.parse(pr.text || "[]")) as Json[];
    const accts: Acct[] = [];
    for (const p of profiles) {
      const biz = str(p.type).toUpperCase() === "BUSINESS" && profiles.length > 1; // same currency in both profiles must stay two accounts
      const br = yield* wiseGet(token, `/v4/profiles/${str(p.id)}/balances`, { types: "STANDARD" });
      yield* wiseOk(br, "/balances");
      for (const b of (JSON.parse(br.text || "[]") as Json[]).filter((x) => x.type === "STANDARD" || x.type === undefined)) {
        const c = cur(b.currency),
          acct: Acct = { accountNumber: (biz ? "B" : "") + c, balance: amount((b.amount as Json | undefined)?.value), currency: c, txns: [] };
        const seen = new Map<string, number>();
        // balance statements span at most 469 days: walk back in 460-day windows until one is empty (5 at most)
        for (let end = Date.now(), i = 0; i < 5; i++) {
          const start = end - 460 * DAY * 1000;
          const r = yield* wiseGet(token, `/v1/profiles/${str(p.id)}/balance-statements/${str(b.id)}/statement.json`, {
            currency: c,
            intervalStart: new Date(start).toISOString(),
            intervalEnd: new Date(end).toISOString(),
            type: "COMPACT",
          });
          if (r.status === 403) return yield* fail(SCA);
          yield* wiseOk(r, "/statement");
          const txs = (Array.isArray(r.json.transactions) ? r.json.transactions : []) as Json[];
          if (i === 0) {
            const eb = amount((r.json.endOfStatementBalance as Json | undefined)?.value);
            if (eb !== null) acct.balance = eb;
          }
          for (const t of txs) {
            const a = t.amount as Json | undefined,
              d = t.details as Json | undefined,
              v = amount(a?.value);
            if (v === null) continue;
            const ref = str(t.referenceNumber),
              n = seen.get(ref) ?? 0;
            seen.set(ref, n + 1);
            // a conversion shows in both balances (out in one, in in the other), each under its own account
            const link = yield* wiseLink(token, t, v, budget);
            acct.txns.push({
              date: str(t.date).slice(0, 10),
              chargedAmount: v,
              chargedCurrency: cur(a?.currency ?? c),
              description: clean(d?.description || d?.type || "Wise", 300),
              identifier: ref ? (n ? `${ref}#${n + 1}` : ref) : undefined,
              status: "completed",
              ...(link ? { link } : {}),
            });
          }
          if (!txs.length) break;
          end = start - 1;
        }
        accts.push(acct);
      }
    }
    yield* writeInbox(dir, fileName, file("Wise", "wise", accts));
    return labels("Wise", accts);
  });

// ---------- Enable Banking ----------
const EB = "https://api.enablebanking.com";
const b64u = (x: string | Buffer) => Buffer.from(x).toString("base64url");
const normPem = (s: string) => s.replaceAll("\\n", "\n").trim();

/** The RS256 JWT every Enable Banking call carries (header kid = application id; up to 24 h of life, 1 h used). */
export const ebJwt = (appId: string, pem: string, iat = Math.floor(Date.now() / 1000)) => {
  const input = `${b64u(JSON.stringify({ typ: "JWT", alg: "RS256", kid: appId }))}.${b64u(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp: iat + 3600 }))}`;
  try {
    return `${input}.${b64u(
      createSign("RSA-SHA256")
        .update(input)
        .sign(createPrivateKey(normPem(pem))),
    )}`;
  } catch {
    throw fail("The private key isn't a valid RSA private key in PEM form (-----BEGIN PRIVATE KEY-----)");
  }
};

const ebCall = (c: { appId: string; privateKey: string }, method: "GET" | "POST", p: string, params: Record<string, string> = {}, body?: Json) =>
  Effect.gen(function* () {
    const jwt = yield* Effect.try({ try: () => ebJwt(c.appId, c.privateKey), catch: (x) => x as ReturnType<typeof fail> });
    const q = new URLSearchParams(params).toString();
    return yield* call("Enable Banking", `${EB}${p}${q ? `?${q}` : ""}`, {
      method,
      headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  });
const ebFail = (r: { status: number; json: Json }, p: string) =>
  fail(
    r.status === 401 || r.status === 403
      ? `Enable Banking refused the request (${r.status}) on ${p}. The app id or key may be wrong, or the bank consent was revoked or expired: reconnect.`
      : `Enable Banking ${r.status} on ${p}${r.json.message ? `: ${clean(r.json.message)}` : ""}`,
  );
const ebJson = (c: { appId: string; privateKey: string }, method: "GET" | "POST", p: string, params: Record<string, string> = {}, body?: Json) =>
  Effect.gen(function* () {
    const r = yield* ebCall(c, method, p, params, body);
    return r.ok ? r.json : yield* ebFail(r, p);
  });

/** state = entity, connection key and a nonce: the callback route finds the connection from it, and the nonce proves it's ours. */
export const ebState = (entity: string, key: string) => b64u(JSON.stringify([entity, key, randomBytes(24).toString("hex")]));
export const ebStateEntity = (state: string): string | null => {
  try {
    const [e] = JSON.parse(Buffer.from(state, "base64url").toString()) as unknown[];
    return typeof e === "string" ? e : null;
  } catch {
    return null;
  }
};
export const ebStateKey = (state: string): string | null => {
  try {
    const [, k] = JSON.parse(Buffer.from(state, "base64url").toString()) as unknown[];
    return typeof k === "string" ? k : null;
  } catch {
    return null;
  }
};
export const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const EB_CALLBACK = "/api/enablebanking/callback";
export const ebRedirect = (origin: string) => (/^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(origin) ? origin + EB_CALLBACK : null);

/** Step 1: find the bank (ASPSP) and start the authorization. Returns the bank's login URL and the expiry we ask for (consent: 180 days at most). */
export const ebStart = (c: { appId: string; privateKey: string; country: string; bank: string }, redirectUrl: string, state: string) =>
  Effect.gen(function* () {
    const list = ((yield* ebJson(c, "GET", "/aspsps", { country: c.country.toUpperCase() })).aspsps ?? []) as Json[];
    const want = c.bank.trim().toLowerCase();
    const bank = list.find((a) => str(a.name).toLowerCase() === want) ?? list.find((a) => str(a.name).toLowerCase().includes(want));
    if (!bank) {
      const some = list
        .slice(0, 8)
        .map((a) => str(a.name))
        .join(", ");
      return yield* fail(`No bank called “${clean(c.bank, 60)}” in ${clean(c.country, 2).toUpperCase()}${some ? `. Some that exist: ${some}` : ""}`);
    }
    const maxS = Number(bank.maximum_consent_validity) || 180 * DAY;
    const validUntil = new Date(Date.now() + Math.min(maxS, 180 * DAY) * 1000 - 60_000).toISOString();
    const a = yield* ebJson(c, "POST", "/auth", undefined, {
      access: { valid_until: validUntil },
      aspsp: { name: str(bank.name), country: str(bank.country) },
      state,
      redirect_url: redirectUrl,
      psu_type: "personal",
    });
    if (typeof a.url !== "string") return yield* fail("Enable Banking didn't return a bank login URL");
    return { url: a.url, bank: str(bank.name), country: str(bank.country), validUntil };
  });

/** Step 2: the code from the callback becomes a session. `accounts` is the list of {uid, iban?, currency}. */
export const ebSession = (c: { appId: string; privateKey: string }, code: string, fallbackValidUntil: string) =>
  Effect.gen(function* () {
    const d = yield* ebJson(c, "POST", "/sessions", undefined, { code });
    if (typeof d.session_id !== "string") return yield* fail("Enable Banking didn't return a session");
    const accounts = ((Array.isArray(d.accounts) ? d.accounts : []) as Json[])
      .filter((a) => typeof a.uid === "string")
      .map((a) => ({ uid: str(a.uid), iban: str((a.account_id as Json | undefined)?.iban), currency: str(a.currency) }));
    const validUntil = str((d.access as Json | undefined)?.valid_until) || fallbackValidUntil;
    return { sessionId: d.session_id, accounts, validUntil };
  });

const BAL_ORDER = ["CLBD", "ITBD", "CLAV", "ITAV", "XPCD"];
export const enablebankingSync = (dir: string, s: Record<string, string>, fileName = "enablebanking-sync.json") =>
  Effect.gen(function* () {
    if (s.validUntil && Date.parse(s.validUntil) < Date.now()) return yield* fail("The bank consent has expired. Reconnect to keep syncing.");
    const c = { appId: s.appId ?? "", privateKey: s.privateKey ?? "" };
    const sessAccts = JSON.parse(s.accountsJson || "[]") as { uid: string; iban: string; currency: string }[];
    const prev = yield* Effect.promise(() => readJson(path.join(dir, "inbox", fileName)));
    const lastMs = prev?.syncedAt ? Date.parse(str(prev.syncedAt)) : NaN;
    const first = !Number.isFinite(lastMs);
    const accts: Acct[] = [];
    const startByAcct = new Map<string, string>();
    let startDay = isoDay(Date.now() - 365 * DAY * 1000);
    for (const sa of sessAccts) {
      const bals = ((yield* ebJson(c, "GET", `/accounts/${sa.uid}/balances`)).balances ?? []) as Json[];
      const bal = BAL_ORDER.map((t) => bals.find((b) => b.balance_type === t)).find(Boolean) ?? bals[0];
      const ba = bal?.balance_amount as Json | undefined;
      const currency = cur(ba?.currency ?? sa.currency);
      const acct: Acct = { accountNumber: sa.iban || sa.uid, balance: amount(ba?.amount), currency, txns: [] };
      // banks cap how far back they answer: a year on the first sync, retried at 90 days if the bank says no
      let from = first ? Date.now() - 365 * DAY * 1000 : lastMs - 14 * DAY * 1000,
        shrunk = false;
      for (let key = "", pages = 0; pages < 200; pages++) {
        const r = yield* ebCall(c, "GET", `/accounts/${sa.uid}/transactions`, {
          date_from: isoDay(from),
          transaction_status: "BOOK",
          ...(key ? { continuation_key: key } : {}),
        });
        if (!r.ok) {
          if (first && !shrunk && !key && (r.status === 400 || r.status === 422)) {
            shrunk = true;
            from = Date.now() - 90 * DAY * 1000;
            continue;
          }
          return yield* ebFail(r, "/transactions");
        }
        for (const t of (Array.isArray(r.json.transactions) ? r.json.transactions : []) as Json[]) {
          const ta = t.transaction_amount as Json | undefined,
            v = amount(ta?.amount),
            date = str(t.booking_date || t.value_date || t.transaction_date).slice(0, 10);
          if (v === null || !date) continue;
          const out = t.credit_debit_indicator === "DBIT";
          const memo = ((Array.isArray(t.remittance_information) ? t.remittance_information : []) as unknown[])
            .map((x) => clean(x, 200))
            .filter(Boolean)
            .join(" ");
          const who = clean((t[out ? "creditor" : "debtor"] as Json | undefined)?.name, 200);
          const id = str(t.entry_reference || t.transaction_id);
          acct.txns.push({
            date,
            chargedAmount: out ? -Math.abs(v) : Math.abs(v),
            chargedCurrency: cur(ta?.currency ?? currency),
            description: who || memo || "Bank transaction",
            ...(who && memo ? { memo } : {}),
            identifier: id || undefined,
            status: "completed",
          });
        }
        const next = str(r.json.continuation_key);
        if (!next || next === key) break;
        key = next;
      }
      const acctStart = isoDay(from);
      startByAcct.set(acct.accountNumber, acctStart);
      startDay = acctStart;
      accts.push(acct);
    }
    keepOld(prev, accts, startByAcct);
    yield* writeInbox(dir, fileName, file("Enable Banking", "enablebanking", accts, { startDate: startDay }));
    return labels("Enable Banking", accts);
  });

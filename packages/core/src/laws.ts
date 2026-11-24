// Official statutory & regulatory law-source registry + pure document verifier.
// Extracts every primary government/statutory source URL referenced by country packs (tax tables, deductions, playbooks),
// fingerprints fetched official documents, and detects statutory drift or updates without ever silently overwriting numbers.
import type { CountryPack, PlaybookItem } from "./country.ts";
import { sha1Hex as sha1 } from "./sha1.ts";

export type LawJurisdiction = "il" | "us" | "treaty";

export interface LawSource {
  readonly id: string;
  readonly url: string;
  readonly host: string;
  readonly authority: string;
  readonly primary: boolean;
  readonly jurisdiction: LawJurisdiction;
  readonly title: string;
  readonly topics: readonly string[];
  readonly years: readonly number[];
  readonly effective?: string;
  readonly verifiedInPack: boolean;
  readonly expectedSignals: readonly string[];
}

export type LawVerificationStatus = "verified" | "changed" | "unreachable" | "unverified";

export interface LawVerification {
  readonly url: string;
  readonly status: LawVerificationStatus;
  readonly fetchedAt: string;
  readonly httpStatus?: number;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly sha1?: string;
  readonly matchedSignals: readonly string[];
  readonly missingSignals: readonly string[];
  readonly detectedChanges: readonly string[];
  readonly excerpt?: string;
  readonly error?: string;
}

export type LawVerificationCache = Readonly<Record<string, LawVerification>>;

export interface LawCheckSummary {
  readonly total: number;
  readonly primary: number;
  readonly verified: number;
  readonly changed: number;
  readonly unreachable: number;
  readonly unverified: number;
  readonly stale: number;
  readonly lastCheckedAt: string | null;
}

const PRIMARY_HOSTS: Readonly<Record<string, { authority: string; jurisdiction?: LawJurisdiction }>> = {
  "www.irs.gov": { authority: "Internal Revenue Service (IRS)", jurisdiction: "us" },
  "irs.gov": { authority: "Internal Revenue Service (IRS)", jurisdiction: "us" },
  "www.law.cornell.edu": { authority: "US Code / CFR (Cornell LII)", jurisdiction: "us" },
  "www.congress.gov": { authority: "US Congress Legislation", jurisdiction: "us" },
  "corp.delaware.gov": { authority: "Delaware Division of Corporations", jurisdiction: "us" },
  "sos.wyo.gov": { authority: "Wyoming Secretary of State", jurisdiction: "us" },
  "www.gov.il": { authority: "Israel Tax Authority (gov.il)", jurisdiction: "il" },
  "gov.il": { authority: "Israel Tax Authority (gov.il)", jurisdiction: "il" },
  "taxes.gov.il": { authority: "Israel Tax Authority", jurisdiction: "il" },
  "www.btl.gov.il": { authority: "National Insurance Institute (Bituach Leumi)", jurisdiction: "il" },
  "btl.gov.il": { authority: "National Insurance Institute (Bituach Leumi)", jurisdiction: "il" },
  "www.boi.org.il": { authority: "Bank of Israel", jurisdiction: "il" },
  "he.wikisource.org": { authority: "Israeli Income Tax Ordinance (Wikisource)", jurisdiction: "il" },
  "www.kolzchut.org.il": { authority: "KolZchut (Israeli Rights Portal)", jurisdiction: "il" },
};

const canonicalUrl = (raw: string): string | null => {
  const trimmed = raw.trim().replace(/[),.;]+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
};

const extractUrls = (text: string): string[] => {
  const out: string[] = [];
  for (const part of text.split(/\s*;\s*/)) {
    const m = part.match(/https?:\/\/[^\s;]+/gi);
    if (m)
      for (const hit of m) {
        const c = canonicalUrl(hit);
        if (c) out.push(c);
      }
  }
  return out;
};

const authorityOf = (host: string, fallbackCountry: string, url: string): { authority: string; primary: boolean; jurisdiction: LawJurisdiction } => {
  const h = host.toLowerCase();
  const isTreaty = /treaty/i.test(url);
  const known = PRIMARY_HOSTS[h];
  if (known) {
    return {
      authority: known.authority,
      primary: h !== "www.kolzchut.org.il",
      jurisdiction: isTreaty ? "treaty" : (known.jurisdiction ?? (fallbackCountry === "us" ? "us" : "il")),
    };
  }
  return {
    authority: h,
    primary: false,
    jurisdiction: isTreaty ? "treaty" : fallbackCountry === "us" ? "us" : "il",
  };
};

/** Build a deduplicated catalog of every statutory/regulatory law source referenced by the country packs. */
export function collectLawSources(packs: readonly CountryPack<any>[]): LawSource[] {
  const map = new Map<
    string,
    {
      url: string;
      host: string;
      authority: string;
      primary: boolean;
      jurisdiction: LawJurisdiction;
      title: string;
      topics: Set<string>;
      years: Set<number>;
      effective?: string;
      verifiedInPack: boolean;
      expectedSignals: Set<string>;
    }
  >();

  const add = (opts: {
    url: string;
    country: string;
    title: string;
    topic: string;
    year?: number;
    effective?: string;
    verified?: boolean;
    signals?: readonly string[];
  }) => {
    const url = canonicalUrl(opts.url);
    if (!url) return;
    const host = new URL(url).hostname;
    const meta = authorityOf(host, opts.country, url);
    let entry = map.get(url);
    if (!entry) {
      entry = {
        url,
        host,
        ...meta,
        title: opts.title,
        topics: new Set(),
        years: new Set(),
        effective: opts.effective,
        verifiedInPack: !!opts.verified,
        expectedSignals: new Set(),
      };
      map.set(url, entry);
    }
    entry.topics.add(opts.topic);
    if (opts.year) entry.years.add(opts.year);
    if (opts.effective && (!entry.effective || opts.effective > entry.effective)) entry.effective = opts.effective;
    if (opts.verified) entry.verifiedInPack = true;
    for (const s of opts.signals ?? []) if (s) entry.expectedSignals.add(s);
  };

  for (const pack of packs) {
    const country = pack.manifest.id;
    // 1. Tax table sources (brackets, ceilings, rates, penalties)
    for (const [yStr, tbl] of Object.entries(pack.tables ?? {})) {
      const year = Number(yStr);
      const t = tbl as Record<string, unknown>;
      const sources = (t.sources ?? {}) as Record<string, { url?: string; effective?: string; note?: string }>;
      for (const [field, src] of Object.entries(sources)) {
        if (!src?.url) continue;
        const val = field.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), t);
        const signals: string[] = [];
        if (typeof val === "number" && Number.isFinite(val)) {
          if (val >= 100) {
            signals.push(String(val), val.toLocaleString("en-US"));
          } else if (val > 0 && val < 1) {
            const pct = +(val * 100).toFixed(2);
            signals.push(`${pct}%`);
          }
        }
        add({
          url: src.url,
          country,
          title: src.note || `${country.toUpperCase()} ${field}`,
          topic: `${country}.table.${field}`,
          year,
          effective: src.effective,
          verified: true,
          signals,
        });
      }
    }

    // 2. Deduction rule sources
    for (const rule of pack.deductions?.rules ?? []) {
      for (const src of rule.sources ?? []) {
        if (!src?.url) continue;
        add({
          url: src.url,
          country,
          title: src.title || rule.label.en,
          topic: rule.id,
          verified: !rule.unverified?.length,
          signals: rule.incomeTaxPct !== null && rule.incomeTaxPct > 0 && rule.incomeTaxPct < 100 ? [`${rule.incomeTaxPct}%`] : [],
        });
      }
    }

    // 3. Playbook strategy sources
    for (const item of (pack.playbook ?? []) as readonly PlaybookItem[]) {
      for (const url of extractUrls(item.source ?? "")) {
        add({
          url,
          country,
          title: item.title_en,
          topic: item.id,
          verified: !!item.verified,
        });
      }
    }
  }

  return [...map.values()]
    .map((e) => ({
      id: sha1(e.url).slice(0, 12),
      url: e.url,
      host: e.host,
      authority: e.authority,
      primary: e.primary,
      jurisdiction: e.jurisdiction,
      title: e.title,
      topics: [...e.topics].sort(),
      years: [...e.years].sort((a, b) => b - a),
      ...(e.effective ? { effective: e.effective } : {}),
      verifiedInPack: e.verifiedInPack,
      expectedSignals: [...e.expectedSignals].slice(0, 8),
    }))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.jurisdiction.localeCompare(b.jurisdiction) || a.url.localeCompare(b.url));
}

/** Strip HTML markup and collapse whitespace into clean searchable text. */
export function extractPlainText(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pure verification of a fetched official law document against its previous cached snapshot and expected statutory signals.
 * Detects content-hash drift (e.g. IRS or Israel Tax Authority updated a form/circular) without blindly mutating tax tables.
 */
export function inspectLawDocument(
  source: LawSource,
  body: string,
  opts: {
    fetchedAt: string;
    httpStatus: number;
    etag?: string;
    lastModified?: string;
    previous?: LawVerification;
  },
): LawVerification {
  const text = extractPlainText(body);
  const digest = sha1(text);
  const matchedSignals: string[] = [];
  const missingSignals: string[] = [];
  const lower = text.toLowerCase();

  for (const sig of source.expectedSignals) {
    if (lower.includes(sig.toLowerCase())) matchedSignals.push(sig);
    else missingSignals.push(sig);
  }

  const detectedChanges: string[] = [];
  if (opts.previous?.sha1 && opts.previous.sha1 !== digest) {
    detectedChanges.push(
      `Official document text changed since ${opts.previous.fetchedAt.slice(0, 10)} (sha1 ${opts.previous.sha1.slice(0, 8)} → ${digest.slice(0, 8)})`,
    );
  }
  if (opts.previous?.lastModified && opts.lastModified && opts.previous.lastModified !== opts.lastModified) {
    detectedChanges.push(`Last-Modified changed (${opts.previous.lastModified} → ${opts.lastModified})`);
  }

  const status: LawVerificationStatus = opts.httpStatus < 200 || opts.httpStatus >= 400 ? "unreachable" : detectedChanges.length > 0 ? "changed" : "verified";

  return {
    url: source.url,
    status,
    fetchedAt: opts.fetchedAt,
    httpStatus: opts.httpStatus,
    ...(opts.etag ? { etag: opts.etag } : {}),
    ...(opts.lastModified ? { lastModified: opts.lastModified } : {}),
    sha1: digest,
    matchedSignals,
    missingSignals,
    detectedChanges,
    excerpt: text.slice(0, 280),
  };
}

/** Summarize verification freshness and detected changes across the entire statutory source catalog. */
export function summarizeLawVerification(
  sources: readonly LawSource[],
  cache: LawVerificationCache,
  nowIso = new Date().toISOString(),
  staleDays = 90,
): LawCheckSummary {
  const nowMs = Date.parse(nowIso);
  let verified = 0,
    changed = 0,
    unreachable = 0,
    unverified = 0,
    stale = 0;
  let lastCheckedAt: string | null = null;

  for (const s of sources) {
    const rec = cache[s.url];
    if (!rec) {
      unverified++;
      continue;
    }
    if (!lastCheckedAt || rec.fetchedAt > lastCheckedAt) lastCheckedAt = rec.fetchedAt;
    if (rec.status === "verified") verified++;
    else if (rec.status === "changed") changed++;
    else if (rec.status === "unreachable") unreachable++;
    else unverified++;

    const ageDays = (nowMs - Date.parse(rec.fetchedAt)) / 864e5;
    if (Number.isFinite(ageDays) && ageDays > staleDays) stale++;
  }

  return {
    total: sources.length,
    primary: sources.filter((s) => s.primary).length,
    verified,
    changed,
    unreachable,
    unverified,
    stale,
    lastCheckedAt,
  };
}

// Official law-source catalog & live verifier shared by HTTP (/api/laws, /api/laws/refresh) and MCP (law_sources).
// Strictly fetches ONLY URLs cataloged in the country packs (zero arbitrary URL fetching / zero SSRF) and stores
// verification snapshots in doc("_app", "law-sources") without ever blindly overwriting statutory tax tables.
import {
  collectLawSources,
  inspectLawDocument,
  summarizeLawVerification,
  type LawCheckSummary,
  type LawJurisdiction,
  type LawSource,
  type LawVerification,
  type LawVerificationCache,
} from "@openbooks/core";
import { il } from "@openbooks/country-il";
import { us } from "@openbooks/country-us";
import { Books } from "@openbooks/storage";
import { Effect } from "effect";

export const OFFICIAL_PACKS = [il, us] as const;

export interface LawCatalogEntry extends LawSource {
  readonly verification: LawVerification | null;
}

export interface LawCatalogResponse {
  readonly summary: LawCheckSummary;
  readonly sources: readonly LawCatalogEntry[];
}

export interface RefreshLawsOptions {
  /** Only check primary government/statutory hosts (irs.gov, gov.il, btl.gov.il, law.cornell.edu, congress.gov, wikisource, state SOS). Default: true. */
  readonly primaryOnly?: boolean;
  /** Optional filter by jurisdiction ("il" | "us" | "treaty"). */
  readonly jurisdiction?: LawJurisdiction;
  /** Optional subset of catalog URLs to refresh (any URL not in the pack catalog is ignored). */
  readonly urls?: readonly string[];
  /** Custom fetch implementation for tests. */
  readonly fetchFn?: typeof fetch;
  /** Timeout per source in ms (default 10000). */
  readonly timeoutMs?: number;
}

export const allLawSources = () => collectLawSources(OFFICIAL_PACKS);

export const listLawSources = (opts?: { primaryOnly?: boolean; jurisdiction?: LawJurisdiction }) =>
  Effect.gen(function* () {
    const cache = yield* Books.use((b) => b.doc<LawVerificationCache>("_app", "law-sources", {})).pipe(Effect.orDie);
    let sources = allLawSources();
    if (opts?.primaryOnly) sources = sources.filter((s) => s.primary);
    if (opts?.jurisdiction) sources = sources.filter((s) => s.jurisdiction === opts.jurisdiction);
    const summary = summarizeLawVerification(sources, cache);
    return {
      summary,
      sources: sources.map((s) => ({ ...s, verification: cache[s.url] ?? null })),
    } satisfies LawCatalogResponse;
  });

export const refreshLawSources = (opts: RefreshLawsOptions = {}) =>
  Effect.gen(function* () {
    const prevCache = yield* Books.use((b) => b.doc<LawVerificationCache>("_app", "law-sources", {})).pipe(Effect.orDie);
    const all = allLawSources();
    const allowSet = opts.urls?.length ? new Set(opts.urls) : null;
    const targets = all.filter((s) => {
      if (opts.primaryOnly !== false && !s.primary) return false;
      if (opts.jurisdiction && s.jurisdiction !== opts.jurisdiction) return false;
      if (allowSet && !allowSet.has(s.url)) return false;
      return true;
    });

    const fetcher = opts.fetchFn ?? fetch;
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const nextCache: Record<string, LawVerification> = { ...prevCache };

    // Polite concurrency cap (4 concurrent requests) to avoid hammering government hosts.
    const queue = [...targets];
    const worker = async () => {
      while (queue.length) {
        const src = queue.shift()!;
        const prev = prevCache[src.url];
        const fetchedAt = new Date().toISOString();
        const headers: Record<string, string> = {
          "User-Agent": "OpenBooks-LawVerifier/1.0 (+https://github.com/DerpcatMusic/openbooks)",
          Accept: "text/html,application/xhtml+xml,text/plain,application/pdf;q=0.5,*/*;q=0.1",
        };
        if (prev?.etag) headers["If-None-Match"] = prev.etag;
        if (prev?.lastModified) headers["If-Modified-Since"] = prev.lastModified;

        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeoutMs);
        try {
          const res = await fetcher(src.url, { headers, redirect: "follow", signal: ac.signal });
          if (res.status === 304 && prev) {
            nextCache[src.url] = { ...prev, status: "verified", fetchedAt, httpStatus: 304, detectedChanges: [] };
            continue;
          }
          const ct = res.headers.get("content-type") ?? "";
          // For binary PDFs (e.g. IRS Rev. Proc. PDFs), fingerprint metadata/headers cleanly rather than raw binary text parsing.
          const body = ct.includes("pdf")
            ? `PDF ${src.url} status=${res.status} len=${res.headers.get("content-length") ?? "?"} lm=${res.headers.get("last-modified") ?? ""}`
            : (await res.text()).slice(0, 400_000);
          nextCache[src.url] = inspectLawDocument(src, body, {
            fetchedAt,
            httpStatus: res.status,
            etag: res.headers.get("etag") ?? undefined,
            lastModified: res.headers.get("last-modified") ?? undefined,
            previous: prev,
          });
        } catch (err) {
          nextCache[src.url] = {
            url: src.url,
            status: "unreachable",
            fetchedAt,
            matchedSignals: prev?.matchedSignals ?? [],
            missingSignals: prev?.missingSignals ?? src.expectedSignals,
            detectedChanges: [],
            error: String((err as Error)?.message || err),
          };
        } finally {
          clearTimeout(timer);
        }
      }
    };

    yield* Effect.promise(() => Promise.all(Array.from({ length: Math.min(4, Math.max(1, targets.length)) }, () => worker())));
    yield* Books.use((b) => b.putDoc("_app", "law-sources", nextCache)).pipe(Effect.orDie);

    const filtered = all.filter((s) => (!opts.jurisdiction || s.jurisdiction === opts.jurisdiction) && (opts.primaryOnly !== false ? s.primary : true));
    return {
      summary: summarizeLawVerification(filtered, nextCache),
      sources: filtered.map((s) => ({ ...s, verification: nextCache[s.url] ?? null })),
    } satisfies LawCatalogResponse;
  });

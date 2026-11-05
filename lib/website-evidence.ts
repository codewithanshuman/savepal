import { MAX_HTML_BYTES, readBoundedHtml, type Criterion, type Finding } from "./assurance.ts";
import { internalLinks, normalizedWords, phraseEvidence, visibleText, type InternalLink } from "./html-evidence.ts";

export const SNAPSHOT_VERSION = "website-snapshot-v1";
export const MAX_PAGES = 6;

export type SnapshotPage = {
  url: string;
  status: number;
  contentType: string;
  body: string;
  bodyHash: string | null;
  truncated: boolean;
  error: string | null;
  title: string | null;
  viewportMeta: boolean;
  formCount: number;
  buttonCount: number;
  productSchema: boolean;
  links: string[];
};
export type WebsiteSnapshot = {
  version: string;
  rootUrl: string;
  capturedAt: string;
  pages: SnapshotPage[];
  discoveredInternalLinks: number;
  coverageLimited: boolean;
};
export type SnapshotManifest = {
  version: string;
  rootUrl: string;
  capturedAt: string;
  pages: Array<Omit<SnapshotPage, "body" | "links"> & { bytes: number; linksDiscovered: number }>;
  discoveredInternalLinks: number;
  coverageLimited: boolean;
};
export type AdvancedFinding = Finding & {
  evidenceRefs: Array<{ url: string; bodyHash: string | null; excerpt?: string }>;
  signals: string[];
  requiresHumanReview: boolean;
  coverage: "FULL" | "PARTIAL";
};
export type LivePage = { url: string; status: number; body: string };

export async function sha256(value: string): Promise<string> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(raw), b => b.toString(16).padStart(2, "0")).join("");
}

export function extractedText(html: string): string {
  return visibleText(html);
}

function pageSignals(html: string) {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] || null;
  return {
    title: title ? extractedText(title).slice(0, 160) : null,
    viewportMeta: /<meta\b[^>]*\bname\s*=\s*(["'])viewport\1/i.test(html),
    formCount: (html.match(/<form\b/gi) || []).length,
    buttonCount: (html.match(/<button\b/gi) || []).length,
    productSchema: /schema\.org\/Product|"@type"\s*:\s*"Product"/i.test(html),
  };
}

async function capturePage(url: string, origin: string, fetcher: typeof fetch): Promise<SnapshotPage> {
  try {
    const response = await fetcher(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "text/html", "User-Agent": "SavePal-Evidence/1.0" },
    });
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const { body, truncated } = response.ok && contentType.includes("text/html")
      ? await readBoundedHtml(response) : { body: "", truncated: false };
    const signals = pageSignals(body);
    return {
      url, status: response.status, contentType, body,
      bodyHash: body ? await sha256(body) : null, truncated, error: null,
      ...signals, links: body ? internalLinks(body,url,origin).map(link => link.url) : [],
    };
  } catch {
    return {
      url, status: 0, contentType: "", body: "", bodyHash: null,
      truncated: false, error: "Fetch failed or timed out", title: null,
      viewportMeta: false, formCount: 0, buttonCount: 0, productSchema: false, links: [],
    };
  }
}

function linkPriority(link: InternalLink, criteria: Criterion[]) {
  const terms = new Set(normalizedWords(`${link.text} ${new URL(link.url).pathname}`).split(" ").filter(term => term.length >= 4).map(term => term.replace(/s$/, "")));
  const requirementTerms = new Set(criteria.flatMap(c => normalizedWords(`${c.label} ${c.needle || ""}`).split(" ")).filter(term => term.length >= 4).map(term => term.replace(/s$/, "")));
  const overlap = [...terms].filter(term => requirementTerms.has(term)).length;
  return overlap * 10 + (/\/(product|shop|catalog|checkout|cart|store)/i.test(link.url) ? 2 : 0);
}

export async function captureWebsite(rootUrl: string, fetcher: typeof fetch = fetch, criteria: Criterion[] = []): Promise<WebsiteSnapshot> {
  const root = new URL(rootUrl);
  const first = await capturePage(rootUrl,root.origin,fetcher);
  const links = first.body ? internalLinks(first.body,rootUrl,root.origin).filter(link => link.url !== rootUrl) : [];
  links.sort((a,b) => linkPriority(b,criteria)-linkPriority(a,criteria) || a.url.localeCompare(b.url));
  const selected = links.slice(0, MAX_PAGES - 1).map(link => link.url);
  const others = await Promise.all(selected.map(url => capturePage(url,root.origin,fetcher)));
  const pages = [first,...others];
  return {
    version: SNAPSHOT_VERSION, rootUrl, capturedAt: new Date().toISOString(), pages,
    discoveredInternalLinks: links.length,
    coverageLimited: links.length > selected.length || pages.some(p => p.truncated || p.status < 200 || p.status >= 300),
  };
}

export function snapshotManifest(snapshot: WebsiteSnapshot): SnapshotManifest {
  return {
    version: snapshot.version, rootUrl: snapshot.rootUrl, capturedAt: snapshot.capturedAt,
    discoveredInternalLinks: snapshot.discoveredInternalLinks, coverageLimited: snapshot.coverageLimited,
    pages: snapshot.pages.map(({ body, links, ...page }) => ({ ...page, bytes: new TextEncoder().encode(body).length, linksDiscovered: links.length })),
  };
}

export async function validateSnapshot(raw: string, expectedHash: string, expectedManifestJson: string, rootUrl: string): Promise<WebsiteSnapshot | null> {
  if (raw.length > MAX_PAGES * 120_000 || await sha256(raw) !== expectedHash) return null;
  try {
    const snapshot = JSON.parse(raw) as WebsiteSnapshot;
    if (snapshot.version !== SNAPSHOT_VERSION || snapshot.rootUrl !== rootUrl || !Array.isArray(snapshot.pages) || snapshot.pages.length < 1 || snapshot.pages.length > MAX_PAGES) return null;
    const origin = new URL(rootUrl).origin;
    for (const page of snapshot.pages) {
      if (typeof page.url !== "string" || new URL(page.url).origin !== origin || typeof page.body !== "string" || new TextEncoder().encode(page.body).length > MAX_HTML_BYTES) return null;
      if ((page.body ? await sha256(page.body) : null) !== page.bodyHash) return null;
    }
    if (JSON.stringify(snapshotManifest(snapshot)) !== expectedManifestJson) return null;
    return snapshot;
  } catch { return null; }
}

export function evaluateSnapshot(criteria: Criterion[], snapshot: WebsiteSnapshot, livePages: LivePage[]): AdvancedFinding[] {
  const root = snapshot.pages[0];
  const liveByUrl = new Map(livePages.map(page => [page.url,page]));
  const submittedText = new Map(snapshot.pages.map(page => [page.url,extractedText(page.body)]));
  const currentText = new Map(livePages.map(page => [page.url,extractedText(page.body)]));
  const liveSuccess = (page: SnapshotPage) => {
    const live = liveByUrl.get(page.url);
    return !!live && live.status >= 200 && live.status < 300 && !!live.body;
  };
  return criteria.map(c => {
    if (c.kind === "reachable") {
      const live = liveByUrl.get(root.url);
      const passed = root.status >= 200 && root.status < 300 && !!live && live.status >= 200 && live.status < 300;
      const failed = root.status >= 400 && root.status < 500 && !!live && live.status >= 400 && live.status < 500;
      const status = passed ? "VERIFIED" : failed ? "FAILED" : "INCONCLUSIVE";
      return {
        label: c.label, status, check: "Snapshot and live HTTP availability",
        explanation: passed ? `The root returned HTTP ${root.status} at submission and HTTP ${live.status} on verification.` :
          failed ? `The root returned HTTP ${root.status} at submission and HTTP ${live.status} on verification.` :
          "The submitted and live availability checks disagree or one could not be completed.",
        evidenceRefs: [{ url: root.url, bodyHash: root.bodyHash }],
        signals: [`Captured HTTP ${root.status}`,`Live HTTP ${live?.status ?? 0}`],
        requiresHumanReview: status !== "VERIFIED", coverage: "FULL",
      };
    }
    if (c.kind === "contains") {
      const needle = c.needle || "";
      const matches = snapshot.pages.map(page => ({ page, excerpt: phraseEvidence(submittedText.get(page.url) || "",needle) }))
        .filter((match): match is { page: SnapshotPage; excerpt: string } => !!match.excerpt);
      const confirmed = matches.filter(({page}) => liveSuccess(page) && !!phraseEvidence(currentText.get(page.url) || "",needle));
      const complete = !snapshot.coverageLimited && snapshot.pages.every(page => page.status >= 200 && page.status < 300 && !page.truncated && liveSuccess(page));
      const status = confirmed.length ? "VERIFIED" : !matches.length && complete ? "FAILED" : "INCONCLUSIVE";
      return {
        label: c.label, status, check: "Whole-phrase visible text in submitted and live pages",
        explanation: confirmed.length ? `The whole phrase appears in ${confirmed.length} submitted page${confirmed.length === 1 ? "" : "s"} and remains present on the same live page.` :
          matches.length ? "The submitted page contained the phrase, but it is missing or could not be confirmed on that live page." :
          complete ? "The phrase was absent from all captured, live-confirmed internal pages." :
          "The phrase was not found, but page availability or crawl coverage is incomplete.",
        evidenceRefs: matches.length ? matches.map(({page,excerpt}) => ({ url:page.url,bodyHash:page.bodyHash,excerpt })) :
          snapshot.pages.map(p => ({ url:p.url,bodyHash:p.bodyHash })),
        signals: [`${snapshot.pages.length} page(s) captured`,`${confirmed.length} live-confirmed whole-phrase match(es)`,`Discovered-page coverage ${complete ? "complete" : "partial"}`],
        requiresHumanReview: status !== "VERIFIED", coverage: complete ? "FULL" : "PARTIAL",
      };
    }
    const signals = [
      `${snapshot.pages.length} page(s) captured`,
      `${snapshot.pages.filter(p=>p.formCount>0).length} page(s) with a form`,
      `${snapshot.pages.filter(p=>p.viewportMeta).length} page(s) with viewport metadata`,
      `${snapshot.pages.filter(p=>p.productSchema).length} page(s) with Product schema`,
    ];
    return {
      label: c.label, status: "INCONCLUSIVE", check: "Structural signals; human test required",
      explanation: "The snapshot contains structural signals, but they cannot prove this criterion. The client must run the agreed test.",
      evidenceRefs: snapshot.pages.map(p => ({ url:p.url,bodyHash:p.bodyHash })),
      signals, requiresHumanReview: true, coverage: snapshot.coverageLimited ? "PARTIAL" : "FULL",
    };
  });
}

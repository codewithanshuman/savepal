import { MAX_HTML_BYTES, readBoundedHtml, type Criterion, type Finding } from "./assurance.ts";

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
  evidenceRefs: Array<{ url: string; bodyHash: string | null }>;
  signals: string[];
  requiresHumanReview: boolean;
  coverage: "FULL" | "PARTIAL";
};
export type LivePage = { url: string; status: number; body: string };

export async function sha256(value: string): Promise<string> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(raw), b => b.toString(16).padStart(2, "0")).join("");
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27);/gi, entity => {
    const key = entity.toLowerCase();
    return key === "&amp;" ? "&" : key === "&lt;" ? "<" : key === "&gt;" ? ">" :
      key === "&quot;" ? '"' : key === "&nbsp;" ? " " : "'";
  });
}

export function extractedText(html: string): string {
  return decodeEntities(html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|template|svg|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function anchorLinks(html: string, base: string, origin: string): string[] {
  const found = new Set<string>();
  const pattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    try {
      const url = new URL(decodeEntities(match[2]), base);
      if (url.origin !== origin || url.search || /\/(?:logout|signout|delete|admin|account)(?:\/|$)/i.test(url.pathname)) continue;
      if (/\.(?:pdf|zip|jpg|jpeg|png|gif|svg|webp|mp4|js|css)$/i.test(url.pathname)) continue;
      url.hash = "";
      found.add(url.toString());
      if (found.size >= 100) break;
    } catch { /* Ignore malformed links from untrusted HTML. */ }
  }
  return [...found];
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
      ...signals, links: body ? anchorLinks(body,url,origin) : [],
    };
  } catch {
    return {
      url, status: 0, contentType: "", body: "", bodyHash: null,
      truncated: false, error: "Fetch failed or timed out", title: null,
      viewportMeta: false, formCount: 0, buttonCount: 0, productSchema: false, links: [],
    };
  }
}

function linkPriority(url: string) {
  return /\/(product|shop|catalog|checkout|cart|store)/i.test(url) ? 0 : 1;
}

export async function captureWebsite(rootUrl: string, fetcher: typeof fetch = fetch): Promise<WebsiteSnapshot> {
  const root = new URL(rootUrl);
  const first = await capturePage(rootUrl,root.origin,fetcher);
  const links = first.links.filter(url => url !== rootUrl).sort((a,b) => linkPriority(a)-linkPriority(b) || a.localeCompare(b));
  const selected = links.slice(0, MAX_PAGES - 1);
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
  const stable = (page: SnapshotPage) => {
    const live = liveByUrl.get(page.url);
    return !!live?.body && live.status >= 200 && live.status < 300 &&
      extractedText(live.body) === extractedText(page.body);
  };
  const rootStable = !!root && stable(root);
  return criteria.map(c => {
    if (c.kind === "reachable") {
      const passed = root.status >= 200 && root.status < 300;
      const failed = root.status >= 400 && root.status < 500;
      const status = rootStable ? passed ? "VERIFIED" : failed ? "FAILED" : "INCONCLUSIVE" : "INCONCLUSIVE";
      return {
        label: c.label, status, check: "Snapshot and live HTTP availability",
        explanation: !rootStable ? "The live root page differs from the submitted snapshot or could not be confirmed." :
          `The submitted root returned HTTP ${root.status}; its extracted text still matches the live page.`,
        evidenceRefs: [{ url: root.url, bodyHash: root.bodyHash }],
        signals: [`Captured HTTP ${root.status}`,`Live text ${rootStable ? "matched" : "mismatch or unavailable"}`],
        requiresHumanReview: status !== "VERIFIED", coverage: "FULL",
      };
    }
    if (c.kind === "contains") {
      const needle = (c.needle || "").toLocaleLowerCase();
      const matches = snapshot.pages.filter(p => p.body && extractedText(p.body).toLocaleLowerCase().includes(needle));
      const complete = !snapshot.coverageLimited && snapshot.pages.every(p => p.status >= 200 && p.status < 300 && !p.truncated);
      const confirmed = matches.filter(stable);
      const allStable = snapshot.pages.every(stable);
      const status = confirmed.length ? "VERIFIED" : complete && allStable ? "FAILED" : "INCONCLUSIVE";
      return {
        label: c.label, status, check: "Extracted HTML text across captured internal pages",
        explanation: confirmed.length ? `The expected text appears in ${confirmed.length} captured page${confirmed.length === 1 ? "" : "s"} and still matches live text.` :
          matches.length ? "The matching page changed or could not be confirmed live." :
          !allStable ? "Captured pages changed or could not be confirmed live." :
          complete ? "The expected text was absent from all discovered internal pages." :
          "The expected text was not found, but crawl coverage is incomplete.",
        evidenceRefs: matches.length ? matches.map(p => ({ url:p.url,bodyHash:p.bodyHash })) :
          snapshot.pages.map(p => ({ url:p.url,bodyHash:p.bodyHash })),
        signals: [`${snapshot.pages.length} page(s) captured`,`${confirmed.length} live-confirmed match(es)`,`Coverage ${complete && allStable ? "complete" : "partial"}`],
        requiresHumanReview: status !== "VERIFIED", coverage: complete && allStable ? "FULL" : "PARTIAL",
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

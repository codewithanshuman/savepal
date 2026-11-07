import { MAX_HTML_BYTES, readBoundedHtml, type Criterion, type Finding } from "./assurance.ts";
import { actionLabels, documentTitle, internalLinks, normalizedWords, phraseEvidence, visibleText, type InternalLink } from "./html-evidence.ts";
import { validateRenderedPage, type RenderedPage } from "./browser-evidence.ts";

export const SNAPSHOT_VERSION = "website-snapshot-v2";
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
  renderedRoot?: RenderedPage;
};
export type SnapshotManifest = {
  version: string;
  rootUrl: string;
  capturedAt: string;
  pages: Array<Omit<SnapshotPage, "body" | "links"> & { bytes: number; linksDiscovered: number }>;
  discoveredInternalLinks: number;
  coverageLimited: boolean;
  renderedRoot?: Omit<RenderedPage,"html"> & { bytes: number };
};
export type AdvancedFinding = Finding & {
  evidenceRefs: Array<{ url: string; bodyHash: string | null; excerpt?: string }>;
  signals: string[];
  requiresHumanReview: boolean;
  coverage: "FULL" | "PARTIAL";
};
export type LivePage = { url: string; status: number; body: string; renderedRoot?: RenderedPage };

/** Absolute URL a `path` criterion refers to, on the submitted site's origin. */
export function criterionPathUrl(rootUrl: string, path: string): string {
  return new URL(path, new URL(rootUrl).origin).toString();
}

export type Confidence = "HIGH" | "MEDIUM" | "LOW";
/**
 * Display-only strength of a finding. Derived rather than stored so stored findings, and the offline
 * proof replay that hashes them, stay byte-identical across checker releases.
 */
export function findingConfidence(finding: Pick<AdvancedFinding,"status"|"coverage"|"requiresHumanReview">): Confidence {
  if (finding.status === "INCONCLUSIVE") return "LOW";
  return finding.coverage === "FULL" ? "HIGH" : "MEDIUM";
}

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
  // Pages named by a path criterion are always captured first, even when nothing links to them.
  const required = [...new Set(criteria.filter(c => c.kind === "path" && c.needle).map(c => criterionPathUrl(rootUrl,c.needle!)))]
    .filter(url => url !== rootUrl).slice(0, MAX_PAGES - 1);
  const selected = [...required,...links.map(link => link.url).filter(url => !required.includes(url))].slice(0, MAX_PAGES - 1);
  const others = await Promise.all(selected.map(url => capturePage(url,root.origin,fetcher)));
  const pages = [first,...others];
  return {
    version: SNAPSHOT_VERSION, rootUrl, capturedAt: new Date().toISOString(), pages,
    discoveredInternalLinks: links.length,
    coverageLimited: links.some(link => !selected.includes(link.url)) || pages.some(p => p.truncated || p.status < 200 || p.status >= 300),
  };
}

export function snapshotManifest(snapshot: WebsiteSnapshot): SnapshotManifest {
  return {
    version: snapshot.version, rootUrl: snapshot.rootUrl, capturedAt: snapshot.capturedAt,
    discoveredInternalLinks: snapshot.discoveredInternalLinks, coverageLimited: snapshot.coverageLimited,
    pages: snapshot.pages.map(({ body, links, ...page }) => ({ ...page, bytes: new TextEncoder().encode(body).length, linksDiscovered: links.length })),
    ...(snapshot.renderedRoot ? { renderedRoot: (({ html, ...rest }) => ({...rest,bytes:new TextEncoder().encode(html).length}))(snapshot.renderedRoot) } : {}),
  };
}

export async function validateSnapshot(raw: string, expectedHash: string, expectedManifestJson: string, rootUrl: string): Promise<WebsiteSnapshot | null> {
  if (raw.length > (MAX_PAGES + 1) * 120_000 || await sha256(raw) !== expectedHash) return null;
  try {
    const snapshot = JSON.parse(raw) as WebsiteSnapshot;
    if (![SNAPSHOT_VERSION,"website-snapshot-v1"].includes(snapshot.version) || snapshot.rootUrl !== rootUrl || !Array.isArray(snapshot.pages) || snapshot.pages.length < 1 || snapshot.pages.length > MAX_PAGES) return null;
    if (!await validateRenderedPage(snapshot.renderedRoot,rootUrl)) return null;
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
  const submittedText = new Map(snapshot.pages.map(page => [page.url,extractedText(page.body) + (page.url === root.url && snapshot.renderedRoot ? ` ${extractedText(snapshot.renderedRoot.html)}` : "")]));
  const currentText = new Map(livePages.map(page => [page.url,extractedText(page.body) + (page.url === root.url && page.renderedRoot ? ` ${extractedText(page.renderedRoot.html)}` : "")]));
  const liveSuccess = (page: SnapshotPage) => {
    const live = liveByUrl.get(page.url);
    return !!live && live.status >= 200 && live.status < 300 && !!live.body &&
      (page.url !== root.url || !snapshot.renderedRoot || !!live.renderedRoot);
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
      const matches = snapshot.pages.map(page => ({
        page, excerpt: phraseEvidence(submittedText.get(page.url) || "",needle),
        evidenceHash: page.url === root.url && snapshot.renderedRoot && !phraseEvidence(extractedText(page.body),needle)
          ? snapshot.renderedRoot.htmlHash : page.bodyHash,
      })).filter(match => !!match.excerpt);
      const confirmed = matches.filter(({page}) => liveSuccess(page) && !!phraseEvidence(currentText.get(page.url) || "",needle));
      const complete = !snapshot.coverageLimited && !snapshot.renderedRoot?.truncated &&
        !liveByUrl.get(root.url)?.renderedRoot?.truncated &&
        snapshot.pages.every(page => page.status >= 200 && page.status < 300 && !page.truncated && liveSuccess(page));
      const status = confirmed.length ? "VERIFIED" : !matches.length && complete ? "FAILED" : "INCONCLUSIVE";
      return {
        label: c.label, status, check: snapshot.renderedRoot ? "Whole-phrase visible text in submitted and live HTML plus rendered root DOM" : "Whole-phrase visible text in submitted and live pages",
        explanation: confirmed.length ? `The whole phrase appears in ${confirmed.length} submitted page${confirmed.length === 1 ? "" : "s"} and remains present on the same live page.` :
          matches.length ? "The submitted page contained the phrase, but it is missing or could not be confirmed on that live page." :
          complete ? "The phrase was absent from all captured, live-confirmed internal pages." :
          "The phrase was not found, but page availability or crawl coverage is incomplete.",
        evidenceRefs: matches.length ? matches.map(({page,excerpt,evidenceHash}) => ({ url:page.url,bodyHash:evidenceHash,excerpt:excerpt! })) :
          snapshot.pages.map(p => ({ url:p.url,bodyHash:p.bodyHash })),
        signals: [`${snapshot.pages.length} page(s) captured`,`${confirmed.length} live-confirmed whole-phrase match(es)`,`Discovered-page coverage ${complete ? "complete" : "partial"}`,snapshot.renderedRoot ? "Browser-rendered root DOM captured at submission and verification" : "Browser-rendered DOM unavailable"],
        requiresHumanReview: status !== "VERIFIED", coverage: complete ? "FULL" : "PARTIAL",
      };
    }
    if (c.kind === "title") {
      const needle = c.needle || "";
      const live = liveByUrl.get(root.url);
      const submittedTitle = documentTitle(root.body);
      const liveTitle = live && liveSuccess(root) ? documentTitle(live.body) : null;
      const before = submittedTitle ? phraseEvidence(submittedTitle,needle) : null;
      const now = liveTitle ? phraseEvidence(liveTitle,needle) : null;
      const bothReadable = root.status >= 200 && root.status < 300 && !root.truncated && liveSuccess(root);
      const status = before && now ? "VERIFIED" : bothReadable && !before && !now ? "FAILED" : "INCONCLUSIVE";
      return {
        label: c.label, status, check: "Whole-phrase match in the root page title, submitted and live",
        explanation: status === "VERIFIED" ? `The page title “${liveTitle}” contains the phrase at submission and on verification.` :
          status === "FAILED" ? (submittedTitle || liveTitle ? `The page title “${liveTitle ?? submittedTitle}” does not contain the phrase.` : "The root page has no title.") :
          before && !now ? "The submitted title contained the phrase, but the live title no longer does or could not be read." :
          !before && now ? "The live title contains the phrase, but the submitted snapshot did not; resubmit to bind it." :
          "The root page title could not be read at submission or on verification.",
        evidenceRefs: [{ url: root.url, bodyHash: root.bodyHash, ...(submittedTitle ? { excerpt: submittedTitle } : {}) }],
        signals: [`Submitted title: ${submittedTitle ?? "none"}`,`Live title: ${liveTitle ?? "unavailable"}`],
        requiresHumanReview: status !== "VERIFIED", coverage: "FULL",
      };
    }
    if (c.kind === "absent") {
      const needle = c.needle || "";
      const hits = snapshot.pages.flatMap(page => {
        const submitted = phraseEvidence(submittedText.get(page.url) || "",needle);
        const live = liveSuccess(page) ? phraseEvidence(currentText.get(page.url) || "",needle) : null;
        return submitted || live ? [{ page, excerpt: (submitted || live)!, where: submitted && live ? "submitted and live" : submitted ? "submitted" : "live" }] : [];
      });
      const complete = !snapshot.coverageLimited && !snapshot.renderedRoot?.truncated &&
        !liveByUrl.get(root.url)?.renderedRoot?.truncated &&
        snapshot.pages.every(page => page.status >= 200 && page.status < 300 && !page.truncated && liveSuccess(page));
      const status = hits.length ? "FAILED" : complete ? "VERIFIED" : "INCONCLUSIVE";
      return {
        label: c.label, status, check: "Whole-phrase absence across submitted and live pages",
        explanation: hits.length ? `The forbidden phrase appears on ${hits.length} page${hits.length === 1 ? "" : "s"} (${[...new Set(hits.map(h => h.where))].join(", ")}).` :
          complete ? "The phrase is absent from every captured page, at submission and on verification." :
          "The phrase was not found, but some pages were not captured or could not be re-read, so absence is not proven.",
        evidenceRefs: hits.length ? hits.map(({page,excerpt}) => ({ url: page.url, bodyHash: page.bodyHash, excerpt })) :
          snapshot.pages.map(p => ({ url: p.url, bodyHash: p.bodyHash })),
        signals: [`${snapshot.pages.length} page(s) searched`,`${hits.length} page(s) containing the phrase`,`Coverage ${complete ? "complete" : "partial"}`],
        requiresHumanReview: status !== "VERIFIED", coverage: complete ? "FULL" : "PARTIAL",
      };
    }
    if (c.kind === "link") {
      const needle = c.needle || "";
      const labelsFor = (html: string, rendered?: string) => [...actionLabels(html),...(rendered ? actionLabels(rendered) : [])];
      const match = (labels: string[]) => labels.find(label => phraseEvidence(label,needle)) ?? null;
      const found = snapshot.pages.flatMap(page => {
        const label = match(labelsFor(page.body,page.url === root.url ? snapshot.renderedRoot?.html : undefined));
        return label ? [{ page, label }] : [];
      });
      const confirmed = found.filter(({page}) => {
        const live = liveByUrl.get(page.url);
        return liveSuccess(page) && !!live && !!match(labelsFor(live.body,page.url === root.url ? live.renderedRoot?.html : undefined));
      });
      const complete = !snapshot.coverageLimited && snapshot.pages.every(page => page.status >= 200 && page.status < 300 && !page.truncated && liveSuccess(page));
      const status = confirmed.length ? "VERIFIED" : !found.length && complete ? "FAILED" : "INCONCLUSIVE";
      return {
        label: c.label, status, check: "Visible link or button label, submitted and live",
        explanation: confirmed.length ? `A visible control labelled “${confirmed[0].label}” exists on ${confirmed.length} page${confirmed.length === 1 ? "" : "s"} and is still present live.` :
          found.length ? "A matching control existed at submission but is missing or unreadable on the live page." :
          complete ? "No visible link or button with that label exists on any captured page." :
          "No matching control was found, but crawl coverage is incomplete.",
        evidenceRefs: found.length ? found.map(({page,label}) => ({ url: page.url, bodyHash: page.bodyHash, excerpt: label })) :
          snapshot.pages.map(p => ({ url: p.url, bodyHash: p.bodyHash })),
        signals: [`${found.length} page(s) with a matching control at submission`,`${confirmed.length} confirmed live`],
        requiresHumanReview: status !== "VERIFIED", coverage: complete ? "FULL" : "PARTIAL",
      };
    }
    if (c.kind === "path") {
      const url = criterionPathUrl(snapshot.rootUrl,c.needle || "/");
      const page = snapshot.pages.find(p => p.url === url);
      const live = liveByUrl.get(url);
      const ok = (s?: number) => s !== undefined && s >= 200 && s < 300;
      const missing = (s?: number) => s === 404 || s === 410;
      const status = !page ? "INCONCLUSIVE" : ok(page.status) && ok(live?.status) ? "VERIFIED" :
        missing(page.status) && missing(live?.status) ? "FAILED" : "INCONCLUSIVE";
      return {
        label: c.label, status, check: "Named page loads, submitted and live",
        explanation: !page ? `${c.needle} was not part of this snapshot; resubmit so it can be captured.` :
          status === "VERIFIED" ? `${c.needle} returned HTTP ${page.status} at submission and HTTP ${live!.status} on verification.` :
          status === "FAILED" ? `${c.needle} does not exist (HTTP ${page.status} at submission, HTTP ${live?.status} live).` :
          page.status >= 300 && page.status < 400 ? `${c.needle} redirects (HTTP ${page.status}); point the criterion at the final address.` :
          `${c.needle} returned HTTP ${page.status} at submission and HTTP ${live?.status ?? 0} live, so the result is not settled.`,
        evidenceRefs: page ? [{ url, bodyHash: page.bodyHash }] : [],
        signals: [`Captured HTTP ${page?.status ?? "not captured"}`,`Live HTTP ${live?.status ?? 0}`],
        requiresHumanReview: status !== "VERIFIED", coverage: "FULL",
      };
    }
    if (c.kind === "no_broken_pages") {
      const results = snapshot.pages.map(page => ({ page, live: liveByUrl.get(page.url)?.status ?? 0 }));
      const broken = results.filter(({page,live}) => page.status >= 400 && live >= 400);
      const healthy = results.every(({page,live}) => page.status >= 200 && page.status < 300 && live >= 200 && live < 300);
      const partial = snapshot.discoveredInternalLinks > snapshot.pages.length - 1;
      const status = broken.length ? "FAILED" : healthy && !partial ? "VERIFIED" : "INCONCLUSIVE";
      return {
        label: c.label, status, check: "Every captured page loads, submitted and live",
        explanation: broken.length ? `${broken.length} page${broken.length === 1 ? " is" : "s are"} broken: ${broken.map(({page,live}) => `${new URL(page.url).pathname} (HTTP ${page.status}/${live})`).join(", ")}.` :
          healthy && !partial ? `All ${results.length} discovered page${results.length === 1 ? "" : "s"} loaded at submission and on verification.` :
          healthy ? `All ${results.length} captured pages loaded, but ${snapshot.discoveredInternalLinks - (snapshot.pages.length - 1)} discovered link(s) were outside the capture limit.` :
          "Some pages returned redirects, errors or timeouts that did not repeat consistently.",
        evidenceRefs: (broken.length ? broken : results).map(({page}) => ({ url: page.url, bodyHash: page.bodyHash })),
        signals: results.map(({page,live}) => `${new URL(page.url).pathname}: ${page.status}/${live}`),
        requiresHumanReview: status !== "VERIFIED", coverage: partial ? "PARTIAL" : "FULL",
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

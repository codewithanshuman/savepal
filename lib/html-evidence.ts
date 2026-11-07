import { parse, type DefaultTreeAdapterTypes } from "parse5";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

const ignoredTags = new Set(["head", "script", "style", "template", "svg", "noscript", "iframe", "canvas"]);
const blockTags = new Set(["address", "article", "blockquote", "br", "button", "dd", "div", "dl", "dt", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "section", "table", "td", "th", "tr", "ul"]);

function element(node: Node): node is Element {
  return "tagName" in node;
}

function attribute(node: Element, name: string): string | null {
  return node.attrs.find(a => a.name === name)?.value ?? null;
}

function hidden(node: Element): boolean {
  const style = attribute(node,"style") || "";
  return ignoredTags.has(node.tagName) || attribute(node,"hidden") !== null ||
    attribute(node,"inert") !== null || attribute(node,"aria-hidden")?.toLowerCase() === "true" ||
    /(?:^|;)\s*display\s*:\s*none(?:\s*!important)?\s*(?:;|$)/i.test(style) ||
    /(?:^|;)\s*visibility\s*:\s*hidden(?:\s*!important)?\s*(?:;|$)/i.test(style);
}

function collectText(node: Node, parts: string[]): void {
  if ("value" in node && node.nodeName === "#text") { parts.push(node.value); return; }
  if (element(node) && hidden(node)) return;
  if (element(node) && blockTags.has(node.tagName)) parts.push(" ");
  if ("childNodes" in node) for (const child of node.childNodes) collectText(child,parts);
  if (element(node) && blockTags.has(node.tagName)) parts.push(" ");
}

export function visibleText(html: string): string {
  const parts: string[] = [];
  collectText(parse(html),parts);
  return parts.join("").replace(/\s+/g," ").trim();
}

export type InternalLink = { url: string; text: string };

export function internalLinks(html: string, base: string, origin: string): InternalLink[] {
  const links = new Map<string,string>();
  function visit(node: Node): void {
    if (element(node)) {
      if (hidden(node)) return;
      if (node.tagName === "a") {
        const href = attribute(node,"href");
        if (href) {
          try {
            const url = new URL(href,base);
            if (url.origin === origin && !url.username && !url.password && !url.search &&
              !/\/(?:logout|signout|delete|admin|account)(?:\/|$)/i.test(url.pathname) &&
              !/\.(?:pdf|zip|jpg|jpeg|png|gif|svg|webp|mp4|js|css)$/i.test(url.pathname)) {
              url.hash = "";
              if (!links.has(url.toString())) {
                const parts: string[] = [];
                for (const child of node.childNodes) collectText(child,parts);
                links.set(url.toString(),parts.join("").replace(/\s+/g," ").trim().slice(0,120));
              }
            }
          } catch { /* Ignore malformed links in untrusted HTML. */ }
        }
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  }
  visit(parse(html));
  return [...links].slice(0,100).map(([url,text]) => ({url,text}));
}

/**
 * Visible labels of things a visitor can act on: links, buttons, submit inputs and ARIA buttons/links.
 * Hidden elements are skipped, matching visibleText(). An empty-text control falls back to aria-label/title.
 */
export function actionLabels(html: string): string[] {
  const labels: string[] = [];
  function visit(node: Node): void {
    if (element(node)) {
      if (hidden(node)) return;
      const role = attribute(node,"role")?.toLowerCase();
      const type = attribute(node,"type")?.toLowerCase();
      const actionable = node.tagName === "a" && attribute(node,"href") !== null || node.tagName === "button" ||
        role === "button" || role === "link" || node.tagName === "input" && (type === "submit" || type === "button");
      if (actionable) {
        const parts: string[] = [];
        if (node.tagName === "input") parts.push(attribute(node,"value") || "");
        else for (const child of node.childNodes) collectText(child,parts);
        const text = parts.join("").replace(/\s+/g," ").trim() || attribute(node,"aria-label") || attribute(node,"title") || "";
        if (text) labels.push(text.slice(0,160));
        if (node.tagName !== "input") return;
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  }
  visit(parse(html));
  return labels.slice(0,300);
}

/** The document title as visible text, or null when the page has none. */
export function documentTitle(html: string): string | null {
  const raw = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1];
  if (!raw) return null;
  const text = visibleText(`<p>${raw}</p>`);
  return text ? text.slice(0,160) : null;
}

export function normalizedWords(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").replace(/\s+/g," ").trim();
}

export function phraseEvidence(text: string, phrase: string): string | null {
  const haystack = normalizedWords(text);
  const needle = normalizedWords(phrase);
  if (!needle) return null;
  const index = (` ${haystack} `).indexOf(` ${needle} `);
  if (index < 0) return null;
  const start = Math.max(0,index - 90);
  const end = Math.min(haystack.length,index + needle.length + 90);
  return `${start ? "…" : ""}${haystack.slice(start,end).trim()}${end < haystack.length ? "…" : ""}`;
}

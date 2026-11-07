export const CHECKER_VERSION = "website-v5";
export const MAX_HTML_BYTES = 100_000;

export const CRITERION_KINDS = ["reachable", "contains", "absent", "title", "link", "path", "no_broken_pages", "manual"] as const;
export type CriterionKind = typeof CRITERION_KINDS[number];
/** Kinds whose check is parameterised by `needle` (a phrase, or a path for `path`). */
export const NEEDLE_KINDS: ReadonlySet<CriterionKind> = new Set(["contains", "absent", "title", "link", "path"]);
export const MAX_PATH_CRITERIA = 4;
/** `required` is absent on agreements created before acceptance policies; those are treated as required. */
export type Criterion = { label: string; kind: CriterionKind; needle?: string; required?: boolean };

export const isRequired = (c: Criterion) => c.required !== false;

/** A same-origin absolute path such as `/pricing`; no scheme, host, query, fragment or traversal. */
export function safeCriterionPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.trim();
  if (!/^\/[A-Za-z0-9\-._~/%]{0,199}$/.test(path) || path.startsWith("//") || /(^|\/)\.\.?(\/|$)/.test(path)) return null;
  return path;
}

/** Validates untrusted criteria input and returns a normalised copy, or an error message. */
export function validateCriteria(raw: unknown): { criteria: Criterion[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8) return { error: "Add 1–8 acceptance criteria" };
  const criteria: Criterion[] = [];
  for (const [index, item] of raw.entries()) {
    const n = index + 1;
    if (!item || typeof item !== "object") return { error: `Criterion ${n} is invalid` };
    const c = item as Record<string, unknown>;
    const label = typeof c.label === "string" ? c.label.trim() : "";
    if (label.length < 3 || label.length > 240) return { error: `Criterion ${n} needs a description of 3–240 characters` };
    if (!CRITERION_KINDS.includes(c.kind as CriterionKind)) return { error: `Criterion ${n} has an unknown check type` };
    const kind = c.kind as CriterionKind;
    const criterion: Criterion = { label, kind, required: c.required !== false };
    if (NEEDLE_KINDS.has(kind)) {
      if (kind === "path") {
        const path = safeCriterionPath(c.needle);
        if (!path) return { error: `Criterion ${n} needs a site path such as /pricing` };
        criterion.needle = path;
      } else {
        const needle = typeof c.needle === "string" ? c.needle.trim() : "";
        if (!needle || needle.length > 100 || !/[\p{L}\p{N}]/u.test(needle)) return { error: `Criterion ${n} needs 1–100 characters of text with at least one letter or digit` };
        criterion.needle = needle;
      }
    }
    criteria.push(criterion);
  }
  if (criteria.filter(c => c.kind === "path").length > MAX_PATH_CRITERIA) return { error: `Use at most ${MAX_PATH_CRITERIA} page-path checks` };
  const keys = criteria.map(c => `${c.kind}:${(c.needle || c.label).toLowerCase()}`);
  if (new Set(keys).size !== keys.length) return { error: "Two criteria check the same thing; merge or change one" };
  if (!criteria.some(isRequired)) return { error: "Mark at least one criterion as required" };
  return { criteria };
}
export type Finding = { label: string; status: "VERIFIED" | "FAILED" | "INCONCLUSIVE"; explanation: string; check: string };
export type WebsiteResult = { status: number; body: string; contentType: string; truncated: boolean; error?: string };
export type PaymentStatus = "NOT_STARTED" | "PENDING" | "COMPLETED" | "FAILED" | "PARTIALLY_REFUNDED" | "REFUNDED";

export function parseUsdCents(raw: unknown): number | null {
  const value = typeof raw === "number" ? String(raw) : raw;
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(value)) return null;
  const [dollars, fraction = ""] = value.split(".");
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
  return cents >= 100 && cents <= 100_000_000 ? cents : null;
}

export function safeWebsiteUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" || url.username || url.password ||
      !host.includes(".") || host === "localhost" ||
      host.endsWith(".local") || host.endsWith(".internal") ||
      host.endsWith(".localhost") || host.endsWith(".test") ||
      host.endsWith(".invalid") || host.endsWith(".example") ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")
    ) return null;
    return url.toString();
  } catch { return null; }
}

export function evaluateCriteria(criteria: Criterion[], website: WebsiteResult): Finding[] {
  return criteria.map(c => {
    if (c.kind === "reachable") {
      const status = website.status >= 200 && website.status < 300 ? "VERIFIED" :
        website.status >= 400 && website.status < 500 ? "FAILED" : "INCONCLUSIVE";
      return {
        label: c.label, status,
        explanation: website.status ? `Website returned HTTP ${website.status}.` :
          website.error || "The website could not be reached.",
        check: "HTTP availability",
      };
    }
    if (c.kind === "contains") {
      const needle = (c.needle || "").toLowerCase();
      const found = !!website.body && website.body.toLowerCase().includes(needle);
      const status = found ? "VERIFIED" : !website.body || website.truncated ? "INCONCLUSIVE" : "FAILED";
      return {
        label: c.label, status,
        explanation: found ? `Expected text “${c.needle}” was found in the retrieved HTML.` :
          website.truncated ? "Only the first 100 KB of HTML was inspected; the text may appear later." :
          website.body ? `Expected text “${c.needle}” was not found in the retrieved HTML.` :
          "HTML was unavailable for this check.",
        check: "HTML source text match",
      };
    }
    return { label: c.label, status: "INCONCLUSIVE", explanation: "This criterion needs client review; no automated test was configured.", check: "Manual review" };
  });
}

export function captureMatches(
  capture: { id?: string; amount?: { value?: string; currency_code?: string } },
  expectedCents: number,
  currency: string,
  expectedId?: string,
): boolean {
  if (!capture.id || (expectedId && capture.id !== expectedId)) return false;
  const amount = capture.amount?.value;
  if (typeof amount !== "string" || !/^\d+\.\d{2}$/.test(amount)) return false;
  return Number(amount.replace(".", "")) === expectedCents && capture.amount?.currency_code === currency;
}

export function providerPaymentStatus(status: string | undefined): PaymentStatus {
  if (status === "REFUNDED") return "REFUNDED";
  if (status === "PARTIALLY_REFUNDED") return "PARTIALLY_REFUNDED";
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "DENIED" || status === "DECLINED" || status === "FAILED") return "FAILED";
  return "PENDING";
}

export function canApplyPaymentStatus(current: string, incoming: PaymentStatus): boolean {
  if (current === "REFUNDED") return incoming === "REFUNDED";
  if (current === "PARTIALLY_REFUNDED") return incoming === "PARTIALLY_REFUNDED" || incoming === "REFUNDED";
  if (current === "COMPLETED") return incoming === "COMPLETED" || incoming === "PARTIALLY_REFUNDED" || incoming === "REFUNDED";
  if (current === "FAILED") return incoming === "FAILED" || incoming === "COMPLETED" || incoming === "PARTIALLY_REFUNDED" || incoming === "REFUNDED";
  if (current === "NOT_STARTED") return incoming === "NOT_STARTED" || incoming === "PENDING";
  return incoming !== "NOT_STARTED";
}

export async function readBoundedHtml(response: Response): Promise<{ body: string; truncated: boolean }> {
  if (!response.body) return { body: "", truncated: false };
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0, truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_HTML_BYTES - total;
      if (value.length > remaining) {
        if (remaining > 0) parts.push(value.subarray(0, remaining));
        total = MAX_HTML_BYTES;
        truncated = true;
        await reader.cancel();
        break;
      }
      parts.push(value);
      total += value.length;
      if (total === MAX_HTML_BYTES) {
        // Read once more to distinguish an exact-sized response from a truncated one.
        const next = await reader.read();
        truncated = !next.done;
        if (truncated) await reader.cancel();
        break;
      }
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return { body: new TextDecoder().decode(bytes), truncated };
}

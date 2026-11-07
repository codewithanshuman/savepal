import { readBoundedHtml, type Criterion } from "./assurance.ts";
import { actionLabels, documentTitle, internalLinks, phraseEvidence, visibleText } from "./html-evidence.ts";

/**
 * The inspector crew: an LLM agent (Groq, OpenAI-compatible API) that reads the delivered website
 * page by page and reports a verdict per acceptance criterion. It is advisory and read-only:
 * - it can only GET pages on the submitted site's own origin; it never submits forms or pays;
 * - every quote it cites must appear on a page it actually read, or the finding is downgraded;
 * - VERIFIED requires a confirmed quote;
 * - steps and pages are bounded, and each request advances one step so the UI can stream it.
 */

export const CREW_MAX_STEPS = 12;
export const CREW_MAX_PAGES = 8;
export const PAGE_TEXT_LIMIT = 2800;
export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

export type Verdict = "VERIFIED" | "FAILED" | "INCONCLUSIVE";
export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};
export type PageRecord = { path: string; status: number; title: string | null; text: string; links: string[]; controls: string[]; forms: string[] };
export type CrewFinding = { index: number; verdict: Verdict; explanation: string; quote: string | null; path: string | null; quoteConfirmed: boolean };
export type CrewEvent = { kind: "THINK" | "VISIT" | "FINDING" | "NOTE" | "DONE" | "ERROR"; pageUrl?: string; criterionIndex?: number; verdict?: Verdict; text: string };
export type CrewState = {
  rootUrl: string; criteria: Criterion[]; messages: ChatMessage[];
  pages: Record<string, PageRecord>; findings: Record<string, CrewFinding>;
  steps: number; done: boolean; summary: string | null;
};

const tools = [
  { type: "function", function: { name: "read_page", description: "Open one page of the delivered website and read its visible text, title, links, buttons and forms. Paths are on the same site only, e.g. \"/\" or \"/pricing\".",
    parameters: { type: "object", properties: { path: { type: "string", description: "Site path starting with /" } }, required: ["path"] } } },
  { type: "function", function: { name: "record_finding", description: "Record your verdict for one acceptance criterion. VERIFIED needs an exact quote copied from a page you read.",
    parameters: { type: "object", properties: {
      criterion: { type: "integer", description: "Criterion number, starting at 1" },
      verdict: { type: "string", enum: ["VERIFIED", "FAILED", "INCONCLUSIVE"] },
      explanation: { type: "string", description: "One or two plain sentences a non-technical client can read" },
      quote: { type: "string", description: "Exact visible text from the page that supports the verdict" },
      path: { type: "string", description: "Path of the page the quote is from" },
    }, required: ["criterion", "verdict", "explanation"] } } },
  { type: "function", function: { name: "finish", description: "End the inspection once every criterion has a finding.",
    parameters: { type: "object", properties: { summary: { type: "string", description: "Two sentences for the client" } }, required: ["summary"] } } },
] as const;

const kindHelp: Record<string, string> = {
  reachable: "the site loads over HTTPS", contains: "this text is visible on the site", absent: "this text must NOT appear anywhere",
  title: "the home page title contains this", link: "a visible link or button with this label exists", path: "this page exists and loads",
  no_broken_pages: "no page is broken", manual: "judge from what the pages show; you cannot click, submit or buy",
};

export function initialCrewState(rootUrl: string, criteria: Criterion[], notes: string): CrewState {
  const list = criteria.map((c, i) => `${i + 1}. ${c.label} [${c.kind}${c.needle ? `: “${c.needle}”` : ""} — ${kindHelp[c.kind] ?? "check it"}]${c.required === false ? " (optional)" : ""}`).join("\n");
  return {
    rootUrl, criteria, pages: {}, findings: {}, steps: 0, done: false, summary: null,
    messages: [
      { role: "system", content: `You are a careful website inspector working for a client who must decide whether delivered work meets agreed criteria. You can only read pages; you cannot click, log in, submit forms or buy anything. Read at most ${CREW_MAX_PAGES} pages. Only report what you actually read. Copy quotes exactly from page text. If you are not sure, use INCONCLUSIVE and say why. Record exactly one finding per criterion, then call finish. Keep explanations short and plain.` },
      { role: "user", content: `Delivered website: ${rootUrl}\nFreelancer's notes: ${notes.slice(0, 800) || "(none)"}\n\nAcceptance criteria:\n${list}\n\nStart by reading "/".` },
    ],
  };
}

function normalizePath(raw: unknown, rootUrl: string): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim() || "/";
  try {
    const root = new URL(rootUrl);
    const url = new URL(value.startsWith("/") ? value : `/${value}`, root.origin);
    if (url.origin !== root.origin || url.username || url.password) return null;
    url.hash = "";
    return `${url.pathname}${url.search}`.slice(0, 300);
  } catch { return null; }
}

async function readPage(path: string, rootUrl: string, fetcher: typeof fetch): Promise<PageRecord> {
  const url = new URL(path, new URL(rootUrl).origin).toString();
  try {
    const response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { Accept: "text/html", "User-Agent": "SavePal-Inspector/1.0" } });
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (!response.ok || !type.includes("text/html")) return { path, status: response.status, title: null, text: "", links: [], controls: [], forms: [] };
    const { body } = await readBoundedHtml(response);
    const origin = new URL(rootUrl).origin;
    const forms = [...body.matchAll(/<form\b([^>]*)>/gi)].slice(0, 5).map(m => {
      const action = /\baction\s*=\s*["']?([^"'\s>]+)/i.exec(m[1])?.[1] ?? "(this page)";
      const method = (/\bmethod\s*=\s*["']?(\w+)/i.exec(m[1])?.[1] ?? "get").toUpperCase();
      return `${method} ${action}`;
    });
    return {
      path, status: response.status, title: documentTitle(body), text: visibleText(body).slice(0, PAGE_TEXT_LIMIT),
      links: internalLinks(body, url, origin).slice(0, 25).map(l => `${new URL(l.url).pathname} (${l.text || "link"})`),
      controls: actionLabels(body).slice(0, 25), forms,
    };
  } catch { return { path, status: 0, title: null, text: "", links: [], controls: [], forms: [] }; }
}

/** Checks a cited quote against the text of a page the crew actually read. */
export function confirmQuote(state: CrewState, quote: string | null, path: string | null): { confirmed: boolean; path: string | null } {
  if (!quote || quote.trim().length < 2) return { confirmed: false, path };
  const candidates = path && state.pages[path] ? [state.pages[path]] : Object.values(state.pages);
  for (const page of candidates) {
    const haystack = `${page.title ?? ""} ${page.text} ${page.controls.join(" ")}`;
    if (phraseEvidence(haystack, quote)) return { confirmed: true, path: page.path };
  }
  return { confirmed: false, path };
}

function recordFinding(state: CrewState, args: Record<string, unknown>): { result: string; event: CrewEvent } {
  const index = Number(args.criterion) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= state.criteria.length) return { result: "Unknown criterion number.", event: { kind: "NOTE", text: "Tried to report on a criterion that doesn’t exist." } };
  const asked = ["VERIFIED", "FAILED", "INCONCLUSIVE"].includes(String(args.verdict)) ? String(args.verdict) as Verdict : "INCONCLUSIVE";
  const quote = typeof args.quote === "string" ? args.quote.trim().slice(0, 240) : null;
  const path = normalizePath(args.path, state.rootUrl);
  const check = confirmQuote(state, quote, path);
  let verdict = asked, explanation = String(args.explanation || "").trim().slice(0, 400) || "No explanation given.";
  if (asked === "VERIFIED" && !check.confirmed) {
    verdict = "INCONCLUSIVE";
    explanation = `${explanation} (Marked “needs review”: the quoted text wasn’t found on the pages read.)`;
  }
  state.findings[String(index)] = { index, verdict, explanation, quote: check.confirmed ? quote : null, path: check.path, quoteConfirmed: check.confirmed };
  return {
    result: verdict === asked ? "Recorded." : "Recorded as INCONCLUSIVE because the quote was not found on any page you read. Quote text exactly or choose INCONCLUSIVE.",
    event: { kind: "FINDING", criterionIndex: index, verdict, pageUrl: check.path ?? undefined, text: `${state.criteria[index].label}: ${explanation}` },
  };
}

/** Every criterion without a finding becomes INCONCLUSIVE when the crew stops. */
export function finalizeFindings(state: CrewState): CrewFinding[] {
  return state.criteria.map((c, index) => state.findings[String(index)] ?? {
    index, verdict: "INCONCLUSIVE", explanation: "The inspectors didn’t reach a conclusion on this one.", quote: null, path: null, quoteConfirmed: false,
  });
}

export class CrewRateLimited extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) { super("Groq rate limit reached"); this.retryAfterMs = retryAfterMs; }
}

/** Advances the crew by one model turn and executes its tool calls. Mutates and returns state. */
export async function crewStep(state: CrewState, deps: { apiKey: string; model: string; fetcher?: typeof fetch; siteFetcher?: typeof fetch }): Promise<{ state: CrewState; events: CrewEvent[] }> {
  const events: CrewEvent[] = [];
  if (state.done) return { state, events };
  const fetcher = deps.fetcher ?? fetch, siteFetcher = deps.siteFetcher ?? fetch;
  if (state.steps >= CREW_MAX_STEPS) {
    state.done = true;
    state.summary = state.summary ?? "The inspection reached its step limit.";
    events.push({ kind: "DONE", text: state.summary });
    return { state, events };
  }
  state.steps++;
  const response = await fetcher(GROQ_URL, {
    method: "POST", signal: AbortSignal.timeout(25_000),
    headers: { Authorization: `Bearer ${deps.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: deps.model, messages: state.messages, tools, tool_choice: "auto", temperature: 0.1, max_completion_tokens: 900 }),
  });
  if (response.status === 429) {
    state.steps--;
    const wait = Number(response.headers.get("retry-after")) * 1000;
    throw new CrewRateLimited(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 30_000) : 6000);
  }
  if (!response.ok) throw new Error(`Groq request failed with HTTP ${response.status}`);
  const data = await response.json() as { choices?: Array<{ message?: ChatMessage }> };
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error("Groq returned no message");
  const calls = (message.tool_calls ?? []).slice(0, 6);
  state.messages.push({ role: "assistant", content: message.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
  if (message.content?.trim()) events.push({ kind: "THINK", text: message.content.trim().slice(0, 280) });
  if (!calls.length) {
    state.messages.push({ role: "user", content: "Use the tools: read pages, record one finding per criterion, then call finish." });
    return { state, events };
  }
  for (const call of calls) {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>; } catch { args = {}; }
    let result: string;
    if (call.function.name === "read_page") {
      const path = normalizePath(args.path, state.rootUrl);
      if (!path) result = "That page isn’t on the delivered site.";
      else if (state.pages[path]) result = pageSummary(state.pages[path]);
      else if (Object.keys(state.pages).length >= CREW_MAX_PAGES) result = `Page limit reached (${CREW_MAX_PAGES}). Record your findings from what you have read.`;
      else {
        const page = await readPage(path, state.rootUrl, siteFetcher);
        state.pages[path] = page;
        events.push({ kind: "VISIT", pageUrl: path, text: page.status >= 200 && page.status < 300 ? `Inspected ${path}${page.title ? ` — “${page.title}”` : ""}` : `${path} didn’t load (HTTP ${page.status || "no response"})` });
        result = pageSummary(page);
      }
    } else if (call.function.name === "record_finding") {
      const outcome = recordFinding(state, args);
      events.push(outcome.event);
      result = outcome.result;
    } else if (call.function.name === "finish") {
      state.done = true;
      state.summary = String(args.summary || "Inspection complete.").slice(0, 500);
      events.push({ kind: "DONE", text: state.summary });
      result = "Finished.";
    } else result = "Unknown tool.";
    state.messages.push({ role: "tool", tool_call_id: call.id, content: result });
  }
  return { state, events };
}

function pageSummary(page: PageRecord): string {
  if (page.status < 200 || page.status >= 300 || !page.text) return `Page ${page.path}: HTTP ${page.status || "no response"}, no readable content.`;
  return [`Page ${page.path} (HTTP ${page.status})`, `Title: ${page.title ?? "(none)"}`, `Text: ${page.text}`,
    `Links: ${page.links.join("; ") || "(none)"}`, `Buttons/links labels: ${page.controls.join("; ") || "(none)"}`, `Forms: ${page.forms.join("; ") || "(none)"}`].join("\n");
}

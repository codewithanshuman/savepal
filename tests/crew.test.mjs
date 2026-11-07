import assert from "node:assert/strict";
import test from "node:test";
import { CREW_MAX_PAGES, CREW_MAX_STEPS, CrewRateLimited, confirmQuote, crewStep, finalizeFindings, initialCrewState } from "../lib/crew.ts";
import { evidenceStore } from "../lib/evidence-store.ts";

const criteria = [
  { label: "Shows a product catalog", kind: "contains", needle: "Products", required: true },
  { label: "Has a contact form", kind: "manual", required: true },
];
const site = new Map([
  ["https://shop.example.org/", '<title>Shop</title><h1>Our Products</h1><a href="/contact">Contact us</a>'],
  ["https://shop.example.org/contact", '<form action="/api/contact" method="post"><input name="email"><button>Send message</button></form>'],
]);
const siteFetcher = async url => {
  const body = site.get(String(url));
  return new Response(body ?? "missing", { status: body ? 200 : 404, headers: { "content-type": "text/html" } });
};
/** A scripted Groq: each call returns the next assistant message. */
const groq = script => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const next = script.shift();
    if (next === 429) return new Response("{}", { status: 429, headers: { "retry-after": "3" } });
    return Response.json({ choices: [{ message: next }] });
  };
  return { fetcher, calls };
};
const tool = (name, args, id = name) => ({ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });

test("the crew reads only same-origin pages and records quoted findings", async () => {
  const state = initialCrewState("https://shop.example.org/", criteria, "Built the shop");
  const { fetcher, calls } = groq([
    tool("read_page", { path: "/" }),
    tool("read_page", { path: "https://evil.example/steal" }),
    tool("record_finding", { criterion: 1, verdict: "VERIFIED", explanation: "The home page lists products.", quote: "Our Products", path: "/" }),
    tool("finish", { summary: "Catalog verified." }),
  ]);
  const deps = { apiKey: "k", model: "m", fetcher, siteFetcher };
  const first = await crewStep(state, deps);
  assert.equal(first.events[0].kind, "VISIT");
  await crewStep(state, deps);
  assert.ok(!Object.keys(state.pages).some(p => p.includes("evil.example") && !p.startsWith("/")), "never leaves the site's origin");
  assert.equal(Object.keys(state.pages).every(p => p.startsWith("/")), true);
  const finding = await crewStep(state, deps);
  assert.equal(finding.events[0].verdict, "VERIFIED");
  const done = await crewStep(state, deps);
  assert.equal(done.events[0].kind, "DONE");
  assert.equal(state.done, true);
  assert.equal(calls[0].tools.length, 3, "only read, record and finish are offered");
  assert.equal(calls[0].model, "m");
});

test("a VERIFIED finding without a real quote is downgraded to needs-review", async () => {
  const state = initialCrewState("https://shop.example.org/", criteria, "");
  const { fetcher } = groq([
    tool("read_page", { path: "/contact" }),
    tool("record_finding", { criterion: 2, verdict: "VERIFIED", explanation: "Form submits fine.", quote: "Thanks, your message was sent", path: "/contact" }),
    tool("record_finding", { criterion: 1, verdict: "VERIFIED", explanation: "Catalog present.", path: "/" }),
  ]);
  const deps = { apiKey: "k", model: "m", fetcher, siteFetcher };
  await crewStep(state, deps);
  const invented = await crewStep(state, deps);
  assert.equal(invented.events[0].verdict, "INCONCLUSIVE", "an invented quote can't verify anything");
  const noQuote = await crewStep(state, deps);
  assert.equal(noQuote.events[0].verdict, "INCONCLUSIVE", "VERIFIED always needs a quote");
  assert.equal(confirmQuote(state, "Send message", null).confirmed, true, "button labels count as visible text");
});

test("unknown criteria are refused and unfinished criteria end as needs-review", async () => {
  const state = initialCrewState("https://shop.example.org/", criteria, "");
  const { fetcher } = groq([tool("record_finding", { criterion: 9, verdict: "FAILED", explanation: "x" })]);
  const out = await crewStep(state, { apiKey: "k", model: "m", fetcher, siteFetcher });
  assert.equal(out.events[0].kind, "NOTE");
  const report = finalizeFindings(state);
  assert.deepEqual(report.map(f => f.verdict), ["INCONCLUSIVE", "INCONCLUSIVE"]);
});

test("page and step limits are enforced", async () => {
  const state = initialCrewState("https://shop.example.org/", criteria, "");
  for (let i = 0; i < CREW_MAX_PAGES; i++) state.pages[`/p${i}`] = { path: `/p${i}`, status: 200, title: null, text: "x", links: [], controls: [], forms: [] };
  const { fetcher } = groq([tool("read_page", { path: "/one-more" })]);
  await crewStep(state, { apiKey: "k", model: "m", fetcher, siteFetcher });
  assert.equal(Object.keys(state.pages).length, CREW_MAX_PAGES, "no page beyond the limit is fetched");
  state.steps = CREW_MAX_STEPS;
  const stop = await crewStep(state, { apiKey: "k", model: "m", fetcher: async () => { throw new Error("should not call the model"); }, siteFetcher });
  assert.equal(stop.events[0].kind, "DONE");
});

test("Groq rate limits pause the crew without losing the step", async () => {
  const state = initialCrewState("https://shop.example.org/", criteria, "");
  const { fetcher } = groq([429]);
  await assert.rejects(() => crewStep(state, { apiKey: "k", model: "m", fetcher, siteFetcher }), e => e instanceof CrewRateLimited && e.retryAfterMs === 3000);
  assert.equal(state.steps, 0);
});

test("evidence falls back to the database when no R2 bucket is bound", async () => {
  const rows = new Map();
  const db = { prepare: sql => ({ bind: (...args) => ({
    run: async () => { if (sql.startsWith("INSERT")) rows.set(args[0], { content_type: args[1], body: Array.from(args[2]) }); if (sql.startsWith("DELETE")) rows.delete(args[0]); },
    first: async () => rows.get(args[0]) ?? null,
  }) }) };
  const store = evidenceStore({ DB: db });
  assert.equal(store.kind, "d1");
  await store.put("evidence/p/s.json", '{"a":1}', "application/json");
  const object = await store.get("evidence/p/s.json");
  assert.equal(await object.text(), '{"a":1}');
  assert.equal(object.contentType, "application/json");
  await store.delete("evidence/p/s.json");
  assert.equal(await store.get("evidence/p/s.json"), null);
  await assert.rejects(() => store.put("big", new Uint8Array(2_000_000), "image/png"), /too large/);
  assert.equal(evidenceStore({}), null);
});

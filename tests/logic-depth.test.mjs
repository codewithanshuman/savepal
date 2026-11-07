import assert from "node:assert/strict";
import test from "node:test";
import { validateCriteria, safeCriterionPath } from "../lib/assurance.ts";
import { captureWebsite, evaluateSnapshot, findingConfidence } from "../lib/website-evidence.ts";
import { actionLabels, documentTitle } from "../lib/html-evidence.ts";
import { approvalViolation, decisionGate, parseMaxRevisions, revisionAllowance } from "../lib/decision-policy.ts";
import { compareFindings, progressScore, revisionHistory } from "../lib/revision-diff.ts";
import { consentState, termsFingerprint, termsHash } from "../lib/terms-consent.ts";

const site = new Map([
  ["https://shop.example.org/",'<html><head><title>Demo Shop — Home</title></head><body><a href="/products">Products</a><button>Add to cart</button><a href="/gone">Old page</a><p>Welcome</p></body></html>'],
  ["https://shop.example.org/products",'<html><body><h1>Catalog</h1><a href="/checkout">Checkout now</a></body></html>'],
  ["https://shop.example.org/pricing",'<html><body><p>Plans start at $9</p></body></html>'],
]);
const fetcher = async url => new Response(site.get(url) ?? "missing", { status: site.has(url) ? 200 : 404, headers: { "content-type": "text/html" } });
const liveFrom = snapshot => snapshot.pages.map(p => ({ url: p.url, status: site.has(p.url) ? 200 : 404, body: site.get(p.url) ?? "" }));
const crit = (kind, needle, extra = {}) => ({ label: `${kind} ${needle ?? ""}`.trim(), kind, ...(needle !== undefined ? { needle } : {}), required: true, ...extra });

test("validateCriteria normalises, rejects unsafe paths, duplicates and all-optional policies", () => {
  const ok = validateCriteria([{ label: "Has pricing page", kind: "path", needle: " /pricing " }, { label: "No lorem ipsum", kind: "absent", needle: "lorem ipsum", required: false }]);
  assert.deepEqual(ok, { criteria: [{ label: "Has pricing page", kind: "path", needle: "/pricing", required: true }, { label: "No lorem ipsum", kind: "absent", needle: "lorem ipsum", required: false }] });
  for (const path of ["https://evil.example/x", "//evil.example", "/a/../admin", "pricing", "/a?b=1"]) assert.equal(safeCriterionPath(path), null, path);
  assert.ok("error" in validateCriteria([{ label: "Twice", kind: "contains", needle: "Shop" }, { label: "Again", kind: "contains", needle: "shop" }]));
  assert.ok("error" in validateCriteria([{ label: "Only optional", kind: "reachable", required: false }]));
  assert.ok("error" in validateCriteria([{ label: "Bad kind", kind: "javascript" }]));
  assert.ok("error" in validateCriteria([{ label: "Punctuation only", kind: "contains", needle: "!!!" }]));
});

test("HTML helpers read titles and visible action labels, ignoring hidden controls", () => {
  assert.equal(documentTitle("<title> Demo &amp; Co </title>"), "Demo & Co");
  assert.equal(documentTitle("<p>no title</p>"), null);
  assert.deepEqual(actionLabels('<a href="/x">Buy <b>now</b></a><button hidden>Secret</button><input type="submit" value="Send"><span role="button" aria-label="Close"></span><a>no href</a>'), ["Buy now", "Send", "Close"]);
});

test("path criteria are captured even when nothing links to them", async () => {
  const criteria = [crit("path", "/pricing")];
  const snapshot = await captureWebsite("https://shop.example.org/", fetcher, criteria);
  assert.equal(snapshot.pages[1].url, "https://shop.example.org/pricing");
  const [finding] = evaluateSnapshot(criteria, snapshot, liveFrom(snapshot));
  assert.equal(finding.status, "VERIFIED");
});

test("new check kinds give VERIFIED, FAILED and INCONCLUSIVE for the right reasons", async () => {
  const criteria = [
    crit("title", "demo shop"), crit("title", "Pricing"),
    crit("link", "checkout"), crit("link", "Subscribe"),
    crit("absent", "lorem ipsum"), crit("absent", "catalog"),
    crit("path", "/missing"), crit("no_broken_pages"),
  ];
  const snapshot = await captureWebsite("https://shop.example.org/", fetcher, criteria);
  const findings = evaluateSnapshot(criteria, snapshot, liveFrom(snapshot));
  const status = findings.map(f => f.status);
  // /gone is broken, so "not found anywhere" claims (link 4, absent 5) cannot be proven: INCONCLUSIVE.
  assert.deepEqual(status, ["VERIFIED", "FAILED", "VERIFIED", "INCONCLUSIVE", "INCONCLUSIVE", "FAILED", "FAILED", "FAILED"]);
  assert.match(findings[5].evidenceRefs[0].excerpt, /catalog/);
  assert.match(findings[7].explanation, /\/gone/);
  assert.equal(findingConfidence(findings[0]), "HIGH");
  assert.equal(findingConfidence(findings[3]), "LOW");
});

test("on a fully readable site, absence and missing controls are proven", async () => {
  const clean = new Map([["https://clean.example.org/",'<title>Clean</title><a href="/about">About us</a>'],["https://clean.example.org/about","<p>Team</p>"]]);
  const cleanFetch = async url => new Response(clean.get(url) ?? "", { status: clean.has(url) ? 200 : 404, headers: { "content-type": "text/html" } });
  const criteria = [crit("absent", "lorem ipsum"), crit("link", "Subscribe"), crit("no_broken_pages")];
  const snapshot = await captureWebsite("https://clean.example.org/", cleanFetch, criteria);
  const live = snapshot.pages.map(p => ({ url: p.url, status: 200, body: clean.get(p.url) }));
  assert.deepEqual(evaluateSnapshot(criteria, snapshot, live).map(f => f.status), ["VERIFIED", "FAILED", "VERIFIED"]);
});

test("absence is never claimed when coverage is partial or the live site changed", async () => {
  const criteria = [crit("absent", "coming soon"), crit("link", "Checkout now"), crit("title", "Demo")];
  const snapshot = await captureWebsite("https://shop.example.org/", fetcher, criteria);
  const live = liveFrom(snapshot).map(p => p.url.endsWith("/products") ? { ...p, body: "<p>Coming soon</p>" } : p.url.endsWith(".org/") ? { ...p, status: 503, body: "" } : p);
  const [absent, link, title] = evaluateSnapshot(criteria, snapshot, live);
  assert.equal(absent.status, "FAILED", "a phrase that appears only live still fails absence");
  assert.equal(link.status, "INCONCLUSIVE", "a control removed after submission is not verified");
  assert.equal(title.status, "INCONCLUSIVE", "an unreadable live root cannot confirm the title");
  assert.equal(findingConfidence(link), "LOW");
});

test("decision gate: failed required blocks, inconclusive needs confirmation, optional is advisory", () => {
  const criteria = [{ label: "A", kind: "reachable" }, { label: "B", kind: "manual", required: true }, { label: "C", kind: "contains", needle: "x", required: false }];
  const f = statuses => statuses.map((status, i) => ({ label: criteria[i].label, status, explanation: "", check: "" }));
  assert.equal(decisionGate(criteria, f(["VERIFIED", "VERIFIED", "VERIFIED"])).mode, "CLEAR");
  const confirm = decisionGate(criteria, f(["VERIFIED", "INCONCLUSIVE", "FAILED"]));
  assert.equal(confirm.mode, "CONFIRM");
  assert.equal(confirm.advisory.length, 1);
  assert.ok(approvalViolation(confirm, "", false));
  assert.equal(approvalViolation(confirm, "Tested checkout by hand", false), null);
  assert.ok(approvalViolation(confirm, "Tested checkout by hand", true), "override is refused when nothing is blocking");
  const blocked = decisionGate(criteria, f(["FAILED", "VERIFIED", "VERIFIED"]));
  assert.equal(blocked.mode, "OVERRIDE");
  assert.match(approvalViolation(blocked, "long enough reason for this", false), /override/);
  assert.match(approvalViolation(blocked, "too short", true), /20 characters/);
  assert.equal(approvalViolation(blocked, "Host outage confirmed; site works now", true), null);
  assert.throws(() => decisionGate(criteria, f(["VERIFIED"])));
  assert.equal(decisionGate([{ label: "legacy", kind: "reachable" }], f(["FAILED"])).mode, "OVERRIDE", "legacy criteria are treated as required");
});

test("revision allowance and limit parsing", () => {
  assert.deepEqual(revisionAllowance(null, 9), { remaining: null, exhausted: false });
  assert.deepEqual(revisionAllowance(2, 2), { remaining: 0, exhausted: true });
  assert.equal(parseMaxRevisions(""), null);
  assert.equal(parseMaxRevisions("3"), 3);
  assert.equal(parseMaxRevisions(-1), undefined);
  assert.equal(parseMaxRevisions(2.5), undefined);
});

test("revision history tracks improvements, regressions and progress score", () => {
  const criteria = [{ label: "A", kind: "reachable" }, { label: "B", kind: "manual" }];
  const run = (id, a, b) => ({ id, submission_id: id, completed_at: id, findings_json: JSON.stringify([{ label: "A", status: a }, { label: "B", status: b }]) });
  const history = revisionHistory(criteria, [run("1", "FAILED", "INCONCLUSIVE"), run("2", "VERIFIED", "INCONCLUSIVE"), run("3", "FAILED", "VERIFIED"), { id: "bad", findings_json: "{" }]);
  assert.equal(history.length, 3);
  assert.equal(history[0].deltas[0].transition, "FIRST");
  assert.deepEqual([history[1].improved, history[1].regressed, history[1].scoreChange], [1, 0, 50]);
  assert.deepEqual([history[2].improved, history[2].regressed], [1, 1]);
  assert.equal(progressScore([{ status: "VERIFIED" }, { status: "INCONCLUSIVE" }]), 75);
  assert.equal(compareFindings(criteria, [{ status: "VERIFIED" }], [{ status: "VERIFIED" }, { status: "FAILED" }])[0].transition, "FIRST", "mismatched history is not compared");
});

test("terms hash binds both parties and detects tampering with locked terms", async () => {
  const base = { id: "p1", client_id: "c1", client_email: "Client@Example.org", freelancer_email: "free@example.org", title: "Site", description: "Build it",
    amount_cents: 100000, currency: "USD", criteria_json: '[{"label":"Up","kind":"reachable","required":true}]', max_revisions: 2,
    status: "INVITED", evidence_hash: null, current_submission_id: null, latest_run_id: null, findings_json: null, audit_head_hash: null };
  const hash = await termsHash(base);
  assert.notEqual(hash, await termsHash({ ...base, max_revisions: 3 }), "revision limit is part of the terms");
  assert.equal(hash, await termsHash({ ...base, status: "APPROVED", audit_head_hash: "x" }), "workflow state is not part of the terms");
  assert.match(termsFingerprint(hash), /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  const agreed = await consentState({ ...base, terms_hash: hash, accepted_terms_hash: hash });
  assert.deepEqual([agreed.legacy, agreed.clientBound, agreed.freelancerBound, agreed.tampered], [false, true, true, false]);
  const pending = await consentState({ ...base, terms_hash: hash, accepted_terms_hash: null });
  assert.deepEqual([pending.freelancerBound, pending.tampered], [false, false]);
  const edited = await consentState({ ...base, amount_cents: 1, terms_hash: hash, accepted_terms_hash: hash });
  assert.equal(edited.tampered, true, "changing the amount after both parties bound it is detected");
  assert.equal((await consentState({ ...base, terms_hash: null, accepted_terms_hash: null })).legacy, true);
});

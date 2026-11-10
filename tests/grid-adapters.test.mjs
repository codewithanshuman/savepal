import test from "node:test";
import assert from "node:assert/strict";
import { agreementRows, comparisonRows, evidenceRows, freshness, matchesEvidenceFilter, paymentEvents, paymentLabel, resultCounts, shortRef } from "../lib/grid-adapters.ts";

const criteria = [
  { label: "Homepage loads", kind: "reachable" },
  { label: "Pricing page", kind: "path", needle: "/pricing" },
  { label: "Checkout works", kind: "manual", required: false },
];
const findings = [
  { label: "Homepage loads", status: "VERIFIED", explanation: "HTTP 200 from the delivery URL.", check: "reachable", confidence: "HIGH", evidenceRefs: [{ url: "https://shop.test/", excerpt: "Welcome" }] },
  { label: "Pricing page", status: "FAILED", explanation: "GET /pricing returned 404.", check: "path", confidence: "HIGH" },
  { label: "Checkout works", status: "INCONCLUSIVE", explanation: "Needs a person to try a purchase.", check: "manual" },
];
const gate = { blocking: [{ index: 1 }], unconfirmed: [], advisory: [{ index: 2 }] };
const history = [
  { runId: "run1", submissionId: "sub1", completedAt: "2026-11-01T10:00:00Z", deltas: [
    { index: 0, label: "Homepage loads", from: null, to: "FAILED", transition: "FIRST" },
    { index: 1, label: "Pricing page", from: null, to: "VERIFIED", transition: "FIRST" },
    { index: 2, label: "Checkout works", from: null, to: "INCONCLUSIVE", transition: "FIRST" },
  ] },
  { runId: "run2", submissionId: "sub2", completedAt: "2026-11-03T10:00:00Z", deltas: [
    { index: 0, label: "Homepage loads", from: "FAILED", to: "VERIFIED", transition: "IMPROVED" },
    { index: 1, label: "Pricing page", from: "VERIFIED", to: "FAILED", transition: "REGRESSED" },
    { index: 2, label: "Checkout works", from: "INCONCLUSIVE", to: "INCONCLUSIVE", transition: "UNCHANGED" },
  ] },
];

test("each criterion shows its saved result and what the server gate makes of it", () => {
  const rows = evidenceRows({ projectId: "p1", criteria, findings, gate, history, runId: "run2" });
  assert.deepEqual(rows.map(r => r.result), ["VERIFIED", "FAILED", "INCONCLUSIVE"]);
  assert.deepEqual(rows.map(r => r.effect), ["CLEAR", "BLOCKS", "ADVISORY"]);
  assert.deepEqual(rows.map(r => r.required), [true, true, false]);
  assert.equal(rows[1].explanation, "GET /pricing returned 404.");
  assert.equal(rows[0].sources[0].excerpt, "Welcome");
  assert.equal(rows[1].needle, "/pricing");
});

test("an inconclusive result is never shown as verified", () => {
  const rows = evidenceRows({ projectId: "p1", criteria, findings, gate, history, runId: "run2" });
  assert.equal(rows[2].result, "INCONCLUSIVE");
  assert.deepEqual(resultCounts(rows), { VERIFIED: 1, FAILED: 1, INCONCLUSIVE: 1, NOT_CHECKED: 0 });
});

test("before any check every criterion is not checked", () => {
  const rows = evidenceRows({ projectId: "p1", criteria, findings: null, gate: null, history: [], runId: null });
  assert.ok(rows.every(r => r.result === "NOT_CHECKED" && r.effect === "NOT_CHECKED"));
  assert.equal(rows[0].id, "p1:unchecked:0");
});

test("a result the server did not classify is not guessed", () => {
  const rows = evidenceRows({ projectId: "p1", criteria, findings, gate: null, history, runId: "run2" });
  assert.equal(rows[1].effect, "UNKNOWN");
  assert.equal(rows[0].effect, "CLEAR");
});

test("filtering by result and required-only keeps just the matching rows", () => {
  const rows = evidenceRows({ projectId: "p1", criteria, findings, gate, history, runId: "run2" });
  assert.deepEqual(rows.filter(r => matchesEvidenceFilter(r, "FAILED", true)).map(r => r.index), [1]);
  assert.deepEqual(rows.filter(r => matchesEvidenceFilter(r, "INCONCLUSIVE", true)).map(r => r.index), []);
  assert.deepEqual(rows.filter(r => matchesEvidenceFilter(r, "ALL", true)).map(r => r.index), [0, 1]);
  assert.equal(rows.filter(r => matchesEvidenceFilter(r, "ALL", false)).length, 3);
});

test("rows from different checks never share an id", () => {
  const a = evidenceRows({ projectId: "p1", criteria, findings, gate, history, runId: "run1" });
  const b = evidenceRows({ projectId: "p1", criteria, findings, gate, history, runId: "run2" });
  assert.notEqual(a[0].id, b[0].id);
  assert.equal(b[0].id, "p1:run2:0");
});

test("the change column comes only from the check the findings belong to", () => {
  const latest = evidenceRows({ projectId: "p1", criteria, findings, gate, history, runId: "run2" });
  assert.deepEqual(latest.map(r => r.change), ["IMPROVED", "REGRESSED", "UNCHANGED"]);
  assert.equal(latest[1].previous, "VERIFIED");
  const stale = evidenceRows({ projectId: "p1", criteria, findings, gate, history, runId: "run1" });
  assert.ok(stale.every(r => r.change === null && r.previous === null));
});

test("the comparison pairs the latest completed check with the one before", () => {
  const c = comparisonRows("p1", history);
  assert.equal(c.from.runId, "run1");
  assert.equal(c.to.runId, "run2");
  assert.deepEqual(c.rows.map(r => [r.previous, r.latest, r.change]), [["FAILED", "VERIFIED", "IMPROVED"], ["VERIFIED", "FAILED", "REGRESSED"], ["INCONCLUSIVE", "INCONCLUSIVE", "UNCHANGED"]]);
  assert.equal(c.rows[0].id, "p1:run1->run2:0");
  assert.deepEqual(comparisonRows("p1", history.slice(0, 1)).rows, []);
});

test("freshness: findings from an earlier delivery, or with a newer check running, are flagged", () => {
  const run = (id, state, sub) => ({ id, state, submission_id: sub, completed_at: null });
  assert.equal(freshness({ findings, history, latestRun: run("run2", "COMPLETED", "sub2"), currentSubmissionId: "sub2" }).state, "CURRENT");
  assert.equal(freshness({ findings, history, latestRun: run("run2", "COMPLETED", "sub2"), currentSubmissionId: "sub3" }).state, "STALE");
  assert.equal(freshness({ findings, history, latestRun: run("run3", "RUNNING", "sub3"), currentSubmissionId: "sub3" }).state, "RUNNING");
  assert.equal(freshness({ findings: null, history: [], latestRun: null, currentSubmissionId: null }).state, "NONE");
  assert.equal(freshness({ findings, history, latestRun: run("run2", "COMPLETED", "sub2"), currentSubmissionId: "sub2" }).runId, "run2");
});

test("agreements: money in plain words, a hold is never called paid", () => {
  assert.equal(paymentLabel({ payment_status: "NOT_STARTED", funding: { mode: "HOLD", status: "HELD" } }), "Held by PayPal");
  assert.equal(paymentLabel({ payment_status: "NOT_STARTED", funding: { mode: "HOLD", status: "CAPTURED" } }), "Paid");
  assert.equal(paymentLabel({ payment_status: "COMPLETED", funding: { mode: "CAPTURE", status: "NONE" } }), "Paid");
  assert.equal(paymentLabel({ payment_status: "PARTIALLY_REFUNDED", funding: { mode: "CAPTURE", status: "NONE" } }), "Paid, partly refunded");
  assert.equal(paymentLabel({ payment_status: "NOT_STARTED", funding: { mode: "CAPTURE", status: "NONE" } }), "Not started");
});

test("agreement rows reuse the workspace's own next move", () => {
  const p = { id: "a1", title: "Storefront", role: "client", client_email: "me@x.test", freelancer_email: "dev@x.test", amount_cents: 100000, currency: "USD", status: "REVIEW", payment_status: "NOT_STARTED", funding: { mode: "HOLD", status: "HELD" }, created_at: "2026-11-01T00:00:00Z", accepted_at: "2026-11-02T00:00:00Z", evidence_at: "2026-11-04T00:00:00Z", evaluated_at: null };
  const [row] = agreementRows([p], () => ({ mine: true, title: "Review the delivery", tone: "act" }));
  assert.equal(row.other, "dev@x.test");
  assert.equal(row.role, "Client");
  assert.equal(row.milestone, "Under review");
  assert.equal(row.payment, "Held by PayPal");
  assert.equal(row.next, "Review the delivery");
  assert.equal(row.mine, true);
  assert.equal(row.updated, "2026-11-04T00:00:00Z");
});

test("payment detail events and short references", () => {
  const audit = [
    { type: "FUNDS_HELD", created_at: "2026-11-01T00:00:00Z" }, { type: "PAYPAL_CAPTURE_OBSERVED", created_at: "2026-11-03T00:00:00Z" },
    { type: "BOUNTY_PAID", created_at: "2026-11-02T00:00:00Z" }, { type: "CRITERIA_LOCKED", created_at: "2026-11-01T00:00:00Z" },
  ];
  assert.deepEqual(paymentEvents("HOLD", audit).map(e => e.type), ["FUNDS_HELD"]);
  assert.deepEqual(paymentEvents("PAYMENT", audit).map(e => e.type), ["PAYPAL_CAPTURE_OBSERVED"]);
  assert.deepEqual(paymentEvents("BOUNTY", audit).map(e => e.type), ["BOUNTY_PAID"]);
  assert.equal(shortRef("8XY12345AB678901C"), "8XY123…901C");
  assert.equal(shortRef(null), "—");
});

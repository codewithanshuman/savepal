import assert from "node:assert/strict";
import test from "node:test";
import { MAX_HTML_BYTES, captureMatches, canApplyPaymentStatus, evaluateCriteria, parseUsdCents, providerPaymentStatus, readBoundedHtml, safeWebsiteUrl } from "../lib/assurance.ts";

test("USD amounts are parsed as exact cents", () => {
  assert.equal(parseUsdCents("12.50"),1250);
  assert.equal(parseUsdCents("1"),100);
  assert.equal(parseUsdCents("1000000"),100000000);
  for (const value of ["1.005","0.99","1000000.01","-5","1e3","01.00"]) assert.equal(parseUsdCents(value),null);
});

test("website URL validation excludes local and direct-IP targets", () => {
  assert.equal(safeWebsiteUrl("https://example.org/store"), "https://example.org/store");
  for (const url of [
    "http://example.org", "https://localhost/", "https://127.0.0.1/",
    "https://[::1]/", "https://internal.local/", "https://site.test/",
    "https://user:pass@example.org/", "file:///etc/passwd",
  ]) assert.equal(safeWebsiteUrl(url), null, url);
});

test("findings remain inconclusive when HTML is missing or truncated", () => {
  const criteria = [
    { label: "Online", kind: "reachable" },
    { label: "Catalog", kind: "contains", needle: "Products" },
    { label: "Checkout", kind: "manual" },
  ];
  assert.deepEqual(evaluateCriteria(criteria, { status: 200, body: "Products", contentType: "text/html", truncated: false }).map(f => f.status), ["VERIFIED","VERIFIED","INCONCLUSIVE"]);
  assert.deepEqual(evaluateCriteria(criteria, { status: 200, body: "partial", contentType: "text/html", truncated: true }).map(f => f.status), ["VERIFIED","INCONCLUSIVE","INCONCLUSIVE"]);
  assert.deepEqual(evaluateCriteria(criteria, { status: 200, body: "other", contentType: "text/html", truncated: false }).map(f => f.status), ["VERIFIED","FAILED","INCONCLUSIVE"]);
  assert.deepEqual(evaluateCriteria(criteria, { status: 0, body: "", contentType: "", truncated: false }).map(f => f.status), ["INCONCLUSIVE","INCONCLUSIVE","INCONCLUSIVE"]);
});

test("HTML reading is bounded to 100 KB", async () => {
  const response = new Response("a".repeat(MAX_HTML_BYTES + 5000), { headers: { "content-type": "text/html" } });
  const result = await readBoundedHtml(response);
  assert.equal(result.body.length, MAX_HTML_BYTES);
  assert.equal(result.truncated, true);
});

test("capture requires exact ID, amount, and currency", () => {
  const capture = { id: "CAP-1", amount: { value: "1000.00", currency_code: "USD" } };
  assert.equal(captureMatches(capture,100000,"USD","CAP-1"),true);
  assert.equal(captureMatches(capture,100001,"USD","CAP-1"),false);
  assert.equal(captureMatches(capture,100000,"EUR","CAP-1"),false);
  assert.equal(captureMatches(capture,100000,"USD","CAP-2"),false);
  assert.equal(captureMatches({ ...capture, amount: { ...capture.amount, value: "1,000.00" } },100000,"USD"),false);
});

test("provider updates cannot demote a completed payment", () => {
  assert.equal(providerPaymentStatus("COMPLETED"),"COMPLETED");
  assert.equal(providerPaymentStatus("DENIED"),"FAILED");
  assert.equal(providerPaymentStatus("SOMETHING_NEW"),"PENDING");
  assert.equal(canApplyPaymentStatus("COMPLETED","PENDING"),false);
  assert.equal(canApplyPaymentStatus("COMPLETED","FAILED"),false);
  assert.equal(canApplyPaymentStatus("PENDING","COMPLETED"),true);
  assert.equal(canApplyPaymentStatus("FAILED","PENDING"),false);
});

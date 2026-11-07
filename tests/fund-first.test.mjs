import assert from "node:assert/strict";
import test from "node:test";
import { PayPalSandbox, authorizationMatches, holdStatus, orderAuthorization, orderCapture, orderMatches } from "../lib/paypal-assurance.ts";
import { canFund, canRelease, fundsSecured, paymentBinding, voidAllowed } from "../lib/funding.ts";
import { fundingCustomId, termsHash } from "../lib/terms-consent.ts";

const expected = { projectId: "p1", orderId: "ORDER1", customId: "terms:abc", amountCents: 100000, currency: "USD", merchantId: "ABCDEFGHIJKLM", intent: "AUTHORIZE" };
const order = (extra = {}) => ({
  id: "ORDER1", intent: "AUTHORIZE", status: "COMPLETED",
  purchase_units: [{ reference_id: "p1", custom_id: "terms:abc", payee: { merchant_id: "ABCDEFGHIJKLM" }, amount: { value: "1000.00", currency_code: "USD" }, payments: extra }],
});
const auth = (extra = {}) => ({ id: "AUTH1", status: "CREATED", amount: { value: "1000.00", currency_code: "USD" }, custom_id: "terms:abc", supplementary_data: { related_ids: { order_id: "ORDER1" } }, ...extra });

test("orders are matched to their intent: a hold order is not a pay-now order", () => {
  assert.equal(orderMatches(order(), expected), true);
  assert.equal(orderMatches(order(), { ...expected, intent: "CAPTURE" }), false);
  assert.equal(orderMatches({ ...order(), intent: "CAPTURE" }, expected), false);
  assert.equal(orderMatches(order(), { ...expected, customId: "terms:other" }), false, "bound to the exact terms");
});

test("authorizations must match amount, terms binding and order", () => {
  assert.equal(orderAuthorization(order({ authorizations: [auth()] }), expected)?.id, "AUTH1");
  assert.equal(orderAuthorization(order({ authorizations: [auth(), auth({ id: "AUTH2" })] }), expected), null, "exactly one hold");
  assert.equal(orderAuthorization(order({ authorizations: [auth()] }), { ...expected, intent: "CAPTURE" }), null);
  assert.equal(authorizationMatches(auth({ amount: { value: "999.99", currency_code: "USD" } }), expected), false);
  assert.equal(authorizationMatches(auth({ custom_id: "terms:zzz" }), expected), false);
  assert.equal(authorizationMatches(auth({ supplementary_data: { related_ids: { order_id: "OTHER" } } }), expected), false);
  assert.equal(authorizationMatches(auth(), expected, "AUTH9"), false);
});

test("captures from a released hold are recognised on the order", () => {
  const capture = { id: "CAP1", status: "COMPLETED", amount: { value: "1000.00", currency_code: "USD" }, supplementary_data: { related_ids: { order_id: "ORDER1", authorization_id: "AUTH1" } } };
  assert.equal(orderCapture(order({ authorizations: [auth({ status: "CAPTURED" })], captures: [capture] }), expected)?.id, "CAP1");
});

test("PayPal hold states map to local states, and unknown states are refused", () => {
  assert.deepEqual(["CREATED", "PENDING", "CAPTURED", "PARTIALLY_CAPTURED", "VOIDED", "EXPIRED", "DENIED"].map(s => holdStatus({ status: s })),
    ["HELD", "PENDING", "CAPTURED", "CAPTURED", "VOIDED", "EXPIRED", "FAILED"]);
  assert.throws(() => holdStatus({ status: "SOMETHING" }));
});

test("the PayPal client sends authorize, capture (with the approval as invoice) and void correctly", async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
    if (String(url).endsWith("/oauth2/token")) return Response.json({ access_token: "t" });
    if (String(url).endsWith("/void")) return new Response(null, { status: 204 });
    return Response.json({ id: "X" });
  };
  const client = new PayPalSandbox("id", "secret", fetcher);
  await client.createOrder(expected, "req-1");
  await client.authorizeOrder("ORDER1", "req-2");
  await client.captureAuthorization("AUTH1", "req-3", "a".repeat(64));
  assert.deepEqual(await client.voidAuthorization("AUTH1", "req-4"), {}, "204 No Content is handled");
  const [, create, authorize, capture, voided] = calls;
  assert.equal(JSON.parse(create.body).intent, "AUTHORIZE");
  assert.match(authorize.url, /\/v2\/checkout\/orders\/ORDER1\/authorize$/);
  assert.equal(authorize.headers["PayPal-Request-Id"], "req-2", "idempotent");
  assert.match(capture.url, /\/v2\/payments\/authorizations\/AUTH1\/capture$/);
  assert.deepEqual([JSON.parse(capture.body).final_capture, JSON.parse(capture.body).invoice_id], [true, "a".repeat(64)]);
  assert.match(voided.url, /\/authorizations\/AUTH1\/void$/);
  assert.throws(() => client.captureAuthorization("AUTH1", "r", "bad invoice!"), /Invalid invoice/);
  assert.throws(() => client.voidAuthorization("../x", "r"), /Invalid PayPal authorization/);
});

const p = (o = {}) => ({ funding_mode: "HOLD", funding_status: "NONE", funding_custom_id: "terms:abc", status: "AGREED", evidence_url: null, paypal_capture_id: null, ...o });

test("funding rules: when money can be secured, delivered against, released or returned", () => {
  assert.equal(canFund(p()), true);
  assert.equal(canFund(p({ status: "INVITED" })), false, "not before the freelancer accepts");
  assert.equal(canFund(p({ status: "APPROVED" })), false, "not after approval");
  assert.equal(canFund(p({ funding_status: "HELD" })), false, "not twice");
  assert.equal(canFund(p({ funding_status: "VOIDED" })), true, "can re-fund after a cancelled hold");
  assert.equal(canFund(p({ funding_mode: "CAPTURE" })), false);

  assert.equal(fundsSecured(p()), false, "no delivery without held funds");
  assert.equal(fundsSecured(p({ funding_status: "HELD" })), true);
  assert.equal(fundsSecured(p({ funding_mode: "CAPTURE" })), true, "pay-after-approval agreements are unaffected");

  assert.equal(canRelease(p({ status: "APPROVED", funding_status: "HELD" })), true);
  assert.equal(canRelease(p({ status: "REVIEW", funding_status: "HELD" })), false, "only after approval");
  assert.equal(canRelease(p({ status: "APPROVED", funding_status: "HELD", paypal_capture_id: "C" })), false, "only once");

  const held = p({ funding_status: "HELD" });
  assert.equal(voidAllowed(held, "client").allowed, true, "client may cancel before any work arrives");
  assert.equal(voidAllowed({ ...held, evidence_url: "https://x.example.org" }, "client").allowed, false, "client can't pull money back after receiving work");
  assert.equal(voidAllowed({ ...held, evidence_url: "https://x.example.org" }, "freelancer").allowed, true, "freelancer can always step away");
  assert.equal(voidAllowed({ ...held, status: "APPROVED" }, "freelancer").allowed, false, "approved funds only go to the freelancer");
  assert.equal(voidAllowed(p(), "freelancer").allowed, false);
});

test("payment binding: holds bind to terms, pay-now binds to the approval receipt", () => {
  assert.deepEqual(paymentBinding(p(), null), { intent: "AUTHORIZE", customId: "terms:abc" });
  const receipt = { source: "DIRECT", receipt_hash: "r".repeat(64), project_id: "p1" };
  assert.deepEqual(paymentBinding({ funding_mode: "CAPTURE" }, receipt), { intent: "CAPTURE", customId: "r".repeat(64) });
  assert.throws(() => paymentBinding({ funding_mode: "CAPTURE" }, null), /approval/);
  assert.throws(() => paymentBinding(p({ funding_custom_id: null }), null), /binding/);
});

test("fund-first is part of the terms, without changing existing agreements' fingerprints", async () => {
  const base = { id: "p1", client_id: "c", client_email: "c@x.org", freelancer_email: "f@x.org", title: "T", description: "D",
    amount_cents: 100, currency: "USD", criteria_json: "[]", max_revisions: 1, status: "INVITED", evidence_hash: null,
    current_submission_id: null, latest_run_id: null, findings_json: null, audit_head_hash: null };
  const legacy = await termsHash(base);
  assert.equal(await termsHash({ ...base, funding_mode: "CAPTURE" }), legacy, "existing agreements keep their hash");
  const hold = await termsHash({ ...base, funding_mode: "HOLD" });
  assert.notEqual(hold, legacy, "switching to fund-first changes the agreed terms");
  assert.equal(fundingCustomId(hold), `terms:${hold}`);
  assert.ok(fundingCustomId(hold).length <= 127, "fits PayPal's custom_id limit");
});

import test from "node:test";
import assert from "node:assert/strict";
import { paymentLedger } from "../lib/payment-ledger.ts";

const base = {
  id: "p1", amount_cents: 250000, currency: "USD",
  funding_mode: "CAPTURE", funding_status: "NONE", paypal_authorization_id: null,
  funding_held_at: null, funding_expires_at: null, funding_renewed_at: null,
  paypal_order_id: null, paypal_capture_id: null, payment_status: "NOT_STARTED",
  payment_order_requested_at: null, payment_capture_requested_at: null, payment_last_reconciled_at: null,
};
const ledger = (project, extra = {}) => paymentLedger({ project: { ...base, ...project }, observations: [], attempts: [], bounties: [], refunds: [], awaitingReconciliation: false, ...extra });
const obs = (id, eventId, provider, projected, at, capture = "CAP1") => ({ id, source: eventId ? "WEBHOOK" : "SYNC", provider_event_id: eventId, order_id: "ORD1", capture_id: capture, provider_status: provider, projected_status: projected, amount_cents: 250000, currency: "USD", observed_at: at });

test("an agreement with no payment activity has no rows", () => {
  const l = ledger({});
  assert.equal(l.rows.length, 0);
  assert.deepEqual(l.totals, { heldCents: 0, paidCents: 0, refundedCents: 0, bountyCents: 0 });
});

test("a PayPal authorization is a hold, never a payment", () => {
  const l = ledger({ funding_mode: "HOLD", funding_status: "HELD", paypal_authorization_id: "AUTH1", paypal_order_id: "ORD1", funding_held_at: "2026-11-01T10:00:00Z" });
  assert.equal(l.rows.length, 1);
  const [hold] = l.rows;
  assert.equal(hold.kind, "HOLD");
  assert.equal(hold.state, "HELD");
  assert.equal(hold.providerStatus, "CREATED");
  assert.equal(hold.reconciliation, "CONFIRMED");
  assert.equal(hold.reference, "AUTH1");
  assert.equal(l.totals.heldCents, 250000);
  assert.equal(l.totals.paidCents, 0);
});

test("a hold the client has not approved in PayPal has no PayPal status", () => {
  const [hold] = ledger({ funding_mode: "HOLD", funding_status: "ORDER_CREATED", paypal_order_id: "ORD1" }).rows;
  assert.equal(hold.state, "AWAITING_APPROVAL");
  assert.equal(hold.providerStatus, null);
  assert.equal(hold.reconciliation, "NOT_REPORTED");
});

test("a capture reported many times is still one payment", () => {
  const l = ledger({ funding_mode: "HOLD", funding_status: "CAPTURED", paypal_authorization_id: "AUTH1", paypal_order_id: "ORD1", paypal_capture_id: "CAP1", payment_status: "COMPLETED" }, {
    observations: [
      obs("o1", null, "COMPLETED", "COMPLETED", "2026-11-02T10:00:00Z"),
      obs("o2", "WH-1", "COMPLETED", "COMPLETED", "2026-11-02T10:00:05Z"),
      obs("o3", "WH-1", "COMPLETED", "COMPLETED", "2026-11-02T10:00:09Z"),
      obs("o4", null, "COMPLETED", "COMPLETED", "2026-11-02T11:00:00Z"),
      obs("x9", null, "COMPLETED", "COMPLETED", "2026-11-02T11:00:00Z", "OTHER"),
    ],
  });
  const payments = l.rows.filter(r => r.kind === "PAYMENT");
  assert.equal(payments.length, 1);
  assert.equal(payments[0].state, "PAID");
  assert.equal(payments[0].providerStatus, "COMPLETED");
  assert.equal(payments[0].reconciliation, "CONFIRMED");
  // the redelivered webhook counts once, and another capture's report is not mixed in
  assert.deepEqual(payments[0].observations.map(o => o.id), ["o4", "o2", "o1"]);
  assert.equal(l.rows.find(r => r.kind === "HOLD").state, "RELEASED");
  assert.equal(l.totals.paidCents, 250000);
  assert.equal(l.totals.heldCents, 0);
});

test("a capture PayPal has not confirmed stays unresolved", () => {
  const [pay] = ledger({ paypal_order_id: "ORD1", payment_status: "NOT_STARTED", payment_capture_requested_at: "2026-11-03T09:00:00Z" }, { awaitingReconciliation: true }).rows;
  assert.equal(pay.kind, "PAYMENT");
  assert.equal(pay.state, "PENDING");
  assert.equal(pay.providerStatus, null);
  assert.equal(pay.reconciliation, "AWAITING");
});

test("a requested refund is not a refund until PayPal completes it", () => {
  const paid = { paypal_order_id: "ORD1", paypal_capture_id: "CAP1", payment_status: "COMPLETED" };
  const requested = ledger(paid, { refunds: [{ id: "r1", capture_id: "CAP1", amount_cents: 5000, currency: "USD", status: "REQUESTED", paypal_refund_id: null, started_at: "2026-11-04T09:00:00Z", updated_at: "2026-11-04T09:00:00Z" }] });
  const r = requested.rows.find(x => x.kind === "REFUND");
  assert.equal(r.state, "REQUESTED");
  assert.equal(r.providerStatus, null);
  assert.equal(requested.totals.refundedCents, 0);
  const done = ledger({ ...paid, payment_status: "PARTIALLY_REFUNDED" }, {
    observations: [obs("o1", null, "COMPLETED", "COMPLETED", "2026-11-02T10:00:00Z")],
    refunds: [{ id: "r1", capture_id: "CAP1", amount_cents: 5000, currency: "USD", status: "COMPLETED", paypal_refund_id: "REF1", started_at: "2026-11-04T09:00:00Z", updated_at: "2026-11-04T09:01:00Z" }],
  });
  assert.equal(done.rows.find(x => x.kind === "REFUND").state, "REFUNDED");
  assert.equal(done.totals.refundedCents, 5000);
  // the payment's status moved on because of the refund, which PayPal confirmed: no false mismatch
  assert.equal(done.rows.find(x => x.kind === "PAYMENT").reconciliation, "CONFIRMED");
});

test("a payment whose last PayPal report disagrees is flagged", () => {
  const [pay] = ledger({ paypal_order_id: "ORD1", paypal_capture_id: "CAP1", payment_status: "COMPLETED" }, { observations: [obs("o1", null, "DECLINED", "FAILED", "2026-11-02T10:00:00Z")] }).rows;
  assert.equal(pay.reconciliation, "DIFFERS");
});

test("bounties: unpaid orders have no PayPal status; paid ones count toward the totals", () => {
  const l = ledger({}, { bounties: [
    { id: "b1", amount_cents: 2500, currency: "USD", note: "Extra polish", status: "ORDER_CREATED", paypal_order_id: "BO1", paypal_capture_id: null, created_at: "2026-11-05T09:00:00Z", updated_at: "2026-11-05T09:00:00Z" },
    { id: "b2", amount_cents: 4000, currency: "USD", note: "Fast delivery", status: "COMPLETED", paypal_order_id: "BO2", paypal_capture_id: "BC2", created_at: "2026-11-06T09:00:00Z", updated_at: "2026-11-06T09:05:00Z" },
  ] });
  const [b1, b2] = l.rows;
  assert.equal(b1.state, "AWAITING_APPROVAL");
  assert.equal(b1.providerStatus, null);
  assert.equal(b2.state, "PAID");
  assert.equal(b2.providerStatus, "COMPLETED");
  assert.equal(l.totals.bountyCents, 4000);
  assert.equal(l.totals.paidCents, 4000);
});

test("rows keep stable ids and run in time order", () => {
  const l = ledger({ funding_mode: "HOLD", funding_status: "CAPTURED", paypal_authorization_id: "AUTH1", paypal_order_id: "ORD1", paypal_capture_id: "CAP1", payment_status: "COMPLETED", funding_held_at: "2026-11-01T00:00:00Z", payment_capture_requested_at: "2026-11-03T00:00:00Z" }, {
    bounties: [{ id: "b1", amount_cents: 100, currency: "USD", note: "x", status: "COMPLETED", paypal_order_id: "BO1", paypal_capture_id: "BC1", created_at: "2026-11-02T00:00:00Z", updated_at: "2026-11-02T00:00:00Z" }],
  });
  assert.deepEqual(l.rows.map(r => r.id), ["HOLD:p1", "BOUNTY:b1", "PAYMENT:p1"]);
});

test("refunds recorded on granted appeals: counted once PayPal completes them, and never twice", () => {
  const paid = { paypal_order_id: "ORD1", paypal_capture_id: "CAP1", payment_status: "PARTIALLY_REFUNDED" };
  const appeal = (id, status, refund_status, ref) => ({ id, amount_cents: 3000, status, refund_status, paypal_refund_id: ref, created_at: "2026-11-05T09:00:00Z", resolved_at: "2026-11-05T10:00:00Z" });
  const done = ledger(paid, { appeals: [appeal("a1", "REFUNDED", "COMPLETED", "REF1"), appeal("a2", "DECLINED", null, null), appeal("a3", "REFUNDED", "PENDING", "REF3")] });
  const refunds = done.rows.filter(r => r.kind === "REFUND");
  assert.deepEqual(refunds.map(r => [r.id, r.state, r.providerStatus]), [["REFUND:a1", "REFUNDED", "COMPLETED"], ["REFUND:a3", "PENDING", "PENDING"]]);
  assert.equal(done.totals.refundedCents, 3000);
  const both = ledger(paid, {
    appeals: [appeal("a1", "REFUNDED", "COMPLETED", "REF1")],
    refunds: [{ id: "a1", capture_id: "CAP1", amount_cents: 3000, currency: "USD", status: "COMPLETED", paypal_refund_id: "REF1", started_at: "2026-11-05T09:30:00Z", updated_at: "2026-11-05T10:00:00Z" }],
  });
  assert.equal(both.rows.filter(r => r.kind === "REFUND").length, 1);
  assert.equal(both.totals.refundedCents, 3000);
});

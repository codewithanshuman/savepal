import test from "node:test";
import assert from "node:assert/strict";
import { appealable, bountyAllowed, parseBountyCents, refundableCents, renewWindow } from "../lib/realm-powers.ts";

test("bounties: only after acceptance, within limits", () => {
  assert.equal(bountyAllowed({ status: "INVITED" }), false);
  assert.equal(bountyAllowed({ status: "AGREED" }), true);
  assert.equal(bountyAllowed({ status: "APPROVED" }), true);
  assert.equal(parseBountyCents("25"), 2500);
  assert.equal(parseBountyCents("12.5"), 1250);
  assert.equal(parseBountyCents("0.50"), null);
  assert.equal(parseBountyCents("5000.01"), null);
  assert.equal(parseBountyCents("-3"), null);
  assert.equal(parseBountyCents("1e3"), null);
});

test("appeals: only paid captures, never refunding more than was paid", () => {
  assert.equal(appealable({ payment_status: "COMPLETED", paypal_capture_id: "CAP1" }), true);
  assert.equal(appealable({ payment_status: "REFUNDED", paypal_capture_id: "CAP1" }), false);
  assert.equal(appealable({ payment_status: "COMPLETED", paypal_capture_id: null }), false);
  assert.equal(refundableCents(10000, [{ status: "REFUNDED", amount_cents: 2500 }, { status: "DECLINED", amount_cents: 9000 }, { status: "OPEN", amount_cents: 100 }]), 7500);
  assert.equal(refundableCents(1000, [{ status: "REFUNDED", amount_cents: 1500 }]), 0);
});

test("hold renewal: after the honor period, before expiry, once", () => {
  const held = "2026-11-01T00:00:00.000Z", expires = "2026-11-30T00:00:00.000Z";
  assert.equal(renewWindow(held, expires, false, Date.parse("2026-11-02T00:00:00Z")).allowed, false);
  assert.equal(renewWindow(held, expires, false, Date.parse("2026-11-05T00:00:00Z")).allowed, true);
  assert.equal(renewWindow(held, expires, true, Date.parse("2026-11-05T00:00:00Z")).allowed, false);
  assert.equal(renewWindow(held, expires, false, Date.parse("2026-12-01T00:00:00Z")).allowed, false);
  assert.equal(renewWindow(null, null, false).allowed, false);
  assert.equal(renewWindow(held, expires, false).from, "2026-11-04T00:00:00.000Z");
});

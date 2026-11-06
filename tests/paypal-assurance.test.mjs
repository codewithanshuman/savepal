import assert from "node:assert/strict";
import test from "node:test";
import { PayPalSandbox, captureMatchesOrder, captureStatus, orderCapture, orderMatches, retrySafe, safeProviderId } from "../lib/paypal-assurance.ts";

const expected = {projectId:"project-1",orderId:"ORDER-1",captureId:"CAPTURE-1",customId:"approval-hash",amountCents:1250,currency:"USD"};
const capture = {id:"CAPTURE-1",status:"COMPLETED",amount:{value:"12.50",currency_code:"USD"},supplementary_data:{related_ids:{order_id:"ORDER-1"}}};
const order = {id:"ORDER-1",intent:"CAPTURE",status:"COMPLETED",purchase_units:[{reference_id:"project-1",custom_id:"approval-hash",amount:{value:"12.50",currency_code:"USD"},payments:{captures:[capture]}}]};

test("orders and captures must match the approved project exactly", () => {
  assert.equal(orderMatches(order,expected),true);
  assert.equal(orderCapture(order,expected)?.id,"CAPTURE-1");
  assert.equal(captureMatchesOrder(capture,expected),true);
  assert.equal(captureStatus(capture),"COMPLETED");
  assert.equal(captureStatus({...capture,status:"REFUNDED"}),"REFUNDED");
  assert.throws(() => captureStatus({...capture,status:"UNKNOWN"}),/unsupported/);
  assert.equal(orderMatches({...order,id:"other"},expected),false);
  assert.equal(orderMatches({...order,purchase_units:[...order.purchase_units,...order.purchase_units]},expected),false);
  assert.equal(orderMatches({...order,purchase_units:[{...order.purchase_units[0],custom_id:"other"}]},expected),false);
  assert.equal(orderMatches({...order,purchase_units:[{...order.purchase_units[0],amount:{value:"12.51",currency_code:"USD"}}]},expected),false);
  assert.equal(orderCapture({...order,purchase_units:[{...order.purchase_units[0],payments:{captures:[capture,capture]}}]},expected),null);
  assert.equal(captureMatchesOrder({...capture,supplementary_data:{related_ids:{order_id:"OTHER"}}},expected),false);
});

test("provider IDs and retry windows are bounded", () => {
  assert.equal(safeProviderId("ORDER-1"),true);
  assert.equal(safeProviderId("../order"),false);
  assert.equal(safeProviderId("a".repeat(81)),false);
  const now = Date.parse("2026-11-06T12:00:00.000Z");
  assert.equal(retrySafe("2026-11-06T08:00:00.000Z",now),true);
  assert.equal(retrySafe("2026-11-06T06:00:00.000Z",now),false);
  assert.equal(retrySafe(null,now),false);
});

test("PayPal client sends stable idempotency keys and reads provider state", async () => {
  const calls = [];
  const fetcher = async (url,options) => {
    calls.push({url,options});
    if (url.endsWith("/oauth2/token")) return Response.json({access_token:"sandbox-token"});
    if (url.endsWith("/verify-webhook-signature")) return Response.json({verification_status:"SUCCESS"});
    if (url.endsWith("/capture") || url.endsWith("/orders/ORDER-1") || url.endsWith("/orders")) return Response.json(order);
    if (url.endsWith("/captures/CAPTURE-1")) return Response.json(capture);
    return new Response("missing",{status:404});
  };
  const client = new PayPalSandbox("client","secret",fetcher);
  await client.createOrder(expected,"request-1");
  await client.getOrder("ORDER-1");
  await client.captureOrder("ORDER-1","request-2");
  await client.getCapture("CAPTURE-1");
  const headers = new Headers({"paypal-transmission-id":"tx","paypal-transmission-time":"2026-11-06T00:00:00Z","paypal-cert-url":"https://api.sandbox.paypal.com/cert","paypal-auth-algo":"SHA256withRSA","paypal-transmission-sig":"sig"});
  assert.equal(await client.verifyWebhook(headers,{id:"event"},"webhook-id"),true);
  assert.equal(calls.filter(call => call.url.endsWith("/oauth2/token")).length,1);
  assert.deepEqual(calls.filter(call => call.url.endsWith("/capture") || call.url.endsWith("/orders")).map(call => call.options.headers["PayPal-Request-Id"]),["request-1","request-2"]);
  assert.equal(JSON.parse(calls.find(call => call.url.endsWith("/orders")).options.body).purchase_units[0].custom_id,"approval-hash");
});

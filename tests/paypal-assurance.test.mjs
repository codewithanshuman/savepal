import assert from "node:assert/strict";
import test from "node:test";
import { PayPalSandbox, captureMatchesOrder, captureStatus, orderCapture, orderMatches, referralActionUrl, referralId, retrySafe, safeProviderId, sellerIntegrationReady } from "../lib/paypal-assurance.ts";

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
  const directed = {...expected,merchantId:"CG5RZJV4NR5P4"};
  const directedCapture = {...capture,payee:{merchant_id:directed.merchantId}};
  const directedOrder = {...order,purchase_units:[{...order.purchase_units[0],payee:{merchant_id:directed.merchantId},payments:{captures:[directedCapture]}}]};
  assert.equal(orderMatches(directedOrder,directed),true);
  assert.equal(orderMatches(order,directed),false);
  assert.equal(captureMatchesOrder(directedCapture,directed),true);
  assert.equal(captureMatchesOrder(capture,directed),false);
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

test("seller onboarding requires PayPal-confirmed recipient and third-party permission", async () => {
  const merchantId = "CG5RZJV4NR5P4";
  const status = { merchant_id: merchantId, tracking_id: "tracking-1", payments_receivable: true,
    primary_email_confirmed: true, oauth_integrations: [{ oauth_third_party: [{ partner_client_id: "platform-client",
      scopes: ["https://uri.paypal.com/services/payments/realtimepayment"] }] }] };
  assert.equal(sellerIntegrationReady(status,"tracking-1","platform-client",merchantId),true);
  assert.equal(sellerIntegrationReady({...status,payments_receivable:false},"tracking-1","platform-client",merchantId),false);
  assert.equal(sellerIntegrationReady({...status,tracking_id:"other"},"tracking-1","platform-client",merchantId),false);
  assert.equal(sellerIntegrationReady({...status,oauth_integrations:[]},"tracking-1","platform-client",merchantId),false);
  const referral = { links: [
    {rel:"self",href:"https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/abc123=="},
    {rel:"action_url",href:"https://www.sandbox.paypal.com/us/merchantsignup/partner/onboardingentry?token=abc123"},
  ] };
  assert.equal(referralId(referral),"abc123==");
  assert.match(referralActionUrl(referral),/^https:\/\/www\.sandbox\.paypal\.com\//);
  assert.equal(referralActionUrl({links:[{rel:"action_url",href:"https://evil.example/"}]}),null);
  const calls = [];
  const client = new PayPalSandbox("platform-client","secret",async (url,options) => {
    calls.push({url,options});
    if (url.endsWith("/oauth2/token")) return Response.json({access_token:"token"});
    if (url.endsWith("/partner-referrals")) return Response.json(referral);
    if (url.includes("/merchant-integrations/")) return Response.json(status);
    return new Response("missing",{status:404});
  },{clientId:"platform-client",attributionId:"BN-CODE",merchantId:"PARTNER123456"});
  await client.createSellerReferral("tracking-1","https://savepal.example/api/p/return","worker@example.com");
  await client.getSellerIntegration("PARTNER123456",merchantId);
  const referralCall = calls.find(call => call.url.endsWith("/partner-referrals"));
  assert.equal(referralCall.options.headers["PayPal-Request-Id"],"tracking-1");
  assert.equal(referralCall.options.headers["PayPal-Partner-Attribution-Id"],"BN-CODE");
  assert.match(referralCall.options.headers["PayPal-Auth-Assertion"],/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.$/);
});

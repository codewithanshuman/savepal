import { env } from "cloudflare:workers";
import { requireApprovalReceipt, type StoredApprovalProject } from "../../../../lib/approval-store";
import { orderCustomId } from "../../../../lib/approval-receipt";
import { recordCaptureObservation, type PaymentProject } from "../../../../lib/payment-store";
import { PayPalSandbox, orderMatches, safeMerchantId, safeProviderId } from "../../../../lib/paypal-assurance";

export const runtime = "edge";
const cfg = env as Cloudflare.Env & { PAYPAL_CLIENT_ID?: string; PAYPAL_CLIENT_SECRET?: string; PAYPAL_WEBHOOK_ID?: string; PAYPAL_PARTNER_MERCHANT_ID?: string; PAYPAL_PARTNER_BN_CODE?: string; AUDIT_HMAC_KEY?: string };
type WebhookEvent = { id?: string; event_type?: string; resource?: { id?: string; supplementary_data?: { related_ids?: { order_id?: string } } } };
type WebhookProject = StoredApprovalProject & PaymentProject;
const acceptedEvents = new Set([
  "PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.PENDING", "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.DECLINED", "PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.PARTIALLY_REFUNDED",
]);

export async function POST(request: Request) {
  if (!env.DB || !cfg.PAYPAL_CLIENT_ID || !cfg.PAYPAL_CLIENT_SECRET || !cfg.PAYPAL_WEBHOOK_ID)
    return Response.json({ error: "Webhook is not configured" }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 100_000) return Response.json({ error: "Event is too large" }, { status: 413 });
  let body: WebhookEvent;
  try { body = JSON.parse(raw) as WebhookEvent; }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!safeProviderId(body.id) || !body.event_type || !safeProviderId(body.resource?.id))
    return Response.json({ error: "Invalid event" }, { status: 400 });
  const partner = cfg.PAYPAL_PARTNER_MERCHANT_ID && cfg.PAYPAL_PARTNER_BN_CODE ? {
    clientId: cfg.PAYPAL_CLIENT_ID, attributionId: cfg.PAYPAL_PARTNER_BN_CODE, merchantId: cfg.PAYPAL_PARTNER_MERCHANT_ID,
  } : undefined;
  const client = new PayPalSandbox(cfg.PAYPAL_CLIENT_ID,cfg.PAYPAL_CLIENT_SECRET,fetch,partner);
  try {
    if (!await client.verifyWebhook(request.headers,body,cfg.PAYPAL_WEBHOOK_ID))
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    if (!acceptedEvents.has(body.event_type)) return Response.json({ ok: true, ignored: true });
    // Match the signed event to the local order before making a seller-scoped lookup.
    const relatedOrder = body.resource.supplementary_data?.related_ids?.order_id;
    const match = await env.DB.prepare("SELECT * FROM projects WHERE paypal_capture_id=? OR paypal_order_id=? LIMIT 1")
      .bind(body.resource.id,relatedOrder || "").first<WebhookProject>();
    if (!match) return Response.json({ ok: true, ignored: true });
    if (!match.paypal_order_id || !safeMerchantId(match.payment_recipient_merchant_id)) throw new Error("Milestone has no bound PayPal recipient and order");
    const merchantId = match.payment_recipient_merchant_id;
    const capture = await client.getCapture(body.resource.id,merchantId);
    if (capture.id !== body.resource.id) throw new Error("PayPal returned a different capture");
    const receipt = await requireApprovalReceipt(env.DB,match,cfg.AUDIT_HMAC_KEY);
    const order = await client.getOrder(match.paypal_order_id,merchantId);
    if (!orderMatches(order,{
      projectId: match.id, orderId: match.paypal_order_id, customId: orderCustomId(receipt),
      amountCents: match.amount_cents, currency: match.currency, merchantId,
    })) throw new Error("PayPal order does not match approval");
    const observation = await recordCaptureObservation(
      env.DB,match,order,capture,orderCustomId(receipt),"WEBHOOK",body.id,cfg.AUDIT_HMAC_KEY,body,
    );
    await env.DB.prepare("INSERT OR IGNORE INTO paypal_events (id,project_id,event_type,received_at) VALUES (?,?,?,?)")
      .bind(body.id,match.id,body.event_type,new Date().toISOString()).run();
    return Response.json({ ok: true, status: observation.status });
  } catch {
    return Response.json({ error: "Temporary webhook failure" }, { status: 502 });
  }
}

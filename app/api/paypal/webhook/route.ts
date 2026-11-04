import { env } from "cloudflare:workers";

export const runtime = "edge";
const cfg = env as Cloudflare.Env & { PAYPAL_CLIENT_ID?: string; PAYPAL_CLIENT_SECRET?: string; PAYPAL_WEBHOOK_ID?: string };

export async function POST(request: Request) {
  if (!env.DB || !cfg.PAYPAL_CLIENT_ID || !cfg.PAYPAL_CLIENT_SECRET || !cfg.PAYPAL_WEBHOOK_ID) return Response.json({ error: "Webhook is not configured" }, { status: 503 });
  const headers = request.headers;
  const transmissionId = headers.get("paypal-transmission-id");
  const transmissionTime = headers.get("paypal-transmission-time");
  const certUrl = headers.get("paypal-cert-url");
  const authAlgo = headers.get("paypal-auth-algo");
  const transmissionSig = headers.get("paypal-transmission-sig");
  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) return Response.json({ error: "Missing PayPal headers" }, { status: 400 });
  let body: { id?: string; event_type?: string; resource?: { id?: string } };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id || !body.event_type || !body.resource?.id) return Response.json({ error: "Invalid event" }, { status: 400 });
  try {
    const auth = btoa(`${cfg.PAYPAL_CLIENT_ID}:${cfg.PAYPAL_CLIENT_SECRET}`);
    const tokenRes = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
    if (!tokenRes.ok) throw new Error("PayPal authentication failed");
    const token = ((await tokenRes.json()) as { access_token: string }).access_token;
    const verification = await fetch("https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ transmission_id: transmissionId, transmission_time: transmissionTime, cert_url: certUrl, auth_algo: authAlgo, transmission_sig: transmissionSig, webhook_id: cfg.PAYPAL_WEBHOOK_ID, webhook_event: body }),
    });
    if (!verification.ok || ((await verification.json()) as { verification_status: string }).verification_status !== "SUCCESS") return Response.json({ error: "Invalid signature" }, { status: 401 });
    const match = await env.DB.prepare("SELECT id, payment_status FROM projects WHERE paypal_capture_id = ?").bind(body.resource.id).first<{ id: string; payment_status: string }>();
    if (!match) return Response.json({ ok: true, ignored: true });
    const inserted = await env.DB.prepare("INSERT OR IGNORE INTO paypal_events (id, project_id, event_type, received_at) VALUES (?, ?, ?, ?)").bind(body.id,match.id,body.event_type,new Date().toISOString()).run();
    if (!inserted.meta.changes) return Response.json({ ok: true, duplicate: true });
    const newStatus: Record<string,string> = { "PAYMENT.CAPTURE.COMPLETED": "COMPLETED", "PAYMENT.CAPTURE.PENDING": "PENDING", "PAYMENT.CAPTURE.DENIED": "FAILED" };
    const status = newStatus[body.event_type];
    if (status && match.payment_status !== "COMPLETED") {
      await env.DB.prepare("UPDATE projects SET payment_status=?,updated_at=? WHERE id=?").bind(status,new Date().toISOString(),match.id).run();
      await env.DB.prepare("INSERT INTO audit_events (project_id, actor, type, detail, created_at) VALUES (?, ?, ?, ?, ?)").bind(match.id,"PayPal",body.event_type,`Verified sandbox event ${body.id}`,new Date().toISOString()).run();
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Temporary webhook failure" }, { status: 502 });
  }
}

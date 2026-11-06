import { env } from "cloudflare:workers";
import { reconcileProject, type ReconcileProject } from "../../../lib/payment-reconciliation";
import { PayPalSandbox } from "../../../lib/paypal-assurance";

export const runtime = "edge";
const cfg = env as Cloudflare.Env & {
  PAYPAL_CLIENT_ID?: string; PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_PARTNER_MERCHANT_ID?: string; PAYPAL_PARTNER_BN_CODE?: string;
  RECONCILIATION_TOKEN?: string; AUDIT_HMAC_KEY?: string;
};

async function authorized(request: Request, secret: string): Promise<boolean> {
  const submitted = request.headers.get("authorization")?.replace(/^Bearer\s+/i,"") || "";
  if (secret.length < 32 || submitted.length !== secret.length) return false;
  const [actual,expected] = await Promise.all([
    crypto.subtle.digest("SHA-256",new TextEncoder().encode(submitted)),
    crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret)),
  ]);
  let difference = 0;
  const a = new Uint8Array(actual), b = new Uint8Array(expected);
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function POST(request: Request) {
  if (!env.DB || !cfg.PAYPAL_CLIENT_ID || !cfg.PAYPAL_CLIENT_SECRET || !cfg.RECONCILIATION_TOKEN)
    return Response.json({ error: "Payment reconciliation is not configured" },{ status: 503 });
  if (!await authorized(request,cfg.RECONCILIATION_TOKEN))
    return Response.json({ error: "Unauthorized" },{ status: 401 });
  const partner = cfg.PAYPAL_PARTNER_MERCHANT_ID && cfg.PAYPAL_PARTNER_BN_CODE ? {
    clientId: cfg.PAYPAL_CLIENT_ID, attributionId: cfg.PAYPAL_PARTNER_BN_CODE, merchantId: cfg.PAYPAL_PARTNER_MERCHANT_ID,
  } : undefined;
  const client = new PayPalSandbox(cfg.PAYPAL_CLIENT_ID,cfg.PAYPAL_CLIENT_SECRET,fetch,partner);
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  const projects = await env.DB.prepare(`SELECT * FROM projects WHERE status='APPROVED'
    AND payment_recipient_merchant_id IS NOT NULL
    AND (paypal_order_id IS NOT NULL OR payment_request_id IS NOT NULL)
    AND (payment_last_reconciled_at IS NULL OR payment_last_reconciled_at<?)
    ORDER BY COALESCE(payment_last_reconciled_at,'') ASC, updated_at ASC LIMIT 5`)
    .bind(staleBefore).all<ReconcileProject>();
  const results = [];
  for (const project of projects.results) {
    results.push(await reconcileProject(env.DB,project,client,cfg.AUDIT_HMAC_KEY));
  }
  const failures = results.filter(result => result.outcome === "ERROR" || result.outcome.endsWith("REVIEW_REQUIRED")).length;
  return Response.json({ checked: results.length, failures, results },{
    status: failures ? 502 : 200, headers: { "Cache-Control": "no-store" },
  });
}

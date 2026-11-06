import { env } from "cloudflare:workers";
import { chatGPTSignInPath, getChatGPTUser } from "../../../chatgpt-auth";
import { completeSellerOnboarding } from "../../../../lib/seller-onboarding";
import { PayPalSandbox } from "../../../../lib/paypal-assurance";

export const runtime = "edge";
const cfg = env as Cloudflare.Env & {
  PAYPAL_CLIENT_ID?: string; PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_PARTNER_MERCHANT_ID?: string; PAYPAL_PARTNER_BN_CODE?: string;
  AUDIT_HMAC_KEY?: string;
};

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  const url = new URL(request.url);
  if (!user) return Response.redirect(new URL(chatGPTSignInPath(url.pathname + url.search),url),302);
  if (!env.DB || !cfg.PAYPAL_CLIENT_ID || !cfg.PAYPAL_CLIENT_SECRET ||
      !cfg.PAYPAL_PARTNER_MERCHANT_ID || !cfg.PAYPAL_PARTNER_BN_CODE)
    return Response.json({ error: "Seller onboarding is not configured" },{ status: 503 });
  const trackingId = url.searchParams.get("merchantId");
  const merchantId = url.searchParams.get("merchantIdInPayPal");
  if (!trackingId || !merchantId) return Response.json({ error: "PayPal did not provide seller identifiers" },{ status: 400 });
  try {
    const paypal = new PayPalSandbox(cfg.PAYPAL_CLIENT_ID,cfg.PAYPAL_CLIENT_SECRET,fetch,{
      clientId: cfg.PAYPAL_CLIENT_ID, attributionId: cfg.PAYPAL_PARTNER_BN_CODE, merchantId: cfg.PAYPAL_PARTNER_MERCHANT_ID,
    });
    const result = await completeSellerOnboarding(env.DB,trackingId,merchantId,user.email,paypal,
      cfg.PAYPAL_PARTNER_MERCHANT_ID,cfg.PAYPAL_CLIENT_ID,cfg.AUDIT_HMAC_KEY);
    const destination = new URL("/app",url);
    destination.searchParams.set("project",result.projectId);
    destination.searchParams.set("paypal","connected");
    return Response.redirect(destination,302);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Seller verification failed" },
      { status: 409, headers: { "Cache-Control": "no-store" } });
  }
}

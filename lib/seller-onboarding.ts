import { appendAudit } from "./audit.ts";
import { PayPalSandbox, referralActionUrl, referralId, sellerIntegrationReady, safeMerchantId } from "./paypal-assurance.ts";

export type SellerProject = {
  id: string; freelancer_email: string; status: string;
  paypal_order_id: string | null; seller_merchant_id: string | null;
};
type Onboarding = {
  id: string; project_id: string; freelancer_email: string; tracking_id: string;
  referral_id: string | null; merchant_id: string | null; status: string;
};

export async function beginSellerOnboarding(
  db: D1Database, project: SellerProject, actorEmail: string, client: PayPalSandbox,
  returnUrl: string, partnerMerchantId: string, partnerClientId: string, auditSecret?: string,
): Promise<{ actionUrl?: string; trackingId: string; connected?: boolean }> {
  if (project.freelancer_email.toLowerCase() !== actorEmail.toLowerCase() || project.paypal_order_id)
    throw new Error("Only the assigned freelancer can connect a recipient before checkout");
  const latest = await db.prepare("SELECT * FROM seller_onboarding WHERE project_id=? ORDER BY created_at DESC LIMIT 1")
    .bind(project.id).first<Onboarding>();
  if (latest?.status === "VERIFIED") {
    if (!safeMerchantId(latest.merchant_id) || latest.freelancer_email.toLowerCase() !== actorEmail.toLowerCase() ||
        (project.seller_merchant_id && project.seller_merchant_id !== latest.merchant_id))
      throw new Error("Verified PayPal recipient does not match this agreement");
    const integration = await client.getSellerIntegration(partnerMerchantId,latest.merchant_id);
    if (!sellerIntegrationReady(integration,latest.tracking_id,partnerClientId,latest.merchant_id))
      throw new Error("PayPal no longer confirms seller permissions");
    if (!project.seller_merchant_id) {
      const repaired = await db.prepare("UPDATE projects SET seller_merchant_id=?,seller_verified_at=?,updated_at=? WHERE id=? AND seller_merchant_id IS NULL AND paypal_order_id IS NULL AND lower(freelancer_email)=?")
        .bind(latest.merchant_id,new Date().toISOString(),new Date().toISOString(),project.id,actorEmail.toLowerCase()).run();
      if (!repaired.meta.changes) throw new Error("Seller connection changed during recovery");
      await appendAudit(db,project.id,actorEmail,"SELLER_ONBOARDING_RECOVERED",`PayPal merchant ${latest.merchant_id}; tracking ${latest.tracking_id}`,auditSecret);
    }
    return { trackingId: latest.tracking_id, connected: true };
  }
  const trackingId = latest?.status === "PENDING" ? latest.tracking_id : crypto.randomUUID();
  const recordId = latest?.status === "PENDING" ? latest.id : crypto.randomUUID();
  if (!latest || latest.status !== "PENDING") {
    await db.prepare("INSERT INTO seller_onboarding (id,project_id,freelancer_email,tracking_id,status,created_at) VALUES (?,?,?,?,'PENDING',?)")
      .bind(recordId,project.id,actorEmail.toLowerCase(),trackingId,new Date().toISOString()).run();
  }
  let referral;
  if (latest?.status === "PENDING" && latest.referral_id) {
    referral = await client.getSellerReferral(latest.referral_id);
  } else {
    referral = await client.createSellerReferral(trackingId,returnUrl,actorEmail);
  }
  const id = referralId(referral);
  const actionUrl = referralActionUrl(referral);
  if (!id || !actionUrl) throw new Error("PayPal did not return a valid onboarding link");
  await db.prepare("UPDATE seller_onboarding SET referral_id=? WHERE id=? AND status='PENDING' AND (referral_id IS NULL OR referral_id=?)")
    .bind(id,recordId,id).run();
  await appendAudit(db,project.id,actorEmail,"SELLER_ONBOARDING_STARTED",`Tracking ${trackingId}; referral ${id}`,auditSecret);
  return { actionUrl, trackingId };
}

export async function completeSellerOnboarding(
  db: D1Database, trackingId: string, merchantId: string, actorEmail: string,
  client: PayPalSandbox, partnerMerchantId: string, partnerClientId: string, auditSecret?: string,
): Promise<{ projectId: string; merchantId: string }> {
  if (!safeMerchantId(merchantId)) throw new Error("Invalid PayPal merchant ID");
  const record = await db.prepare("SELECT * FROM seller_onboarding WHERE tracking_id=?")
    .bind(trackingId).first<Onboarding>();
  if (!record || record.freelancer_email.toLowerCase() !== actorEmail.toLowerCase())
    throw new Error("Onboarding request does not belong to this freelancer");
  const integration = await client.getSellerIntegration(partnerMerchantId,merchantId);
  if (!sellerIntegrationReady(integration,trackingId,partnerClientId,merchantId))
    throw new Error("PayPal has not confirmed seller permissions and payment readiness");
  const time = new Date().toISOString();
  const changes = await db.batch([
    db.prepare("UPDATE seller_onboarding SET merchant_id=?,status='VERIFIED',verified_at=?,last_checked_at=? WHERE id=? AND status IN ('PENDING','VERIFIED') AND (merchant_id IS NULL OR merchant_id=?)")
      .bind(merchantId,time,time,record.id,merchantId),
    db.prepare("UPDATE projects SET seller_merchant_id=?,seller_verified_at=?,updated_at=? WHERE id=? AND lower(freelancer_email)=? AND paypal_order_id IS NULL AND (seller_merchant_id IS NULL OR seller_merchant_id=?)")
      .bind(merchantId,time,time,record.project_id,actorEmail.toLowerCase(),merchantId),
  ]);
  if (!changes[0].meta.changes || !changes[1].meta.changes) throw new Error("Seller connection changed during verification");
  await appendAudit(db,record.project_id,actorEmail,"SELLER_ONBOARDING_VERIFIED",`PayPal merchant ${merchantId}; tracking ${trackingId}; receivable and permissions verified`,auditSecret);
  return { projectId: record.project_id, merchantId };
}

export async function requireReadySeller(
  db: D1Database, project: SellerProject, client: PayPalSandbox,
  partnerMerchantId: string, partnerClientId: string,
): Promise<string> {
  if (!project.seller_merchant_id) throw new Error("The assigned freelancer must connect a PayPal seller account");
  const record = await db.prepare("SELECT * FROM seller_onboarding WHERE project_id=? AND merchant_id=? AND status='VERIFIED' ORDER BY verified_at DESC LIMIT 1")
    .bind(project.id,project.seller_merchant_id).first<Onboarding>();
  if (!record || record.freelancer_email.toLowerCase() !== project.freelancer_email.toLowerCase())
    throw new Error("The PayPal seller connection does not match this agreement");
  const integration = await client.getSellerIntegration(partnerMerchantId,project.seller_merchant_id);
  if (!sellerIntegrationReady(integration,record.tracking_id,partnerClientId,project.seller_merchant_id))
    throw new Error("The freelancer's PayPal account is no longer ready to receive payments");
  return project.seller_merchant_id;
}

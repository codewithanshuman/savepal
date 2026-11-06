import { requireApprovalReceipt, type StoredApprovalProject } from "./approval-store.ts";
import { orderCustomId } from "./approval-receipt.ts";
import { recordCaptureObservation, type PaymentProject } from "./payment-store.ts";
import { PayPalSandbox, orderCapture, orderMatches, retrySafe, safeMerchantId, safeProviderId, type ExpectedPayment } from "./paypal-assurance.ts";

export type ReconcileProject = StoredApprovalProject & PaymentProject & {
  payment_request_id: string | null; payment_order_requested_at: string | null;
  payment_capture_request_id: string | null; payment_capture_requested_at: string | null;
};
export type ReconciliationResult = { projectId: string; outcome: string; paymentStatus: string | null; captureId: string | null };

export async function reconcileProject(
  db: D1Database, project: ReconcileProject, client: PayPalSandbox,
  auditSecret?: string, source: "MANUAL" | "SCHEDULED" = "SCHEDULED",
): Promise<ReconciliationResult> {
  const time = new Date().toISOString();
  let outcome = "ERROR", detail = "Provider reconciliation failed";
  let paymentStatus: string | null = null, captureId: string | null = null;
  try {
    if (project.status !== "APPROVED") throw new Error("Milestone is not approved");
    if (!safeMerchantId(project.payment_recipient_merchant_id))
      throw new Error("Payment recipient is not bound to this milestone");
    const receipt = await requireApprovalReceipt(db,project,auditSecret);
    const expected: ExpectedPayment = {
      projectId: project.id, orderId: project.paypal_order_id || undefined,
      captureId: project.paypal_capture_id || undefined, customId: orderCustomId(receipt),
      amountCents: project.amount_cents, currency: project.currency,
      merchantId: project.payment_recipient_merchant_id,
    };
    let orderId = project.paypal_order_id;
    if (!orderId) {
      if (!project.payment_request_id || !retrySafe(project.payment_order_requested_at)) {
        outcome = "ORDER_REVIEW_REQUIRED";
        detail = "An order ID is missing and the safe request retry window has ended";
      } else {
        const recovered = await client.createOrder(expected,project.payment_request_id);
        if (!safeProviderId(recovered.id)) throw new Error("PayPal returned an invalid order ID");
        const stored = await db.prepare("UPDATE projects SET paypal_order_id=?,updated_at=? WHERE id=? AND paypal_order_id IS NULL AND payment_request_id=? AND payment_recipient_merchant_id=?")
          .bind(recovered.id,time,project.id,project.payment_request_id,expected.merchantId).run();
        const current = await db.prepare("SELECT paypal_order_id FROM projects WHERE id=?").bind(project.id).first<{ paypal_order_id: string | null }>();
        if (!stored.meta.changes && current?.paypal_order_id !== recovered.id) throw new Error("Recovered PayPal order conflicts with local state");
        orderId = recovered.id;
      }
    }
    if (orderId) {
      const order = await client.getOrder(orderId,expected.merchantId);
      if (!orderMatches(order,{...expected,orderId})) throw new Error("Provider order does not match the approved recipient and amount");
      const providerCaptures = order.purchase_units?.[0]?.payments?.captures || [];
      let capture = orderCapture(order,{...expected,orderId});
      if (providerCaptures.length && !capture) throw new Error("Provider order has a conflicting capture");
      if (!capture && project.payment_capture_request_id) {
        if (!retrySafe(project.payment_capture_requested_at)) {
          outcome = "CAPTURE_REVIEW_REQUIRED";
          detail = "Capture request has no confirmed result beyond the safe retry window";
        } else {
          await client.captureOrder(orderId,project.payment_capture_request_id,expected.merchantId);
          const refreshed = await client.getOrder(orderId,expected.merchantId);
          if (!orderMatches(refreshed,{...expected,orderId})) throw new Error("Provider order changed during capture recovery");
          capture = orderCapture(refreshed,{...expected,orderId});
          if (!capture) throw new Error("PayPal capture is not yet visible after retry");
        }
      }
      if (capture) {
        const confirmedOrder = await client.getOrder(orderId,expected.merchantId);
        const confirmedCapture = await client.getCapture(capture.id!,expected.merchantId);
        const observation = await recordCaptureObservation(db,
          {...project,paypal_order_id:orderId},confirmedOrder,confirmedCapture,expected.customId,"RECOVERY",undefined,auditSecret);
        outcome = "CAPTURE_CONFIRMED";
        detail = `Capture ${observation.captureId}; provider status ${confirmedCapture.status}; local status ${observation.status}`;
        paymentStatus = observation.status;
        captureId = observation.captureId;
      } else if (outcome === "ERROR") {
        outcome = "AWAITING_BUYER";
        detail = `Order ${orderId} has no capture`;
      }
    }
  } catch (error) {
    detail = error instanceof Error ? error.message.slice(0,500) : "Provider reconciliation failed";
    outcome = "ERROR";
  }
  await db.batch([
    db.prepare("INSERT INTO reconciliation_attempts (id,project_id,source,outcome,detail,attempted_at) VALUES (?,?,?,?,?,?)")
      .bind(crypto.randomUUID(),project.id,source,outcome,detail,time),
    db.prepare("UPDATE projects SET payment_last_reconciled_at=? WHERE id=?")
      .bind(time,project.id),
  ]);
  return { projectId: project.id, outcome, paymentStatus, captureId };
}

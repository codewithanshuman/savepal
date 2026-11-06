import { canApplyPaymentStatus, type PaymentStatus } from "./assurance.ts";
import { appendAudit } from "./audit.ts";
import { captureMatchesOrder, captureStatus, orderCapture, safeMerchantId, safeProviderId, type PayPalCapture, type PayPalOrder } from "./paypal-assurance.ts";
import { sha256 } from "./website-evidence.ts";

export type PaymentProject = {
  id: string; status: string; amount_cents: number; currency: string;
  paypal_order_id: string | null; paypal_capture_id: string | null;
  payment_recipient_merchant_id?: string | null;
  payment_status: string;
};

export type ObservationSource = "CAPTURE" | "SYNC" | "WEBHOOK" | "RECOVERY";

export function nextPaymentStatus(current: string, incoming: PaymentStatus): string {
  return canApplyPaymentStatus(current,incoming) ? incoming : current;
}

async function recoverObservationAudit(db: D1Database, projectId: string, secret?: string): Promise<void> {
  const missing = await db.prepare(`SELECT o.id,o.source,o.order_id,o.capture_id,o.provider_status,o.projected_status,o.payload_hash
    FROM payment_observations o WHERE o.project_id=? AND NOT EXISTS
      (SELECT 1 FROM audit_events a WHERE a.project_id=o.project_id AND a.type='PAYPAL_CAPTURE_OBSERVED'
       AND instr(a.detail,o.id)>0)
    ORDER BY o.observed_at ASC LIMIT 30`).bind(projectId).all<{
      id: string; source: ObservationSource; order_id: string; capture_id: string;
      provider_status: string; projected_status: string; payload_hash: string;
    }>();
  for (const row of missing.results) {
    await appendAudit(db,projectId,row.source === "WEBHOOK" ? "PayPal" : "PayPal reconciliation",
      "PAYPAL_CAPTURE_OBSERVED",`${row.source} capture ${row.capture_id}; order ${row.order_id}; provider ${row.provider_status}; projected ${row.projected_status}; observation ${row.id}; payload ${row.payload_hash}`,secret);
  }
}

export async function recordCaptureObservation(
  db: D1Database, project: PaymentProject, order: PayPalOrder, capture: PayPalCapture,
  customId: string, source: ObservationSource, providerEventId?: string,
  auditSecret?: string, payload?: unknown,
): Promise<{ status: string; captureId: string; changed: boolean }> {
  const orderId = project.paypal_order_id;
  const captureId = capture.id;
  if (project.status !== "APPROVED" || !orderId || !safeProviderId(orderId) ||
      !safeMerchantId(project.payment_recipient_merchant_id) ||
      !safeProviderId(captureId) ||
      !captureMatchesOrder(capture,{
        projectId: project.id, orderId, captureId,
        customId, amountCents: project.amount_cents, currency: project.currency,
        merchantId: project.payment_recipient_merchant_id || undefined,
      }) || orderCapture(order,{
        projectId: project.id, orderId, captureId,
        customId, amountCents: project.amount_cents, currency: project.currency,
        merchantId: project.payment_recipient_merchant_id || undefined,
      })?.id !== captureId) throw new Error("PayPal capture does not match the approved milestone");
  if (project.paypal_capture_id && project.paypal_capture_id !== captureId) throw new Error("Conflicting PayPal capture ID");
  const incoming = captureStatus(capture);
  const payloadHash = await sha256(JSON.stringify(payload ?? capture));
  const observationId = providerEventId ? `webhook:${providerEventId}` : crypto.randomUUID();
  if (providerEventId) {
    const previous = await db.prepare("SELECT payload_hash,project_id,capture_id FROM payment_observations WHERE provider_event_id=?")
      .bind(providerEventId).first<{ payload_hash: string; project_id: string; capture_id: string }>();
    if (previous && (previous.payload_hash !== payloadHash || previous.project_id !== project.id || previous.capture_id !== captureId)) throw new Error("Conflicting PayPal webhook replay");
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await db.prepare("SELECT id,status,amount_cents,currency,paypal_order_id,paypal_capture_id,payment_status,payment_recipient_merchant_id FROM projects WHERE id=?")
      .bind(project.id).first<PaymentProject>();
    if (!current || current.status !== "APPROVED" || current.paypal_order_id !== orderId ||
        current.amount_cents !== project.amount_cents || current.currency !== project.currency ||
        (current.payment_recipient_merchant_id || null) !== (project.payment_recipient_merchant_id || null) ||
        (current.paypal_capture_id && current.paypal_capture_id !== captureId)) throw new Error("Milestone changed during payment reconciliation");
    const next = nextPaymentStatus(current.payment_status,incoming);
    const time = new Date().toISOString();
    const results = await db.batch([
      db.prepare("INSERT OR IGNORE INTO payment_observations (id,project_id,source,provider_event_id,order_id,capture_id,provider_status,projected_status,amount_cents,currency,payload_hash,observed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(observationId,project.id,source,providerEventId || null,orderId,captureId,capture.status || "UNKNOWN",next,project.amount_cents,project.currency,payloadHash,time),
      db.prepare("UPDATE projects SET paypal_capture_id=COALESCE(paypal_capture_id,?),payment_status=?,updated_at=? WHERE id=? AND status='APPROVED' AND paypal_order_id=? AND payment_status=? AND (paypal_capture_id IS NULL OR paypal_capture_id=?) AND EXISTS (SELECT 1 FROM payment_observations WHERE id=? AND payload_hash=? AND project_id=? AND capture_id=?)")
        .bind(captureId,next,time,project.id,orderId,current.payment_status,captureId,observationId,payloadHash,project.id,captureId),
    ]);
    if (providerEventId) {
      const recorded = await db.prepare("SELECT payload_hash,project_id,capture_id FROM payment_observations WHERE provider_event_id=?")
        .bind(providerEventId).first<{ payload_hash: string; project_id: string; capture_id: string }>();
      if (!recorded || recorded.payload_hash !== payloadHash || recorded.project_id !== project.id || recorded.capture_id !== captureId)
        throw new Error("Conflicting PayPal webhook replay");
    }
    if (!results[1].meta.changes) continue;
    const changed = current.payment_status !== next || current.paypal_capture_id !== captureId;
    await recoverObservationAudit(db,project.id,auditSecret);
    return { status: next, captureId, changed };
  }
  throw new Error("Concurrent payment update; retry reconciliation");
}

import { appendAudit, verifyAudit } from "./audit.ts";
import {
  approvalContextMatches, createApprovalReceipt, verifyApprovalReceipt,
  type ApprovalProject, type ApprovalReceipt, type ApprovalRun, type ApprovalSubmission,
} from "./approval-receipt.ts";

export type StoredApprovalProject = ApprovalProject & { approval_receipt_id: string | null; decision_reason: string | null };

async function context(db: D1Database, project: StoredApprovalProject) {
  const run = project.latest_run_id ? await db.prepare("SELECT id,project_id,evidence_hash,submission_id,snapshot_hash,findings_json,state FROM verification_runs WHERE id=? AND project_id=?")
    .bind(project.latest_run_id,project.id).first<ApprovalRun>() : null;
  const submission = project.current_submission_id ? await db.prepare("SELECT id,project_id,submission_hash,snapshot_hash FROM evidence_submissions WHERE id=? AND project_id=?")
    .bind(project.current_submission_id,project.id).first<ApprovalSubmission>() : null;
  return { run, submission };
}

const columns = "id,project_id,source,agreement_hash,submission_id,submission_hash,snapshot_hash,verification_run_id,findings_hash,amount_cents,currency,approved_by,reason,approved_at,previous_audit_hash,receipt_hash";
function values(receipt: ApprovalReceipt) {
  return [receipt.id,receipt.project_id,receipt.source,receipt.agreement_hash,receipt.submission_id,receipt.submission_hash,
    receipt.snapshot_hash,receipt.verification_run_id,receipt.findings_hash,receipt.amount_cents,receipt.currency,
    receipt.approved_by,receipt.reason,receipt.approved_at,receipt.previous_audit_hash,receipt.receipt_hash];
}

export async function approveWithReceipt(
  db: D1Database, project: StoredApprovalProject, actor: string, reason: string, secret?: string,
): Promise<ApprovalReceipt> {
  if (project.status !== "REVIEW" || project.approval_receipt_id) throw new Error("Milestone is not ready for approval");
  const audit = await verifyAudit(db,project.id,secret);
  if (!audit.valid) throw new Error("Agreement audit integrity failed");
  const { run, submission } = await context(db,project);
  if (!approvalContextMatches(project,run,submission)) throw new Error("Verification does not match submitted evidence");
  const time = new Date().toISOString();
  const receipt = await createApprovalReceipt(project,run!,submission!,actor,reason,time);
  const result = await db.batch([
    db.prepare("UPDATE projects SET status='APPROVED',decision_reason=?,approval_receipt_id=?,updated_at=? WHERE id=? AND status='REVIEW' AND approval_receipt_id IS NULL AND latest_run_id=? AND current_submission_id=? AND evidence_hash=? AND findings_json=? AND audit_head_hash IS ?")
      .bind(reason,receipt.id,time,project.id,run!.id,submission!.id,project.evidence_hash,project.findings_json,project.audit_head_hash),
    db.prepare(`INSERT INTO approval_receipts (${columns}) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM projects WHERE id=? AND approval_receipt_id=?`)
      .bind(...values(receipt),project.id,receipt.id),
  ]);
  if (!result[0].meta.changes || !result[1].meta.changes) throw new Error("Milestone state changed during approval");
  await appendAudit(db,project.id,actor,"CLIENT_APPROVED",`Receipt ${receipt.receipt_hash}; ${reason}`,secret);
  return receipt;
}

export async function requireApprovalReceipt(
  db: D1Database, project: StoredApprovalProject, secret?: string,
): Promise<ApprovalReceipt> {
  if (project.status !== "APPROVED") throw new Error("Client approval is required");
  const audit = await verifyAudit(db,project.id,secret);
  if (!audit.valid) throw new Error("Agreement audit integrity failed");
  const { run, submission } = await context(db,project);
  if (!approvalContextMatches(project,run,submission)) throw new Error("Approval no longer matches verification");

  let receipt = project.approval_receipt_id ? await db.prepare("SELECT * FROM approval_receipts WHERE id=? AND project_id=?")
    .bind(project.approval_receipt_id,project.id).first<ApprovalReceipt>() : null;
  if (!receipt && !project.approval_receipt_id) {
    const approval = await db.prepare("SELECT actor,detail,created_at FROM audit_events WHERE project_id=? AND type='CLIENT_APPROVED' ORDER BY id DESC LIMIT 1")
      .bind(project.id).first<{ actor: string; detail: string; created_at: string }>();
    if (!approval) throw new Error("Approval audit event is missing");
    const legacy = await createApprovalReceipt(project,run!,submission!,approval.actor,project.decision_reason || approval.detail,approval.created_at,"LEGACY");
    try {
      const result = await db.batch([
        db.prepare("UPDATE projects SET approval_receipt_id=? WHERE id=? AND approval_receipt_id IS NULL AND status='APPROVED' AND latest_run_id=? AND evidence_hash=?")
          .bind(legacy.id,project.id,run!.id,project.evidence_hash),
        db.prepare(`INSERT INTO approval_receipts (${columns}) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM projects WHERE id=? AND approval_receipt_id=?`)
          .bind(...values(legacy),project.id,legacy.id),
      ]);
      if (result[0].meta.changes && result[1].meta.changes) receipt = legacy;
    } catch { /* A concurrent request may have created the receipt. */ }
    if (!receipt) {
      const current = await db.prepare("SELECT approval_receipt_id FROM projects WHERE id=?").bind(project.id).first<{ approval_receipt_id: string | null }>();
      if (current?.approval_receipt_id) receipt = await db.prepare("SELECT * FROM approval_receipts WHERE id=? AND project_id=?")
        .bind(current.approval_receipt_id,project.id).first<ApprovalReceipt>();
    }
  }
  if (!receipt || !await verifyApprovalReceipt(receipt,project,run,submission)) throw new Error("Approval receipt is invalid");
  if (receipt.source === "DIRECT") {
    const linked = await db.prepare("SELECT id FROM audit_events WHERE project_id=? AND type IN ('CLIENT_APPROVED','APPROVAL_AUDIT_RECOVERED') AND detail LIKE ? LIMIT 1")
      .bind(project.id,`%${receipt.receipt_hash}%`).first();
    if (!linked) await appendAudit(db,project.id,receipt.approved_by,"APPROVAL_AUDIT_RECOVERED",`Receipt ${receipt.receipt_hash}; recovered after an incomplete approval response.`,secret);
  }
  return receipt;
}

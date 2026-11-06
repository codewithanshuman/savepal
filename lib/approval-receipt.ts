import { sha256 } from "./website-evidence.ts";

export type ApprovalProject = {
  id: string; client_id: string; client_email: string; freelancer_email: string;
  title: string; description: string; amount_cents: number; currency: string;
  criteria_json: string; status: string; evidence_hash: string | null;
  current_submission_id: string | null; latest_run_id: string | null;
  findings_json: string | null; audit_head_hash: string | null;
};

export type ApprovalRun = {
  id: string; project_id: string; evidence_hash: string; submission_id: string | null;
  snapshot_hash: string | null; findings_json: string | null; state: string;
};

export type ApprovalSubmission = {
  id: string; project_id: string; submission_hash: string; snapshot_hash: string;
};

export type ApprovalReceipt = {
  id: string; project_id: string; source: "DIRECT" | "LEGACY";
  agreement_hash: string; submission_id: string; submission_hash: string;
  snapshot_hash: string; verification_run_id: string; findings_hash: string;
  amount_cents: number; currency: string; approved_by: string; reason: string;
  approved_at: string; previous_audit_hash: string | null; receipt_hash: string;
};

export async function agreementHash(project: ApprovalProject): Promise<string> {
  return sha256(JSON.stringify([
    project.id, project.client_id, project.client_email.toLowerCase(), project.freelancer_email.toLowerCase(),
    project.title, project.description, project.amount_cents, project.currency, project.criteria_json,
  ]));
}

function receiptPayload(receipt: Omit<ApprovalReceipt,"receipt_hash">) {
  return [
    receipt.id, receipt.project_id, receipt.source, receipt.agreement_hash,
    receipt.submission_id, receipt.submission_hash, receipt.snapshot_hash,
    receipt.verification_run_id, receipt.findings_hash, receipt.amount_cents,
    receipt.currency, receipt.approved_by.toLowerCase(), receipt.reason,
    receipt.approved_at, receipt.previous_audit_hash,
  ];
}

export function approvalContextMatches(project: ApprovalProject, run: ApprovalRun | null, submission: ApprovalSubmission | null): boolean {
  return !!run && !!submission && !!project.evidence_hash && !!project.current_submission_id &&
    !!project.latest_run_id && !!project.findings_json &&
    run.id === project.latest_run_id && run.project_id === project.id &&
    run.state === "COMPLETED" && run.evidence_hash === project.evidence_hash &&
    run.submission_id === project.current_submission_id &&
    run.snapshot_hash === submission.snapshot_hash && run.findings_json === project.findings_json &&
    submission.id === project.current_submission_id && submission.project_id === project.id &&
    submission.submission_hash === project.evidence_hash;
}

export async function createApprovalReceipt(
  project: ApprovalProject, run: ApprovalRun, submission: ApprovalSubmission,
  approvedBy: string, reason: string, approvedAt: string, source: "DIRECT" | "LEGACY" = "DIRECT",
): Promise<ApprovalReceipt> {
  if (!approvalContextMatches(project,run,submission)) throw new Error("Verification does not match submitted evidence");
  if (source === "DIRECT" && project.status !== "REVIEW") throw new Error("Milestone is not under review");
  if (source === "LEGACY" && project.status !== "APPROVED") throw new Error("Legacy milestone is not approved");
  const receipt: Omit<ApprovalReceipt,"receipt_hash"> = {
    id: crypto.randomUUID(), project_id: project.id, source,
    agreement_hash: await agreementHash(project), submission_id: submission.id,
    submission_hash: submission.submission_hash, snapshot_hash: submission.snapshot_hash,
    verification_run_id: run.id, findings_hash: await sha256(run.findings_json!),
    amount_cents: project.amount_cents, currency: project.currency,
    approved_by: approvedBy, reason, approved_at: approvedAt,
    previous_audit_hash: project.audit_head_hash,
  };
  return { ...receipt, receipt_hash: await sha256(JSON.stringify(receiptPayload(receipt))) };
}

export async function verifyApprovalReceipt(
  receipt: ApprovalReceipt, project: ApprovalProject, run: ApprovalRun | null,
  submission: ApprovalSubmission | null,
): Promise<boolean> {
  if (!approvalContextMatches(project,run,submission) || receipt.project_id !== project.id ||
      receipt.submission_id !== submission!.id || receipt.submission_hash !== submission!.submission_hash ||
      receipt.snapshot_hash !== submission!.snapshot_hash || receipt.verification_run_id !== run!.id ||
      receipt.amount_cents !== project.amount_cents || receipt.currency !== project.currency ||
      receipt.findings_hash !== await sha256(run!.findings_json!) ||
      receipt.agreement_hash !== await agreementHash(project)) return false;
  const { receipt_hash, ...payload } = receipt;
  return receipt_hash === await sha256(JSON.stringify(receiptPayload(payload)));
}

export function orderCustomId(receipt: ApprovalReceipt): string {
  return receipt.source === "LEGACY" ? receipt.project_id : receipt.receipt_hash;
}

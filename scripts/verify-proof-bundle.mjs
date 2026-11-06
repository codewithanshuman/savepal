import { readFile } from "node:fs/promises";
import { agreementHash } from "../lib/approval-receipt.ts";
import { replayVerification } from "../lib/verification-proof.ts";
import { sha256, validateSnapshot } from "../lib/website-evidence.ts";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/verify-proof-bundle.mjs <downloaded-proof.json>");
  process.exit(2);
}

try {
  const proof = JSON.parse(await readFile(path,"utf8"));
  if (proof.version !== "savepal-proof-bundle-v1" || !proof.summary?.valid)
    throw new Error("Unknown or unsuccessful proof bundle");
  const { agreement, submission, snapshot, liveInput, findings, approvalReceipt, summary } = proof;
  if (agreement.id !== summary.projectId || liveInput.runId !== summary.runId ||
      submission.id !== liveInput.submissionId || snapshot.rootUrl !== submission.manifest.rootUrl)
    throw new Error("Proof references disagree");
  const snapshotRaw = JSON.stringify(snapshot);
  const checkedSnapshot = await validateSnapshot(snapshotRaw,summary.snapshotHash,
    JSON.stringify(submission.manifest),snapshot.rootUrl);
  if (!checkedSnapshot) throw new Error("Submitted snapshot or manifest changed");
  const artifact = {
    project_id: summary.projectId, run_id: summary.runId,
    submission_id: submission.id, snapshot_hash: summary.snapshotHash,
    criteria_hash: summary.criteriaHash, live_hash: summary.liveHash,
    objective_hash: summary.objectiveHash,
  };
  const replay = await replayVerification(JSON.stringify(liveInput),artifact,checkedSnapshot,
    JSON.stringify(agreement.criteria),JSON.stringify(findings));
  if (!replay.valid) throw new Error(`Verification replay failed: ${JSON.stringify(replay.checks)}`);
  const events = proof.auditEvents || [];
  let previous = null;
  for (const event of events) {
    if (event.event_hash) {
      if (event.previous_hash !== previous) throw new Error("Audit event links changed");
      previous = event.event_hash;
    }
  }
  if (previous !== summary.auditHeadHash) throw new Error("Audit head changed");
  if (approvalReceipt) {
    const receipt = approvalReceipt;
    const criteriaJson = JSON.stringify(agreement.criteria);
    const agreementDigest = await agreementHash({
      id: agreement.id,client_id:agreement.clientId,client_email:agreement.clientEmail,
      freelancer_email:agreement.freelancerEmail,title:agreement.title,description:agreement.description,
      amount_cents:agreement.amountCents,currency:agreement.currency,criteria_json:criteriaJson,
    });
    if (receipt.agreement_hash !== agreementDigest ||
        receipt.submission_id !== submission.id || receipt.submission_hash !== submission.hash ||
        receipt.snapshot_hash !== summary.snapshotHash || receipt.verification_run_id !== summary.runId ||
        receipt.findings_hash !== await sha256(JSON.stringify(findings)) ||
        receipt.amount_cents !== agreement.amountCents || receipt.currency !== agreement.currency)
      throw new Error("Approval receipt binding changed");
    const payload = [receipt.id,receipt.project_id,receipt.source,receipt.agreement_hash,
      receipt.submission_id,receipt.submission_hash,receipt.snapshot_hash,receipt.verification_run_id,
      receipt.findings_hash,receipt.amount_cents,receipt.currency,receipt.approved_by.toLowerCase(),
      receipt.reason,receipt.approved_at,receipt.previous_audit_hash];
    if (receipt.receipt_hash !== await sha256(JSON.stringify(payload)))
      throw new Error("Approval receipt hash changed");
  }
  console.log(`PASS project=${summary.projectId} run=${summary.runId} pages=${snapshot.pages.length} audit_events=${events.length} approval=${!!approvalReceipt}`);
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : "Proof verification failed"}`);
  process.exitCode = 1;
}

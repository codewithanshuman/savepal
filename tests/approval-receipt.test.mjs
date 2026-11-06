import assert from "node:assert/strict";
import test from "node:test";
import { approvalContextMatches, createApprovalReceipt, orderCustomId, verifyApprovalReceipt } from "../lib/approval-receipt.ts";

const project = {
  id:"project-1",client_id:"client-1",client_email:"client@example.org",freelancer_email:"worker@example.org",
  title:"Website",description:"Working catalog",amount_cents:1250,currency:"USD",
  criteria_json:'[{"label":"Catalog","kind":"contains","needle":"Blue shirt"}]',
  status:"REVIEW",evidence_hash:"submission-hash",current_submission_id:"submission-1",
  latest_run_id:"run-1",findings_json:'[{"status":"VERIFIED"}]',audit_head_hash:"audit-head",
};
const run = {id:"run-1",project_id:"project-1",evidence_hash:"submission-hash",submission_id:"submission-1",snapshot_hash:"snapshot-hash",findings_json:'[{"status":"VERIFIED"}]',state:"COMPLETED"};
const submission = {id:"submission-1",project_id:"project-1",submission_hash:"submission-hash",snapshot_hash:"snapshot-hash"};

test("approval receipt binds the agreement, exact verification, and submitted snapshot", async () => {
  assert.equal(approvalContextMatches(project,run,submission),true);
  const receipt = await createApprovalReceipt(project,run,submission,"client@example.org","All criteria checked.","2026-11-06T10:00:00.000Z");
  assert.equal(receipt.source,"DIRECT");
  assert.equal(orderCustomId(receipt),receipt.receipt_hash);
  assert.equal(await verifyApprovalReceipt(receipt,{...project,status:"APPROVED"},run,submission),true);
  assert.equal(await verifyApprovalReceipt(receipt,{...project,amount_cents:1300},run,submission),false);
  assert.equal(await verifyApprovalReceipt(receipt,{...project,criteria_json:"[]"},run,submission),false);
  assert.equal(await verifyApprovalReceipt(receipt,project,{...run,findings_json:'[{"status":"FAILED"}]'},submission),false);
  assert.equal(await verifyApprovalReceipt({...receipt,reason:"Changed"},project,run,submission),false);
});

test("stale or incomplete verification cannot produce a payment receipt", async () => {
  for (const invalid of [
    {...run,state:"RUNNING"},{...run,evidence_hash:"other"},{...run,submission_id:"other"},
    {...run,snapshot_hash:"other"},{...run,findings_json:"[]"},
  ]) {
    assert.equal(approvalContextMatches(project,invalid,submission),false);
    await assert.rejects(createApprovalReceipt(project,invalid,submission,"client@example.org","Approved","2026-11-06T10:00:00.000Z"));
  }
  const legacy = await createApprovalReceipt({...project,status:"APPROVED"},run,submission,"client@example.org","Earlier approval","2026-11-06T10:00:00.000Z","LEGACY");
  assert.equal(orderCustomId(legacy),project.id);
});

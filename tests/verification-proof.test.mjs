import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createVerificationInput, replayVerification } from "../lib/verification-proof.ts";
import { captureWebsite, evaluateSnapshot, sha256, snapshotManifest } from "../lib/website-evidence.ts";

test("a verification run replays from saved live evidence and rejects altered inputs", async () => {
  const url = "https://example.org/";
  const html = "<html><head><title>Example</title></head><body><p>Product catalog</p></body></html>";
  const criteria = [{ label: "Catalog", kind: "contains", needle: "Product catalog" }];
  const criteriaJson = JSON.stringify(criteria);
  const snapshot = await captureWebsite(url,async () => new Response(html,{status:200,headers:{"content-type":"text/html"}}),criteria);
  const snapshotHash = await sha256(JSON.stringify(snapshot));
  const live = [{url,status:200,body:html,contentType:"text/html",truncated:false}];
  const stored = await createVerificationInput("project-1","run-1","submission-1",snapshotHash,criteriaJson,live,"2026-11-06T00:00:00.000Z");
  const findings = evaluateSnapshot(criteria,snapshot,live);
  const artifact = {
    id:"artifact-1",project_id:"project-1",run_id:"run-1",submission_id:"submission-1",
    snapshot_hash:snapshotHash,criteria_hash:stored.input.criteriaHash,live_key:"verification/project-1/run-1.json",
    live_hash:stored.hash,objective_hash:await sha256(JSON.stringify(findings)),created_at:"2026-11-06T00:00:00.000Z",
  };
  const valid = await replayVerification(stored.raw,artifact,snapshot,criteriaJson,JSON.stringify(findings));
  assert.equal(valid.valid,true);
  assert.ok(Object.values(valid.checks).every(Boolean));
  const altered = stored.raw.replace("Product catalog","Unrelated text");
  assert.equal((await replayVerification(altered,artifact,snapshot,criteriaJson,JSON.stringify(findings))).valid,false);
  assert.equal((await replayVerification(stored.raw,artifact,snapshot,JSON.stringify([{...criteria[0],needle:"Other"}]),JSON.stringify(findings))).valid,false);
  assert.equal((await replayVerification(stored.raw,artifact,snapshot,criteriaJson,JSON.stringify([{...findings[0],status:"FAILED"}]))).valid,false);
  const directory = await mkdtemp(join(tmpdir(),"savepal-proof-"));
  try {
    const file = join(directory,"proof.json");
    const bundle = {
      version:"savepal-proof-bundle-v1",summary:{valid:true,projectId:"project-1",runId:"run-1",
        snapshotHash,criteriaHash:artifact.criteria_hash,liveHash:artifact.live_hash,
        objectiveHash:artifact.objective_hash,auditHeadHash:null},
      agreement:{id:"project-1",criteria},submission:{id:"submission-1",manifest:snapshotManifest(snapshot)},
      snapshot,liveInput:stored.input,findings,auditEvents:[],approvalReceipt:null,
    };
    await writeFile(file,JSON.stringify(bundle));
    const validFile = spawnSync(process.execPath,["scripts/verify-proof-bundle.mjs",file],{cwd:process.cwd(),encoding:"utf8"});
    assert.equal(validFile.status,0,validFile.stderr);
    bundle.liveInput.pages[0].body = "tampered";
    await writeFile(file,JSON.stringify(bundle));
    const invalidFile = spawnSync(process.execPath,["scripts/verify-proof-bundle.mjs",file],{cwd:process.cwd(),encoding:"utf8"});
    assert.equal(invalidFile.status,1);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

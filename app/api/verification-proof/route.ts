import { env } from "cloudflare:workers";
import { getUser } from "../../auth";
import { verifyAudit } from "../../../lib/audit";
import { replayVerification, type VerificationArtifact } from "../../../lib/verification-proof";
import { sha256, validateSnapshot } from "../../../lib/website-evidence";
import { sha256Bytes } from "../../../lib/browser-evidence";

import { evidenceStore } from "../../../lib/evidence-store";

export const runtime = "edge";
/** Private evidence: R2 when bound, otherwise the database fallback. */
const hasStore = () => !!evidenceStore(env);
const store = () => { const s = evidenceStore(env); if (!s) throw new Error("Private evidence storage is unavailable"); return s; };
const cfg = env as Cloudflare.Env & { AUDIT_HMAC_KEY?: string };
const fail = (message: string, status: number) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return fail("Sign in is required",401);
  if (!env.DB || !hasStore()) return fail("Verification storage is unavailable",503);
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const runId = url.searchParams.get("runId");
  if (!projectId || !runId) return fail("Project and run IDs are required",400);
  const project = await env.DB.prepare("SELECT * FROM projects WHERE id=?").bind(projectId).first<{
    id: string; client_id: string; client_email: string; freelancer_email: string; criteria_json: string;
    approval_receipt_id: string | null; title: string; description: string;
    amount_cents: number; currency: string; status: string; audit_head_hash: string | null;
  }>();
  if (!project || (project.client_id !== user.userId && project.freelancer_email.toLowerCase() !== user.email.toLowerCase()))
    return fail("Verification proof not found",404);
  const artifact = await env.DB.prepare("SELECT * FROM verification_artifacts WHERE project_id=? AND run_id=?")
    .bind(projectId,runId).first<VerificationArtifact>();
  if (!artifact) return fail("This run has no replayable proof",404);
  const run = await env.DB.prepare("SELECT id,submission_id,snapshot_hash,checker_version,findings_json,coverage_json,completed_at FROM verification_runs WHERE id=? AND project_id=? AND state='COMPLETED'")
    .bind(runId,projectId).first<{ id: string; submission_id: string; snapshot_hash: string; checker_version: string; findings_json: string; coverage_json: string; completed_at: string }>();
  const submission = await env.DB.prepare("SELECT id,url,snapshot_key,snapshot_hash,manifest_json,submission_hash,created_at FROM evidence_submissions WHERE id=? AND project_id=?")
    .bind(artifact.submission_id,projectId).first<{ id: string; url: string; snapshot_key: string; snapshot_hash: string; manifest_json: string; submission_hash: string; created_at: string }>();
  if (!run || !submission || run.submission_id !== artifact.submission_id || run.snapshot_hash !== artifact.snapshot_hash || submission.snapshot_hash !== artifact.snapshot_hash)
    return fail("Verification records disagree",409);
  const [snapshotObject,liveObject] = await Promise.all([store().get(submission.snapshot_key),store().get(artifact.live_key)]);
  if (!snapshotObject || !liveObject) return fail("Verification evidence is missing",409);
  const [snapshotRaw,liveRaw] = await Promise.all([snapshotObject.text(),liveObject.text()]);
  const snapshot = await validateSnapshot(snapshotRaw,artifact.snapshot_hash,submission.manifest_json,submission.url);
  if (!snapshot) return fail("Submitted evidence failed integrity verification",409);
  const replay = await replayVerification(liveRaw,artifact,snapshot,project.criteria_json,run.findings_json);
  const auditIntegrity = await verifyAudit(env.DB,projectId,cfg.AUDIT_HMAC_KEY);
  if (!replay.valid || !auditIntegrity.valid) return fail("Verification proof failed integrity checks",409);
  const screenshot = url.searchParams.get("screenshot");
  if (screenshot === "submission" || screenshot === "verification") {
    const rendered = screenshot === "submission" ? snapshot.renderedRoot :
      (JSON.parse(liveRaw) as { pages: Array<{ renderedRoot?: { screenshotKey: string; screenshotHash: string } }> }).pages[0]?.renderedRoot;
    if (!rendered) return fail("No rendered screenshot was captured",404);
    const object = await store().get(rendered.screenshotKey);
    if (!object) return fail("Rendered screenshot is missing",409);
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (await sha256Bytes(bytes) !== rendered.screenshotHash) return fail("Rendered screenshot failed integrity verification",409);
    return new Response(bytes as BodyInit,{ headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
  const summary = {
    valid: true, projectId, runId, checkerVersion: run.checker_version,
    snapshotHash: artifact.snapshot_hash, liveHash: artifact.live_hash,
    criteriaHash: artifact.criteria_hash, objectiveHash: artifact.objective_hash,
    auditHeadHash: project.audit_head_hash, checks: replay.checks, auditIntegrity,
  };
  if (url.searchParams.get("download") !== "1") return Response.json(summary,{ headers: { "Cache-Control": "private, no-store" } });
  const [audit,observations,receipt] = await Promise.all([
    env.DB.prepare("SELECT actor,type,detail,previous_hash,event_hash,created_at FROM audit_events WHERE project_id=? ORDER BY id ASC").bind(projectId).all(),
    env.DB.prepare("SELECT * FROM payment_observations WHERE project_id=? ORDER BY observed_at ASC").bind(projectId).all(),
    env.DB.prepare("SELECT * FROM approval_receipts WHERE project_id=? AND verification_run_id=? ORDER BY approved_at DESC LIMIT 1").bind(projectId,runId).first(),
  ]);
  const bundle = {
    version: "savepal-proof-bundle-v1", exportedAt: new Date().toISOString(), summary,
    agreement: { id: project.id, clientId: project.client_id, clientEmail: project.client_email,
      freelancerEmail: project.freelancer_email, title: project.title, description: project.description,
      criteria: JSON.parse(project.criteria_json), amountCents: project.amount_cents, currency: project.currency },
    submission: { id: submission.id, hash: submission.submission_hash, createdAt: submission.created_at,
      manifest: JSON.parse(submission.manifest_json) },
    snapshot, liveInput: JSON.parse(liveRaw), findings: JSON.parse(run.findings_json),
    coverage: JSON.parse(run.coverage_json), approvalReceipt: receipt,
    auditEvents: audit.results, paymentObservations: observations.results,
  };
  const raw = JSON.stringify(bundle);
  const digest = await sha256(raw);
  return new Response(raw,{ headers: {
    "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="savepal-proof-${runId}.json"`,
    "X-SavePal-SHA256": digest, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
  } });
}

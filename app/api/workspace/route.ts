import { env } from "cloudflare:workers";
import { getUser } from "../../auth";
import { CHECKER_VERSION, parseUsdCents, readBoundedHtml, safeWebsiteUrl, validateCriteria, type Criterion, type Finding, type WebsiteResult } from "../../../lib/assurance";
import { approvalViolation, decisionGate, parseMaxRevisions, revisionAllowance } from "../../../lib/decision-policy";
import { revisionHistory } from "../../../lib/revision-diff";
import { consentState, termsFingerprint, termsHash } from "../../../lib/terms-consent";
import { findingConfidence, type AdvancedFinding } from "../../../lib/website-evidence";
import { appendAudit, verifyAudit } from "../../../lib/audit";
import { captureWebsite, evaluateSnapshot, sha256, snapshotManifest, validateSnapshot } from "../../../lib/website-evidence";
import { reviewWithAi } from "../../../lib/ai-verification";
import { approveWithReceipt, requireApprovalReceipt, type StoredApprovalProject } from "../../../lib/approval-store";
import { orderCustomId } from "../../../lib/approval-receipt";
import { PayPalSandbox, orderCapture, orderMatches, retrySafe, safeMerchantId, safeProviderId, type ExpectedPayment } from "../../../lib/paypal-assurance";
import { recordCaptureObservation } from "../../../lib/payment-store";
import { createVerificationInput, type CapturedLivePage } from "../../../lib/verification-proof";
import { beginSellerOnboarding, requireReadySeller } from "../../../lib/seller-onboarding";
import { captureRenderedPage } from "../../../lib/browser-evidence";
import { reconcileProject } from "../../../lib/payment-reconciliation";

export const runtime = "edge";

type Project = StoredApprovalProject & {
  id: string; client_id: string; client_email: string; freelancer_email: string;
  title: string; description: string; amount_cents: number; currency: string;
  criteria_json: string; status: string; evidence_url: string | null;
  evidence_notes: string | null; evidence_hash: string | null; evidence_at: string | null;
  findings_json: string | null; evaluated_at: string | null; decision_reason: string | null;
  paypal_order_id: string | null; paypal_capture_id: string | null;
  payment_status: string; payment_request_id: string | null;
  payment_order_requested_at: string | null; payment_capture_request_id: string | null;
  payment_capture_requested_at: string | null;
  seller_merchant_id: string | null; seller_verified_at: string | null;
  payment_recipient_merchant_id: string | null; payment_last_reconciled_at: string | null;
  max_revisions: number | null; revision_count: number;
  terms_hash: string | null; accepted_terms_hash: string | null; accepted_at: string | null;
  created_at: string; updated_at: string;
};
type EvidenceSubmission = { id: string; project_id: string; submission_hash: string; snapshot_hash: string; snapshot_key: string; manifest_json: string; created_at: string };

const db = () => {
  if (!env.DB) throw new Error("Database is unavailable");
  return env.DB;
};
const cfg = env as Cloudflare.Env & { PAYPAL_CLIENT_ID?: string; PAYPAL_CLIENT_SECRET?: string; PAYPAL_MERCHANT_ID?: string; PAYPAL_PARTNER_MERCHANT_ID?: string; PAYPAL_PARTNER_BN_CODE?: string; SITE_ORIGIN?: string; OPENAI_API_KEY?: string; OPENAI_MODEL?: string; AUDIT_HMAC_KEY?: string; BROWSER_RUN_ACCOUNT_ID?: string; BROWSER_RUN_API_TOKEN?: string };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const now = () => new Date().toISOString();
const fail = (message: string, status = 400) => json({ error: message }, status);

async function event(projectId: string, actor: string, type: string, detail: string) {
  await appendAudit(db(),projectId,actor,type,detail,cfg.AUDIT_HMAC_KEY);
}
async function project(id: string) {
  return db().prepare("SELECT * FROM projects WHERE id = ?").bind(id).first<Project>();
}
function role(p: Project, user: { userId: string; email: string }) {
  if (p.client_id === user.userId) return "client";
  if (p.freelancer_email.toLowerCase() === user.email.toLowerCase()) return "freelancer";
  return null;
}
async function view(p: Project, user: { userId: string; email: string }) {
  const staleEvaluation = p.status === "EVALUATING" && new Date(p.updated_at).getTime() < Date.now() - 5 * 60_000;
  const criteria = JSON.parse(p.criteria_json) as Criterion[];
  const findings = p.findings_json ? JSON.parse(p.findings_json) as AdvancedFinding[] : null;
  const consent = await consentState(p);
  let gate = null;
  try { gate = findings ? decisionGate(criteria,findings) : null; } catch { gate = null; }
  return {
    ...p,
    status: staleEvaluation ? "SUBMITTED" : p.status,
    role: role(p, user),
    criteria,
    findings: findings?.map(f => ({ ...f, confidence: findingConfidence(f) })) ?? null,
    gate,
    revisions: { max: p.max_revisions, used: p.revision_count, ...revisionAllowance(p.max_revisions,p.revision_count) },
    consent: { ...consent, fingerprint: termsFingerprint(consent.termsHash) },
    criteria_json: undefined, findings_json: undefined, payment_request_id: undefined,
    payment_capture_request_id: undefined, audit_head_hash: undefined,
    paymentAwaitingReconciliation: !!p.payment_request_id || !!p.paypal_order_id,
  };
}

/** Refuses to act on an agreement whose locked terms no longer match what both parties bound. */
async function termsIntact(p: Project): Promise<string | null> {
  const consent = await consentState(p);
  if (consent.legacy) return null;
  if (consent.tampered) return "Locked agreement terms changed after they were agreed; this agreement is frozen";
  if (!consent.freelancerBound) return "The freelancer has not accepted these exact terms";
  return null;
}

export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return fail("Sign in is required", 401);
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const p = await project(id);
    if (!p || !role(p, user)) return fail("Agreement not found", 404);
    const audit = await db().prepare("SELECT actor, type, detail, created_at FROM audit_events WHERE project_id = ? ORDER BY id DESC").bind(id).all();
    const auditIntegrity = await verifyAudit(db(),id,cfg.AUDIT_HMAC_KEY);
    const submissions = await db().prepare("SELECT id,submission_hash,snapshot_hash,manifest_json,created_at FROM evidence_submissions WHERE project_id=? ORDER BY created_at DESC LIMIT 20").bind(id).all<Pick<EvidenceSubmission,"id"|"submission_hash"|"snapshot_hash"|"manifest_json"|"created_at">>();
    const verificationRun = p.latest_run_id ? await db().prepare("SELECT id,submission_id,snapshot_hash,checker_version,model,started_at,completed_at,state,website_status,website_body_hash,website_truncated,findings_json,ai_note,coverage_json FROM verification_runs WHERE id=? AND project_id=?").bind(p.latest_run_id,id).first() : null;
    const approvalReceipt = p.approval_receipt_id ? await db().prepare("SELECT * FROM approval_receipts WHERE id=? AND project_id=?").bind(p.approval_receipt_id,id).first() : null;
    const paymentObservations = await db().prepare("SELECT id,source,provider_event_id,order_id,capture_id,provider_status,projected_status,amount_cents,currency,payload_hash,observed_at FROM payment_observations WHERE project_id=? ORDER BY observed_at DESC LIMIT 30").bind(id).all();
    const reconciliationAttempts = await db().prepare("SELECT id,source,outcome,detail,attempted_at FROM reconciliation_attempts WHERE project_id=? ORDER BY attempted_at DESC LIMIT 30").bind(id).all();
    const runs = await db().prepare("SELECT id,submission_id,completed_at,findings_json FROM verification_runs WHERE project_id=? AND state='COMPLETED' ORDER BY completed_at ASC LIMIT 50").bind(id).all<{ id: string; submission_id: string | null; completed_at: string | null; findings_json: string | null }>();
    const history = revisionHistory(JSON.parse(p.criteria_json) as Criterion[],runs.results);
    return json({ project: await view(p, user), revisionHistory: history, audit: audit.results, auditIntegrity, evidenceHistory: submissions.results.map(s => ({ ...s, manifest: JSON.parse(s.manifest_json), manifest_json: undefined })), verificationRun, approvalReceipt, paymentObservations: paymentObservations.results, reconciliationAttempts: reconciliationAttempts.results });
  }
  const rows = await db().prepare("SELECT * FROM projects WHERE client_id = ? OR lower(freelancer_email) = ? ORDER BY created_at DESC")
    .bind(user.userId, user.email.toLowerCase()).all<Project>();
  return json({ user: { name: user.displayName, email: user.email }, projects: await Promise.all(rows.results.map(p => view(p, user))), paypalReady: !!(cfg.PAYPAL_CLIENT_ID && cfg.PAYPAL_CLIENT_SECRET && (cfg.PAYPAL_PARTNER_MERCHANT_ID ? safeMerchantId(cfg.PAYPAL_PARTNER_MERCHANT_ID) && cfg.PAYPAL_PARTNER_BN_CODE : safeMerchantId(cfg.PAYPAL_MERCHANT_ID))), sellerOnboardingReady: !!(cfg.PAYPAL_CLIENT_ID && cfg.PAYPAL_CLIENT_SECRET && safeMerchantId(cfg.PAYPAL_PARTNER_MERCHANT_ID) && cfg.PAYPAL_PARTNER_BN_CODE), paymentMode: cfg.PAYPAL_PARTNER_MERCHANT_ID ? "SELLER" : "MERCHANT", paypalClientId: cfg.PAYPAL_CLIENT_ID || null, paypalPartnerBnCode: cfg.PAYPAL_PARTNER_BN_CODE || null, aiReady: !!cfg.OPENAI_API_KEY });
}

async function inspectWebsite(url: string): Promise<WebsiteResult> {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { Accept: "text/html" } });
    const type = (res.headers.get("content-type") || "").toLowerCase();
    const html = res.ok && type.includes("text/html") ? await readBoundedHtml(res) : { body: "", truncated: false };
    return { status: res.status, ...html, contentType: type };
  } catch { return { status: 0, body: "", contentType: "", truncated: false, error: "The website could not be reached within 8 seconds." }; }
}
async function storeSnapshot(projectId: string, submissionId: string, url: string, criteria: Criterion[]) {
  if (!env.BUCKET) throw new Error("Private evidence storage is unavailable");
  const snapshot = await captureWebsite(url,fetch,criteria);
  if (cfg.BROWSER_RUN_ACCOUNT_ID && cfg.BROWSER_RUN_API_TOKEN) {
    const capture = await captureRenderedPage(url,`rendered/${projectId}/${submissionId}.png`,cfg.BROWSER_RUN_ACCOUNT_ID,cfg.BROWSER_RUN_API_TOKEN);
    await env.BUCKET.put(capture.rendered.screenshotKey,capture.screenshot,{ httpMetadata: { contentType: "image/png" } });
    snapshot.renderedRoot = capture.rendered;
  }
  const raw = JSON.stringify(snapshot);
  const snapshotHash = await sha256(raw);
  const key = `evidence/${projectId}/${submissionId}.json`;
  await env.BUCKET.put(key,raw,{ httpMetadata: { contentType: "application/json" } });
  return { snapshot, snapshotHash, key };
}
function paypal() {
  if (!cfg.PAYPAL_CLIENT_ID || !cfg.PAYPAL_CLIENT_SECRET) throw new Error("PayPal sandbox credentials are not configured");
  const partner = cfg.PAYPAL_PARTNER_MERCHANT_ID && cfg.PAYPAL_PARTNER_BN_CODE ? {
    clientId: cfg.PAYPAL_CLIENT_ID, attributionId: cfg.PAYPAL_PARTNER_BN_CODE, merchantId: cfg.PAYPAL_PARTNER_MERCHANT_ID,
  } : undefined;
  return new PayPalSandbox(cfg.PAYPAL_CLIENT_ID,cfg.PAYPAL_CLIENT_SECRET,fetch,partner);
}
function paymentExpectation(p: Project, customId: string): ExpectedPayment {
  const merchantId = p.payment_recipient_merchant_id || (cfg.PAYPAL_PARTNER_MERCHANT_ID ? p.seller_merchant_id : cfg.PAYPAL_MERCHANT_ID);
  if (!safeMerchantId(merchantId)) throw new Error("A verified PayPal recipient is required before checkout");
  return { projectId: p.id, orderId: p.paypal_order_id || undefined, captureId: p.paypal_capture_id || undefined,
    customId, amountCents: p.amount_cents, currency: p.currency, merchantId };
}

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return fail("Sign in is required", 401);
  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; } catch { return fail("Invalid JSON"); }
  const action = input.action;
  if (action === "create") {
    const title = String(input.title || "").trim().slice(0, 120);
    const description = String(input.description || "").trim().slice(0, 2000);
    const freelancerEmail = String(input.freelancerEmail || "").trim().toLowerCase();
    const amountCents = parseUsdCents(input.amount);
    const maxRevisions = parseMaxRevisions(input.maxRevisions);
    if (!title || !description || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(freelancerEmail) || freelancerEmail === user.email.toLowerCase() || amountCents === null) return fail("Enter a title, scope, a different freelancer email, and a USD amount from $1 to $1,000,000 with at most two decimals");
    if (maxRevisions === undefined) return fail("Revision limit must be a whole number from 0 to 20, or empty for no limit");
    const checked = validateCriteria(input.criteria);
    if ("error" in checked) return fail(checked.error);
    const id = crypto.randomUUID(), time = now();
    const criteriaJson = JSON.stringify(checked.criteria);
    const terms = await termsHash({ id, client_id: user.userId, client_email: user.email, freelancer_email: freelancerEmail, title, description,
      amount_cents: amountCents, currency: "USD", criteria_json: criteriaJson, max_revisions: maxRevisions,
      status: "INVITED", evidence_hash: null, current_submission_id: null, latest_run_id: null, findings_json: null, audit_head_hash: null });
    await db().prepare("INSERT INTO projects (id,client_id,client_email,freelancer_email,title,description,amount_cents,currency,criteria_json,status,payment_status,max_revisions,revision_count,terms_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)")
      .bind(id,user.userId,user.email,freelancerEmail,title,description,amountCents,"USD",criteriaJson,"INVITED","NOT_STARTED",maxRevisions,terms,time,time).run();
    const required = checked.criteria.filter(c => c.required !== false).length;
    await event(id,user.email,"AGREEMENT_CREATED",`Version 1 bound by client; terms ${terms} (${termsFingerprint(terms)}). ${checked.criteria.length} criteria (${required} required), ${maxRevisions === null ? "unlimited revisions" : `${maxRevisions} revision${maxRevisions === 1 ? "" : "s"}`}. Awaiting freelancer acceptance.`);
    return json({ id, termsHash: terms }, 201);
  }
  const id = String(input.id || "");
  let p = await project(id);
  if (!p) return fail("Agreement not found", 404);
  const userRole = role(p, user);
  if (!userRole) return fail("Access denied", 403);

  if (action === "accept") {
    if (userRole !== "freelancer" || p.status !== "INVITED") return fail("Only the invited freelancer can accept this agreement", 403);
    const consent = await consentState(p);
    if (consent.tampered) return fail("Locked agreement terms changed after the client bound them; this agreement cannot be accepted", 409);
    // The freelancer must echo the terms hash they were shown, so consent is bound to exact terms.
    if (!consent.legacy && input.termsHash !== consent.termsHash) return fail("These terms differ from the ones you reviewed; refresh and review them again", 409);
    const time = now();
    const changed = await db().prepare("UPDATE projects SET status='AGREED',accepted_terms_hash=?,accepted_at=?,updated_at=? WHERE id=? AND status='INVITED' AND terms_hash IS ?")
      .bind(consent.legacy ? null : consent.termsHash,time,time,id,p.terms_hash).run();
    if (!changed.meta.changes) return fail("Agreement state changed; refresh and try again", 409);
    await event(id,user.email,"AGREEMENT_ACCEPTED",consent.legacy ? "Freelancer accepted agreement version 1." :
      `Freelancer bound to terms ${consent.termsHash} (${termsFingerprint(consent.termsHash)}); both parties now hold the same terms.`);
    return json({ ok: true });
  }

  if (action === "submit") {
    if (userRole !== "freelancer" || !["AGREED","REVISION_REQUESTED"].includes(p.status)) return fail("Only the assigned freelancer can submit evidence after agreement or revision", 403);
    const url = safeWebsiteUrl(input.url);
    const notes = String(input.notes || "").trim().slice(0, 3000);
    if (!url || !notes) return fail("Provide a public HTTPS website URL and evidence notes");
    if (!env.BUCKET) return fail("Private evidence storage is unavailable", 503);
    const submissionId = crypto.randomUUID(), time = now();
    let storedSnapshot: Awaited<ReturnType<typeof storeSnapshot>>;
    try { storedSnapshot = await storeSnapshot(id,submissionId,url,JSON.parse(p.criteria_json) as Criterion[]); }
    catch { return fail("Website snapshot could not be captured or stored", 502); }
    const { snapshot, snapshotHash, key } = storedSnapshot;
    const hash = await sha256(JSON.stringify([id,submissionId,url,notes,snapshotHash,time]));
    try {
      const results = await db().batch([
        db().prepare("UPDATE projects SET current_submission_id=?,evidence_url=?,evidence_notes=?,evidence_hash=?,evidence_at=?,findings_json=NULL,evaluated_at=NULL,latest_run_id=NULL,status='SUBMITTED',updated_at=? WHERE id=? AND status IN ('AGREED','REVISION_REQUESTED')")
          .bind(submissionId,url,notes,hash,time,time,id),
        db().prepare("INSERT INTO evidence_submissions (id,project_id,submitted_by,url,notes,submission_hash,snapshot_hash,snapshot_key,manifest_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,? FROM projects WHERE id=? AND current_submission_id=?")
          .bind(submissionId,id,user.email,url,notes,hash,snapshotHash,key,JSON.stringify(snapshotManifest(snapshot)),time,id,submissionId),
      ]);
      if (!results[0].meta.changes || !results[1].meta.changes) {
        await env.BUCKET.delete(key);
        return fail("Milestone state changed; refresh and try again", 409);
      }
    } catch {
      await env.BUCKET.delete(key).catch(() => {});
      return fail("Evidence snapshot could not be stored; no submission was accepted", 502);
    }
    await event(id,user.email,"EVIDENCE_SUBMITTED",`Submission ${submissionId}; snapshot SHA-256 ${snapshotHash}; ${snapshot.pages.length} pages captured.`);
    return json({ ok: true, submissionId, snapshotHash, pagesCaptured: snapshot.pages.length });
  }
  if (action === "verify") {
    if (userRole === "client" && p.status === "SUBMITTED" && !p.current_submission_id && p.evidence_url && p.evidence_notes && p.evidence_hash) {
      if (!env.BUCKET) return fail("Private evidence storage is unavailable", 503);
      const legacyId = crypto.randomUUID(), migratedAt = now();
      let stored: Awaited<ReturnType<typeof storeSnapshot>>;
      try { stored = await storeSnapshot(id,legacyId,p.evidence_url,JSON.parse(p.criteria_json) as Criterion[]); }
      catch { return fail("Legacy evidence could not be snapshotted", 502); }
      try {
        const results = await db().batch([
          db().prepare("UPDATE projects SET current_submission_id=?,updated_at=? WHERE id=? AND status='SUBMITTED' AND current_submission_id IS NULL AND evidence_hash=?")
            .bind(legacyId,migratedAt,id,p.evidence_hash),
          db().prepare("INSERT INTO evidence_submissions (id,project_id,submitted_by,url,notes,submission_hash,snapshot_hash,snapshot_key,manifest_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,? FROM projects WHERE id=? AND current_submission_id=?")
            .bind(legacyId,id,p.freelancer_email,p.evidence_url,p.evidence_notes,p.evidence_hash,stored.snapshotHash,stored.key,JSON.stringify(snapshotManifest(stored.snapshot)),migratedAt,id,legacyId),
        ]);
        if (!results[0].meta.changes || !results[1].meta.changes) {
          await env.BUCKET.delete(stored.key);
          return fail("Evidence changed during migration; refresh and retry", 409);
        }
      } catch {
        await env.BUCKET.delete(stored.key).catch(() => {});
        return fail("Legacy evidence migration failed", 502);
      }
      await event(id,user.email,"LEGACY_EVIDENCE_SNAPSHOTTED",`Existing URL was snapshotted at verification time by ${user.email}; snapshot ${stored.snapshotHash}. Original evidence timestamp remains unchanged.`);
      p = await project(id);
      if (!p) return fail("Agreement disappeared during verification", 409);
    }
    if (userRole !== "client" || !p.evidence_url || !p.evidence_hash || !p.current_submission_id || !["SUBMITTED","EVALUATING"].includes(p.status)) return fail("A snapshotted submission is required", 409);
    if (!env.BUCKET) return fail("Private evidence storage is unavailable", 503);
    const submission = await db().prepare("SELECT id,project_id,submission_hash,snapshot_hash,snapshot_key,manifest_json,created_at FROM evidence_submissions WHERE id=? AND project_id=?")
      .bind(p.current_submission_id,id).first<EvidenceSubmission>();
    if (!submission || submission.submission_hash !== p.evidence_hash) return fail("Evidence record does not match the milestone", 409);
    const runId = crypto.randomUUID(), startedAt = now();
    const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
    const claim = await db().prepare("UPDATE projects SET status='EVALUATING',latest_run_id=?,updated_at=? WHERE id=? AND evidence_hash=? AND current_submission_id=? AND (status='SUBMITTED' OR (status='EVALUATING' AND updated_at < ?))")
      .bind(runId,startedAt,id,p.evidence_hash,submission.id,staleBefore).run();
    if (!claim.meta.changes) return fail("Verification is already running or evidence changed", 409);
    try {
      await db().prepare("INSERT INTO verification_runs (id,project_id,evidence_hash,checker_version,model,started_at,state,submission_id,snapshot_hash) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(runId,id,p.evidence_hash,CHECKER_VERSION,cfg.OPENAI_API_KEY ? (cfg.OPENAI_MODEL || "gpt-4o-mini") : null,startedAt,"RUNNING",submission.id,submission.snapshot_hash).run();
      const object = await env.BUCKET.get(submission.snapshot_key);
      if (!object) throw new Error("Snapshot object missing");
      const raw = await object.text();
      const snapshot = await validateSnapshot(raw,submission.snapshot_hash,submission.manifest_json,p.evidence_url);
      if (!snapshot) throw new Error("Snapshot integrity mismatch");
      const livePages: CapturedLivePage[] = await Promise.all(snapshot.pages.map(async page => ({ url: page.url, ...await inspectWebsite(page.url) })));
      if (snapshot.renderedRoot) {
        if (!cfg.BROWSER_RUN_ACCOUNT_ID || !cfg.BROWSER_RUN_API_TOKEN) throw new Error("Browser evidence service is unavailable for replay");
        const capture = await captureRenderedPage(snapshot.rootUrl,`rendered/${id}/${runId}.png`,cfg.BROWSER_RUN_ACCOUNT_ID,cfg.BROWSER_RUN_API_TOKEN);
        await env.BUCKET.put(capture.rendered.screenshotKey,capture.screenshot,{ httpMetadata: { contentType: "image/png" } });
        livePages[0] = { ...livePages[0], renderedRoot: capture.rendered };
      }
      const criteria = JSON.parse(p.criteria_json) as Criterion[];
      const objectiveFindings = evaluateSnapshot(criteria,snapshot,livePages);
      const liveEvidence = await createVerificationInput(id,runId,submission.id,submission.snapshot_hash,p.criteria_json,livePages,now());
      const liveKey = `verification/${id}/${runId}.json`;
      await env.BUCKET.put(liveKey,liveEvidence.raw,{ httpMetadata: { contentType: "application/json" } });
      const objectiveHash = await sha256(JSON.stringify(objectiveFindings));
      const aiReview = cfg.OPENAI_API_KEY ? await reviewWithAi(cfg.OPENAI_API_KEY,cfg.OPENAI_MODEL || "gpt-4o-mini",criteria,objectiveFindings,snapshot,livePages,p.evidence_notes || "") : null;
      const findings = aiReview?.status === "COMPLETED" ? objectiveFindings.map((finding,index) => ({ ...finding, aiReview: aiReview.assessments[index] })) : objectiveFindings;
      const note = aiReview?.note || null;
      const time = now();
      const coverage = {
        snapshot: snapshotManifest(snapshot),
        livePages: await Promise.all(livePages.map(async page => ({ url: page.url, status: page.status, bodyHash: page.body ? await sha256(page.body) : null, truncated: page.truncated }))),
        ai: aiReview ? { status: aiReview.status, model: aiReview.model, responseId: aiReview.responseId, inputHash: aiReview.inputHash, outputHash: aiReview.outputHash } : { status: "UNCONFIGURED" },
      };
      const liveRoot = livePages[0];
      const saved = await db().batch([
        db().prepare("UPDATE verification_runs SET state='COMPLETED',completed_at=?,website_status=?,website_body_hash=?,website_truncated=?,findings_json=?,ai_note=?,coverage_json=? WHERE id=? AND state='RUNNING'")
          .bind(time,liveRoot.status,coverage.livePages[0].bodyHash,liveRoot.truncated ? 1 : 0,JSON.stringify(findings),note,JSON.stringify(coverage),runId),
        db().prepare("UPDATE projects SET findings_json=?,evaluated_at=?,status='REVIEW',updated_at=? WHERE id=? AND status='EVALUATING' AND latest_run_id=? AND evidence_hash=? AND current_submission_id=?")
          .bind(JSON.stringify(findings),time,time,id,runId,p.evidence_hash,submission.id),
        db().prepare("INSERT INTO verification_artifacts (id,project_id,run_id,submission_id,snapshot_hash,criteria_hash,live_key,live_hash,objective_hash,created_at) SELECT ?,?,?,?,?,?,?,?,?,? FROM projects WHERE id=? AND status='REVIEW' AND latest_run_id=?")
          .bind(crypto.randomUUID(),id,runId,submission.id,submission.snapshot_hash,liveEvidence.input.criteriaHash,liveKey,liveEvidence.hash,objectiveHash,time,id,runId),
      ]);
      if (!saved[0].meta.changes || !saved[1].meta.changes || !saved[2].meta.changes) {
        await db().prepare("UPDATE verification_runs SET state='STALE' WHERE id=?").bind(runId).run();
        return fail("Evidence changed during verification; run it again", 409);
      }
      await event(id,user.email,"VERIFICATION_COMPLETED",`Run ${runId}; submission ${submission.id}; snapshot ${submission.snapshot_hash}; checker ${CHECKER_VERSION}; AI ${aiReview?.status || "UNCONFIGURED"} ${aiReview?.outputHash || ""}; ${note || "objective checks complete"}`);
      return json({ findings, aiNote: note, runId, snapshotHash: submission.snapshot_hash, coverage });
    } catch (error) {
      await db().prepare("UPDATE verification_runs SET state='FAILED',completed_at=? WHERE id=?").bind(now(),runId).run().catch(() => {});
      await db().prepare("UPDATE projects SET status='SUBMITTED',updated_at=? WHERE id=? AND status='EVALUATING' AND latest_run_id=?").bind(now(),id,runId).run().catch(() => {});
      await event(id,user.email,"VERIFICATION_FAILED",`Run ${runId}; snapshot validation or evaluation failed.`).catch(() => {});
      return fail(error instanceof Error && error.message.startsWith("Snapshot") ? "Evidence snapshot integrity failed" : "Verification failed; you can retry safely", 502);
    }
  }
  if (action === "approve" || action === "revise") {
    if (userRole !== "client" || p.status !== "REVIEW") return fail("Only the client can decide after review", 403);
    const reason = String(input.reason || "").trim().slice(0, 1000);
    if (action === "revise" && reason.length < 5) return fail("Explain the revision needed");
    const findings = p.findings_json ? JSON.parse(p.findings_json) as Finding[] : [];
    if (!p.latest_run_id || findings.length === 0) return fail("A completed verification run is required", 409);
    const intact = await termsIntact(p);
    if (intact) return fail(intact, 409);
    if (action === "approve") {
      let gate;
      try { gate = decisionGate(JSON.parse(p.criteria_json) as Criterion[],findings); }
      catch { return fail("Findings do not match the agreement's criteria; run verification again", 409); }
      const override = input.override === true;
      const violation = approvalViolation(gate,reason,override);
      if (violation) return fail(violation, 422);
      // The override and the criteria it covers become part of the receipt's hashed reason.
      const recorded = override
        ? `OVERRIDE of required ${gate.blocking.map(b => `#${b.index + 1}`).join(", ")}: ${reason}`
        : reason || "Client reviewed the evidence; every criterion verified.";
      try {
        const receipt = await approveWithReceipt(db(),p,user.email,recorded,cfg.AUDIT_HMAC_KEY);
        if (override) await event(id,user.email,"POLICY_OVERRIDE",`Approved despite failed required criteria ${gate.blocking.map(b => `#${b.index + 1} “${b.label}”`).join("; ")}. Receipt ${receipt.receipt_hash}.`);
        return json({ ok: true, approvalReceiptId: receipt.id, approvalHash: receipt.receipt_hash, mode: gate.mode });
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Approval could not be recorded", 409);
      }
    }
    const allowance = revisionAllowance(p.max_revisions,p.revision_count);
    if (allowance.exhausted) return fail(`The agreed limit of ${p.max_revisions} revision${p.max_revisions === 1 ? "" : "s"} is used up. Approve, approve with an override, or settle outside SavePal.`, 409);
    const changed = await db().prepare("UPDATE projects SET status='REVISION_REQUESTED',decision_reason=?,revision_count=revision_count+1,updated_at=? WHERE id=? AND status='REVIEW' AND approval_receipt_id IS NULL AND revision_count=? AND (max_revisions IS NULL OR revision_count < max_revisions)")
      .bind(reason,now(),id,p.revision_count).run();
    if (!changed.meta.changes) return fail("Milestone state changed; refresh and decide again", 409);
    const used = p.revision_count + 1;
    await event(id,user.email,"REVISION_REQUESTED",`Revision ${used}${p.max_revisions === null ? "" : ` of ${p.max_revisions}`}: ${reason}`);
    return json({ ok: true, revisionsUsed: used });
  }
  if (action === "begin_seller_onboarding") {
    if (userRole !== "freelancer") return fail("Only the assigned freelancer can connect PayPal",403);
    if (!cfg.PAYPAL_PARTNER_MERCHANT_ID || !cfg.PAYPAL_PARTNER_BN_CODE || !cfg.PAYPAL_CLIENT_ID || !cfg.PAYPAL_CLIENT_SECRET)
      return fail("PayPal partner onboarding is not configured",503);
    try {
      const base = new URL(cfg.SITE_ORIGIN || request.url);
      if (base.protocol !== "https:" && base.hostname !== "127.0.0.1") throw new Error("A secure Site origin is required");
      const returnUrl = new URL("/api/p/return",base).toString();
      const result = await beginSellerOnboarding(db(),p,user.email,paypal(),returnUrl,
        cfg.PAYPAL_PARTNER_MERCHANT_ID,cfg.PAYPAL_CLIENT_ID,cfg.AUDIT_HMAC_KEY);
      return json(result);
    } catch (error) { return fail(error instanceof Error ? error.message : "PayPal onboarding failed",502); }
  }
  if (action === "create_order") {
    if (userRole !== "client" || p.status !== "APPROVED") return fail("Client approval is required", 403);
    if (["COMPLETED","PARTIALLY_REFUNDED","REFUNDED"].includes(p.payment_status)) return fail("This milestone already has a captured payment", 409);
    if (p.payment_status === "FAILED") return fail("This attempt failed; reconcile it before another payment", 409);
    const intact = await termsIntact(p);
    if (intact) return fail(intact, 409);
    try {
      const receipt = await requireApprovalReceipt(db(),p,cfg.AUDIT_HMAC_KEY);
      const client = paypal();
      const expected = paymentExpectation(p,orderCustomId(receipt));
      if (cfg.PAYPAL_PARTNER_MERCHANT_ID && cfg.PAYPAL_CLIENT_ID)
        await requireReadySeller(db(),p,client,cfg.PAYPAL_PARTNER_MERCHANT_ID,cfg.PAYPAL_CLIENT_ID);
      if (p.paypal_order_id) {
        const existing = await client.getOrder(p.paypal_order_id,expected.merchantId);
        if (!orderMatches(existing,expected)) return fail("PayPal order does not match the approval receipt", 409);
        const recorded = await db().prepare("SELECT id FROM audit_events WHERE project_id=? AND type IN ('PAYPAL_ORDER_CREATED','PAYPAL_ORDER_RECOVERED') AND detail LIKE ? LIMIT 1")
          .bind(id,`%${p.paypal_order_id}%`).first();
        if (!recorded) await event(id,user.email,"PAYPAL_ORDER_RECOVERED",`Sandbox order ${p.paypal_order_id}; approval ${receipt.receipt_hash}; recovered audit record.`);
        return json({ orderId: p.paypal_order_id });
      }
      if (p.payment_request_id && !retrySafe(p.payment_order_requested_at)) return fail("Order outcome is uncertain after the safe retry window; reconcile with PayPal before another attempt", 409);
      const requestId = p.payment_request_id || crypto.randomUUID();
      const requestedAt = p.payment_order_requested_at || now();
      const reserved = await db().prepare("UPDATE projects SET payment_request_id=COALESCE(payment_request_id,?),payment_order_requested_at=COALESCE(payment_order_requested_at,?),payment_recipient_merchant_id=COALESCE(payment_recipient_merchant_id,?),payment_status='PENDING',updated_at=? WHERE id=? AND status='APPROVED' AND payment_status NOT IN ('COMPLETED','FAILED','PARTIALLY_REFUNDED','REFUNDED') AND paypal_order_id IS NULL AND (payment_request_id IS NULL OR payment_request_id=?) AND (payment_recipient_merchant_id IS NULL OR payment_recipient_merchant_id=?) AND approval_receipt_id=?")
        .bind(requestId,requestedAt,expected.merchantId,now(),id,requestId,expected.merchantId,receipt.id).run();
      if (!reserved.meta.changes) return fail("Payment state changed; refresh before checkout", 409);
      const created = await client.createOrder(expected,requestId);
      if (!safeProviderId(created.id)) throw new Error("PayPal returned an invalid order ID");
      const stored = await db().prepare("UPDATE projects SET paypal_order_id=?,updated_at=? WHERE id=? AND paypal_order_id IS NULL AND status='APPROVED' AND approval_receipt_id=? AND payment_request_id=?")
        .bind(created.id,now(),id,receipt.id,requestId).run();
      const latest = await project(id);
      if (!latest?.paypal_order_id) throw new Error("Order was created but could not be recorded; retry with the same idempotency key");
      if (latest.paypal_order_id !== created.id) throw new Error("PayPal returned a conflicting order ID");
      const providerOrder = await client.getOrder(created.id,expected.merchantId);
      if (!orderMatches(providerOrder,{...expected,orderId:created.id})) throw new Error("PayPal order amount, reference, or approval binding does not match");
      if (stored.meta.changes) await event(id,user.email,"PAYPAL_ORDER_CREATED",`Sandbox order ${created.id}; approval ${receipt.receipt_hash}; request ${requestId}`);
      return json({ orderId: latest.paypal_order_id });
    } catch (error) { return fail(error instanceof Error ? error.message : "PayPal request failed", 502); }
  }
  if (action === "capture_order") {
    if (userRole !== "client" || p.status !== "APPROVED" || !p.paypal_order_id || String(input.orderId) !== p.paypal_order_id) return fail("Order does not match the approved milestone", 403);
    try {
      const receipt = await requireApprovalReceipt(db(),p,cfg.AUDIT_HMAC_KEY);
      const client = paypal();
      const expected = paymentExpectation(p,orderCustomId(receipt));
      let order = await client.getOrder(p.paypal_order_id,expected.merchantId);
      if (!orderMatches(order,expected)) return fail("PayPal order does not match the approval receipt", 409);
      const providerCaptures = order.purchase_units?.[0]?.payments?.captures || [];
      let captured = orderCapture(order,expected);
      if (providerCaptures.length && !captured) return fail("PayPal returned a conflicting capture", 409);
      if (!captured) {
        if (p.paypal_capture_id) return fail("Stored capture is missing from PayPal order; reconcile before retrying", 409);
        if (p.payment_capture_request_id && !retrySafe(p.payment_capture_requested_at)) return fail("Capture outcome is uncertain after the safe retry window; reconcile with PayPal before another attempt", 409);
        const requestId = p.payment_capture_request_id || crypto.randomUUID();
        const requestedAt = p.payment_capture_requested_at || now();
        const reserved = await db().prepare("UPDATE projects SET payment_capture_request_id=COALESCE(payment_capture_request_id,?),payment_capture_requested_at=COALESCE(payment_capture_requested_at,?),updated_at=? WHERE id=? AND status='APPROVED' AND paypal_order_id=? AND paypal_capture_id IS NULL AND payment_status NOT IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED') AND approval_receipt_id=? AND (payment_capture_request_id IS NULL OR payment_capture_request_id=?)")
          .bind(requestId,requestedAt,now(),id,p.paypal_order_id,receipt.id,requestId).run();
        if (!reserved.meta.changes) return fail("Capture state changed; reconcile before retrying", 409);
        const result = await client.captureOrder(p.paypal_order_id,requestId,expected.merchantId);
        if (result.id && result.id !== p.paypal_order_id) throw new Error("PayPal capture returned a different order ID");
        order = await client.getOrder(p.paypal_order_id,expected.merchantId);
        if (!orderMatches(order,expected)) throw new Error("PayPal order changed during capture");
        captured = orderCapture(order,expected);
        if (!captured) throw new Error("PayPal capture could not be confirmed from the order");
      }
      const providerCapture = await client.getCapture(captured.id!,expected.merchantId);
      const observation = await recordCaptureObservation(db(),p,order,providerCapture,expected.customId,p.paypal_capture_id ? "RECOVERY" : "CAPTURE",undefined,cfg.AUDIT_HMAC_KEY);
      return json({ status: observation.status, captureId: observation.captureId });
    } catch (error) { return fail(error instanceof Error ? error.message : "PayPal capture failed", 502); }
  }
  if (action === "sync_payment") {
    if (userRole !== "client" || (!p.paypal_order_id && !p.payment_request_id) || p.status !== "APPROVED") return fail("No payment request is available to reconcile", 409);
    try {
      const result = await reconcileProject(db(),p,paypal(),cfg.AUDIT_HMAC_KEY,"MANUAL");
      if (result.outcome === "ERROR" || result.outcome.endsWith("REVIEW_REQUIRED"))
        return fail(`PayPal reconciliation requires review: ${result.outcome}`,409);
      return json(result);
    } catch (error) { return fail(error instanceof Error ? error.message : "Payment reconciliation failed", 502); }
  }
  return fail("Unknown action");
}

import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { CHECKER_VERSION, captureMatches, canApplyPaymentStatus, parseUsdCents, providerPaymentStatus, readBoundedHtml, safeWebsiteUrl, type Criterion, type Finding, type WebsiteResult } from "../../../lib/assurance";
import { appendAudit, verifyAudit } from "../../../lib/audit";
import { captureWebsite, evaluateSnapshot, sha256, snapshotManifest, validateSnapshot } from "../../../lib/website-evidence";
import { reviewWithAi } from "../../../lib/ai-verification";

export const runtime = "edge";

type Project = {
  id: string; client_id: string; client_email: string; freelancer_email: string;
  title: string; description: string; amount_cents: number; currency: string;
  criteria_json: string; status: string; evidence_url: string | null;
  evidence_notes: string | null; evidence_hash: string | null; evidence_at: string | null;
  findings_json: string | null; evaluated_at: string | null; decision_reason: string | null;
  paypal_order_id: string | null; paypal_capture_id: string | null;
  payment_status: string; payment_request_id: string | null;
  created_at: string; updated_at: string; latest_run_id: string | null; current_submission_id: string | null;
};
type EvidenceSubmission = { id: string; project_id: string; submission_hash: string; snapshot_hash: string; snapshot_key: string; manifest_json: string; created_at: string };

const db = () => {
  if (!env.DB) throw new Error("Database is unavailable");
  return env.DB;
};
const cfg = env as Cloudflare.Env & { PAYPAL_CLIENT_ID?: string; PAYPAL_CLIENT_SECRET?: string; OPENAI_API_KEY?: string; OPENAI_MODEL?: string; AUDIT_HMAC_KEY?: string };
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
function view(p: Project, user: { userId: string; email: string }) {
  const staleEvaluation = p.status === "EVALUATING" && new Date(p.updated_at).getTime() < Date.now() - 5 * 60_000;
  return {
    ...p,
    status: staleEvaluation ? "SUBMITTED" : p.status,
    role: role(p, user),
    criteria: JSON.parse(p.criteria_json) as Criterion[],
    findings: p.findings_json ? JSON.parse(p.findings_json) as Finding[] : null,
    criteria_json: undefined, findings_json: undefined, payment_request_id: undefined,
  };
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return fail("Sign in is required", 401);
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const p = await project(id);
    if (!p || !role(p, user)) return fail("Agreement not found", 404);
    const audit = await db().prepare("SELECT actor, type, detail, created_at FROM audit_events WHERE project_id = ? ORDER BY id DESC").bind(id).all();
    const auditIntegrity = await verifyAudit(db(),id,cfg.AUDIT_HMAC_KEY);
    const submissions = await db().prepare("SELECT id,submission_hash,snapshot_hash,manifest_json,created_at FROM evidence_submissions WHERE project_id=? ORDER BY created_at DESC LIMIT 20").bind(id).all<Pick<EvidenceSubmission,"id"|"submission_hash"|"snapshot_hash"|"manifest_json"|"created_at">>();
    const verificationRun = p.latest_run_id ? await db().prepare("SELECT id,submission_id,snapshot_hash,checker_version,model,started_at,completed_at,state,website_status,website_body_hash,website_truncated,findings_json,ai_note,coverage_json FROM verification_runs WHERE id=? AND project_id=?").bind(p.latest_run_id,id).first() : null;
    return json({ project: view(p, user), audit: audit.results, auditIntegrity, evidenceHistory: submissions.results.map(s => ({ ...s, manifest: JSON.parse(s.manifest_json), manifest_json: undefined })), verificationRun });
  }
  const rows = await db().prepare("SELECT * FROM projects WHERE client_id = ? OR lower(freelancer_email) = ? ORDER BY created_at DESC")
    .bind(user.userId, user.email.toLowerCase()).all<Project>();
  return json({ user: { name: user.displayName, email: user.email }, projects: rows.results.map(p => view(p, user)), paypalReady: !!(cfg.PAYPAL_CLIENT_ID && cfg.PAYPAL_CLIENT_SECRET), paypalClientId: cfg.PAYPAL_CLIENT_ID || null, aiReady: !!cfg.OPENAI_API_KEY });
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
  const raw = JSON.stringify(snapshot);
  const snapshotHash = await sha256(raw);
  const key = `evidence/${projectId}/${submissionId}.json`;
  await env.BUCKET.put(key,raw,{ httpMetadata: { contentType: "application/json" } });
  return { snapshot, snapshotHash, key };
}
async function paypalToken() {
  if (!cfg.PAYPAL_CLIENT_ID || !cfg.PAYPAL_CLIENT_SECRET) throw new Error("PayPal sandbox credentials are not configured");
  const basic = btoa(`${cfg.PAYPAL_CLIENT_ID}:${cfg.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
    method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error("PayPal authentication failed");
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return fail("Sign in is required", 401);
  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; } catch { return fail("Invalid JSON"); }
  const action = input.action;
  if (action === "create") {
    const title = String(input.title || "").trim().slice(0, 120);
    const description = String(input.description || "").trim().slice(0, 2000);
    const freelancerEmail = String(input.freelancerEmail || "").trim().toLowerCase();
    const amountCents = parseUsdCents(input.amount);
    const criteria = input.criteria;
    if (!title || !description || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(freelancerEmail) || freelancerEmail === user.email.toLowerCase() || amountCents === null) return fail("Enter a title, scope, a different freelancer email, and a USD amount from $1 to $1,000,000 with at most two decimals");
    if (!Array.isArray(criteria) || criteria.length < 1 || criteria.length > 8 || !criteria.every(c => c && typeof c.label === "string" && c.label.trim().length > 2 && c.label.length <= 240 && ["reachable", "contains", "manual"].includes(c.kind) && (c.kind !== "contains" || (typeof c.needle === "string" && c.needle.trim().length > 0 && c.needle.length <= 100)))) return fail("Add 1–8 valid acceptance criteria");
    const id = crypto.randomUUID(), time = now();
    await db().prepare("INSERT INTO projects (id,client_id,client_email,freelancer_email,title,description,amount_cents,currency,criteria_json,status,payment_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id,user.userId,user.email,freelancerEmail,title,description,amountCents,"USD",JSON.stringify(criteria),"INVITED","NOT_STARTED",time,time).run();
    await event(id,user.email,"AGREEMENT_CREATED","Version 1 accepted by client; awaiting freelancer acceptance. Criteria and amount are locked.");
    return json({ id }, 201);
  }
  const id = String(input.id || "");
  let p = await project(id);
  if (!p) return fail("Agreement not found", 404);
  const userRole = role(p, user);
  if (!userRole) return fail("Access denied", 403);

  if (action === "accept") {
    if (userRole !== "freelancer" || p.status !== "INVITED") return fail("Only the invited freelancer can accept this agreement", 403);
    const changed = await db().prepare("UPDATE projects SET status='AGREED',updated_at=? WHERE id=? AND status='INVITED'").bind(now(),id).run();
    if (!changed.meta.changes) return fail("Agreement state changed; refresh and try again", 409);
    await event(id,user.email,"AGREEMENT_ACCEPTED","Freelancer accepted agreement version 1.");
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
      const livePages = await Promise.all(snapshot.pages.map(async page => ({ url: page.url, ...await inspectWebsite(page.url) })));
      const criteria = JSON.parse(p.criteria_json) as Criterion[];
      const objectiveFindings = evaluateSnapshot(criteria,snapshot,livePages);
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
      await db().prepare("UPDATE verification_runs SET state='COMPLETED',completed_at=?,website_status=?,website_body_hash=?,website_truncated=?,findings_json=?,ai_note=?,coverage_json=? WHERE id=?")
        .bind(time,liveRoot.status,coverage.livePages[0].bodyHash,liveRoot.truncated ? 1 : 0,JSON.stringify(findings),note,JSON.stringify(coverage),runId).run();
      const complete = await db().prepare("UPDATE projects SET findings_json=?,evaluated_at=?,status='REVIEW',updated_at=? WHERE id=? AND status='EVALUATING' AND latest_run_id=? AND evidence_hash=? AND current_submission_id=?")
        .bind(JSON.stringify(findings),time,time,id,runId,p.evidence_hash,submission.id).run();
      if (!complete.meta.changes) {
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
    if (action === "approve" && findings.some(f => f.status !== "VERIFIED") && reason.length < 5) return fail("Explain why you are approving an inconclusive or failed check");
    const status = action === "approve" ? "APPROVED" : "REVISION_REQUESTED";
    const changed = await db().prepare("UPDATE projects SET status=?,decision_reason=?,updated_at=? WHERE id=? AND status='REVIEW'").bind(status,reason || "Client reviewed the evidence and approved.",now(),id).run();
    if (!changed.meta.changes) return fail("Milestone state changed; refresh and decide again", 409);
    await event(id,user.email,action === "approve" ? "CLIENT_APPROVED" : "REVISION_REQUESTED",reason || "Client reviewed the evidence and approved.");
    return json({ ok: true });
  }
  if (action === "create_order") {
    if (userRole !== "client" || p.status !== "APPROVED") return fail("Client approval is required", 403);
    if (p.payment_status === "COMPLETED") return fail("This milestone is already paid", 409);
    if (p.payment_status === "FAILED") return fail("This attempt failed; reconcile it before another payment", 409);
    if (p.paypal_order_id) return json({ orderId: p.paypal_order_id });
    try {
      const token = await paypalToken();
      const requestId = p.payment_request_id || `${id}-create`;
      const reserved = await db().prepare("UPDATE projects SET payment_request_id=?,payment_status='PENDING',updated_at=? WHERE id=? AND status='APPROVED' AND payment_status NOT IN ('COMPLETED','FAILED') AND paypal_order_id IS NULL")
        .bind(requestId,now(),id).run();
      if (!reserved.meta.changes) return fail("Payment state changed; refresh before checkout", 409);
      const response = await fetch("https://api-m.sandbox.paypal.com/v2/checkout/orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": requestId },
        body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ reference_id: id, custom_id: id, amount: { currency_code: p.currency, value: (p.amount_cents / 100).toFixed(2) } }] }),
      });
      const data = await response.json() as { id?: string; message?: string };
      if (!response.ok || !data.id) throw new Error(data.message || "PayPal order creation failed");
      const stored = await db().prepare("UPDATE projects SET paypal_order_id=?,updated_at=? WHERE id=? AND paypal_order_id IS NULL AND status='APPROVED'")
        .bind(data.id,now(),id).run();
      if (stored.meta.changes) await event(id,user.email,"PAYPAL_ORDER_CREATED",`Sandbox order ${data.id}`);
      const latest = await project(id);
      if (!latest?.paypal_order_id) throw new Error("Order was created but could not be recorded; retry with the same idempotency key");
      if (latest.paypal_order_id !== data.id) throw new Error("PayPal returned a conflicting order ID");
      return json({ orderId: latest.paypal_order_id });
    } catch (error) { return fail(error instanceof Error ? error.message : "PayPal request failed", 502); }
  }
  if (action === "capture_order") {
    if (userRole !== "client" || p.status !== "APPROVED" || !p.paypal_order_id || String(input.orderId) !== p.paypal_order_id) return fail("Order does not match the approved milestone", 403);
    if (p.payment_status === "COMPLETED") return json({ status: "COMPLETED", captureId: p.paypal_capture_id });
    try {
      const token = await paypalToken();
      const response = await fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${encodeURIComponent(p.paypal_order_id)}/capture`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": `${id}-capture` }, body: "{}",
      });
      const data = await response.json() as { status?: string; purchase_units?: Array<{ payments?: { captures?: Array<{ id: string; status: string; amount?: { value: string; currency_code: string } }> } }> };
      const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
      if (!response.ok || !capture) throw new Error("PayPal did not return a capture");
      if (!captureMatches(capture,p.amount_cents,p.currency)) throw new Error("PayPal capture amount or currency mismatch");
      const status = providerPaymentStatus(capture.status);
      const stored = await db().prepare("UPDATE projects SET paypal_capture_id=?,payment_status=?,updated_at=? WHERE id=? AND paypal_order_id=? AND (paypal_capture_id IS NULL OR paypal_capture_id=?) AND payment_status!='COMPLETED'")
        .bind(capture.id,status,now(),id,p.paypal_order_id,capture.id).run();
      if (!stored.meta.changes) {
        const latest = await project(id);
        if (latest?.payment_status === "COMPLETED" && latest.paypal_capture_id === capture.id) return json({ status: "COMPLETED", captureId: capture.id });
        throw new Error("Capture state changed; reconcile before retrying");
      }
      await event(id,user.email,"PAYPAL_CAPTURE_RESULT",`Sandbox capture ${capture.id}: ${capture.status}`);
      return json({ status, captureId: capture.id });
    } catch (error) { return fail(error instanceof Error ? error.message : "PayPal capture failed", 502); }
  }
  if (action === "sync_payment") {
    if (userRole !== "client" || !p.paypal_capture_id || p.status !== "APPROVED") return fail("No capture is available to reconcile", 409);
    try {
      const token = await paypalToken();
      const response = await fetch(`https://api-m.sandbox.paypal.com/v2/payments/captures/${encodeURIComponent(p.paypal_capture_id)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("PayPal status lookup failed");
      const capture = await response.json() as { id?: string; status?: string; amount?: { value?: string; currency_code?: string } };
      if (!captureMatches(capture,p.amount_cents,p.currency,p.paypal_capture_id)) throw new Error("PayPal capture does not match this milestone");
      const status = providerPaymentStatus(capture.status);
      if (!canApplyPaymentStatus(p.payment_status,status)) return json({ status: p.payment_status });
      const changed = await db().prepare("UPDATE projects SET payment_status=?,updated_at=? WHERE id=? AND paypal_capture_id=? AND payment_status=?")
        .bind(status,now(),id,p.paypal_capture_id,p.payment_status).run();
      if (!changed.meta.changes) return fail("Payment state changed; refresh and reconcile again", 409);
      await event(id,user.email,"PAYMENT_RECONCILED",`Sandbox capture ${capture.id}: ${capture.status}`);
      return json({ status });
    } catch (error) { return fail(error instanceof Error ? error.message : "Payment reconciliation failed", 502); }
  }
  return fail("Unknown action");
}

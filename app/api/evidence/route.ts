import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { validateSnapshot } from "../../../lib/website-evidence";

export const runtime = "edge";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in is required" }, { status: 401 });
  if (!env.DB || !env.BUCKET) return Response.json({ error: "Evidence storage is unavailable" }, { status: 503 });
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const submissionId = url.searchParams.get("submissionId");
  if (!projectId || !submissionId) return Response.json({ error: "Project and submission IDs are required" }, { status: 400 });
  const project = await env.DB.prepare("SELECT client_id,freelancer_email FROM projects WHERE id=?").bind(projectId).first<{ client_id: string; freelancer_email: string }>();
  if (!project || (project.client_id !== user.userId && project.freelancer_email.toLowerCase() !== user.email.toLowerCase())) return Response.json({ error: "Evidence not found" }, { status: 404 });
  const submission = await env.DB.prepare("SELECT snapshot_key,snapshot_hash,manifest_json,url FROM evidence_submissions WHERE id=? AND project_id=?")
    .bind(submissionId,projectId).first<{ snapshot_key: string; snapshot_hash: string; manifest_json: string; url: string }>();
  if (!submission) return Response.json({ error: "Evidence not found" }, { status: 404 });
  const object = await env.BUCKET.get(submission.snapshot_key);
  if (!object) return Response.json({ error: "Evidence snapshot is missing" }, { status: 409 });
  const raw = await object.text();
  if (!await validateSnapshot(raw,submission.snapshot_hash,submission.manifest_json,submission.url)) return Response.json({ error: "Evidence snapshot failed integrity verification" }, { status: 409 });
  return new Response(raw, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

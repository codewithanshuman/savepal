import { type Criterion, type WebsiteResult } from "./assurance.ts";
import { evaluateSnapshot, sha256, type AdvancedFinding, type WebsiteSnapshot } from "./website-evidence.ts";
import { validateRenderedPage, type RenderedPage } from "./browser-evidence.ts";

export const VERIFICATION_INPUT_VERSION = "verification-input-v1";
export type CapturedLivePage = WebsiteResult & { url: string; renderedRoot?: RenderedPage };
export type VerificationInput = {
  version: typeof VERIFICATION_INPUT_VERSION;
  projectId: string;
  runId: string;
  submissionId: string;
  snapshotHash: string;
  criteriaHash: string;
  capturedAt: string;
  pages: CapturedLivePage[];
};
export type VerificationArtifact = {
  id: string; project_id: string; run_id: string; submission_id: string;
  snapshot_hash: string; criteria_hash: string; live_key: string;
  live_hash: string; objective_hash: string; created_at: string;
};

export async function createVerificationInput(
  projectId: string, runId: string, submissionId: string, snapshotHash: string,
  criteriaJson: string, pages: CapturedLivePage[], capturedAt: string,
): Promise<{ input: VerificationInput; raw: string; hash: string }> {
  if (pages.length < 1 || pages.length > 6 || pages.some(page => page.body.length > 100_000))
    throw new Error("Live verification evidence exceeds its bound");
  const input: VerificationInput = {
    version: VERIFICATION_INPUT_VERSION, projectId, runId, submissionId, snapshotHash,
    criteriaHash: await sha256(criteriaJson), capturedAt, pages,
  };
  const raw = JSON.stringify(input);
  return { input, raw, hash: await sha256(raw) };
}

export async function replayVerification(
  raw: string, artifact: VerificationArtifact, snapshot: WebsiteSnapshot,
  criteriaJson: string, storedFindingsJson: string,
): Promise<{ valid: boolean; checks: Record<string, boolean>; objectiveFindings: AdvancedFinding[] | null }> {
  const checks: Record<string, boolean> = {};
  checks.liveHash = await sha256(raw) === artifact.live_hash;
  let input: VerificationInput;
  try { input = JSON.parse(raw) as VerificationInput; }
  catch { return { valid: false, checks: { ...checks, format: false }, objectiveFindings: null }; }
  checks.binding = input.version === VERIFICATION_INPUT_VERSION &&
    input.projectId === artifact.project_id && input.runId === artifact.run_id &&
    input.submissionId === artifact.submission_id && input.snapshotHash === artifact.snapshot_hash &&
    input.criteriaHash === artifact.criteria_hash && input.criteriaHash === await sha256(criteriaJson);
  checks.pages = Array.isArray(input.pages) && input.pages.length === snapshot.pages.length &&
    input.pages.every((page,index) => page.url === snapshot.pages[index].url &&
      typeof page.body === "string" && page.body.length <= 100_000 &&
      Number.isInteger(page.status) && typeof page.truncated === "boolean");
  checks.rendered = !!snapshot.renderedRoot === !!input.pages?.[0]?.renderedRoot &&
    await validateRenderedPage(input.pages?.[0]?.renderedRoot,snapshot.rootUrl);
  if (!checks.liveHash || !checks.binding || !checks.pages) return { valid: false, checks, objectiveFindings: null };
  let criteria: Criterion[], stored: Array<AdvancedFinding & { aiReview?: unknown }>;
  try {
    criteria = JSON.parse(criteriaJson) as Criterion[];
    stored = JSON.parse(storedFindingsJson) as typeof stored;
    if (!Array.isArray(criteria) || !Array.isArray(stored)) throw new Error("Invalid findings");
  } catch { return { valid: false, checks: { ...checks, findingsFormat: false }, objectiveFindings: null }; }
  const objectiveFindings = evaluateSnapshot(criteria,snapshot,input.pages);
  const objectiveHash = await sha256(JSON.stringify(objectiveFindings));
  checks.objectiveHash = objectiveHash === artifact.objective_hash;
  const storedObjective = stored.map(({ aiReview: _advisory, ...finding }) => finding);
  checks.storedFindings = JSON.stringify(storedObjective) === JSON.stringify(objectiveFindings);
  return { valid: Object.values(checks).every(Boolean), checks, objectiveFindings };
}

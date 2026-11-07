import type { Criterion, Finding } from "./assurance.ts";

export type Transition = "IMPROVED" | "REGRESSED" | "UNCHANGED" | "CHANGED" | "FIRST";
export type CriterionDelta = { index: number; label: string; from: Finding["status"] | null; to: Finding["status"]; transition: Transition };
export type RunSummary = {
  runId: string; submissionId: string | null; completedAt: string | null;
  verified: number; failed: number; inconclusive: number;
  deltas: CriterionDelta[]; improved: number; regressed: number;
  /** Positive when this run is better than the one before it. */
  scoreChange: number | null; score: number;
};

const rank: Record<Finding["status"], number> = { FAILED: 0, INCONCLUSIVE: 1, VERIFIED: 2 };

/** Progress score in [0,100]: verified counts fully, inconclusive counts half. */
export function progressScore(findings: Finding[]): number {
  if (!findings.length) return 0;
  return Math.round(findings.reduce((sum, f) => sum + rank[f.status], 0) / (findings.length * 2) * 100);
}

export function compareFindings(criteria: Criterion[], previous: Finding[] | null, current: Finding[]): CriterionDelta[] {
  return current.map((finding, index) => {
    const before = previous && previous.length === current.length ? previous[index]?.status ?? null : null;
    const transition: Transition = before === null ? "FIRST" :
      before === finding.status ? "UNCHANGED" :
      rank[finding.status] > rank[before] ? "IMPROVED" :
      rank[finding.status] < rank[before] ? "REGRESSED" : "CHANGED";
    return { index, label: criteria[index]?.label ?? finding.label, from: before, to: finding.status, transition };
  });
}

/**
 * Builds the revision history, oldest first, from completed verification runs. Re-runs of the same
 * submission are kept: a regression without a new submission means the live site changed.
 */
export function revisionHistory(
  criteria: Criterion[],
  runs: Array<{ id: string; submission_id: string | null; completed_at: string | null; findings_json: string | null }>,
): RunSummary[] {
  const history: RunSummary[] = [];
  let previous: Finding[] | null = null;
  for (const run of runs) {
    if (!run.findings_json) continue;
    let findings: Finding[];
    try { findings = JSON.parse(run.findings_json) as Finding[]; } catch { continue; }
    if (!Array.isArray(findings) || findings.length !== criteria.length) continue;
    const deltas = compareFindings(criteria, previous, findings);
    const score = progressScore(findings);
    history.push({
      runId: run.id, submissionId: run.submission_id, completedAt: run.completed_at,
      verified: findings.filter(f => f.status === "VERIFIED").length,
      failed: findings.filter(f => f.status === "FAILED").length,
      inconclusive: findings.filter(f => f.status === "INCONCLUSIVE").length,
      deltas, improved: deltas.filter(d => d.transition === "IMPROVED").length,
      regressed: deltas.filter(d => d.transition === "REGRESSED").length,
      score, scoreChange: previous ? score - progressScore(previous) : null,
    });
    previous = findings;
  }
  return history;
}

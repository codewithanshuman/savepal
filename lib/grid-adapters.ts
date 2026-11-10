/*
 * Pure transformations from the workspace API's responses into the rows SavePal's tables show:
 * the evidence matrix, the comparison with the previous check, and the agreements table. No I/O,
 * no React, no grid library -- the tables render exactly what these return, and the tests check
 * it. Every value comes from a saved record (locked criteria, saved findings, the server's own
 * approval gate and run history); nothing is generated or guessed, and nothing here decides
 * whether money can move -- that stays with the server's decision policy.
 */

export type ResultStatus = "VERIFIED" | "FAILED" | "INCONCLUSIVE" | "NOT_CHECKED";
export type Transition = "IMPROVED" | "REGRESSED" | "UNCHANGED" | "CHANGED" | "FIRST";
/** UNKNOWN: the server has not classified this result (no approval gate was returned). */
export type ApprovalEffect = "BLOCKS" | "NEEDS_CONFIRMATION" | "ADVISORY" | "CLEAR" | "NOT_CHECKED" | "UNKNOWN";

type Criterion = { label: string; kind: string; needle?: string; required?: boolean };
type Finding = { label: string; status: "VERIFIED" | "FAILED" | "INCONCLUSIVE"; explanation: string; check: string; confidence?: "HIGH" | "MEDIUM" | "LOW"; evidenceRefs?: Array<{ url: string; excerpt?: string }> };
type GateItem = { index: number };
type Gate = { blocking: GateItem[]; unconfirmed: GateItem[]; advisory: GateItem[] };
type Delta = { index: number; label: string; from: "VERIFIED" | "FAILED" | "INCONCLUSIVE" | null; to: "VERIFIED" | "FAILED" | "INCONCLUSIVE"; transition: Transition };
export type RunSummary = { runId: string; submissionId: string | null; completedAt: string | null; deltas: Delta[] };
export type RunRecord = { id: string; submission_id: string | null; state: string; completed_at: string | null; checker_version?: string | null; model?: string | null; website_status?: number | null; ai_note?: string | null };

export type EvidenceRow = {
  /** Agreement, check and criterion together: results of different checks never share an id. */
  id: string;
  index: number;
  criterion: string;
  required: boolean;
  kind: string;
  needle: string | null;
  result: ResultStatus;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  explanation: string | null;
  check: string | null;
  sources: Array<{ url: string; excerpt?: string }>;
  /** What the server's approval gate makes of this criterion. */
  effect: ApprovalEffect;
  /** Versus the previous completed check. */
  change: Transition | null;
  previous: ResultStatus | null;
};

export type Freshness = { state: "NONE" | "CURRENT" | "RUNNING" | "STALE"; runId: string | null; completedAt: string | null };

/** Which check the saved findings belong to, and whether it is the check of the current delivery. */
export function freshness(input: { findings: unknown[] | null; history: RunSummary[]; latestRun: RunRecord | null; currentSubmissionId: string | null }): Freshness {
  const done = input.history[input.history.length - 1] ?? null;
  if (!input.findings?.length) return { state: input.latestRun && input.latestRun.state !== "COMPLETED" ? "RUNNING" : "NONE", runId: null, completedAt: null };
  const runId = done?.runId ?? input.latestRun?.id ?? null, completedAt = done?.completedAt ?? input.latestRun?.completed_at ?? null;
  if (input.latestRun && input.latestRun.state !== "COMPLETED" && input.latestRun.id !== done?.runId) return { state: "RUNNING", runId, completedAt };
  if (input.currentSubmissionId && done?.submissionId && done.submissionId !== input.currentSubmissionId) return { state: "STALE", runId, completedAt };
  return { state: "CURRENT", runId, completedAt };
}

/** One row per locked acceptance criterion, with its saved result from the latest completed check. */
export function evidenceRows(input: { projectId: string; criteria: Criterion[]; findings: Finding[] | null; gate: Gate | null; history: RunSummary[]; runId: string | null }): EvidenceRow[] {
  const last = input.history[input.history.length - 1];
  const deltas = new Map((last?.runId === input.runId ? last.deltas : []).map(d => [d.index, d]));
  const inGate = (list: GateItem[] | undefined, i: number) => !!list?.some(x => x.index === i);
  return input.criteria.map((c, i) => {
    const f = input.findings?.[i];
    const result: ResultStatus = f?.status ?? "NOT_CHECKED";
    const effect: ApprovalEffect = !f ? "NOT_CHECKED"
      : inGate(input.gate?.blocking, i) ? "BLOCKS" : inGate(input.gate?.unconfirmed, i) ? "NEEDS_CONFIRMATION"
      : inGate(input.gate?.advisory, i) ? "ADVISORY" : result === "VERIFIED" ? "CLEAR" : "UNKNOWN";
    const d = deltas.get(i);
    return {
      id: `${input.projectId}:${input.runId ?? "unchecked"}:${i}`, index: i, criterion: c.label, required: c.required !== false,
      kind: c.kind, needle: c.needle ?? null, result, confidence: f?.confidence ?? null,
      explanation: f?.explanation ?? null, check: f?.check ?? null, sources: f?.evidenceRefs ?? [],
      effect, change: d?.transition ?? null, previous: d ? (d.from ?? "NOT_CHECKED") : null,
    };
  });
}

export type ComparisonRow = { id: string; index: number; criterion: string; previous: ResultStatus; latest: ResultStatus; change: Transition };
/** The latest completed check against the one before it. Empty until there have been two. */
export function comparisonRows(projectId: string, history: RunSummary[]): { rows: ComparisonRow[]; from: RunSummary | null; to: RunSummary | null } {
  if (history.length < 2) return { rows: [], from: null, to: history[history.length - 1] ?? null };
  const from = history[history.length - 2]!, to = history[history.length - 1]!;
  return {
    from, to,
    rows: to.deltas.map(d => ({ id: `${projectId}:${from.runId}->${to.runId}:${d.index}`, index: d.index, criterion: d.label, previous: d.from ?? "NOT_CHECKED", latest: d.to, change: d.transition })),
  };
}

/** Counts of each result, for the summary above the matrix. */
export function resultCounts(rows: EvidenceRow[]): Record<ResultStatus, number> {
  const out: Record<ResultStatus, number> = { VERIFIED: 0, FAILED: 0, INCONCLUSIVE: 0, NOT_CHECKED: 0 };
  for (const r of rows) out[r.result]++;
  return out;
}

/** The filters above the matrix: by result, and required criteria only. */
export function matchesEvidenceFilter(row: EvidenceRow, result: ResultStatus | "ALL", requiredOnly: boolean): boolean {
  return (result === "ALL" || row.result === result) && (!requiredOnly || row.required);
}

// ── the agreements table ─────────────────────────────────────────────────────

type AgreementProject = {
  id: string; title: string; role: "client" | "freelancer"; client_email: string; freelancer_email: string;
  amount_cents: number; currency: string; status: string; payment_status: string;
  funding: { mode: string; status: string };
  created_at: string; accepted_at: string | null; evidence_at: string | null; evaluated_at: string | null;
};
export type Move = { mine: boolean; title: string; tone: "act" | "wait" | "done" | "warn" };
export type AgreementRow = {
  id: string; title: string; other: string; role: "Client" | "Freelancer"; amountCents: number; currency: string;
  milestone: string; payment: string; next: string; mine: boolean; tone: Move["tone"]; updated: string;
};

const MILESTONE: Record<string, string> = { INVITED: "Invited", AGREED: "Agreed", SUBMITTED: "Submitted", REVIEW: "Under review", REVISION_REQUESTED: "Revision requested", APPROVED: "Approved" };
const PAID = ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"];

/** The agreement's money in plain words, from its recorded payment and hold. */
export function paymentLabel(p: Pick<AgreementProject, "payment_status" | "funding">): string {
  if (p.payment_status === "REFUNDED") return "Refunded";
  if (p.payment_status === "PARTIALLY_REFUNDED") return "Paid, partly refunded";
  if (p.funding.status === "CAPTURED" || PAID.includes(p.payment_status)) return "Paid";
  if (p.payment_status === "PENDING") return "Payment pending";
  if (p.payment_status === "FAILED") return "Payment failed";
  const hold: Record<string, string> = { HELD: "Held by PayPal", PENDING: "Hold pending", ORDER_CREATED: "Awaiting PayPal approval", VOIDED: "Returned to client", EXPIRED: "Hold expired", FAILED: "Hold failed" };
  if (p.funding.mode === "HOLD" && hold[p.funding.status]) return hold[p.funding.status]!;
  return "Not started";
}

/** One row per agreement. The next move comes from the workspace's own nextMove(), passed in. */
export function agreementRows(projects: AgreementProject[], move: (p: AgreementProject) => Move): AgreementRow[] {
  return projects.map(p => {
    const m = move(p), other = p.role === "client" ? p.freelancer_email : p.client_email;
    const updated = [p.created_at, p.accepted_at, p.evidence_at, p.evaluated_at].filter((x): x is string => !!x).sort().pop() ?? p.created_at;
    return {
      id: p.id, title: p.title, other, role: p.role === "client" ? "Client" : "Freelancer", amountCents: p.amount_cents, currency: p.currency,
      milestone: MILESTONE[p.status] ?? p.status, payment: paymentLabel(p), next: m.title, mine: m.mine, tone: m.tone, updated,
    };
  });
}

// ── the payment detail panel ─────────────────────────────────────────────────

const PAYMENT_EVENTS: Record<string, RegExp> = {
  HOLD: /^(FUNDS_|PAYPAL_HOLD_)/,
  PAYMENT: /^(PAYPAL_ORDER_|PAYPAL_CAPTURE_|CAPTURE_|ORDER_REVIEW|FUNDS_RELEASED|CLIENT_APPROVED)/,
  BOUNTY: /^BOUNTY_/,
  REFUND: /^(APPEAL_|REFUND_)/,
};
/** The audit events that belong to one kind of payment operation, newest first. */
export function paymentEvents<T extends { type: string; created_at: string }>(kind: string, audit: T[]): T[] {
  const re = PAYMENT_EVENTS[kind];
  return re ? audit.filter(e => re.test(e.type)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) : [];
}

/** A long provider id shortened for a table cell; the detail panel shows it whole. */
export function shortRef(ref: string | null): string {
  if (!ref) return "—";
  return ref.length > 14 ? `${ref.slice(0, 6)}…${ref.slice(-4)}` : ref;
}

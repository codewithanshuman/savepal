import { isRequired, type Criterion, type Finding } from "./assurance.ts";

export type GateItem = { index: number; label: string; status: Finding["status"]; required: boolean };
export type DecisionGate = {
  /** Required criteria that failed: approval needs an explicit, justified override. */
  blocking: GateItem[];
  /** Required criteria nobody could prove: approval needs the client to confirm them by hand. */
  unconfirmed: GateItem[];
  /** Optional criteria that did not verify: recorded, never blocking. */
  advisory: GateItem[];
  verified: number;
  total: number;
  /** "CLEAR" approves freely; "CONFIRM" needs a reason; "OVERRIDE" needs override=true and a longer reason. */
  mode: "CLEAR" | "CONFIRM" | "OVERRIDE";
  minimumReason: number;
};

export const CONFIRM_REASON = 5;
export const OVERRIDE_REASON = 20;

/**
 * Turns the locked acceptance policy plus the latest findings into what an approval must satisfy.
 * Findings are matched to criteria by position, which is fixed when the agreement is created.
 */
export function decisionGate(criteria: Criterion[], findings: Finding[]): DecisionGate {
  if (findings.length !== criteria.length) throw new Error("Findings do not cover every criterion");
  const items = criteria.map((c, index): GateItem => ({ index, label: c.label, status: findings[index].status, required: isRequired(c) }));
  const blocking = items.filter(i => i.required && i.status === "FAILED");
  const unconfirmed = items.filter(i => i.required && i.status === "INCONCLUSIVE");
  const advisory = items.filter(i => !i.required && i.status !== "VERIFIED");
  const mode = blocking.length ? "OVERRIDE" : unconfirmed.length || advisory.length ? "CONFIRM" : "CLEAR";
  return {
    blocking, unconfirmed, advisory,
    verified: items.filter(i => i.status === "VERIFIED").length, total: items.length, mode,
    minimumReason: mode === "OVERRIDE" ? OVERRIDE_REASON : mode === "CONFIRM" ? CONFIRM_REASON : 0,
  };
}

/** Returns an error message when the approval does not meet the gate, otherwise null. */
export function approvalViolation(gate: DecisionGate, reason: string, override: boolean): string | null {
  const length = reason.trim().length;
  if (gate.mode === "OVERRIDE") {
    if (!override) return `${gate.blocking.length} required ${gate.blocking.length === 1 ? "criterion" : "criteria"} failed. Approving needs an explicit override.`;
    if (length < OVERRIDE_REASON) return `Explain the override in at least ${OVERRIDE_REASON} characters; it is recorded on the receipt.`;
    return null;
  }
  if (override) return "Override is only available when a required criterion failed";
  if (gate.mode === "CONFIRM" && length < CONFIRM_REASON) return gate.unconfirmed.length
    ? "Confirm how you checked the criteria that could not be verified automatically."
    : "Note why you accept the optional criteria that did not verify.";
  return null;
}

/** Revision requests allowed under the agreement, or null for no limit. */
export function revisionAllowance(maxRevisions: number | null, used: number): { remaining: number | null; exhausted: boolean } {
  if (maxRevisions === null) return { remaining: null, exhausted: false };
  const remaining = Math.max(0, maxRevisions - used);
  return { remaining, exhausted: remaining === 0 };
}

export function parseMaxRevisions(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 20 ? value : undefined;
}

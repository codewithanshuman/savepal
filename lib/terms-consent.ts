import { agreementHash, type ApprovalProject } from "./approval-receipt.ts";
import { sha256 } from "./website-evidence.ts";

export const TERMS_VERSION = "savepal-terms-v1";

export type TermsProject = ApprovalProject & { max_revisions: number | null; funding_mode?: string | null };

/**
 * Fingerprint of everything both parties agree to. It wraps the existing agreement hash (used by
 * approval receipts and offline proofs) and adds terms introduced later, so older receipts stay valid.
 * Fund-first is appended only when chosen, so pay-after-approval agreements keep their original hash.
 */
export async function termsHash(project: TermsProject): Promise<string> {
  const terms: unknown[] = [TERMS_VERSION, await agreementHash(project), project.max_revisions ?? null];
  if (project.funding_mode === "HOLD") terms.push("fund-first:paypal-authorization");
  return sha256(JSON.stringify(terms));
}

/** PayPal custom_id for a fund-first order: ties the hold to the exact agreed terms. */
export function fundingCustomId(hash: string): string {
  return `terms:${hash}`;
}

/** Short, human-comparable form shown to both parties, e.g. "9F3C-2E7A-B41D". */
export function termsFingerprint(hash: string): string {
  return hash.slice(0, 12).toUpperCase().match(/.{4}/g)!.join("-");
}

export type ConsentState = {
  /** Agreements created before consent binding have no stored terms hash. */
  legacy: boolean;
  termsHash: string;
  clientBound: boolean;
  freelancerBound: boolean;
  /** Stored terms no longer match the agreement row: someone changed locked terms. */
  tampered: boolean;
};

export async function consentState(
  project: TermsProject & { terms_hash: string | null; accepted_terms_hash: string | null },
): Promise<ConsentState> {
  const current = await termsHash(project);
  if (!project.terms_hash) return { legacy: true, termsHash: current, clientBound: false, freelancerBound: false, tampered: false };
  const clientBound = project.terms_hash === current;
  const freelancerBound = project.accepted_terms_hash === current;
  return { legacy: false, termsHash: current, clientBound, freelancerBound,
    tampered: !clientBound || (project.accepted_terms_hash !== null && !freelancerBound) };
}

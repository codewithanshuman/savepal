import { orderCustomId, type ApprovalReceipt } from "./approval-receipt.ts";
import type { PaymentIntent } from "./paypal-assurance.ts";

export type FundingMode = "CAPTURE" | "HOLD";
export type FundingStatus = "NONE" | "ORDER_CREATED" | "HELD" | "PENDING" | "CAPTURED" | "VOIDED" | "EXPIRED" | "FAILED";
export type FundingProject = {
  funding_mode: string; funding_status: string; funding_custom_id: string | null;
  status: string; evidence_url: string | null; paypal_capture_id: string | null;
};

export const isHold = (p: { funding_mode?: string | null }) => p.funding_mode === "HOLD";

/**
 * What a PayPal order for this agreement must carry. Fund-first orders exist before approval, so
 * they are bound to the agreed terms; the approval receipt then travels on the capture's invoice_id.
 * Pay-after-approval orders are bound to the approval receipt directly, as before.
 */
export function paymentBinding(p: { funding_mode?: string | null; funding_custom_id?: string | null }, receipt: ApprovalReceipt | null): { intent: PaymentIntent; customId: string } {
  if (isHold(p)) {
    if (!p.funding_custom_id) throw new Error("Fund-first agreement has no PayPal binding");
    return { intent: "AUTHORIZE", customId: p.funding_custom_id };
  }
  if (!receipt) throw new Error("Client approval is required");
  return { intent: "CAPTURE", customId: orderCustomId(receipt) };
}

/** Funds can be secured once the freelancer has accepted and before any approval. */
export function canFund(p: FundingProject): boolean {
  return isHold(p) && ["AGREED", "SUBMITTED", "REVIEW", "REVISION_REQUESTED"].includes(p.status) &&
    ["NONE", "ORDER_CREATED", "VOIDED", "EXPIRED", "FAILED"].includes(p.funding_status);
}

/** Work can only be delivered against a live hold. */
export function fundsSecured(p: FundingProject): boolean {
  return !isHold(p) || p.funding_status === "HELD";
}

/**
 * Who may cancel a hold, and when. The freelancer can always step away before approval, returning
 * the client's money. The client can only cancel before any work has been submitted, so a client
 * can't reserve funds, receive the work, and then pull the money back.
 */
export function voidAllowed(p: FundingProject, role: "client" | "freelancer"): { allowed: boolean; reason?: string } {
  if (!isHold(p) || !["HELD", "PENDING"].includes(p.funding_status)) return { allowed: false, reason: "There are no held funds to release" };
  if (p.status === "APPROVED" || p.paypal_capture_id) return { allowed: false, reason: "The work is approved; held funds can only be released to the freelancer" };
  if (role === "freelancer") return { allowed: true };
  if (p.evidence_url) return { allowed: false, reason: "Work has been submitted. Review it, or ask the freelancer to release the hold." };
  return { allowed: true };
}

/** Release is the capture of a held authorization after the client's approval. */
export function canRelease(p: FundingProject): boolean {
  return isHold(p) && p.status === "APPROVED" && p.funding_status === "HELD" && !p.paypal_capture_id;
}

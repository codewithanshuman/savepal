/*
 * Rules for the Realm's PayPal powers, kept pure so they can be tested on their own.
 * Bounty: the client pays the freelancer a bonus through its own PayPal checkout.
 * Appeal: after payment the client asks for money back; the freelancer grants it as a real PayPal refund.
 * Renewal: PayPal holds expire after 29 days; after the 3-day honor period a hold can be reauthorized once.
 */

export const BOUNTY_MIN_CENTS = 100;
export const BOUNTY_MAX_CENTS = 500_000;
export const HONOR_DAYS = 3;
const DAY = 86_400_000;

type Stage = { status: string; accepted_at?: string | null };
type Paid = { payment_status: string; paypal_capture_id: string | null };

/** A bounty can be paid once the freelancer has accepted, for as long as the agreement lives. */
export function bountyAllowed(p: Stage): boolean {
  return ["AGREED", "SUBMITTED", "REVIEW", "REVISION_REQUESTED", "APPROVED"].includes(p.status);
}

/** Parses a bounty amount in dollars ("25", "12.50") to cents, inside the allowed range. */
export function parseBountyCents(value: unknown): number | null {
  const text = typeof value === "number" ? value.toFixed(2) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return cents >= BOUNTY_MIN_CENTS && cents <= BOUNTY_MAX_CENTS ? cents : null;
}

/** Only a completed (or partly refunded) payment can be appealed. */
export function appealable(p: Paid): boolean {
  return !!p.paypal_capture_id && ["COMPLETED", "PARTIALLY_REFUNDED"].includes(p.payment_status);
}

/** What is still refundable: the agreement amount minus every refund already granted. */
export function refundableCents(amountCents: number, refunds: Array<{ status: string; amount_cents: number }>): number {
  const granted = refunds.filter(r => r.status === "REFUNDED").reduce((sum, r) => sum + r.amount_cents, 0);
  return Math.max(0, amountCents - granted);
}

/** When a hold may be renewed: after the honor period, before it expires, and only once. */
export function renewWindow(heldAt: string | null, expiresAt: string | null, renewed: boolean, now = Date.now()): { allowed: boolean; from: string | null; reason?: string } {
  const held = heldAt ? Date.parse(heldAt) : NaN;
  if (!Number.isFinite(held)) return { allowed: false, from: null, reason: "There is no active hold" };
  const from = new Date(held + HONOR_DAYS * DAY).toISOString();
  if (renewed) return { allowed: false, from, reason: "PayPal renews a hold only once" };
  const expires = expiresAt ? Date.parse(expiresAt) : NaN;
  if (Number.isFinite(expires) && expires <= now) return { allowed: false, from, reason: "The hold has expired; secure the funds again" };
  if (now < held + HONOR_DAYS * DAY) return { allowed: false, from, reason: "PayPal renews a hold after its first 3 days" };
  return { allowed: true, from };
}

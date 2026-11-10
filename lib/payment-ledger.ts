/*
 * An agreement's payment history as one read-only ledger, for the Payments tab.
 *
 * Every money operation PayPal was asked to perform appears exactly once -- the hold placed
 * before work began, the milestone payment, each bounty, each refund -- however many webhooks,
 * syncs and recoveries reported on it. A capture observed five times is still one payment.
 *
 * Two statuses are kept apart on purpose: what PayPal reported ("provider") and what SavePal has
 * recorded ("savepal"). A provider status is only shown when PayPal actually reported one; it is
 * never inferred. An authorization is a hold, not a payment; a refund that was requested is not a
 * refund until PayPal completes it. Nothing here moves money or decides anything -- the payment
 * handlers and decision policy stay the only authorities. Pure: no I/O, no clock.
 */

export type LedgerProject = {
  id: string; amount_cents: number; currency: string;
  funding_mode: string | null; funding_status: string | null; paypal_authorization_id: string | null;
  funding_held_at: string | null; funding_expires_at: string | null; funding_renewed_at: string | null;
  paypal_order_id: string | null; paypal_capture_id: string | null; payment_status: string;
  payment_order_requested_at: string | null; payment_capture_requested_at: string | null; payment_last_reconciled_at: string | null;
};
export type LedgerObservation = {
  id: string; source: string; provider_event_id: string | null; order_id: string; capture_id: string;
  provider_status: string; projected_status: string; amount_cents: number; currency: string; observed_at: string;
};
export type LedgerAttempt = { id: string; source: string; outcome: string; detail: string; attempted_at: string };
export type LedgerBounty = { id: string; amount_cents: number; currency: string; note: string; status: string; paypal_order_id: string | null; paypal_capture_id: string | null; created_at: string; updated_at: string };
export type LedgerRefund = { id: string; capture_id: string; amount_cents: number; currency: string; status: string; paypal_refund_id: string | null; started_at: string; updated_at: string };
/** An appeal: when it was granted, its refund (PayPal's refund id and status) is recorded on it. */
export type LedgerAppeal = { id: string; amount_cents: number; status: string; refund_status: string | null; paypal_refund_id: string | null; created_at: string; resolved_at: string | null };

export type LedgerKind = "HOLD" | "PAYMENT" | "BOUNTY" | "REFUND";
/** Whether SavePal's record and PayPal's report agree. */
export type Reconciliation = "CONFIRMED" | "AWAITING" | "NOT_REPORTED" | "DIFFERS";
/** What the operation means for the money, in plain terms. */
export type MoneyState = "AWAITING_APPROVAL" | "HELD" | "PENDING" | "PAID" | "PARTLY_REFUNDED" | "REFUNDED" | "RELEASED" | "RETURNED" | "EXPIRED" | "REQUESTED" | "UNDER_REVIEW" | "FAILED";

export type LedgerObservationRow = { id: string; source: string; eventId: string | null; providerStatus: string; projectedStatus: string; observedAt: string };
export type LedgerRow = {
  /** Stable across refreshes: the kind and SavePal's own record id for the operation. */
  id: string;
  kind: LedgerKind;
  operation: string;
  amountCents: number; currency: string;
  /** Where this operation sends the money. */
  direction: "HOLD" | "TO_FREELANCER" | "TO_CLIENT";
  state: MoneyState;
  /** PayPal's own status for the operation, or null when PayPal has not reported one. */
  providerStatus: string | null;
  /** The status SavePal has recorded. */
  savepalStatus: string;
  reconciliation: Reconciliation;
  /** PayPal's identifier for the operation (authorization, capture or refund), once there is one. */
  reference: string | null;
  orderId: string | null;
  recordedAt: string | null;
  updatedAt: string | null;
  note: string | null;
  /** Each distinct report PayPal made about this operation, newest first. */
  observations: LedgerObservationRow[];
};
export type Ledger = {
  currency: string;
  rows: LedgerRow[];
  totals: { heldCents: number; paidCents: number; refundedCents: number; bountyCents: number };
  attempts: LedgerAttempt[];
  lastReconciledAt: string | null;
};

const latest = <T>(items: T[], at: (t: T) => string): T | undefined => items.reduce<T | undefined>((best, x) => (!best || at(x) > at(best) ? x : best), undefined);

/** Reports about one capture, each counted once (a webhook redelivered keeps its event id). */
function reportsFor(observations: LedgerObservation[], captureId: string | null, orderId: string | null): LedgerObservationRow[] {
  const seen = new Set<string>();
  return observations
    .filter(o => (captureId ? o.capture_id === captureId : !!orderId && o.order_id === orderId))
    .filter(o => { const key = o.provider_event_id ? `event:${o.provider_event_id}` : `row:${o.id}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => (a.observed_at < b.observed_at ? 1 : a.observed_at > b.observed_at ? -1 : 0))
    .map(o => ({ id: o.id, source: o.source, eventId: o.provider_event_id, providerStatus: o.provider_status, projectedStatus: o.projected_status, observedAt: o.observed_at }));
}

function holdRow(p: LedgerProject): LedgerRow | null {
  if (p.funding_mode !== "HOLD" || !p.funding_status || p.funding_status === "NONE") return null;
  const s = p.funding_status;
  const state: MoneyState = s === "HELD" ? "HELD" : s === "PENDING" ? "PENDING" : s === "CAPTURED" ? "RELEASED" : s === "VOIDED" ? "RETURNED"
    : s === "EXPIRED" ? "EXPIRED" : s === "FAILED" ? "FAILED" : s === "VOIDING" ? "PENDING" : "AWAITING_APPROVAL";
  // SavePal moves a hold into these states only on PayPal's own authorize, void or capture
  // response, so PayPal reported them. ORDER_CREATED means PayPal has an order the client has not
  // yet approved (no authorization to report on), and FAILED may mean the call never reached
  // PayPal: neither is shown as a PayPal status.
  const reported: Record<string, string> = { HELD: "CREATED", PENDING: "PENDING", CAPTURED: "CAPTURED", VOIDED: "VOIDED", EXPIRED: "EXPIRED" };
  const providerStatus = p.paypal_authorization_id ? reported[s] ?? null : null;
  return {
    id: `HOLD:${p.id}`, kind: "HOLD", operation: "Hold (PayPal authorization)",
    amountCents: p.amount_cents, currency: p.currency, direction: "HOLD", state,
    providerStatus, savepalStatus: s,
    reconciliation: providerStatus === null ? "NOT_REPORTED" : ["PENDING", "VOIDING"].includes(s) ? "AWAITING" : "CONFIRMED",
    reference: p.paypal_authorization_id, orderId: p.paypal_order_id,
    recordedAt: p.funding_held_at ?? p.payment_order_requested_at, updatedAt: p.funding_renewed_at ?? p.funding_held_at,
    note: p.funding_renewed_at ? "Renewed before it expired" : null, observations: [],
  };
}

function paymentRow(p: LedgerProject, observations: LedgerObservation[], refunds: LedgerRefund[], awaiting: boolean): LedgerRow | null {
  const started = p.payment_status !== "NOT_STARTED" || !!p.paypal_capture_id || (p.funding_mode !== "HOLD" && !!p.paypal_order_id);
  if (!started) return null;
  const reports = reportsFor(observations, p.paypal_capture_id, p.paypal_order_id);
  const last = reports[0];
  const s = p.payment_status;
  const state: MoneyState = s === "COMPLETED" ? "PAID" : s === "PARTIALLY_REFUNDED" ? "PARTLY_REFUNDED" : s === "REFUNDED" ? "REFUNDED"
    : s === "FAILED" ? "FAILED" : s === "PENDING" ? "PENDING" : p.paypal_capture_id || awaiting ? "PENDING" : "AWAITING_APPROVAL";
  const refundedByPayPal = refunds.some(r => r.status === "COMPLETED");
  const reconciliation: Reconciliation = awaiting ? "AWAITING"
    : !last ? "NOT_REPORTED"
    : last.projectedStatus === s || (["PARTIALLY_REFUNDED", "REFUNDED"].includes(s) && refundedByPayPal && last.projectedStatus === "COMPLETED") ? "CONFIRMED"
    : last.projectedStatus === "PENDING" ? "AWAITING" : "DIFFERS";
  return {
    id: `PAYMENT:${p.id}`, kind: "PAYMENT", operation: p.funding_mode === "HOLD" ? "Payment (hold captured)" : "Payment (PayPal capture)",
    amountCents: p.amount_cents, currency: p.currency, direction: "TO_FREELANCER", state,
    providerStatus: last?.providerStatus ?? null, savepalStatus: s, reconciliation,
    reference: p.paypal_capture_id, orderId: p.paypal_order_id,
    recordedAt: p.payment_capture_requested_at ?? p.payment_order_requested_at ?? last?.observedAt ?? null,
    updatedAt: last?.observedAt ?? p.payment_last_reconciled_at,
    note: awaiting ? "PayPal has not yet confirmed this capture; SavePal keeps checking" : null, observations: reports,
  };
}

function bountyRow(b: LedgerBounty): LedgerRow {
  // after capture SavePal stores PayPal's own capture status, read back from the order
  const captured = !!b.paypal_capture_id && b.status !== "ORDER_CREATED";
  const s = b.status;
  const state: MoneyState = s === "COMPLETED" ? "PAID" : s === "PENDING" ? "PENDING" : s === "ORDER_CREATED" ? "AWAITING_APPROVAL" : s === "REFUNDED" ? "REFUNDED" : "FAILED";
  return {
    id: `BOUNTY:${b.id}`, kind: "BOUNTY", operation: "Bounty", amountCents: b.amount_cents, currency: b.currency,
    direction: "TO_FREELANCER", state, providerStatus: captured ? s : null, savepalStatus: s,
    reconciliation: !captured ? "NOT_REPORTED" : s === "PENDING" ? "AWAITING" : "CONFIRMED",
    reference: b.paypal_capture_id, orderId: b.paypal_order_id, recordedAt: b.created_at, updatedAt: b.updated_at, note: b.note, observations: [],
  };
}

function refundRow(r: LedgerRefund): LedgerRow {
  const s = r.status;
  // PayPal answered with a refund status for these; REQUESTED and UNKNOWN have no PayPal answer yet
  const answered = ["COMPLETED", "PENDING", "FAILED"].includes(s);
  const state: MoneyState = s === "COMPLETED" ? "REFUNDED" : s === "FAILED" ? "FAILED" : s === "REVIEW_REQUIRED" ? "UNDER_REVIEW" : s === "PENDING" ? "PENDING" : "REQUESTED";
  return {
    id: `REFUND:${r.id}`, kind: "REFUND", operation: "Refund to client", amountCents: r.amount_cents, currency: r.currency,
    direction: "TO_CLIENT", state, providerStatus: answered ? s : null, savepalStatus: s,
    reconciliation: s === "COMPLETED" || s === "FAILED" ? "CONFIRMED" : answered ? "AWAITING" : "NOT_REPORTED",
    reference: r.paypal_refund_id, orderId: null, recordedAt: r.started_at, updatedAt: r.updated_at,
    note: `From capture ${r.capture_id}`, observations: [],
  };
}

/** A refund recorded on a granted appeal (as SavePal recorded refunds before refund operations). */
function appealRefundRow(a: LedgerAppeal, currency: string): LedgerRow | null {
  if (!a.paypal_refund_id && a.status !== "REFUNDED" && a.status !== "REFUNDING") return null;
  // refund_status is PayPal's own status for the refund, recorded when PayPal answered
  const r = a.refund_status;
  const state: MoneyState = r === "COMPLETED" ? "REFUNDED" : r === "PENDING" ? "PENDING" : r === "FAILED" || r === "CANCELLED" ? "FAILED" : "REQUESTED";
  return {
    id: `REFUND:${a.id}`, kind: "REFUND", operation: "Refund to client", amountCents: a.amount_cents, currency,
    direction: "TO_CLIENT", state, providerStatus: r, savepalStatus: `Appeal ${a.status.toLowerCase()}`,
    reconciliation: !r ? "NOT_REPORTED" : r === "PENDING" ? "AWAITING" : "CONFIRMED",
    reference: a.paypal_refund_id, orderId: null, recordedAt: a.resolved_at ?? a.created_at, updatedAt: a.resolved_at,
    note: "Granted on an appeal", observations: [],
  };
}

export function paymentLedger(input: {
  project: LedgerProject; observations: LedgerObservation[]; attempts: LedgerAttempt[];
  bounties: LedgerBounty[]; refunds: LedgerRefund[]; awaitingReconciliation: boolean;
  /** Appeals, for refunds recorded on them; a refund operation for the same appeal takes precedence. */
  appeals?: LedgerAppeal[];
}): Ledger {
  const { project: p } = input;
  const rows: LedgerRow[] = [];
  const hold = holdRow(p); if (hold) rows.push(hold);
  const pay = paymentRow(p, input.observations, input.refunds, input.awaitingReconciliation); if (pay) rows.push(pay);
  for (const b of input.bounties) rows.push(bountyRow(b));
  for (const r of input.refunds) rows.push(refundRow(r));
  // a refund operation carries its appeal's id, so the two never count the same refund twice
  const operated = new Set(input.refunds.map(r => r.id));
  for (const a of input.appeals ?? []) { if (operated.has(a.id)) continue; const row = appealRefundRow(a, p.currency); if (row) rows.push(row); }
  rows.sort((a, b) => ((a.recordedAt ?? "") < (b.recordedAt ?? "") ? -1 : (a.recordedAt ?? "") > (b.recordedAt ?? "") ? 1 : 0));
  const sum = (pick: (r: LedgerRow) => boolean) => rows.filter(pick).reduce((t, r) => t + r.amountCents, 0);
  const lastAttempt = latest(input.attempts, a => a.attempted_at);
  return {
    currency: p.currency, rows,
    totals: {
      heldCents: sum(r => r.kind === "HOLD" && (r.state === "HELD" || r.state === "PENDING")),
      paidCents: sum(r => (r.kind === "PAYMENT" || r.kind === "BOUNTY") && (r.state === "PAID" || r.state === "PARTLY_REFUNDED" || r.state === "REFUNDED")),
      refundedCents: sum(r => r.kind === "REFUND" && r.state === "REFUNDED"),
      bountyCents: sum(r => r.kind === "BOUNTY" && r.state === "PAID"),
    },
    attempts: [...input.attempts].sort((a, b) => (a.attempted_at < b.attempted_at ? 1 : -1)),
    lastReconciledAt: [p.payment_last_reconciled_at, lastAttempt?.attempted_at].filter((x): x is string => !!x).sort().pop() ?? null,
  };
}

"use client";
/*
 * One payment operation in full: PayPal's identifiers for it, what PayPal reported and what SavePal
 * recorded (side by side, never merged), each distinct report PayPal made about it, SavePal's
 * reconciliation checks, and the audit events that belong to it.
 */
import type { LedgerAttempt, LedgerRow, MoneyState, Reconciliation } from "../../lib/payment-ledger";
import { Pill, money, when, type Tone } from "./grid-theme";

export const STATE: Record<MoneyState, { label: string; tone: Tone }> = {
  AWAITING_APPROVAL: { label: "Awaiting PayPal approval", tone: "mute" }, HELD: { label: "Held", tone: "pp" }, PENDING: { label: "Pending", tone: "warn" },
  PAID: { label: "Paid", tone: "ok" }, PARTLY_REFUNDED: { label: "Partly refunded", tone: "warn" }, REFUNDED: { label: "Refunded", tone: "warn" },
  RELEASED: { label: "Released as payment", tone: "ok" }, RETURNED: { label: "Returned to client", tone: "mute" }, EXPIRED: { label: "Expired", tone: "mute" },
  REQUESTED: { label: "Requested", tone: "warn" }, UNDER_REVIEW: { label: "Under review", tone: "warn" }, FAILED: { label: "Failed", tone: "bad" },
};
export const RECON: Record<Reconciliation, { label: string; tone: Tone; text: string }> = {
  CONFIRMED: { label: "Confirmed by PayPal", tone: "ok", text: "SavePal's record matches what PayPal reported." },
  AWAITING: { label: "Awaiting PayPal", tone: "warn", text: "PayPal has not given a final answer yet. SavePal keeps checking and shows the result here when it arrives." },
  NOT_REPORTED: { label: "Not reported yet", tone: "mute", text: "PayPal has not reported on this operation yet, so there is nothing to compare." },
  DIFFERS: { label: "Differs from PayPal", tone: "bad", text: "PayPal's latest report does not match SavePal's record. It is being reconciled; nothing moves until it is resolved." },
};
const KIND_TEXT: Record<LedgerRow["kind"], string> = {
  HOLD: "A PayPal authorization: the client's money is held, not paid. It is captured to pay the freelancer on approval, or voided to return it.",
  PAYMENT: "The milestone payment to the freelancer.",
  BOUNTY: "An extra payment from the client to the freelancer.",
  REFUND: "Money returned to the client from a captured payment.",
};

type AuditEvent = { actor: string; type: string; detail: string; created_at: string };

export function PaymentDetail({ row, events, attempts }: { row: LedgerRow | null; events: AuditEvent[]; attempts: LedgerAttempt[] }) {
  if (!row) return <aside className="g-detail g-detail-empty" aria-label="Payment details"><p>Select a payment to see PayPal&apos;s record of it.</p></aside>;
  const s = STATE[row.state], r = RECON[row.reconciliation];
  return <aside className="g-detail" aria-label={`Details for ${row.operation}`} aria-live="polite">
    <header>
      <small>{row.direction === "HOLD" ? "Held for the agreement" : row.direction === "TO_CLIENT" ? "To the client" : "To the freelancer"}</small>
      <h3>{row.operation}</h3>
      <div className="g-detail-tags"><Pill tone={s.tone}>{s.label}</Pill><strong className="g-amt">{money(row.amountCents, row.currency)}</strong></div>
      <p className="g-sub">{KIND_TEXT[row.kind]}</p>
    </header>
    <section>
      <h4>Status</h4>
      <dl className="g-facts">
        <dt>PayPal</dt><dd>{row.providerStatus ?? <span className="g-dim">Not reported</span>}</dd>
        <dt>SavePal</dt><dd>{row.savepalStatus}</dd>
      </dl>
      <div className="g-detail-tags"><Pill tone={r.tone}>{r.label}</Pill></div>
      <p className="g-sub">{r.text}</p>
      {row.note && <p className="g-sub">{row.note}</p>}
    </section>
    <section>
      <h4>PayPal references</h4>
      <dl className="g-facts">
        <dt>{row.kind === "HOLD" ? "Authorization" : row.kind === "REFUND" ? "Refund" : "Capture"}</dt><dd className="g-wrap">{row.reference ?? <span className="g-dim">None yet</span>}</dd>
        {row.orderId && <><dt>Order</dt><dd className="g-wrap">{row.orderId}</dd></>}
        <dt>Recorded</dt><dd>{when(row.recordedAt)}</dd>
        {row.updatedAt && row.updatedAt !== row.recordedAt && <><dt>Last update</dt><dd>{when(row.updatedAt)}</dd></>}
      </dl>
    </section>
    {row.observations.length > 0 && <section>
      <h4>Reports from PayPal <span className="g-dim">({row.observations.length})</span></h4>
      <ol className="g-log">{row.observations.map(o => <li key={o.id}><b>{o.providerStatus}</b> <span className="g-dim">via {o.source.toLowerCase()}</span><small>{when(o.observedAt)}{o.eventId ? ` · event ${o.eventId.slice(0, 14)}` : ""}</small></li>)}</ol>
      <p className="g-sub">Each report counts once, even when PayPal sends it again.</p>
    </section>}
    {(row.kind === "PAYMENT" || row.kind === "REFUND") && attempts.length > 0 && <section>
      <h4>Reconciliation checks</h4>
      <ol className="g-log">{attempts.slice(0, 8).map(a => <li key={a.id}><b>{a.outcome.toLowerCase().replace(/_/g, " ")}</b> <span className="g-dim">{a.source.toLowerCase()}</span><small>{when(a.attempted_at)}</small></li>)}</ol>
    </section>}
    {events.length > 0 && <section>
      <h4>In the audit trail</h4>
      <ol className="g-log">{events.slice(0, 10).map((e, i) => <li key={i}><b>{e.type.toLowerCase().replace(/_/g, " ")}</b><small>{when(e.created_at)} · {e.actor}</small><p>{e.detail}</p></li>)}</ol>
    </section>}
  </aside>;
}

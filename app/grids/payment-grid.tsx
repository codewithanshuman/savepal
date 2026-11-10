"use client";
/*
 * The Payments tab: every money operation PayPal performed for this agreement -- the hold, the
 * payment, bounties and refunds -- once each, with PayPal's status beside SavePal's and whether
 * they agree, and a panel with the selected operation's references, PayPal's reports, SavePal's
 * reconciliation checks and its audit events. It comes from the server's read-only ledger
 * (lib/payment-ledger.ts) and changes nothing: there are no editable cells and no payment actions.
 */
import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ValueFormatterParams } from "ag-grid-community";
import type { Ledger, LedgerRow, MoneyState, Reconciliation } from "../../lib/payment-ledger";
import { paymentEvents, shortRef } from "../../lib/grid-adapters";
import { GRID_MODULES, Pill, READ_ONLY, gridTheme, money, useNarrow, when, whenShort } from "./grid-theme";
import { PaymentDetail, RECON, STATE } from "./payment-detail";

type AuditEvent = { actor: string; type: string; detail: string; created_at: string };

export default function PaymentsTab({ ledger, audit }: { ledger: Ledger | null; audit: AuditEvent[] }) {
  const narrow = useNarrow();
  const rows = ledger?.rows ?? [];
  const [chosenId, setSelectedId] = useState<string | null>(null);
  // until something is chosen, show the most recent operation
  const selectedId = chosenId && rows.some(r => r.id === chosenId) ? chosenId : rows[rows.length - 1]?.id ?? null;
  const selected = rows.find(r => r.id === selectedId) ?? null;
  const events = useMemo(() => (selected ? paymentEvents(selected.kind, audit) : []), [selected, audit]);
  const currency = ledger?.currency ?? "USD";

  const columns = useMemo<ColDef<LedgerRow>[]>(() => [
    // a pinned column does not flex, so on wide screens it gets its own width
    { headerName: "Operation", field: "operation", ...(narrow ? { flex: 1, minWidth: 150 } : { width: 184, pinned: "left" as const }), tooltip: true },
    { headerName: "Amount", field: "amountCents", width: 98, type: "rightAligned", filter: "agNumberColumnFilter", valueFormatter: (p: ValueFormatterParams<LedgerRow, number>) => money(p.value ?? 0, p.data?.currency) },
    { headerName: "Money", field: "state", width: 128, cellRenderer: (p: { value: MoneyState }) => <Pill tone={STATE[p.value].tone}>{STATE[p.value].label}</Pill>, getQuickFilterText: (p: { value: MoneyState }) => STATE[p.value].label },
    { headerName: "PayPal status", field: "providerStatus", width: 114, hide: narrow, valueFormatter: (p: ValueFormatterParams<LedgerRow, string | null>) => p.value ?? "Not reported", cellClassRules: { "g-dim": p => !p.value } },
    { headerName: "SavePal status", field: "savepalStatus", width: 114, hide: narrow },
    { headerName: "Reference", field: "reference", width: 116, hide: narrow, valueFormatter: (p: ValueFormatterParams<LedgerRow, string | null>) => shortRef(p.value ?? null), tooltip: p => (p.value as string | null) ?? "No PayPal reference yet" },
    { headerName: "Recorded", field: "recordedAt", width: 128, hide: narrow, sort: "asc", valueFormatter: (p: ValueFormatterParams<LedgerRow, string | null>) => whenShort(p.value ?? null), tooltip: p => when((p.value as string | null) ?? null) },
    { headerName: "Reconciliation", field: "reconciliation", width: 168, hide: narrow, cellRenderer: (p: { value: Reconciliation }) => <Pill tone={RECON[p.value].tone} title={RECON[p.value].text}>{RECON[p.value].label}</Pill> },
  ], [narrow]);

  if (!ledger) return <section className="g-tab" aria-label="Payments"><p className="g-sub">Loading the payment record…</p></section>;
  const t = ledger.totals;
  return <section className="g-tab" aria-label="Payments">
    <header className="g-tab-head">
      <div><h2>Payments</h2>
        <p className="g-sub">What PayPal was asked to do for this agreement, and what it confirmed.{ledger.lastReconciledAt ? ` Last checked with PayPal ${when(ledger.lastReconciledAt)}.` : ""}</p></div>
    </header>
    <div className="g-counts" aria-label="Totals">
      <div className="g-count g-pp"><strong>{money(t.heldCents, currency)}</strong><small>Held by PayPal now</small></div>
      <div className="g-count g-ok"><strong>{money(t.paidCents, currency)}</strong><small>Paid to the freelancer</small></div>
      <div className="g-count g-warn"><strong>{money(t.refundedCents, currency)}</strong><small>Refunded to the client</small></div>
      <div className="g-count g-mute"><strong>{money(t.bountyCents, currency)}</strong><small>Of which bounties</small></div>
    </div>
    {rows.length ? <div className="g-split">
      <div className="g-grid" role="region" aria-label="Payment operations">
        <AgGridReact<LedgerRow>
          modules={GRID_MODULES} theme={gridTheme} rowData={rows} columnDefs={columns} defaultColDef={READ_ONLY}
          getRowId={p => p.data.id} domLayout="autoHeight"
          rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: true }}
          onGridReady={e => { if (selectedId) e.api.getRowNode(selectedId)?.setSelected(true); }}
          onSelectionChanged={e => { const r = e.api.getSelectedRows()[0]; if (r) setSelectedId(r.id); }}
          onCellKeyDown={e => { if ((e.event as KeyboardEvent | undefined)?.key === "Enter" && e.data) { e.node.setSelected(true); setSelectedId(e.data.id); } }}
        />
      </div>
      <PaymentDetail row={selected} events={events} attempts={ledger.attempts} />
    </div> : <p className="g-empty">No payment activity yet. Once the client funds the agreement, every PayPal operation appears here.</p>}
    <p className="g-foot">Read-only. An authorization is a hold, not a payment, and a refund counts only once PayPal completes it. Money moves only through the actions on the Overview, which the server checks.</p>
  </section>;
}

"use client";
/*
 * The agreements table: the homepage's cards as a sortable, searchable table for people with many
 * agreements. Rows come from lib/grid-adapters.ts (agreementRows), whose next move is the
 * workspace's own nextMove(), so "Your move" means exactly what it means on the cards. The
 * homepage's filters and search apply before the rows arrive here. Opening a row goes to the
 * agreement's own page; nothing is editable.
 */
import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridState, RowClassRules, ValueFormatterParams } from "ag-grid-community";
import type { AgreementRow } from "../../lib/grid-adapters";
import { GRID_MODULES, Pill, READ_ONLY, gridTheme, money, useNarrow, when, whenShort, type Tone } from "./grid-theme";

const TONE: Record<AgreementRow["tone"], Tone> = { act: "pp", wait: "mute", done: "ok", warn: "warn" };
const STATE_KEY = "savepal:grid:agreements:v2";
const readState = (): GridState | undefined => { try { const raw = localStorage.getItem(STATE_KEY); return raw ? JSON.parse(raw) as GridState : undefined; } catch { return undefined; } };
// only the sort is kept: restoring saved widths would bring back columns hidden on a phone
const saveState = (s: GridState) => { try { localStorage.setItem(STATE_KEY, JSON.stringify({ sort: s.sort })); } catch { /* storage unavailable */ } };

export default function AgreementsTable({ rows, onOpen }: { rows: AgreementRow[]; onOpen(id: string): void }) {
  const narrow = useNarrow();
  // the viewer's saved sort, read once when the table opens
  const [initialState] = useState(readState);
  const columns = useMemo<ColDef<AgreementRow>[]>(() => [
    {
      // the agreement's name opens it, as the card does
      headerName: "Agreement", field: "title", ...(narrow ? { flex: 1.5, minWidth: 150 } : { width: 196, pinned: "left" as const }), tooltip: true, filter: "agTextColumnFilter",
      cellRenderer: (p: { value: string; data?: AgreementRow }) => p.data ? <button className="g-link" onClick={() => onOpen(p.data!.id)} aria-label={`Open ${p.value}`}>{p.value}</button> : null,
    },
    { headerName: "Other party", field: "other", minWidth: 140, flex: 1, hide: narrow, tooltip: true },
    { headerName: "Your role", field: "role", width: 96, hide: narrow },
    { headerName: "Amount", field: "amountCents", width: 108, type: "rightAligned", filter: "agNumberColumnFilter", valueFormatter: (p: ValueFormatterParams<AgreementRow, number>) => money(p.value ?? 0, p.data?.currency) },
    { headerName: "Milestone", field: "milestone", width: 128, hide: narrow },
    { headerName: "Payment", field: "payment", width: 140, hide: narrow },
    {
      headerName: "Next action", field: "next", flex: 1.3, minWidth: 170,
      cellRenderer: (p: { value: string; data?: AgreementRow }) => p.data ? <span className="g-next">{p.data.mine && <span className="d-pulse" aria-label="Your move" />}<Pill tone={TONE[p.data.tone]}>{p.value}</Pill></span> : null,
    },
    { headerName: "Last activity", field: "updated", width: 132, hide: narrow, sort: "desc", valueFormatter: (p: ValueFormatterParams<AgreementRow, string>) => whenShort(p.value ?? null), tooltip: p => when((p.value as string | null) ?? null) },
  ], [narrow, onOpen]);
  const rowClassRules = useMemo<RowClassRules<AgreementRow>>(() => ({ "g-row-mine": p => !!p.data?.mine }), []);
  return <div className="g-grid g-wide" role="region" aria-label="Agreements">
    <AgGridReact<AgreementRow>
      modules={GRID_MODULES} theme={gridTheme} rowData={rows} columnDefs={columns} defaultColDef={READ_ONLY}
      getRowId={p => p.data.id} domLayout="autoHeight" rowClassRules={rowClassRules}
      pagination={rows.length > 20} paginationPageSize={20} paginationPageSizeSelector={false}
      initialState={initialState} onStateUpdated={e => saveState(e.state)}
      onRowDoubleClicked={e => { if (e.data) onOpen(e.data.id); }}
      onCellKeyDown={e => { if ((e.event as KeyboardEvent | undefined)?.key === "Enter" && e.data) onOpen(e.data.id); }}
    />
  </div>;
}

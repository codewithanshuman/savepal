"use client";
/*
 * The Evidence tab: every locked acceptance criterion with its saved result, in a table that
 * filters (by result, required only, or a search) and sorts, beside a panel with the selected
 * criterion's saved explanation and sources; and a second view, the changes since the previous
 * check, for judging whether a revision actually fixed what failed. Read-only throughout:
 * approving or asking for a revision stays on the Overview, where the server checks every rule.
 */
import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridState, RowClassRules, ValueFormatterParams } from "ag-grid-community";
import { comparisonRows, evidenceRows, freshness, matchesEvidenceFilter, resultCounts, type ComparisonRow, type EvidenceRow, type ResultStatus, type RunRecord, type RunSummary } from "../../lib/grid-adapters";
import { GRID_MODULES, Pill, READ_ONLY, gridTheme, useNarrow, when } from "./grid-theme";
import { CHANGE, EFFECT, EvidenceDetail, KIND_LABEL, RESULT } from "./evidence-detail";

type Criterion = { label: string; kind: string; needle?: string; required?: boolean };
type Finding = { label: string; status: "VERIFIED" | "FAILED" | "INCONCLUSIVE"; explanation: string; check: string; confidence?: "HIGH" | "MEDIUM" | "LOW"; evidenceRefs?: Array<{ url: string; excerpt?: string }> };
type Gate = { blocking: Array<{ index: number }>; unconfirmed: Array<{ index: number }>; advisory: Array<{ index: number }> };
export type EvidenceProject = {
  id: string; role: "client" | "freelancer"; criteria: Criterion[]; findings: Finding[] | null; gate: Gate | null;
  evidence_url: string | null; evidence_hash: string | null; evidence_at: string | null;
};
export type Submission = { id: string; submission_hash: string; snapshot_hash: string | null; created_at: string };

const ORDER: Record<ResultStatus, number> = { FAILED: 0, INCONCLUSIVE: 1, NOT_CHECKED: 2, VERIFIED: 3 };
const STATE_KEY = "savepal:grid:evidence:v2";
const readState = (): GridState | undefined => { try { const raw = localStorage.getItem(STATE_KEY); return raw ? JSON.parse(raw) as GridState : undefined; } catch { return undefined; } };
// only the sort is kept: restoring saved widths would bring back columns hidden on a phone
const saveState = (s: GridState) => { try { localStorage.setItem(STATE_KEY, JSON.stringify({ sort: s.sort })); } catch { /* storage unavailable */ } };

export default function EvidenceTab({ project, history, run, submissions, currentSubmissionId, onOverview }: {
  project: EvidenceProject; history: RunSummary[]; run: RunRecord | null; submissions: Submission[]; currentSubmissionId: string | null; onOverview(): void;
}) {
  const narrow = useNarrow();
  const fresh = useMemo(() => freshness({ findings: project.findings, history, latestRun: run, currentSubmissionId }), [project.findings, history, run, currentSubmissionId]);
  const rows = useMemo(() => evidenceRows({ projectId: project.id, criteria: project.criteria, findings: project.findings, gate: project.gate, history, runId: fresh.runId }), [project, history, fresh.runId]);
  const compare = useMemo(() => comparisonRows(project.id, history), [project.id, history]);
  const counts = useMemo(() => resultCounts(rows), [rows]);
  const [view, setView] = useState<"latest" | "changes">("latest");
  const [result, setResult] = useState<ResultStatus | "ALL">("ALL");
  const [requiredOnly, setRequiredOnly] = useState(false);
  const [search, setSearch] = useState("");
  const firstOpen = rows.find(r => r.result === "FAILED") ?? rows.find(r => r.result === "INCONCLUSIVE") ?? rows[0] ?? null;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(firstOpen?.index ?? null);
  const shown = useMemo(() => rows.filter(r => matchesEvidenceFilter(r, result, requiredOnly)), [rows, result, requiredOnly]);
  const selected = rows.find(r => r.index === selectedIndex) ?? null;
  // the viewer's saved sort, read once when the table opens
  const [initialState] = useState(readState);
  const latestSubmission = submissions[0] ?? null;

  const columns = useMemo<ColDef<EvidenceRow>[]>(() => [
    { headerName: "#", field: "index", width: 58, pinned: narrow ? undefined : "left", valueFormatter: (p: ValueFormatterParams<EvidenceRow, number>) => String((p.value ?? 0) + 1) },
    { headerName: "Acceptance criterion", field: "criterion", ...(narrow ? { flex: 2, minWidth: 160 } : { width: 230, pinned: "left" as const }), tooltip: true, filter: "agTextColumnFilter" },
    {
      headerName: "Result", field: "result", width: 124, comparator: (a: ResultStatus, b: ResultStatus) => ORDER[a] - ORDER[b],
      cellRenderer: (p: { value: ResultStatus }) => <Pill tone={RESULT[p.value].tone}>{RESULT[p.value].label}</Pill>,
      getQuickFilterText: (p: { value: ResultStatus }) => RESULT[p.value].label,
    },
    { headerName: "Required", colId: "required", width: 104, hide: narrow, cellDataType: "text", valueGetter: (p) => (p.data?.required ? "Required" : "Optional") },
    {
      headerName: "Approval", field: "effect", width: 156, hide: narrow,
      cellRenderer: (p: { value: EvidenceRow["effect"] }) => <Pill tone={EFFECT[p.value].tone} title={EFFECT[p.value].text}>{EFFECT[p.value].label}</Pill>,
      getQuickFilterText: (p: { value: EvidenceRow["effect"] }) => EFFECT[p.value].label,
    },
    { headerName: "Check method", colId: "method", minWidth: 170, flex: 1, hide: narrow, valueGetter: (p) => p.data ? `${KIND_LABEL[p.data.kind] ?? p.data.kind}${p.data.needle ? ` · “${p.data.needle}”` : ""}` : "", tooltip: true },
    { headerName: "Confidence", field: "confidence", width: 112, hide: narrow, valueFormatter: (p: ValueFormatterParams<EvidenceRow, string | null>) => (p.value ? p.value[0] + p.value.slice(1).toLowerCase() : "—") },
    { headerName: "Sources", colId: "sources", width: 94, hide: narrow, valueGetter: (p) => p.data?.sources.length ?? 0, filter: "agNumberColumnFilter" },
    {
      headerName: "Since last check", field: "change", width: 140, hide: narrow || history.length < 2,
      cellRenderer: (p: { value: EvidenceRow["change"] }) => p.value && p.value !== "FIRST" ? <Pill tone={CHANGE[p.value].tone}>{CHANGE[p.value].label}</Pill> : <span className="g-dim">—</span>,
    },
  ], [narrow, history.length]);

  const changeColumns = useMemo<ColDef<ComparisonRow>[]>(() => [
    { headerName: "Acceptance criterion", field: "criterion", ...(narrow ? { flex: 2, minWidth: 160 } : { width: 280, pinned: "left" as const }), tooltip: true },
    { headerName: "Previous", field: "previous", width: 136, cellRenderer: (p: { value: ResultStatus }) => <Pill tone={RESULT[p.value].tone}>{RESULT[p.value].label}</Pill> },
    { headerName: "Latest", field: "latest", width: 136, cellRenderer: (p: { value: ResultStatus }) => <Pill tone={RESULT[p.value].tone}>{RESULT[p.value].label}</Pill> },
    { headerName: "Change", field: "change", width: 136, cellRenderer: (p: { value: ComparisonRow["change"] }) => <Pill tone={CHANGE[p.value].tone}>{CHANGE[p.value].label}</Pill> },
  ], [narrow]);

  const rowClassRules = useMemo<RowClassRules<EvidenceRow>>(() => ({ "g-row-bad": p => p.data?.result === "FAILED" }), []);
  const chips: Array<[ResultStatus | "ALL", string, number]> = [["ALL", "All", rows.length], ["FAILED", "Failed", counts.FAILED], ["INCONCLUSIVE", "Inconclusive", counts.INCONCLUSIVE], ["VERIFIED", "Verified", counts.VERIFIED], ["NOT_CHECKED", "Not checked", counts.NOT_CHECKED]];

  return <section className="g-tab" aria-label="Evidence review">
    <header className="g-tab-head">
      <div><h2>Evidence review</h2>
        <p className="g-sub">{fresh.state === "NONE" ? "Nothing has been checked yet. Results appear here once the freelancer delivers and the check runs."
          : `Latest completed check${fresh.completedAt ? ` · ${when(fresh.completedAt)}` : ""} · ${history.length} check${history.length === 1 ? "" : "s"} so far`}</p></div>
      <div className="g-seg" role="tablist" aria-label="Evidence view">
        <button role="tab" aria-selected={view === "latest"} className={view === "latest" ? "on" : ""} onClick={() => setView("latest")}>Latest results</button>
        <button role="tab" aria-selected={view === "changes"} className={view === "changes" ? "on" : ""} onClick={() => setView("changes")} disabled={!compare.rows.length} title={compare.rows.length ? undefined : "Appears after a second check"}>Changes since previous check</button>
      </div>
    </header>
    {fresh.state === "STALE" && <p className="g-banner warn" role="status">These results are from an earlier delivery. The latest delivery has not finished its check yet.</p>}
    {fresh.state === "RUNNING" && <p className="g-banner" role="status">A new check is running. These are the results of the last completed check.</p>}
    <div className="g-counts" aria-label="Results">
      {(["VERIFIED", "FAILED", "INCONCLUSIVE", "NOT_CHECKED"] as const).map(k => <button key={k} className={`g-count g-${RESULT[k].tone} ${result === k ? "on" : ""}`} onClick={() => { setView("latest"); setResult(result === k ? "ALL" : k); }} aria-pressed={result === k}><strong>{counts[k]}</strong><small>{RESULT[k].label}</small></button>)}
    </div>
    {view === "latest" ? <>
      <div className="g-tools">
        <div className="d-filters" role="tablist" aria-label="Filter by result">{chips.map(([k, label, n]) => <button key={k} role="tab" aria-selected={result === k} className={result === k ? "on" : ""} onClick={() => setResult(k)}>{label}<span>{n}</span></button>)}</div>
        <label className="g-check"><input type="checkbox" checked={requiredOnly} onChange={e => setRequiredOnly(e.target.checked)} /> Required only</label>
        <label className="d-search"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search criteria" aria-label="Search criteria" /></label>
      </div>
      <div className="g-split">
        <div className="g-grid" role="region" aria-label="Acceptance criteria">
          <AgGridReact<EvidenceRow>
            modules={GRID_MODULES} theme={gridTheme} rowData={shown} columnDefs={columns} defaultColDef={READ_ONLY}
            getRowId={p => p.data.id} domLayout="autoHeight" quickFilterText={search} rowClassRules={rowClassRules}
            rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: true }}
            initialState={initialState} onStateUpdated={e => saveState(e.state)}
            onGridReady={e => { if (selectedIndex !== null) e.api.getRowNode(`${project.id}:${fresh.runId ?? "unchecked"}:${selectedIndex}`)?.setSelected(true); }}
            onSelectionChanged={e => { const r = e.api.getSelectedRows()[0]; if (r) setSelectedIndex(r.index); }}
            onCellKeyDown={e => { if ((e.event as KeyboardEvent | undefined)?.key === "Enter" && e.data) { e.node.setSelected(true); setSelectedIndex(e.data.index); } }}
            overlayNoRowsTemplate={"<span class=\"g-dim\">No criteria match these filters</span>"}
          />
        </div>
        <EvidenceDetail row={selected} run={run && fresh.runId === run.id ? run : null} client={project.role === "client"} onOverview={onOverview}
          delivery={{ url: project.evidence_url, hash: project.evidence_hash, at: project.evidence_at, submissionHash: latestSubmission?.submission_hash ?? null }} />
      </div>
    </> : <div className="g-grid g-wide" role="region" aria-label="Changes since the previous check">
      <p className="g-sub">Check {history.length - 1}{compare.from?.completedAt ? ` (${when(compare.from.completedAt)})` : ""} → check {history.length}{compare.to?.completedAt ? ` (${when(compare.to.completedAt)})` : ""}</p>
      <AgGridReact<ComparisonRow> modules={GRID_MODULES} theme={gridTheme} rowData={compare.rows} columnDefs={changeColumns} defaultColDef={READ_ONLY} getRowId={p => p.data.id} domLayout="autoHeight" />
    </div>}
    <p className="g-foot">Read-only. Results come from the saved checks; approval and payment are decided on the server when you act on the Overview.</p>
  </section>;
}

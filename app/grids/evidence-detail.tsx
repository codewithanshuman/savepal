"use client";
/*
 * The selected criterion, in full: the locked requirement, exactly what the check recorded and
 * where it looked, what the server's approval gate makes of it, how it changed since the previous
 * check, and which check and delivery it belongs to. Every line comes from a saved record.
 */
import type { ApprovalEffect, EvidenceRow, ResultStatus, RunRecord, Transition } from "../../lib/grid-adapters";
import { Pill, when, type Tone } from "./grid-theme";

export const KIND_LABEL: Record<string, string> = {
  reachable: "Site loads", contains: "Shows text", absent: "Text is gone", title: "Page title",
  link: "Button exists", path: "Page exists", no_broken_pages: "No broken pages", manual: "You check it",
};
export const RESULT: Record<ResultStatus, { label: string; tone: Tone }> = {
  VERIFIED: { label: "Verified", tone: "ok" }, FAILED: { label: "Failed", tone: "bad" },
  INCONCLUSIVE: { label: "Inconclusive", tone: "warn" }, NOT_CHECKED: { label: "Not checked", tone: "mute" },
};
export const EFFECT: Record<ApprovalEffect, { label: string; tone: Tone; text: string }> = {
  BLOCKS: { label: "Blocks approval", tone: "bad", text: "A required criterion failed. The client can approve only with an explicit override and a written reason of at least 20 characters, which goes on the approval receipt." },
  NEEDS_CONFIRMATION: { label: "Needs confirming", tone: "warn", text: "A required criterion the check could not prove. Approving asks the client to confirm, in a short note, how they checked it." },
  ADVISORY: { label: "Advisory", tone: "mute", text: "An optional criterion that did not verify. It is recorded, but it never blocks approval." },
  CLEAR: { label: "Clear", tone: "ok", text: "Verified. Nothing more is needed for this criterion." },
  NOT_CHECKED: { label: "Not checked", tone: "mute", text: "No check has covered this criterion yet." },
  UNKNOWN: { label: "—", tone: "mute", text: "The server has not classified this result yet." },
};
export const CHANGE: Record<Transition, { label: string; tone: Tone }> = {
  IMPROVED: { label: "Improved", tone: "ok" }, REGRESSED: { label: "Regressed", tone: "bad" },
  UNCHANGED: { label: "Unchanged", tone: "mute" }, CHANGED: { label: "Changed", tone: "warn" }, FIRST: { label: "First check", tone: "mute" },
};

/** Only web links become links: sources can quote the inspected site, so anything else stays plain text. */
function Source({ url, excerpt }: { url: string; excerpt?: string }) {
  let safe: string | null = null;
  try { const u = new URL(url); if (u.protocol === "https:" || u.protocol === "http:") safe = u.href; } catch { /* not a URL */ }
  return <li>
    {safe ? <a href={safe} target="_blank" rel="noopener noreferrer nofollow">{safe}</a> : <span>{url}</span>}
    {excerpt && <q>{excerpt}</q>}
  </li>;
}

const short = (v: string | null | undefined, n = 12) => (v ? (v.length > n ? `${v.slice(0, n)}…` : v) : "—");

export function EvidenceDetail({ row, run, delivery, client, onOverview }: {
  row: EvidenceRow | null;
  run: RunRecord | null;
  delivery: { url: string | null; hash: string | null; at: string | null; submissionHash: string | null };
  client: boolean;
  onOverview(): void;
}) {
  if (!row) return <aside className="g-detail g-detail-empty" aria-label="Criterion details"><p>Select a criterion to see exactly what was checked.</p></aside>;
  const r = RESULT[row.result], e = EFFECT[row.effect];
  return <aside className="g-detail" aria-label={`Details for ${row.criterion}`} aria-live="polite">
    <header>
      <small>Criterion {row.index + 1}</small>
      <h3>{row.criterion}</h3>
      <div className="g-detail-tags"><Pill tone={r.tone}>{r.label}</Pill>{!row.required && <Pill tone="mute">Optional</Pill>}</div>
    </header>
    <section>
      <h4>Required</h4>
      <p>{KIND_LABEL[row.kind] ?? row.kind}{row.needle ? <> · <q>{row.needle}</q></> : null}</p>
      <p className="g-sub">{row.required ? "Required for approval" : "Optional: never blocks approval"} · locked when the agreement was signed</p>
    </section>
    <section>
      <h4>What the check recorded</h4>
      {row.explanation ? <p className="g-quote">{row.explanation}</p> : <p className="g-sub">Nothing has been recorded for this criterion yet.</p>}
      {(row.check || row.confidence) && <p className="g-sub">{row.check ? `Method: ${row.check}` : ""}{row.check && row.confidence ? " · " : ""}{row.confidence ? `${row.confidence.toLowerCase()} confidence` : ""}</p>}
    </section>
    {row.sources.length > 0 && <section>
      <h4>Sources</h4>
      <ul className="g-sources">{row.sources.map((s, i) => <Source key={i} url={s.url} excerpt={s.excerpt} />)}</ul>
    </section>}
    <section>
      <h4>Effect on approval</h4>
      <div className="g-detail-tags"><Pill tone={e.tone}>{e.label}</Pill></div>
      <p className="g-sub">{e.text}</p>
    </section>
    {row.change && row.change !== "FIRST" && row.previous && <section>
      <h4>Since the previous check</h4>
      <p className="g-change"><Pill tone={RESULT[row.previous].tone}>{RESULT[row.previous].label}</Pill><span aria-hidden="true">→</span><Pill tone={r.tone}>{r.label}</Pill><Pill tone={CHANGE[row.change].tone}>{CHANGE[row.change].label}</Pill></p>
    </section>}
    <section>
      <h4>Check and delivery</h4>
      <dl className="g-facts">
        <dt>Check</dt><dd title={run?.id}>{short(run?.id, 8)}{run?.completed_at ? ` · ${when(run.completed_at)}` : ""}</dd>
        {run?.checker_version && <><dt>Checker</dt><dd>{run.checker_version}{run.model ? ` · ${run.model}` : ""}</dd></>}
        {typeof run?.website_status === "number" && <><dt>Site answered</dt><dd>HTTP {run.website_status}</dd></>}
        {delivery.url && <><dt>Delivery</dt><dd className="g-wrap">{delivery.url}</dd></>}
        {delivery.at && <><dt>Delivered</dt><dd>{when(delivery.at)}</dd></>}
        {delivery.hash && <><dt>Capture</dt><dd title={delivery.hash}>SHA-256 {short(delivery.hash)}</dd></>}
        {delivery.submissionHash && <><dt>Submission</dt><dd title={delivery.submissionHash}>{short(delivery.submissionHash)}</dd></>}
      </dl>
    </section>
    <footer><button className="d-btn" onClick={onOverview}>{client ? "Approve or request changes on the Overview" : "Back to the Overview"}</button></footer>
  </aside>;
}

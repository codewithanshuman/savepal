"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowRight, Check, CheckCircle2, CircleDollarSign, ClipboardCheck, Clock3, ExternalLink, FileCheck2, FileText, Fingerprint, GitCompareArrows, LayoutDashboard, Link2, LockKeyhole, Menu, Plus, RefreshCw, ShieldAlert, ShieldCheck, Sparkles, TrendingDown, TrendingUp, X, XCircle } from "lucide-react";

type Kind = "reachable" | "contains" | "absent" | "title" | "link" | "path" | "no_broken_pages" | "manual";
type Criterion = { label: string; kind: Kind; needle?: string; required?: boolean };
type Status = "VERIFIED" | "FAILED" | "INCONCLUSIVE";
type Finding = { label: string; status: Status; explanation: string; check: string; confidence?: "HIGH" | "MEDIUM" | "LOW"; evidenceRefs?: Array<{ url: string; excerpt?: string }> };
type GateItem = { index: number; label: string; status: Status; required: boolean };
type Gate = { blocking: GateItem[]; unconfirmed: GateItem[]; advisory: GateItem[]; verified: number; total: number; mode: "CLEAR" | "CONFIRM" | "OVERRIDE"; minimumReason: number };
type Consent = { legacy: boolean; termsHash: string; fingerprint: string; clientBound: boolean; freelancerBound: boolean; tampered: boolean };
type RunSummary = { runId: string; submissionId: string | null; completedAt: string | null; verified: number; failed: number; inconclusive: number; improved: number; regressed: number; score: number; scoreChange: number | null; deltas: Array<{ index: number; label: string; from: Status | null; to: Status; transition: "IMPROVED" | "REGRESSED" | "UNCHANGED" | "CHANGED" | "FIRST" }> };

/** Check types the client can pick; `needle` describes the parameter each one takes. */
const KINDS: Record<Kind, { label: string; hint: string; needle?: { placeholder: string; label: string } }> = {
  reachable: { label: "Site is reachable", hint: "Automated HTTPS check, submitted and live" },
  contains: { label: "Page shows text", hint: "Whole phrase in visible text on any page", needle: { placeholder: "Expected text, e.g. Products", label: "Expected text" } },
  absent: { label: "Text must NOT appear", hint: "Fails if the phrase is anywhere, e.g. placeholder copy", needle: { placeholder: "Forbidden text, e.g. lorem ipsum", label: "Forbidden text" } },
  title: { label: "Page title contains", hint: "Whole phrase in the home page <title>", needle: { placeholder: "Title text, e.g. Acme Store", label: "Title text" } },
  link: { label: "Link or button exists", hint: "A visible link or button with this label", needle: { placeholder: "Label, e.g. Add to cart", label: "Control label" } },
  path: { label: "Specific page loads", hint: "This page returns 200, submitted and live", needle: { placeholder: "/pricing", label: "Page path" } },
  no_broken_pages: { label: "No broken pages", hint: "Every captured page loads without errors" },
  manual: { label: "Human review", hint: "Client checks this by hand" },
};
const criterionHint = (c: Criterion) => c.needle ? `${KINDS[c.kind]?.hint ?? ""} · “${c.needle}”` : KINDS[c.kind]?.hint ?? "";
type Project = {
  id: string; role: "client" | "freelancer"; title: string; description: string;
  client_email: string; freelancer_email: string; amount_cents: number; currency: string;
  criteria: Criterion[]; status: string; evidence_url: string | null; evidence_notes: string | null;
  evidence_hash: string | null; evidence_at: string | null; findings: Finding[] | null;
  evaluated_at: string | null; decision_reason: string | null; payment_status: string;
  paypal_order_id: string | null; paypal_capture_id: string | null; created_at: string;
  seller_merchant_id: string | null; payment_recipient_merchant_id: string | null;
  paymentAwaitingReconciliation: boolean;
  gate: Gate | null; consent: Consent; accepted_at: string | null;
  revisions: { max: number | null; used: number; remaining: number | null; exhausted: boolean };
};
type Event = { actor: string; type: string; detail: string; created_at: string };
type WorkspaceData = { user: { name: string; email: string }; projects: Project[]; paypalReady: boolean; sellerOnboardingReady: boolean; paymentMode: "SELLER" | "MERCHANT"; paypalClientId: string | null; paypalPartnerBnCode: string | null; aiReady: boolean };
type PayPal = { Buttons: (options: { createOrder: () => Promise<string>; onApprove: (data: { orderID: string }) => Promise<void>; onError: (error: Error) => void; style: { layout: string; color: string; shape: string; label: string } }) => { render: (selector: string) => Promise<void> } };
declare global { interface Window { paypal?: PayPal } }

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(cents / 100);
const date = (value: string | null) => value ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
const initials = (value: string) => value.split(/[\s@.]+/).slice(0, 2).map(x => x[0]?.toUpperCase()).join("");
const statusLabel: Record<string,string> = { INVITED: "Awaiting acceptance", AGREED: "Awaiting delivery", SUBMITTED: "Ready to verify", REVIEW: "Review required", APPROVED: "Approved", REVISION_REQUESTED: "Revision requested" };
const steps = ["Agreement", "Evidence", "Verification", "Decision", "Payment"];

async function api(payload: Record<string, unknown>) {
  const res = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json() as { error?: string; id?: string; orderId?: string; status?: string; actionUrl?: string; connected?: boolean };
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function PlaneMark() {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true"><path d="M21.6 2.6 2.9 10.1c-.8.3-.8 1.5.1 1.7l6.4 1.8 1.8 6.4c.2.9 1.4 1 1.7.1l7.5-18.7c.2-.5-.3-1-.8-.8Z" fill="currentColor"/><path d="m9.4 13.6 5.2-5.2" stroke="var(--plane-crease,#2f6fdc)" strokeWidth="1.6" strokeLinecap="round"/></svg>;
}

function Pill({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function PayPalCheckout({ project, clientId, merchantId, bnCode, onPaid, onError }: { project: Project; clientId: string; merchantId?: string; bnCode?: string | null; onPaid: () => void; onError: (message: string) => void }) {
  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      const sdkUrl = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture${merchantId ? `&merchant-id=${encodeURIComponent(merchantId)}` : ""}`;
      const previous = document.querySelector<HTMLScriptElement>('script[data-savepal-paypal="true"]');
      if (previous && previous.src !== sdkUrl) { previous.remove(); window.paypal = undefined; }
      if (!window.paypal) {
        const script = document.createElement("script");
        script.src = sdkUrl;
        script.dataset.savepalPaypal = "true";
        if (bnCode) script.dataset.partnerAttributionId = bnCode;
        script.async = true;
        await new Promise<void>((resolve, reject) => { script.onload = () => resolve(); script.onerror = () => reject(new Error("PayPal SDK could not load")); document.head.appendChild(script); });
      }
      if (cancelled || !window.paypal) return;
      await window.paypal.Buttons({
        createOrder: async () => {
          const result = await api({ action: "create_order", id: project.id });
          if (!result.orderId) throw new Error("PayPal order ID is missing");
          return result.orderId;
        },
        onApprove: async ({ orderID }) => {
          const result = await api({ action: "capture_order", id: project.id, orderId: orderID });
          if (result.status === "COMPLETED") onPaid();
          else onError("PayPal reported a pending capture. Check back for confirmation.");
        },
        onError: (error) => onError(error.message || "PayPal checkout failed"),
        style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal" },
      }).render("#paypal-button");
    };
    start().catch(e => onError(e.message));
    return () => { cancelled = true; };
  }, [project.id, clientId, merchantId, bnCode, onPaid, onError]);
  return <div id="paypal-button" className="paypal-button" />;
}

export default function Workspace() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [audit, setAudit] = useState<Event[]>([]);
  const [tab, setTab] = useState<"overview" | "activity">("overview");
  const [creating, setCreating] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("Website implementation");
  const [description, setDescription] = useState("Build and deliver a responsive e-commerce website with a product catalog and test checkout.");
  const [freelancerEmail, setFreelancerEmail] = useState("");
  const [amount, setAmount] = useState("1000");
  const [criteria, setCriteria] = useState<Criterion[]>([
    { label: "The deployed website is reachable over HTTPS", kind: "reachable", required: true },
    { label: "The page contains a product catalog", kind: "contains", needle: "Products", required: true },
    { label: "No placeholder copy is left on the site", kind: "absent", needle: "lorem ipsum", required: true },
    { label: "Visitors can add an item to the cart", kind: "link", needle: "Add to cart", required: true },
    { label: "A test checkout can be completed", kind: "manual", required: false },
  ]);
  const [maxRevisions, setMaxRevisions] = useState("2");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceNotes, setEvidenceNotes] = useState("");
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [history, setHistory] = useState<RunSummary[]>([]);
  useEffect(() => {
    const projectId = new URLSearchParams(window.location.search).get("project");
    if (projectId) setSelected(projectId);
  }, []);

  const refresh = useCallback(async (chosen?: string | null) => {
    const res = await fetch("/api/workspace", { cache: "no-store" });
    if (!res.ok) throw new Error("Workspace could not load");
    const next = await res.json() as WorkspaceData;
    setData(next);
    const id = chosen === undefined ? selected : chosen;
    if (id) {
      const detail = await fetch(`/api/workspace?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (detail.ok) {
        const body = await detail.json() as { audit: Event[]; revisionHistory?: RunSummary[] };
        setAudit(body.audit);
        setHistory(body.revisionHistory || []);
      }
    }
  }, [selected]);
  useEffect(() => { refresh().catch(e => setError(e.message)); }, [refresh]);
  const project = data?.projects.find(p => p.id === selected) || null;
  const openProject = (id: string) => { setSelected(id); setCreating(false); setTab("overview"); setError(""); setNotice(""); setOverride(false); setReason(""); setHistory([]); refresh(id).catch(e => setError(e.message)); };
  const run = async (payload: Record<string, unknown>, success: string) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api(payload);
      await refresh(result.id || selected);
      if (result.id) { setSelected(result.id); setCreating(false); }
      setNotice(success);
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(false); }
  };
  const connectSeller = async (id: string) => {
    setBusy(true); setError("");
    try {
      const result = await api({ action: "begin_seller_onboarding", id });
      if (result.connected) { await refresh(id); setNotice("PayPal seller connection verified."); setBusy(false); return; }
      if (!result.actionUrl) throw new Error("PayPal did not return an onboarding link");
      window.location.assign(result.actionUrl);
    } catch (e) { setError(e instanceof Error ? e.message : "Seller connection failed"); setBusy(false); }
  };
  const onPaid = useCallback(() => { setNotice("PayPal sandbox capture confirmed."); refresh().catch(e => setError(e.message)); }, [refresh]);
  const onPayError = useCallback((message: string) => setError(message), []);
  const totals = useMemo(() => ({
    contracts: data?.projects.length || 0,
    inReview: data?.projects.filter(p => p.status === "REVIEW" || p.status === "SUBMITTED").length || 0,
    paid: data?.projects.filter(p => p.payment_status === "COMPLETED").reduce((sum,p) => sum + p.amount_cents, 0) || 0,
  }), [data]);
  const currentStep = project ? project.payment_status === "COMPLETED" ? 5 : project.status === "APPROVED" ? 4 : project.status === "REVIEW" ? 3 : project.status === "SUBMITTED" ? 2 : project.evidence_url ? 1 : 0 : 0;

  return <div className="shell">
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <Link href="/" className="brand"><div className="brand-icon"><PlaneMark/></div><div><strong>savepal</strong><small>WORK ASSURANCE</small></div></Link>
      <div className="nav-group-label">WORKSPACE</div>
      <button className={`nav-item ${!selected && !creating && tab === "overview" ? "active" : ""}`} onClick={() => { setSelected(null); setCreating(false); setTab("overview"); setMobileNav(false); }}><LayoutDashboard size={18}/> Overview</button>
      <button className={`nav-item ${selected && tab === "overview" ? "active" : ""}`} onClick={() => { setTab("overview"); setMobileNav(false); }}><FileText size={18}/> Agreements <span className="nav-count">{totals.contracts}</span></button>
      <button className={`nav-item ${tab === "activity" ? "active" : ""}`} onClick={() => { setTab("activity"); setMobileNav(false); }}><Activity size={18}/> Activity</button>
      <div className="nav-divider" />
      <div className="nav-group-label">YOUR AGREEMENTS</div>
      <div className="project-nav">{data?.projects.map(p => <button key={p.id} className={`project-nav-item ${selected === p.id ? "selected" : ""}`} onClick={() => { openProject(p.id); setMobileNav(false); }}><span className="project-dot" /> <span>{p.title}</span></button>)}</div>
      <button className="sidebar-new" onClick={() => { setCreating(true); setSelected(null); setMobileNav(false); }}><Plus size={16}/> New agreement</button>
      <div className="sidebar-bottom"><div className="sandbox-tag"><span className="live-dot"/> PAYPAL SANDBOX</div><div className="profile"><div className="avatar">{initials(data?.user.name || "SP")}</div><div><strong>{data?.user.name?.split("@")[0] || "Your workspace"}</strong><span>{data?.user.email || "Loading…"}</span></div></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMobileNav(!mobileNav)} aria-label="Toggle menu"><Menu size={20}/></button><div className="breadcrumb">Workspace <span>/</span> {creating ? "New agreement" : project ? project.title : tab === "activity" ? "Activity" : "Overview"}</div><div className="topbar-right"><span className="topbar-secure"><LockKeyhole size={14}/> Secure workspace</span><button className="icon-button" onClick={() => refresh().catch(e => setError(e.message))} aria-label="Refresh"><RefreshCw size={17}/></button><div className="top-avatar">{initials(data?.user.name || "SP")}</div></div></header>
      <div className="content">
        {error && <div className="flash flash-error"><XCircle size={17}/><span>{error}</span><button onClick={() => setError("")}><X size={16}/></button></div>}
        {notice && <div className="flash flash-success"><CheckCircle2 size={17}/><span>{notice}</span><button onClick={() => setNotice("")}><X size={16}/></button></div>}
        {!data && !error && <div className="loading">Opening your workspace…</div>}
        {creating && data && <div className="create-view"><div className="page-eyebrow">NEW AGREEMENT <span>·</span> VERSION 1</div><h1>Make the work measurable.</h1><p className="page-lead">Define the milestone and its acceptance criteria before delivery begins. The terms lock when you create the agreement.</p>
          <form onSubmit={e => { e.preventDefault(); run({ action: "create", title, description, freelancerEmail, amount, criteria: criteria.map(c => KINDS[c.kind].needle ? c : { ...c, needle: undefined }), maxRevisions }, "Agreement created and bound to its terms fingerprint. Share this workspace with the freelancer."); }}>
            <div className="form-card"><div className="form-card-heading"><div className="section-number">01</div><div><h2>Milestone details</h2><p>The essentials both sides will see.</p></div></div><div className="form-grid"><label>Milestone title<input value={title} onChange={e=>setTitle(e.target.value)} required maxLength={120}/></label><label>Freelancer email<input type="email" value={freelancerEmail} onChange={e=>setFreelancerEmail(e.target.value)} placeholder="freelancer@example.com" required/></label><label className="full">Scope of work<textarea rows={3} value={description} onChange={e=>setDescription(e.target.value)} required maxLength={2000}/></label><label>Milestone amount <span className="label-hint">USD · sandbox</span><div className="money-input"><span>$</span><input type="number" min="1" max="1000000" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} required/></div></label><label>Revision rounds <span className="label-hint">Part of the locked terms</span><select value={maxRevisions} onChange={e=>setMaxRevisions(e.target.value)}>{["0","1","2","3","5"].map(n=><option key={n} value={n}>{n === "0" ? "No revisions" : `Up to ${n} revision${n==="1"?"":"s"}`}</option>)}<option value="">Unlimited</option></select></label></div></div>
            <div className="form-card"><div className="form-card-heading"><div className="section-number">02</div><div><h2>Acceptance criteria</h2><p>Each criterion gets its own finding. Required ones gate approval; optional ones are recorded.</p></div></div><div className="criterion-editor">{criteria.map((c,i)=>{const spec=KINDS[c.kind];const update=(patch: Partial<Criterion>)=>setCriteria(criteria.map((x,j)=>j===i?{...x,...patch}:x));return <div key={i} className={`criterion-row ${c.required===false?"optional":""}`}><span className="criterion-index">{String(i+1).padStart(2,"0")}</span><div className="criterion-fields"><input aria-label={`Criterion ${i+1}`} value={c.label} onChange={e=>update({label:e.target.value})} placeholder="What must be true?" required minLength={3} maxLength={240}/><div className="criterion-options"><select aria-label={`Check type ${i+1}`} value={c.kind} onChange={e=>update({kind:e.target.value as Kind})}>{(Object.keys(KINDS) as Kind[]).map(k=><option key={k} value={k}>{KINDS[k].label}</option>)}</select>{spec.needle && <input aria-label={spec.needle.label} value={c.needle || ""} onChange={e=>update({needle:e.target.value})} placeholder={spec.needle.placeholder} required maxLength={c.kind==="path"?200:100}/>}</div><div className="criterion-meta"><span>{spec.hint}</span><button type="button" role="switch" aria-checked={c.required!==false} className={`req-toggle ${c.required===false?"":"on"}`} onClick={()=>update({required:c.required===false})}><i/>{c.required===false?"Optional":"Required"}</button></div></div><button type="button" className="icon-button remove" disabled={criteria.length===1} onClick={()=>setCriteria(criteria.filter((_,j)=>j!==i))} aria-label="Remove criterion"><X size={16}/></button></div>})}</div><button type="button" className="text-button" disabled={criteria.length>=8} onClick={()=>setCriteria([...criteria,{label:"",kind:"manual",required:true}])}><Plus size={15}/> Add criterion</button></div>
            <div className="create-footer"><span><LockKeyhole size={15}/> Terms are locked after creation.</span><button className="primary-button" disabled={busy}>{busy ? "Creating…" : "Create agreement"} <ArrowRight size={17}/></button></div>
          </form>
        </div>}
        {!creating && data && !project && tab === "overview" && <div><div className="welcome"><div><div className="page-eyebrow">SAVE­PAL WORKSPACE <span>·</span> PAYMENT ASSURANCE</div><h1>Good work deserves<br/><em>a clear path to payment.</em></h1><p>Bring your agreements, evidence, decisions, and PayPal sandbox payments into one accountable workflow.</p><button className="primary-button" onClick={()=>setCreating(true)}><Plus size={17}/> New agreement</button></div><div className="welcome-art" aria-hidden="true"><div className="art-plane"><PlaneMark/></div><div className="art-card art-card-back"><div/><div/><div/></div><div className="art-card art-card-front"><div className="art-check"><Check size={22}/></div><div className="art-lines"><span/><span/></div><div className="art-pill">VERIFIED</div></div></div></div><div className="stats"><div className="stat"><div className="stat-icon blue"><FileText size={19}/></div><span>Active agreements</span><strong>{totals.contracts}</strong></div><div className="stat"><div className="stat-icon amber"><Clock3 size={19}/></div><span>Needs review</span><strong>{totals.inReview}</strong></div><div className="stat"><div className="stat-icon green"><CircleDollarSign size={19}/></div><span>Sandbox paid</span><strong>{money(totals.paid)}</strong></div></div><div className="section-heading"><div><h2>Agreements</h2><p>Every milestone, from scope to settlement.</p></div><button className="ghost-button" onClick={()=>setCreating(true)}><Plus size={16}/> New agreement</button></div>{data.projects.length ? <div className="agreement-list">{data.projects.map(p=><button key={p.id} className="agreement-row" onClick={()=>openProject(p.id)}><div className="agreement-logo"><FileText size={20}/></div><div className="agreement-info"><strong>{p.title}</strong><span>{p.role === "client" ? "Client" : "Freelancer"} · {p.role === "client" ? p.freelancer_email : p.client_email}</span></div><Pill tone={p.payment_status === "COMPLETED" ? "green" : p.status === "REVIEW" ? "amber" : "blue"}>{p.payment_status === "COMPLETED" ? "Paid" : statusLabel[p.status] || p.status}</Pill><strong className="agreement-amount">{money(p.amount_cents)}</strong><ArrowRight size={17} className="row-arrow"/></button>)}</div> : <div className="empty"><div className="empty-icon"><FileCheck2 size={26}/></div><h3>Your first agreement starts here</h3><p>Create a milestone with clear acceptance criteria, then invite a freelancer to submit evidence.</p><button className="primary-button" onClick={()=>setCreating(true)}>Create an agreement <ArrowRight size={16}/></button></div>}</div>}
        {!creating && data && project && tab === "overview" && <div className="detail-view"><div className="detail-heading"><div><div className="page-eyebrow">AGREEMENT <span>·</span> {project.id.slice(0,8).toUpperCase()}</div><h1>{project.title}</h1><p>{project.description}</p><div className="detail-pills"><Pill tone={project.payment_status === "COMPLETED" ? "green" : project.status === "REVIEW" ? "amber" : "blue"}>{project.payment_status === "COMPLETED" ? "Payment completed" : statusLabel[project.status] || project.status}</Pill><Pill>{project.role === "client" ? "Client view" : "Freelancer view"}</Pill></div></div><div className="amount-card"><small>MILESTONE VALUE</small><strong>{money(project.amount_cents)}</strong><span>USD · PayPal sandbox</span></div></div>
          <div className="stepper">{steps.map((step,i)=><div key={step} className={`step ${i<currentStep?"done":i===currentStep?"current":""}`}><span className="step-circle">{i<currentStep?<Check size={14}/>:String(i+1).padStart(2,"0")}</span><span>{step}</span></div>)}</div>
          <div className="detail-grid"><div className="detail-main"><section className="panel"><div className="panel-heading"><div className="panel-icon"><ClipboardCheck size={20}/></div><div><h2>Acceptance criteria</h2><p>Agreement version 1 · locked at creation</p></div><LockKeyhole size={16} className="muted-icon"/></div><div className="criteria-list">{project.criteria.map((c,i)=>{const f=project.findings?.[i];const quote=f?.evidenceRefs?.find(r=>r.excerpt)?.excerpt;return <div className="criteria-item" key={i}><div className={`finding-icon ${f?.status?.toLowerCase() || ""}`}>{f?.status==="VERIFIED"?<Check size={16}/>:f?.status==="FAILED"?<X size={16}/>:<span>{String(i+1).padStart(2,"0")}</span>}</div><div><strong>{c.label} <em className={`req-chip ${c.required===false?"":"on"}`}>{c.required===false?"Optional":"Required"}</em></strong><span>{f ? f.explanation : criterionHint(c)}</span>{quote && <q className="finding-quote">{quote}</q>}</div>{f && <div className="finding-tags"><Pill tone={f.status==="VERIFIED"?"green":f.status==="FAILED"?"red":"amber"}>{f.status.toLowerCase()}</Pill>{f.confidence && <span className={`confidence c-${f.confidence.toLowerCase()}`} title="How strongly the captured evidence supports this result">{f.confidence.toLowerCase()} confidence</span>}</div>}</div>})}</div></section>
          <section className="panel"><div className="panel-heading"><div className="panel-icon"><Link2 size={20}/></div><div><h2>Delivery evidence</h2><p>Specific submission tied to this milestone</p></div></div>{project.evidence_url ? <div className="evidence-card"><div><small>WEBSITE URL</small><a href={project.evidence_url} target="_blank" rel="noopener noreferrer">{project.evidence_url} <ExternalLink size={14}/></a></div><p>{project.evidence_notes}</p><div className="evidence-meta">Submitted {date(project.evidence_at)} · SHA-256 {project.evidence_hash?.slice(0,16)}…</div></div> : <div className="panel-empty">No evidence has been submitted yet.</div>}
            {project.role==="freelancer" && ["AGREED","REVISION_REQUESTED"].includes(project.status) && <form className="inline-form" onSubmit={e=>{e.preventDefault();run({action:"submit",id:project.id,url:evidenceUrl,notes:evidenceNotes},"Evidence submitted. The client can now run verification.");}}><h3>{project.evidence_url?"Submit a new version":"Submit your work"}</h3><label>Deployed HTTPS URL<input type="url" value={evidenceUrl} onChange={e=>setEvidenceUrl(e.target.value)} placeholder="https://your-project.example" required/></label><label>Evidence notes<textarea value={evidenceNotes} onChange={e=>setEvidenceNotes(e.target.value)} rows={3} placeholder="Describe what you delivered and how to test it." required/></label><button className="primary-button" disabled={busy}>Submit evidence <ArrowRight size={16}/></button></form>}</section>
          {project.findings && <section className="panel"><div className="panel-heading"><div className="panel-icon"><Sparkles size={20}/></div><div><h2>Verification report</h2><p>Objective checks · {date(project.evaluated_at)}</p></div></div><div className="report-summary">{project.findings.filter(f=>f.status==="VERIFIED").length} verified <span>·</span> {project.findings.filter(f=>f.status==="FAILED").length} failed <span>·</span> {project.findings.filter(f=>f.status==="INCONCLUSIVE").length} inconclusive</div>{project.gate && <div className={`gate gate-${project.gate.mode.toLowerCase()}`}><div className="gate-meter" style={{["--v" as string]: project.gate.verified/project.gate.total}}><span/></div><strong>{project.gate.mode==="CLEAR"?"Every criterion verified — clear to approve.":project.gate.mode==="CONFIRM"?`${project.gate.unconfirmed.length+project.gate.advisory.length} item${project.gate.unconfirmed.length+project.gate.advisory.length===1?"":"s"} need your judgement before approval.`:`${project.gate.blocking.length} required ${project.gate.blocking.length===1?"criterion":"criteria"} failed — approval is blocked.`}</strong>{[...project.gate.blocking.map(b=>({...b,tag:"Blocking"})),...project.gate.unconfirmed.map(b=>({...b,tag:"Confirm by hand"})),...project.gate.advisory.map(b=>({...b,tag:"Optional"}))].map(b=><div key={b.index} className="gate-row"><span>#{b.index+1}</span>{b.label}<em>{b.tag}</em></div>)}</div>}<p className="report-note">Findings prepare the decision; they never make it. Required criteria gate approval under the locked policy.</p></section>}
          {history.length > 0 && <section className="panel"><div className="panel-heading"><div className="panel-icon"><GitCompareArrows size={20}/></div><div><h2>Revision intelligence</h2><p>{history.length} verification run{history.length===1?"":"s"} · {project.revisions.max===null?"unlimited revisions":`${project.revisions.used} of ${project.revisions.max} revisions used`}</p></div></div><div className="runs">{[...history].reverse().map((r,i)=><div className="run" key={r.runId}><div className="run-head"><span className="run-score" style={{["--v" as string]: r.score/100}}><b>{r.score}</b></span><div><strong>{i===0?"Latest run":`Run ${history.length-i}`}</strong><small>{date(r.completedAt)} · {r.verified} verified · {r.failed} failed · {r.inconclusive} open</small></div>{r.scoreChange!==null && <span className={`run-delta ${r.scoreChange>0?"up":r.scoreChange<0?"down":""}`}>{r.scoreChange>0?<TrendingUp size={14}/>:r.scoreChange<0?<TrendingDown size={14}/>:null}{r.scoreChange>0?"+":""}{r.scoreChange}</span>}</div>{r.deltas.some(d=>d.transition==="IMPROVED"||d.transition==="REGRESSED") && <div className="run-deltas">{r.deltas.filter(d=>d.transition==="IMPROVED"||d.transition==="REGRESSED").map(d=><span key={d.index} className={d.transition.toLowerCase()}>#{d.index+1} {d.from?.toLowerCase()} → {d.to.toLowerCase()}</span>)}</div>}{r.regressed>0 && history.length-i>1 && history[history.length-i-2]?.submissionId===r.submissionId && <p className="run-warn">Regressed without a new submission — the live site changed after it was submitted.</p>}</div>)}</div></section>}
          </div><aside className="detail-side"><section className="panel action-panel"><div className="side-icon"><ShieldCheck size={22}/></div><h2>Next action</h2>{project.status==="INVITED" && <><p>The invited freelancer must accept the locked terms before delivering work.</p>{project.role==="freelancer" ? <>{!project.consent.legacy && <div className="consent-card"><Fingerprint size={18}/><div><small>TERMS FINGERPRINT</small><strong>{project.consent.fingerprint}</strong><span>Accepting binds you to exactly these terms. Your client sees the same fingerprint.</span></div></div>}<button className="primary-button wide" disabled={busy || project.consent.tampered} onClick={()=>run({action:"accept",id:project.id,termsHash:project.consent.termsHash},"Agreement accepted. Both parties are now bound to the same terms.")}>Accept these exact terms <Check size={16}/></button></> : <div className="side-hint">Invited freelancer<br/><strong>{project.freelancer_email}</strong></div>}</>}{project.status==="AGREED" && <><p>Waiting for the assigned freelancer to submit the website URL and delivery notes.</p><div className="side-hint">Assigned to<br/><strong>{project.freelancer_email}</strong></div></>}
            {project.status==="REVISION_REQUESTED" && <><p>The freelancer can submit revised evidence against the same agreement.</p><div className="side-hint">Client feedback<br/><strong>{project.decision_reason}</strong></div></>}
            {project.status==="SUBMITTED" && <><p>Evidence is ready. Run the objective website checks to prepare a report.</p>{project.role==="client" && <button className="primary-button wide" disabled={busy} onClick={()=>run({action:"verify",id:project.id},"Verification report generated.")}>{busy?"Checking…":"Run verification"} <ArrowRight size={16}/></button>}</>}
            {project.status==="REVIEW" && <><p>Review each finding and the underlying evidence. You retain the final decision.</p>{project.role==="client" && (()=>{const gate=project.gate;const mode=gate?.mode??"CONFIRM";const min=gate?.minimumReason??5;const short=reason.trim().length<min;const approveBlocked=mode==="OVERRIDE"&&!override;return <div className="decision"><label>Decision reason <span className="label-hint">{mode==="OVERRIDE"?`Override needs ${min}+ characters`:mode==="CONFIRM"?"Say how you checked the open items":"Optional when everything verified"}</span><textarea value={reason} onChange={e=>setReason(e.target.value)} rows={3} placeholder={mode==="OVERRIDE"?"Why approve despite a failed required criterion? This is recorded on the receipt.":"Explain your decision or requested changes."}/></label>{mode==="OVERRIDE" && <label className="override"><input type="checkbox" checked={override} onChange={e=>setOverride(e.target.checked)}/><ShieldAlert size={16}/><span>Override the policy for {gate!.blocking.map(b=>`#${b.index+1}`).join(", ")}. The override and your reason are written into the approval receipt.</span></label>}<button className={`primary-button wide ${mode==="OVERRIDE"?"danger":""}`} disabled={busy||approveBlocked||(mode!=="CLEAR"&&short)} onClick={()=>run({action:"approve",id:project.id,reason,override:mode==="OVERRIDE"&&override},mode==="OVERRIDE"?"Approved with a recorded policy override. Payment is still separate.":"Milestone approved. Payment is still separate.")}>{mode==="OVERRIDE"?"Approve with override":"Approve milestone"} <Check size={16}/></button><button className="outline-button wide" disabled={busy||project.revisions.exhausted||reason.trim().length<5} onClick={()=>run({action:"revise",id:project.id,reason},"Revision requested.")}>{project.revisions.exhausted?"Revision limit reached":`Request revision${project.revisions.remaining!==null?` · ${project.revisions.remaining} left`:""}`}</button></div>})()}</>}
            {project.role==="freelancer" && data.paymentMode==="SELLER" && !project.seller_merchant_id && data.sellerOnboardingReady && !project.paypal_order_id && <><p>Connect your PayPal seller account so this agreement can be paid to you.</p><button className="outline-button wide" disabled={busy} onClick={()=>connectSeller(project.id)}>Connect PayPal recipient <ArrowRight size={15}/></button></>}
            {project.role==="freelancer" && data.paymentMode==="SELLER" && project.seller_merchant_id && <div className="integration-note">PayPal recipient verified: {project.seller_merchant_id}</div>}
            {project.status==="APPROVED" && !["COMPLETED","PARTIALLY_REFUNDED","REFUNDED"].includes(project.payment_status) && <>
              <p>The milestone is approved. Payment requires a separate client action through PayPal sandbox.</p>
              <div className="integration-note">{data.paymentMode==="SELLER" ? project.seller_merchant_id ? `Checkout is bound to freelancer merchant ${project.seller_merchant_id}.` : "The freelancer must connect a PayPal seller account before checkout." : "Checkout pays the configured sandbox merchant; it does not prove a freelancer payout."}</div>
              {project.role==="client" && data.paypalReady && data.paypalClientId && (data.paymentMode==="MERCHANT" || !!project.seller_merchant_id) ? <PayPalCheckout project={project} clientId={data.paypalClientId} merchantId={data.paymentMode==="SELLER" ? project.seller_merchant_id || undefined : undefined} bnCode={data.paypalPartnerBnCode} onPaid={onPaid} onError={onPayError}/> : !data.paypalReady && <div className="integration-note">PayPal sandbox credentials and a recipient merchant ID must be configured before checkout can run.</div>}
              {project.role==="client" && project.paymentAwaitingReconciliation && <button className="outline-button wide" disabled={busy} onClick={()=>run({action:"sync_payment",id:project.id},"Payment status checked with PayPal.")}>Reconcile with PayPal <RefreshCw size={15}/></button>}
            </>}
            {["COMPLETED","PARTIALLY_REFUNDED","REFUNDED"].includes(project.payment_status) && <><p>{project.payment_status==="COMPLETED" ? "The PayPal sandbox capture was confirmed." : project.payment_status==="REFUNDED" ? "The PayPal sandbox capture was refunded." : "The PayPal sandbox capture was partially refunded."}</p><div className="receipt"><small>CAPTURE ID</small><strong>{project.paypal_capture_id}</strong></div></>}
          </section><section className={`panel consent-panel ${project.consent.tampered?"bad":project.consent.freelancerBound?"bound":""}`}><div className="consent-head"><Fingerprint size={18}/><h3>Terms consent</h3></div>{project.consent.legacy ? <p>Created before terms binding; acceptance is recorded in the audit log only.</p> : <><code>{project.consent.fingerprint}</code><div className="consent-parties"><span className={project.consent.clientBound?"ok":"no"}>{project.consent.clientBound?<Check size={13}/>:<X size={13}/>} Client bound</span><span className={project.consent.freelancerBound?"ok":"no"}>{project.consent.freelancerBound?<Check size={13}/>:<Clock3 size={13}/>} Freelancer {project.consent.freelancerBound?"bound":"pending"}</span></div>{project.consent.tampered && <p className="consent-alert">Locked terms no longer match this fingerprint. Approval and payment are frozen.</p>}</>}</section><section className="panel side-details"><h3>Agreement details</h3><div><span>Revisions</span><strong>{project.revisions.max===null?`${project.revisions.used} used · unlimited`:`${project.revisions.used} of ${project.revisions.max} used`}</strong></div><div><span>Client</span><strong>{project.client_email}</strong></div><div><span>Freelancer</span><strong>{project.freelancer_email}</strong></div><div><span>Created</span><strong>{date(project.created_at)}</strong></div><div><span>Currency</span><strong>USD</strong></div><div><span>Payment</span><strong>{project.payment_status.replaceAll("_"," ")}</strong></div></section></aside></div>
        </div>}
        {!creating && data && tab==="activity" && <div className="activity-view"><div className="page-eyebrow">TRANSPARENT BY DESIGN</div><h1>Activity history</h1><p className="page-lead">Decisions, submissions, and payment events tied to the selected agreement.</p>{!project ? <div className="empty"><div className="empty-icon"><Activity size={26}/></div><h3>Select an agreement</h3><p>Choose an agreement from the left to see its audit history.</p></div> : <div className="timeline">{audit.map((e,i)=><div className="timeline-item" key={i}><div className="timeline-mark"/><div className="timeline-content"><div><strong>{e.type.replaceAll("_"," ")}</strong><time>{date(e.created_at)}</time></div><p>{e.detail}</p><small>{e.actor}</small></div></div>)}</div>}</div>}
      </div>
    </main>
  </div>;
}

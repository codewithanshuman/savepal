"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PayPalCheckout from "../../paypal-checkout";
import { NATIVE_H, NATIVE_W, project } from "./engine";
import { drawScene, houseBounds, landmarkAt, landmarkBounds, type House, type Landmark, type SceneState, type Verdict, type Walker } from "./scene";

/* The Realm: one agreement as a small kingdom, and a place where the work actually happens.
 * Castle = the client's throne room (checks, approval), treasury = the PayPal hold (fund, release,
 * recall), guild hall = the freelancer (accept, deliver). Every action here is the real API call. */

type Criterion = { label: string; kind: string; needle?: string; required?: boolean };
type Gate = { mode: "CLEAR" | "CONFIRM" | "OVERRIDE"; verified: number; total: number; minimumReason: number; blocking: Array<{ index: number }>; unconfirmed: unknown[]; advisory: unknown[] };
type Project = {
  id: string; role: "client" | "freelancer"; title: string; client_email: string; freelancer_email: string;
  amount_cents: number; status: string; payment_status: string; evidence_url: string | null; decision_reason: string | null;
  criteria: Criterion[]; findings: Array<{ status: Verdict }> | null; gate: Gate | null;
  consent: { termsHash: string; fingerprint: string; tampered: boolean; legacy: boolean };
  revisions: { remaining: number | null; exhausted: boolean };
  paypal_order_id: string | null; paypal_capture_id: string | null; seller_merchant_id: string | null;
  funding: { mode: string; status: string; expiresAt: string | null; canFund: boolean; canRelease: boolean; canVoid: { allowed: boolean } };
};
type ListData = { projects: Project[]; crewReady?: boolean; paypalReady: boolean; paypalClientId: string | null; paypalPartnerBnCode: string | null; paymentMode: "SELLER" | "MERCHANT"; user: { name: string; email: string; avatar: string | null } };
type ManifestPage = { url: string; status: number; title: string | null; bytes: number };
type CrewEvent = { id: number; kind: string; page_url: string | null; criterion_index: number | null; verdict: Verdict | null; text: string; created_at: string };
type CrewRun = { id: string; status: string; steps: number; pages_read: number; current: boolean; report: { summary: string | null; findings: Array<{ index: number; verdict: Verdict; path: string | null }> } | null };
type Audit = { type: string; detail: string; created_at: string };

const PAID = ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"];
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const kindTag: Record<string, string> = { VISIT: "VISIT", FINDING: "REPORT", THINK: "THINK", NOTE: "ORDER", DONE: "SEALED", ERROR: "ALERT" };
const LEDGER: Record<string, string> = {
  PAYPAL_HOLD_ORDER_CREATED: "PayPal order opened", FUNDS_PENDING: "PayPal reviewing the hold", FUNDS_HELD: "Gold locked by PayPal",
  FUNDS_RELEASED: "Gold released to the guild", FUNDS_RETURNED: "Hold recalled", FUNDS_STATUS_CHANGED: "PayPal sent word", CLIENT_APPROVED: "Decree sealed",
  PAYPAL_ORDER_CREATED: "PayPal order opened", CAPTURE_CONFIRMED: "PayPal confirmed the payment",
};
const PLOTS: Array<[number, number]> = [[1.4, 13.1], [3.6, 13.1], [5.8, 13.1], [10.0, 13.1], [12.2, 13.1], [14.4, 13.1], [2.2, 9.3], [4.6, 9.3], [11.0, 9.3], [13.6, 9.3]];
const CREW_HUES = ["#2f5fbe", "#7a5aa8", "#1f9e62"];
const ISLAND = { x0: 78, x1: 668, y0: 34, y1: 414 };
const NAMES: Record<Landmark, string> = { castle: "THRONE ROOM", treasury: "ROYAL TREASURY", guild: "GUILD HALL" };

async function api(payload: Record<string, unknown>) {
  const res = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json() as Record<string, unknown> & { error?: string };
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/** Where the viewer's next real action lives. */
function questFor(p: Project): Landmark | null {
  const paid = p.funding.status === "CAPTURED" || PAID.includes(p.payment_status);
  if (paid || p.consent.tampered) return null;
  if (p.role === "client") {
    if (p.funding.mode === "HOLD" && p.funding.canFund) return "treasury";
    if (p.status === "SUBMITTED" || p.status === "REVIEW") return "castle";
    if (p.status === "APPROVED") return "treasury";
    return null;
  }
  if (p.status === "INVITED") return "guild";
  if (["AGREED", "REVISION_REQUESTED"].includes(p.status) && (p.funding.mode !== "HOLD" || p.funding.status === "HELD")) return "guild";
  return null;
}

export default function Realm({ id }: { id: string }) {
  const [list, setList] = useState<ListData | null>(null);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [pages, setPages] = useState<ManifestPage[]>([]);
  const [crewReady, setCrewReady] = useState(false);
  const [run, setRun] = useState<CrewRun | null>(null);
  const [events, setEvents] = useState<CrewEvent[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<House | null>(null);
  const [court, setCourt] = useState<Landmark | null>(null);
  const [hover, setHover] = useState<Landmark | null>(null);
  const [atlas, setAtlas] = useState(false);
  const [cam, setCam] = useState({ k: 0, x: 0, y: 0 });
  const [logOpen, setLogOpen] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const cursor = useRef(0);
  const driving = useRef(false);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);

  const loadProject = useCallback(async () => {
    const [all, detail] = await Promise.all([
      fetch("/api/workspace", { cache: "no-store" }).then(r => r.json()) as Promise<ListData>,
      fetch(`/api/workspace?id=${encodeURIComponent(id)}`, { cache: "no-store" }).then(r => r.ok ? r.json() : null) as Promise<{ audit?: Audit[]; evidenceHistory?: Array<{ manifest: { pages: ManifestPage[] } }> } | null>,
    ]);
    if (!all.projects?.some(x => x.id === id)) throw new Error("This agreement isn’t in your workspace");
    setList(all);
    setCrewReady(!!all.crewReady);
    setAudit(detail?.audit ?? []);
    setPages(detail?.evidenceHistory?.[0]?.manifest?.pages ?? []);
  }, [id]);
  const p = list?.projects.find(x => x.id === id) ?? null;

  const loadCrew = useCallback(async () => {
    const res = await fetch(`/api/workspace?id=${encodeURIComponent(id)}&crew=1&after=${cursor.current}`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json() as { run: CrewRun | null; events: CrewEvent[]; crewReady: boolean };
    setRun(body.run);
    setCrewReady(body.crewReady);
    if (body.events.length) { cursor.current = body.events[body.events.length - 1].id; setEvents(prev => [...prev, ...body.events].slice(-120)); }
    return body.run;
  }, [id]);

  useEffect(() => { loadProject().catch(e => setError(e.message)); loadCrew().catch(() => {}); }, [loadProject, loadCrew]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(t); }, [notice]);

  /** Every court action is the real workspace API; the world redraws from the new state. */
  const act = async (payload: Record<string, unknown>, done: string) => {
    setBusy(true); setError(""); setNotice("");
    try { await api({ ...payload, id }); await loadProject(); setNotice(done); }
    catch (e) { setError(e instanceof Error ? e.message : "The court could not do that"); }
    finally { setBusy(false); }
  };
  const onFunded = useCallback(() => { setNotice("The gold is locked in the treasury. PayPal holds it until the decree."); loadProject().catch(() => {}); }, [loadProject]);
  const onPaid = useCallback(() => { setNotice("PayPal confirmed the payment. The galleon sails."); loadProject().catch(() => {}); }, [loadProject]);
  const onPayError = useCallback((m: string) => setError(m), []);

  const drive = useCallback(async (runId: string) => {
    if (driving.current) return;
    driving.current = true;
    try {
      for (let guard = 0; guard < 40; guard++) {
        const step = await api({ action: "crew_step", id, runId }) as { done?: boolean; busy?: boolean; retryAfterMs?: number };
        await loadCrew();
        if (step.done) break;
        await new Promise(r => setTimeout(r, step.retryAfterMs ?? (step.busy ? 1500 : 900)));
      }
    } catch (e) { setError(e instanceof Error ? e.message : "The inspection stopped"); }
    finally { driving.current = false; await loadCrew(); loadProject().catch(() => {}); }
  }, [id, loadCrew, loadProject]);
  useEffect(() => { if (run?.status === "RUNNING") drive(run.id); }, [run?.id, run?.status, drive]);
  useEffect(() => {
    if (!p || !["ORDER_CREATED", "PENDING", "HELD", "VOIDING"].includes(p.funding.status)) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") loadProject().catch(() => {}); }, 15_000);
    return () => window.clearInterval(timer);
  }, [p, loadProject]);
  const dispatch = async () => {
    setError("");
    try { const r = await api({ action: "crew_start", id }) as { runId: string }; cursor.current = 0; setEvents([]); await loadCrew(); drive(r.runId); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not dispatch the inspectors"); }
  };

  /* ── world model from data ── */
  const houses: House[] = useMemo(() => {
    const paths = new Map<string, { title: string | null; status: number; bytes: number }>();
    for (const pg of pages) { try { paths.set(new URL(pg.url).pathname, { title: pg.title, status: pg.status, bytes: pg.bytes }); } catch { /* skip */ } }
    for (const e of events) if (e.kind === "VISIT" && e.page_url && !paths.has(e.page_url)) paths.set(e.page_url, { title: null, status: 200, bytes: 6000 });
    const entries = [...paths.entries()].slice(0, PLOTS.length);
    const max = Math.max(1, ...entries.map(([, v]) => v.bytes));
    return entries.map(([path, v], i) => { const size = Math.sqrt(v.bytes / max); return { path, title: v.title, status: v.status, u: PLOTS[i][0], v: PLOTS[i][1], s: 1.25 + size * .45, floors: 1 + Math.round(size * 2) }; });
  }, [pages, events]);
  const visited = useMemo(() => new Set(events.filter(e => e.kind === "VISIT" && e.page_url).map(e => e.page_url!)), [events]);
  const running = run?.status === "RUNNING";
  const active = running ? [...events].reverse().find(e => e.kind === "VISIT")?.page_url ?? null : null;
  const crewFindings = useMemo(() => {
    const byIndex: Record<number, { verdict: Verdict; path: string | null }> = {};
    if (run?.report) for (const f of run.report.findings) byIndex[f.index] = { verdict: f.verdict, path: f.path };
    for (const e of events) if (e.kind === "FINDING" && e.criterion_index !== null && e.verdict) byIndex[e.criterion_index] = { verdict: e.verdict, path: e.page_url };
    return byIndex;
  }, [run, events]);
  const verdicts = useMemo(() => {
    const rank: Record<Verdict, number> = { FAILED: 0, INCONCLUSIVE: 1, VERIFIED: 2 };
    const out: Record<string, Verdict> = {};
    for (const f of Object.values(crewFindings)) if (f.path && (!out[f.path] || rank[f.verdict] < rank[out[f.path]])) out[f.path] = f.verdict;
    return out;
  }, [crewFindings]);
  const quest = p ? questFor(p) : null;

  /* ── animation state lives outside React so walking is smooth ── */
  const world = useRef<SceneState & { cartTarget: number; crewTargets: Array<{ u: number; v: number }> }>({
    houses: [], verdicts: {}, visited: new Set(), active: null, held: false, approved: false, paid: false,
    cartU: 3.6, cartMoving: false, showCrew: false, chestsSince: 0, sealSince: 0, paidSince: 0, cartTarget: 3.6, crewTargets: [],
    inspectors: CREW_HUES.map((tunic, i) => ({ u: 6.9 + i * .45, v: 12.5, moving: false, flip: false, tunic } as Walker)), quest: null, hover: null,
  });
  useEffect(() => {
    if (!p) return;
    const w = world.current, now = performance.now();
    const held = p.funding.status === "HELD" || p.funding.status === "PENDING";
    const paid = p.funding.status === "CAPTURED" || PAID.includes(p.payment_status);
    const approved = p.status === "APPROVED" || paid;
    if (held && !w.held) w.chestsSince = now;
    if (approved && !w.approved) w.sealSince = now;
    if (paid && !w.paid) w.paidSince = now;
    Object.assign(w, { houses, verdicts, visited, active, held, approved, paid, showCrew: running || visited.size > 0, quest: court ? null : quest, hover });
    w.cartTarget = paid ? 13.4 : held ? 8.9 : 3.6;
    const target = active ? houses.find(h => h.path === active) : null;
    w.crewTargets = w.inspectors.map((_, i) => target
      ? { u: target.u + target.s / 2 + (i - 1) * .32, v: target.v < 12 ? target.v + target.s + .45 + (i % 2) * .12 : target.v - .45 - (i % 2) * .12 }
      : { u: 6.9 + i * .45, v: 12.55 + (i % 2) * .1 });
  }, [p, houses, verdicts, visited, active, running, quest, hover, court]);

  const ready = !!p;
  useEffect(() => {
    const el = canvas.current;
    if (!el || !ready) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let frame = 0, last = performance.now();
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const step = (now: number) => {
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      const w = world.current;
      const dc = w.cartTarget - w.cartU;
      w.cartMoving = Math.abs(dc) > .02;
      w.cartU = still ? w.cartTarget : w.cartU + Math.sign(dc) * Math.min(Math.abs(dc), dt * 2.2);
      w.inspectors.forEach((m, i) => {
        const t = w.crewTargets[i]; if (!t) return;
        if (still) { m.u = t.u; m.v = t.v; m.moving = false; return; }
        const speed = dt * 2.1;
        const onRoad = Math.abs(m.v - 12.5) < .08;
        let gu = t.u, gv = t.v;
        if (Math.abs(m.u - t.u) > .05 && !onRoad) { gu = m.u; gv = 12.5; }
        else if (Math.abs(m.u - t.u) > .05) { gv = 12.5; }
        const du = gu - m.u, dv = gv - m.v, dist = Math.hypot(du, dv);
        m.moving = dist > .03;
        if (m.moving) { const k = Math.min(1, speed / dist); m.u += du * k; m.v += dv * k; m.flip = du - dv < 0; }
      });
      ctx.imageSmoothingEnabled = false;
      drawScene(ctx, w, now);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  /* ── camera ── */
  const fitView = useCallback((logOpen: boolean) => {
    const el = stage.current; if (!el) return;
    const vw = el.clientWidth, vh = el.clientHeight, wide = vw > 900;
    const left = wide ? 24 : 6, right = wide ? (logOpen ? 330 : 24) : 6, top = wide ? 130 : 230, bottom = wide ? 96 : 130;
    const freeW = vw - left - right, freeH = vh - top - bottom;
    const k = Math.min(4, Math.max(wide ? 1 : .6, Math.floor(Math.min(freeW / (ISLAND.x1 - ISLAND.x0), freeH / (ISLAND.y1 - ISLAND.y0)) * 10) / 10));
    const cx = (ISLAND.x0 + ISLAND.x1) / 2, cy = (ISLAND.y0 + ISLAND.y1) / 2;
    const fx = left + freeW / 2 - vw / 2, fy = top + freeH / 2 - vh / 2;
    setCam({ k, x: fx - (cx - NATIVE_W / 2) * k, y: fy - (cy - NATIVE_H / 2) * k });
  }, []);
  useEffect(() => { if (typeof window !== "undefined" && window.innerWidth <= 900) setLogOpen(false); }, []);
  useEffect(() => {
    if (!ready) return;
    fitView(logOpen);
    const onResize = () => fitView(logOpen);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [ready, logOpen, fitView]);
  const zoomAt = (px: number, py: number, dir: 1 | -1) => setCam(c => {
    const k = Math.min(5, Math.max(.6, Math.round((c.k + dir * .4) * 10) / 10));
    const nx = (px - c.x) / c.k, ny = (py - c.y) / c.k;
    return { k, x: px - nx * k, y: py - ny * k };
  });
  const onWheel = (e: React.WheelEvent) => { const r = stage.current!.getBoundingClientRect(); zoomAt(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2, e.deltaY < 0 ? 1 : -1); };
  const toNative = (cx: number, cy: number) => { const r = canvas.current!.getBoundingClientRect(); return { x: (cx - r.left) / r.width * NATIVE_W, y: (cy - r.top) / r.height * NATIVE_H }; };
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) { if (canvas.current && e.pointerType === "mouse") { const n = toNative(e.clientX, e.clientY); const l = landmarkAt(n.x, n.y); if (l !== hover) setHover(l); } return; }
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 5) d.moved = true;
    if (d.moved) setCam(c => ({ ...c, x: d.cx + e.clientX - d.x, y: d.cy + e.clientY - d.y }));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (!d || d.moved || !canvas.current) return;
    const n = toNative(e.clientX, e.clientY);
    const hit = [...houses].reverse().find(h => { const b = houseBounds(h); return n.x >= b.x0 && n.x <= b.x1 && n.y >= b.y0 && n.y <= b.y1; });
    if (hit) { setPicked(hit); setCourt(null); return; }
    const l = landmarkAt(n.x, n.y);
    setCourt(l); setPicked(null);
  };

  if (error && !p) return <main className="realm realm-empty"><p>{error}</p><a href="/app">Back to workspace</a></main>;
  if (!p || !list) return <main className="realm realm-empty"><div className="realm-spinner" /><p>RAISING THE KINGDOM…</p></main>;

  const held = p.funding.status === "HELD" || p.funding.status === "PENDING";
  const paid = p.funding.status === "CAPTURED" || PAID.includes(p.payment_status);
  const treasuryState = paid ? "PAID TO THE GUILD" : held ? "HELD BY PAYPAL" : p.funding.mode === "HOLD" ? "AWAITING GOLD" : "PAID AFTER APPROVAL";
  const days = held && p.funding.expiresAt ? Math.max(0, Math.ceil((new Date(p.funding.expiresAt).getTime() - Date.now()) / 86_400_000)) : null;
  const canDispatch = p.role === "client" && !!p.evidence_url && ["SUBMITTED", "REVIEW", "APPROVED", "REVISION_REQUESTED"].includes(p.status);
  const k = cam.k || 1;
  const toScreen = (x: number, y: number) => ({ left: x * k, top: y * k });
  const chip = (l: Landmark, label: string) => { const b = landmarkBounds(l); return <button key={l} className={`realm-chip land ${quest === l ? "quest" : ""} ${l === "treasury" ? "gold" : ""}`} style={toScreen(b.cx, b.y1 + 4)} onClick={() => { setCourt(l); setPicked(null); }}>{label}</button>; };
  const others = list.projects.filter(x => x.id !== id);

  return <main className="realm">
    <div className={`realm-stage ${hover ? "pointing" : ""}`} ref={stage} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { drag.current = null; setHover(null); }}>
      <div className="realm-cam" style={{ width: NATIVE_W * k, height: NATIVE_H * k, transform: `translate(calc(-50% + ${cam.x}px), calc(-50% + ${cam.y}px))` }}>
        <canvas ref={canvas} width={NATIVE_W} height={NATIVE_H} style={{ width: NATIVE_W * k, height: NATIVE_H * k }} aria-label={`${p.title}: ${treasuryState.toLowerCase()}`} />
        <div className={`realm-labels ${k < 1 ? "small" : ""}`}>
          {houses.map(h => { const b = houseBounds(h); const s = toScreen(b.label.x, b.label.y); return <span key={h.path} aria-hidden="true" className={`realm-chip ${active === h.path ? "on" : ""}`} style={s}>{h.path.length > 16 ? `${h.path.slice(0, 15)}…` : h.path}</span>; })}
          {chip("castle", p.role === "client" ? "YOUR CASTLE" : "CLIENT’S CASTLE")}
          {chip("treasury", `TREASURY${days !== null ? ` · ${days}D` : ""}`)}
          {chip("guild", p.role === "freelancer" ? "YOUR GUILD" : "GUILD HALL")}
          <span aria-hidden="true" className="realm-chip" style={toScreen(project(19.6, 16.2).x, project(19.6, 16.2).y + 8)}>HARBOUR</span>
        </div>
      </div>
    </div>

    <header className="hud hud-title">
      <div className="hud-bar"><span>THE REALM</span><i /><em className="hud-live">LIVE</em></div>
      <button className="hud-kingdom" onClick={() => setAtlas(!atlas)} aria-expanded={atlas}><h1>{p.title}</h1><b>{others.length ? (atlas ? "▴" : "▾") : ""}</b></button>
      {atlas && others.length > 0 && <ul className="hud-atlas">{others.map(o => { const q = questFor(o); return <li key={o.id}><a href={`/app/realm?id=${encodeURIComponent(o.id)}`}><span>{o.title}</span><small>{money(o.amount_cents)}</small>{q && <em>!</em>}</a></li>; })}</ul>}
      <p><b className="c">{p.client_email}</b><span>×</span><b className="f">{p.freelancer_email}</b></p>
      <a href={`/app?project=${encodeURIComponent(p.id)}`} className="hud-link">◂ WORKSPACE</a>
    </header>

    <button className={`hud hud-treasury ${quest === "treasury" ? "quest" : ""}`} aria-label="Open the treasury" onClick={() => { setCourt("treasury"); setPicked(null); }}>
      <div className="hud-bar"><span>TREASURY</span><i /><img src="/paypal-logo.webp" alt="PayPal" className="hud-pp" /></div>
      <strong>{money(p.amount_cents)}</strong>
      <span className={`hud-state ${paid ? "paid" : held ? "held" : ""}`}>{treasuryState}</span>
      {days !== null && <div className="hud-meter" aria-label={`${days} of 29 days left on the hold`}>{Array.from({ length: 29 }, (_, i) => <i key={i} className={i < days ? "on" : ""} />)}</div>}
    </button>

    {quest && !court && <button className="hud hud-quest" onClick={() => setCourt(quest)}><b>!</b><span>{questLine(p)}</span><em>GO ▸</em></button>}

    <div className="hud hud-zoom" role="group" aria-label="Zoom">
      <button onClick={() => zoomAt(0, 0, 1)} aria-label="Zoom in">+</button>
      <button onClick={() => zoomAt(0, 0, -1)} aria-label="Zoom out">−</button>
      <button onClick={() => fitView(logOpen)} aria-label="Fit the kingdom">FIT</button>
    </div>

    <aside className={`hud hud-log ${logOpen ? "" : "closed"}`} aria-label="Inspector's log">
      <div className="hud-bar"><span>INSPECTORS</span><i />{running ? <em className="hud-live">ON PATROL</em> : <em>{run?.status === "DONE" ? "SEALED" : "IDLE"}</em>}<button onClick={() => setLogOpen(!logOpen)} aria-expanded={logOpen} aria-label={logOpen ? "Hide the log" : "Show the log"}>{logOpen ? "HIDE" : "SHOW"}</button></div>
      <div className="hud-stats"><div><small>PAGES</small><b>{run?.pages_read ?? 0}<span>/8</span></b></div><div><small>STEPS</small><b>{run?.steps ?? 0}<span>/12</span></b></div><div><small>FOUND</small><b>{Object.keys(crewFindings).length}<span>/{p.criteria.length}</span></b></div></div>
      <ol className="hud-events">
        {events.length === 0 && <li className="hud-ev muted">{canDispatch ? "Quiet roads. Dispatch the inspectors to read the delivered site." : p.evidence_url ? "The client can dispatch the inspectors." : "The inspectors await the delivery."}</li>}
        {[...events].reverse().map(e => <li key={e.id} className={`hud-ev k-${e.kind.toLowerCase()} ${e.verdict ? `v-${e.verdict.toLowerCase()}` : ""}`}><em>{kindTag[e.kind] ?? e.kind}</em><span>{e.text}</span></li>)}
      </ol>
      {canDispatch && <button className="hud-stamp" disabled={running || !crewReady} onClick={dispatch}>{running ? "ON PATROL…" : run?.status === "DONE" ? "SEND NEW PATROL" : "DISPATCH INSPECTORS"}</button>}
      {canDispatch && !crewReady && <p className="hud-note">The crew needs a Groq key on the server.</p>}
      <p className="hud-note">The crew only reads. Only the client’s seal releases the gold.</p>
    </aside>

    <nav className="hud hud-banners" aria-label="Requirements" style={logOpen ? undefined : { right: 18 }}>
      {p.criteria.map((c, i) => { const v = crewFindings[i]?.verdict ?? p.findings?.[i]?.status ?? null; return <div key={i} className={`hud-banner ${v ? `v-${v.toLowerCase()}` : ""}`} title={c.label}><b>{v === "VERIFIED" ? "✓" : v === "FAILED" ? "✕" : i + 1}</b><span>{c.label}</span></div>; })}
    </nav>

    {picked && <div className="hud hud-inspect" role="dialog" aria-label="Building">
      <div className="hud-bar"><span>DELIVERED PAGE</span><i /><button onClick={() => setPicked(null)} aria-label="Close">✕</button></div>
      <strong>{picked.path}</strong>
      <span>{picked.title ?? "No title"} · HTTP {picked.status}</span>
      <span>{visited.has(picked.path) ? "Inspected" : "Not inspected yet"}{verdicts[picked.path] ? ` · ${verdicts[picked.path].toLowerCase()}` : ""}</span>
    </div>}

    {court && <Court place={court} p={p} list={list} audit={audit} busy={busy} act={act} dispatch={canDispatch && crewReady && !running ? dispatch : null}
      onFunded={onFunded} onPaid={onPaid} onPayError={onPayError} close={() => setCourt(null)} />}

    {(notice || error) && <div className={`hud hud-toast ${error ? "err" : ""}`} role="status"><span>{error || notice}</span><button onClick={() => { setError(""); setNotice(""); }} aria-label="Dismiss">✕</button></div>}
    <p className="realm-hint">DRAG · SCROLL TO ZOOM · CLICK A BUILDING</p>
  </main>;
}

function questLine(p: Project): string {
  const amt = money(p.amount_cents);
  if (p.role === "client") {
    if (p.funding.canFund) return `Lock ${amt} in the treasury`;
    if (p.status === "SUBMITTED") return "The work has arrived. Inspect it";
    if (p.status === "REVIEW") return "Seal your decree";
    if (p.status === "APPROVED") return `Release ${amt} to the guild`;
  }
  if (p.status === "INVITED") return "Swear to the terms";
  return p.status === "REVISION_REQUESTED" ? "Deliver the revision" : "Deliver your work";
}

/** The dialog for a landmark: what it means, its state, and the real actions available to the viewer. */
function Court({ place, p, list, audit, busy, act, dispatch, onFunded, onPaid, onPayError, close }: {
  place: Landmark; p: Project; list: ListData; audit: Audit[]; busy: boolean;
  act: (payload: Record<string, unknown>, done: string) => Promise<void>; dispatch: (() => void) | null;
  onFunded: () => void; onPaid: () => void; onPayError: (m: string) => void; close: () => void;
}) {
  const [reason, setReason] = useState(""), [override, setOverride] = useState(false), [url, setUrl] = useState(""), [notes, setNotes] = useState("");
  const client = p.role === "client", amt = money(p.amount_cents);
  const paid = p.funding.status === "CAPTURED" || PAID.includes(p.payment_status);
  const held = p.funding.status === "HELD" || p.funding.status === "PENDING";
  const sellerMissing = list.paymentMode === "SELLER" && !p.seller_merchant_id;
  const merchant = list.paymentMode === "SELLER" ? p.seller_merchant_id || undefined : undefined;
  let lore = "", body: React.ReactNode = null;

  if (place === "treasury") {
    lore = paid ? `${amt} left the treasury on the guild’s galleon. PayPal confirmed it.` : held ? `PayPal is holding ${amt}. It leaves only when the client seals the decree.` : p.funding.mode === "HOLD" ? `Empty. The client locks ${amt} here with PayPal before any work begins.` : `This kingdom pays through PayPal after the decree.`;
    const ledger = [...audit].reverse().filter(e => LEDGER[e.type]);
    body = <>
      <div className="court-gold"><strong>{amt}</strong><span className={paid ? "paid" : held ? "held" : ""}>{paid ? "PAID" : held ? (p.funding.status === "PENDING" ? "PAYPAL REVIEWING" : "HELD BY PAYPAL") : "NOT SECURED"}</span></div>
      {client && p.funding.mode === "HOLD" && p.funding.canFund && !sellerMissing && (list.paypalReady && list.paypalClientId
        ? <div className="court-pp"><PayPalCheckout project={p} clientId={list.paypalClientId} merchantId={merchant} bnCode={list.paypalPartnerBnCode} mode="hold" onPaid={onFunded} onError={onPayError} /></div>
        : <p className="court-note">PayPal keys aren’t set on this site.</p>)}
      {client && p.funding.canRelease && <button className="court-btn gold" disabled={busy} onClick={() => act({ action: "release_funds" }, `${amt} released through PayPal. The galleon sails.`)}>RELEASE {amt} TO THE GUILD</button>}
      {client && p.status === "APPROVED" && p.funding.mode !== "HOLD" && !paid && list.paypalReady && list.paypalClientId && !sellerMissing &&
        <div className="court-pp"><PayPalCheckout project={p} clientId={list.paypalClientId} merchantId={merchant} bnCode={list.paypalPartnerBnCode} onPaid={onPaid} onError={onPayError} /></div>}
      {p.funding.canVoid.allowed && <button className="court-btn ghost" disabled={busy} onClick={() => { if (window.confirm(client ? "Recall the gold? PayPal will cancel the hold." : "Decline the quest and release the client’s gold? This can’t be undone.")) act({ action: "void_hold" }, client ? "The hold was recalled." : "You released the client’s gold."); }}>{client ? "RECALL THE GOLD" : "DECLINE THE QUEST"}</button>}
      {p.funding.status !== "NONE" && p.funding.status !== "ORDER_CREATED" && !paid && <button className="court-btn ghost" disabled={busy} onClick={() => act({ action: "sync_payment" }, "A rider returned from PayPal with the latest word.")}>SEND A RIDER TO PAYPAL</button>}
      {ledger.length > 0 && <ol className="court-ledger" aria-label="PayPal ledger">{ledger.slice(0, 6).map((e, i) => <li key={i}><span>{LEDGER[e.type]}</span><time>{new Date(e.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</time></li>)}</ol>}
      {(p.paypal_order_id || p.paypal_capture_id) && <p className="court-ids">{p.paypal_order_id && <>ORDER {p.paypal_order_id}</>}{p.paypal_capture_id && <> · CAPTURE {p.paypal_capture_id}</>}</p>}
    </>;
  } else if (place === "castle") {
    lore = client ? "Your throne room. Here you inspect the delivery and seal the decree that frees the gold." : "The client’s castle. The decree that frees your gold is sealed here.";
    const gate = p.gate, mode = gate?.mode ?? "CONFIRM", min = gate?.minimumReason ?? 5;
    if (client && p.status === "SUBMITTED") body = <>
      <button className="court-btn gold" disabled={busy} onClick={() => act({ action: "verify" }, "The royal checks are done. Read the findings.")}>{busy ? "CHECKING…" : "RUN THE ROYAL CHECKS"}</button>
      {dispatch && <button className="court-btn ghost" onClick={() => { dispatch(); close(); }}>DISPATCH THE INSPECTORS</button>}
    </>;
    else if (client && p.status === "REVIEW") body = <>
      {gate && <div className={`court-gate g-${mode.toLowerCase()}`}><b>{gate.verified}/{gate.total}</b><span>{mode === "CLEAR" ? "Every requirement passed" : mode === "CONFIRM" ? "Some need your own eyes" : `${gate.blocking.length} required failed`}</span></div>}
      <textarea className="court-input" rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder={mode === "CLEAR" ? "A word for the record (optional)" : mode === "OVERRIDE" ? "Why seal it anyway?" : "How did you check the open items?"} aria-label="Decree note" />
      {mode === "OVERRIDE" && <label className="court-check"><input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} /> Override the failed requirements (written on the receipt)</label>}
      <button className="court-btn gold" disabled={busy || (mode === "OVERRIDE" && !override) || (mode !== "CLEAR" && reason.trim().length < min)} onClick={() => act({ action: "approve", reason, override: mode === "OVERRIDE" && override }, "The decree is sealed. Now release the gold.")}>SEAL THE DECREE</button>
      <button className="court-btn ghost" disabled={busy || p.revisions.exhausted || reason.trim().length < 5} onClick={() => act({ action: "revise", reason }, "A revision was ordered.")}>{p.revisions.exhausted ? "NO REVISIONS LEFT" : `ORDER A REVISION${p.revisions.remaining !== null ? ` · ${p.revisions.remaining} LEFT` : ""}`}</button>
    </>;
    else body = <p className="court-note">{paid ? "The decree was sealed and the gold has sailed." : p.status === "APPROVED" ? "The decree is sealed." : p.status === "INVITED" ? "Waiting for the guild to swear to the terms." : "Waiting for the guild’s delivery."}</p>;
  } else {
    lore = client ? "The freelancer’s guild hall, where the work is made." : "Your guild hall. Swear to the terms, then deliver your work here.";
    if (!client && p.status === "INVITED") body = <>
      {!p.consent.legacy && <p className="court-seal">SEAL <code>{p.consent.fingerprint}</code></p>}
      <button className="court-btn gold" disabled={busy || p.consent.tampered} onClick={() => act({ action: "accept", termsHash: p.consent.termsHash }, "You swore to the terms. Both seals match.")}>SWEAR TO THESE TERMS</button>
    </>;
    else if (!client && ["AGREED", "REVISION_REQUESTED"].includes(p.status) && (p.funding.mode !== "HOLD" || p.funding.status === "HELD")) body =
      <form className="court-form" onSubmit={e => { e.preventDefault(); act({ action: "submit", url, notes }, "Delivered. The client’s inspectors can ride."); }}>
        {p.status === "REVISION_REQUESTED" && p.decision_reason && <p className="court-note">“{p.decision_reason}”</p>}
        <input className="court-input" type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://your-site.com" aria-label="Live link" />
        <textarea className="court-input" rows={2} required value={notes} onChange={e => setNotes(e.target.value)} placeholder="What you built, how to test it" aria-label="Notes" />
        <button className="court-btn gold" disabled={busy}>DELIVER THE WORK</button>
      </form>;
    else body = <p className="court-note">{!client && p.funding.mode === "HOLD" && p.funding.status !== "HELD" && p.status === "AGREED" ? "Wait until the client’s gold is locked in the treasury, then deliver." : p.evidence_url ? "The work has been delivered." : "The guild is at work."}</p>;
  }

  return <section className="hud hud-court" role="dialog" aria-label={NAMES[place]}>
    <div className="hud-bar"><span>{NAMES[place]}</span><i /><button onClick={close} aria-label="Close">✕</button></div>
    <p className="court-lore">{lore}</p>
    {body}
  </section>;
}

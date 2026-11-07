"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NATIVE_H, NATIVE_W, project } from "./engine";
import { drawScene, houseBounds, type House, type SceneState, type Verdict, type Walker } from "./scene";

/* The Realm: one agreement as a small kingdom. Every element is driven by real data:
 * castle = client, treasury = the PayPal hold, guild hall = freelancer, town = the delivered
 * pages, inspectors = the Groq crew walking to the page it is reading, cart = where the money is. */

type Criterion = { label: string; kind: string; needle?: string; required?: boolean };
type Project = {
  id: string; role: "client" | "freelancer"; title: string; client_email: string; freelancer_email: string;
  amount_cents: number; status: string; payment_status: string; evidence_url: string | null;
  criteria: Criterion[]; findings: Array<{ status: Verdict }> | null;
  funding: { mode: string; status: string; expiresAt: string | null };
};
type ManifestPage = { url: string; status: number; title: string | null; bytes: number };
type CrewEvent = { id: number; kind: string; page_url: string | null; criterion_index: number | null; verdict: Verdict | null; text: string; created_at: string };
type CrewRun = { id: string; status: string; steps: number; pages_read: number; current: boolean; report: { summary: string | null; findings: Array<{ index: number; verdict: Verdict; path: string | null }> } | null };

const PAID = ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"];
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const kindTag: Record<string, string> = { VISIT: "VISIT", FINDING: "REPORT", THINK: "THINK", NOTE: "ORDER", DONE: "SEALED", ERROR: "ALERT" };
/** Building plots on the island: south of the town road, then north of it. */
const PLOTS: Array<[number, number]> = [[1.4, 13.1], [3.6, 13.1], [5.8, 13.1], [10.0, 13.1], [12.2, 13.1], [14.4, 13.1], [2.2, 9.3], [4.6, 9.3], [11.0, 9.3], [13.6, 9.3]];
const CREW_HUES = ["#2f5fbe", "#7a5aa8", "#1f9e62"];
/** Native-pixel bounds of the island and its harbour: what the camera frames. */
const ISLAND = { x0: 78, x1: 668, y0: 34, y1: 414 };

async function api(payload: Record<string, unknown>) {
  const res = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json() as Record<string, unknown> & { error?: string };
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function Realm({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [pages, setPages] = useState<ManifestPage[]>([]);
  const [crewReady, setCrewReady] = useState(false);
  const [run, setRun] = useState<CrewRun | null>(null);
  const [events, setEvents] = useState<CrewEvent[]>([]);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<House | null>(null);
  const [cam, setCam] = useState({ k: 0, x: 0, y: 0 });
  const [logOpen, setLogOpen] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const cursor = useRef(0);
  const driving = useRef(false);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);

  const loadProject = useCallback(async () => {
    const [list, detail] = await Promise.all([
      fetch("/api/workspace", { cache: "no-store" }).then(r => r.json()) as Promise<{ projects: Project[]; crewReady?: boolean }>,
      fetch(`/api/workspace?id=${encodeURIComponent(id)}`, { cache: "no-store" }).then(r => r.ok ? r.json() : null) as Promise<{ evidenceHistory?: Array<{ manifest: { pages: ManifestPage[] } }> } | null>,
    ]);
    const p = list.projects?.find(x => x.id === id) ?? null;
    if (!p) throw new Error("This agreement isn’t in your workspace");
    setProject(p);
    setCrewReady(!!list.crewReady);
    setPages(detail?.evidenceHistory?.[0]?.manifest?.pages ?? []);
  }, [id]);

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

  /** Advances the crew one step at a time so the world can react to each move. */
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
    if (!project || !["ORDER_CREATED", "PENDING", "HELD"].includes(project.funding.status)) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") loadProject().catch(() => {}); }, 15_000);
    return () => window.clearInterval(timer);
  }, [project, loadProject]);

  const dispatch = async () => {
    setError("");
    try { const r = await api({ action: "crew_start", id }) as { runId: string }; cursor.current = 0; setEvents([]); await loadCrew(); drive(r.runId); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not dispatch the inspectors"); }
  };

  /* ── world model from data ── */
  const houses: House[] = useMemo(() => {
    const paths = new Map<string, { title: string | null; status: number; bytes: number }>();
    for (const p of pages) { try { paths.set(new URL(p.url).pathname, { title: p.title, status: p.status, bytes: p.bytes }); } catch { /* skip */ } }
    for (const e of events) if (e.kind === "VISIT" && e.page_url && !paths.has(e.page_url)) paths.set(e.page_url, { title: null, status: 200, bytes: 6000 });
    const list = [...paths.entries()].slice(0, PLOTS.length);
    const max = Math.max(1, ...list.map(([, v]) => v.bytes));
    return list.map(([path, v], i) => { const size = Math.sqrt(v.bytes / max); return { path, title: v.title, status: v.status, u: PLOTS[i][0], v: PLOTS[i][1], s: 1.25 + size * .45, floors: 1 + Math.round(size * 2) }; });
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

  /* ── animation state lives outside React so walking is smooth ── */
  const world = useRef<SceneState & { cartTarget: number; crewTargets: Array<{ u: number; v: number }> }>({
    houses: [], verdicts: {}, visited: new Set(), active: null, held: false, approved: false, paid: false,
    cartU: 3.6, cartMoving: false, showCrew: false, chestsSince: 0, sealSince: 0, paidSince: 0, cartTarget: 3.6, crewTargets: [],
    inspectors: CREW_HUES.map((tunic, i) => ({ u: 6.9 + i * .45, v: 12.5, moving: false, flip: false, tunic } as Walker)),
  });
  useEffect(() => {
    if (!project) return;
    const w = world.current, now = performance.now();
    const held = project.funding.status === "HELD" || project.funding.status === "PENDING";
    const paid = project.funding.status === "CAPTURED" || PAID.includes(project.payment_status);
    const approved = project.status === "APPROVED" || paid;
    if (held && !w.held) w.chestsSince = now;
    if (approved && !w.approved) w.sealSince = now;
    if (paid && !w.paid) w.paidSince = now;
    Object.assign(w, { houses, verdicts, visited, active, held, approved, paid, showCrew: running || visited.size > 0 });
    w.cartTarget = paid ? 13.4 : held ? 8.9 : 3.6;
    const target = active ? houses.find(h => h.path === active) : null;
    w.crewTargets = w.inspectors.map((_, i) => target
      ? { u: target.u + target.s / 2 + (i - 1) * .32, v: target.v < 12 ? target.v + target.s + .45 + (i % 2) * .12 : target.v - .45 - (i % 2) * .12 }
      : { u: 6.9 + i * .45, v: 12.55 + (i % 2) * .1 });
  }, [project, houses, verdicts, visited, active, running]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !project) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let frame = 0, last = performance.now();
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const step = (now: number) => {
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      const w = world.current;
      // cart rolls along the king's road
      const dc = w.cartTarget - w.cartU;
      w.cartMoving = Math.abs(dc) > .02;
      w.cartU = still ? w.cartTarget : w.cartU + Math.sign(dc) * Math.min(Math.abs(dc), dt * 2.2);
      // inspectors walk the town road first, then step off toward the house
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
  }, [project]);

  /* ── camera: frame the island itself (not the empty sea) in the space the panels leave ── */
  const fitView = useCallback((logOpen: boolean) => {
    const el = stage.current; if (!el) return;
    const vw = el.clientWidth, vh = el.clientHeight, wide = vw > 900;
    const left = wide ? 24 : 12, right = wide ? (logOpen ? 330 : 24) : 12, top = wide ? 120 : 150, bottom = wide ? 90 : (logOpen ? 40 * vh / 100 + 90 : 90);
    const freeW = vw - left - right, freeH = vh - top - bottom;
    const k = Math.min(4, Math.max(1, Math.floor(Math.min(freeW / (ISLAND.x1 - ISLAND.x0), freeH / (ISLAND.y1 - ISLAND.y0)) * 10) / 10));
    const cx = (ISLAND.x0 + ISLAND.x1) / 2, cy = (ISLAND.y0 + ISLAND.y1) / 2;
    const fx = left + freeW / 2 - vw / 2, fy = top + freeH / 2 - vh / 2;
    setCam({ k, x: fx - (cx - NATIVE_W / 2) * k, y: fy - (cy - NATIVE_H / 2) * k });
  }, []);
  useEffect(() => {
    if (!project) return;
    fitView(logOpen);
    const onResize = () => fitView(logOpen);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [project, logOpen, fitView]);
  /** Zooms around a screen point (relative to the stage centre) so the building under it stays put. */
  const zoomAt = (px: number, py: number, dir: 1 | -1) => setCam(c => {
    const k = Math.min(5, Math.max(1, Math.round((c.k + dir * .4) * 10) / 10));
    const nx = (px - c.x) / c.k, ny = (py - c.y) / c.k;
    return { k, x: px - nx * k, y: py - ny * k };
  });
  const onWheel = (e: React.WheelEvent) => {
    const r = stage.current!.getBoundingClientRect();
    zoomAt(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2, e.deltaY < 0 ? 1 : -1);
  };
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
    setCam(c => ({ ...c, x: d.cx + e.clientX - d.x, y: d.cy + e.clientY - d.y }));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (!d || d.moved || !canvas.current) return;
    const r = canvas.current.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width * NATIVE_W, ny = (e.clientY - r.top) / r.height * NATIVE_H;
    const hit = [...houses].reverse().find(h => { const b = houseBounds(h); return nx >= b.x0 && nx <= b.x1 && ny >= b.y0 && ny <= b.y1; });
    setPicked(hit ?? null);
  };

  if (error && !project) return <main className="realm realm-empty"><p>{error}</p><a href="/app">Back to workspace</a></main>;
  if (!project) return <main className="realm realm-empty"><div className="realm-spinner" /><p>RAISING THE KINGDOM…</p></main>;

  const held = project.funding.status === "HELD" || project.funding.status === "PENDING";
  const paid = project.funding.status === "CAPTURED" || PAID.includes(project.payment_status);
  const treasuryState = paid ? "PAID TO THE GUILD" : held ? "HELD IN THE TREASURY" : project.funding.mode === "HOLD" ? "AWAITING GOLD" : "PAID AFTER APPROVAL";
  const days = held && project.funding.expiresAt ? Math.max(0, Math.ceil((new Date(project.funding.expiresAt).getTime() - Date.now()) / 86_400_000)) : null;
  const canDispatch = project.role === "client" && !!project.evidence_url && ["SUBMITTED", "REVIEW", "APPROVED", "REVISION_REQUESTED"].includes(project.status);
  const k = cam.k || 1;
  const toScreen = (x: number, y: number) => ({ left: x * k, top: y * k });
  const tl = projectTreasuryLabel(), tre = toScreen(tl.x, tl.y);

  return <main className="realm">
    <div className="realm-stage" ref={stage} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { drag.current = null; }}>
      <div className="realm-cam" style={{ width: NATIVE_W * k, height: NATIVE_H * k, transform: `translate(calc(-50% + ${cam.x}px), calc(-50% + ${cam.y}px))` }}>
        <canvas ref={canvas} width={NATIVE_W} height={NATIVE_H} style={{ width: NATIVE_W * k, height: NATIVE_H * k }} aria-label={`${project.title}: ${treasuryState.toLowerCase()}`} />
        <div className="realm-labels" aria-hidden="true">
          {houses.map(h => { const b = houseBounds(h); const s = toScreen(b.label.x, b.label.y); return <span key={h.path} className={`realm-chip ${active === h.path ? "on" : ""}`} style={s}>{h.path.length > 16 ? `${h.path.slice(0, 15)}…` : h.path}</span>; })}
          <span className="realm-chip gold" style={tre}>TREASURY{days !== null ? ` · ${days}D HELD` : ""}</span>
          <span className="realm-chip" style={toScreen(project3(3.5, 8.4).x, project3(3.5, 8.4).y)}>CLIENT</span>
          <span className="realm-chip" style={toScreen(project3(13.6, 8.4).x, project3(13.6, 8.4).y)}>FREELANCER</span>
          <span className="realm-chip" style={toScreen(project3(19.6, 16.2).x, project3(19.6, 16.2).y + 8)}>HARBOUR</span>
        </div>
      </div>
    </div>

    <header className="hud hud-title">
      <div className="hud-bar"><span>THE REALM</span><i /><em className="hud-live">LIVE</em></div>
      <h1>{project.title}</h1>
      <p><b className="c">{project.client_email}</b><span>×</span><b className="f">{project.freelancer_email}</b></p>
      <a href={`/app?project=${encodeURIComponent(project.id)}`} className="hud-link">◂ BACK TO WORKSPACE</a>
    </header>

    <section className="hud hud-treasury" aria-label="Treasury">
      <div className="hud-bar"><span>ROYAL TREASURY</span><i /><em>PAYPAL</em></div>
      <strong>{money(project.amount_cents)}</strong>
      <span className={`hud-state ${paid ? "paid" : held ? "held" : ""}`}>{treasuryState}</span>
      {days !== null && <div className="hud-meter" aria-label={`${days} of 29 days left on the hold`}>{Array.from({ length: 29 }, (_, i) => <i key={i} className={i < days ? "on" : ""} />)}</div>}
    </section>

    <div className="hud hud-zoom" role="group" aria-label="Zoom">
      <button onClick={() => zoomAt(0, 0, 1)} aria-label="Zoom in">+</button>
      <button onClick={() => zoomAt(0, 0, -1)} aria-label="Zoom out">−</button>
      <button onClick={() => fitView(logOpen)} aria-label="Fit the kingdom">FIT</button>
    </div>

    <aside className={`hud hud-log ${logOpen ? "" : "closed"}`} aria-label="Inspector's log">
      <div className="hud-bar"><span>INSPECTOR’S LOG</span><i />{running ? <em className="hud-live">ON PATROL</em> : <em>{run?.status === "DONE" ? "SEALED" : "IDLE"}</em>}<button onClick={() => setLogOpen(!logOpen)} aria-expanded={logOpen} aria-label={logOpen ? "Hide the log" : "Show the log"}>{logOpen ? "HIDE" : "SHOW"}</button></div>
      <div className="hud-stats"><div><small>PAGES READ</small><b>{run?.pages_read ?? 0}<span>/8</span></b></div><div><small>STEP</small><b>{run?.steps ?? 0}<span>/12</span></b></div><div><small>FINDINGS</small><b>{Object.keys(crewFindings).length}<span>/{project.criteria.length}</span></b></div></div>
      <ol className="hud-events">
        {events.length === 0 && <li className="hud-ev muted">{canDispatch ? "The radio is quiet. Dispatch the inspectors to read the delivered site." : project.evidence_url ? "The client can dispatch the inspectors." : "The inspectors await the freelancer’s delivery."}</li>}
        {[...events].reverse().map(e => <li key={e.id} className={`hud-ev k-${e.kind.toLowerCase()} ${e.verdict ? `v-${e.verdict.toLowerCase()}` : ""}`}><em>{kindTag[e.kind] ?? e.kind}</em><span>{e.text}</span></li>)}
      </ol>
      {canDispatch && <button className="hud-stamp" disabled={running || !crewReady} onClick={dispatch}>{running ? "ON PATROL…" : run?.status === "DONE" ? "SEND NEW PATROL" : "DISPATCH INSPECTORS"}</button>}
      {canDispatch && !crewReady && <p className="hud-note">Add a Groq API key on the server to enable the crew.</p>}
      {error && <p className="hud-note err">{error}</p>}
      <p className="hud-note">The crew only reads pages. Its report is advice — only the client’s seal releases the gold.</p>
    </aside>

    <nav className="hud hud-banners" aria-label="Requirements" style={logOpen ? undefined : { right: 18 }}>
      {project.criteria.map((c, i) => { const v = crewFindings[i]?.verdict ?? project.findings?.[i]?.status ?? null; return <div key={i} className={`hud-banner ${v ? `v-${v.toLowerCase()}` : ""}`} title={c.label}><b>{i + 1}</b><span>{c.label}</span></div>; })}
    </nav>

    {picked && <div className="hud hud-inspect" role="dialog" aria-label="Building">
      <div className="hud-bar"><span>DELIVERED PAGE</span><i /><button onClick={() => setPicked(null)} aria-label="Close">✕</button></div>
      <strong>{picked.path}</strong>
      <span>{picked.title ?? "No title"} · HTTP {picked.status}</span>
      <span>{visited.has(picked.path) ? "Inspected by the crew" : "Not inspected yet"}{verdicts[picked.path] ? ` · ${verdicts[picked.path].toLowerCase()}` : ""}</span>
    </div>}
    <p className="realm-hint">DRAG TO PAN · SCROLL TO ZOOM · CLICK A HOUSE</p>
  </main>;
}

function project3(u: number, v: number) { return project(u, v); }
function projectTreasuryLabel() { return project(8.8, 6.35, 122); }

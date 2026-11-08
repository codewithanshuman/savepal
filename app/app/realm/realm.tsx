"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PayPalCheckout from "../../paypal-checkout";
import { setSfxEnabled, sfx, sfxEnabled } from "./sfx";
import { UNLOCKS, housesBuilt, isPaid, levelFor, rewards } from "./progress";
import { RealmCanvas, type RealmCanvasHandle } from "./city/RealmCanvas";
import type { SkyMode } from "./city/night";
import { MAX_HOMES, type RealmInput } from "./city/layout";
import type { RealmPick, RealmPlace } from "./city/SavePalScene";
import { coinIconUrl, coinPileUrl } from "./city/coins";

type Landmark = RealmPlace;
type Verdict = "VERIFIED" | "FAILED" | "INCONCLUSIVE";

/* The Realm: one agreement as a city, and a place where the work actually happens. The world is the
 * city renderer from Claude Clan (as adapted in grounded), driven by SavePal data in city/.
 * Castle = the client's throne room (checks, approval), treasury = the PayPal hold (fund, release,
 * recall, renew), guild hall = the freelancer (accept, deliver), bounty board = bonuses paid through
 * their own PayPal checkout, customs house = appeals that end in a real PayPal refund.
 * Every action here is the real API call. */

type Criterion = { label: string; kind: string; needle?: string; required?: boolean };
type Gate = { mode: "CLEAR" | "CONFIRM" | "OVERRIDE"; verified: number; total: number; minimumReason: number; blocking: Array<{ index: number }>; unconfirmed: unknown[]; advisory: unknown[] };
type Project = {
  id: string; role: "client" | "freelancer"; title: string; client_email: string; freelancer_email: string;
  amount_cents: number; status: string; payment_status: string; evidence_url: string | null; decision_reason: string | null;
  criteria: Criterion[]; findings: Array<{ status: Verdict }> | null; gate: Gate | null;
  consent: { termsHash: string; fingerprint: string; tampered: boolean; legacy: boolean };
  revisions: { remaining: number | null; exhausted: boolean };
  paypal_order_id: string | null; paypal_capture_id: string | null; seller_merchant_id: string | null;
  funding: { mode: string; status: string; heldAt: string | null; expiresAt: string | null; canFund: boolean; canRelease: boolean; canVoid: { allowed: boolean } };
  realm: RealmPowers;
};
type Bounty = { id: string; amount_cents: number; note: string; status: string; paypal_capture_id: string | null; created_at: string };
type Appeal = { id: string; amount_cents: number; reason: string; status: string; reply: string | null; paypal_refund_id: string | null; created_at: string; resolved_at: string | null };
type RealmPowers = {
  bounties: Bounty[]; bountyCents: number; canBounty: boolean;
  appeals: Appeal[]; openAppeal: Appeal | null; refundedCents: number; refundableCents: number; canAppeal: boolean;
  renew: { allowed: boolean; from: string | null; reason?: string; renewedAt: string | null } | null;
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
  FUNDS_RENEWED: "PayPal renewed the hold", BOUNTY_PAID: "Bounty paid", REFUND_ISSUED: "Refund sailed to the client",
};
const NAMES: Record<Landmark, string> = { castle: "ROYAL PALACE", treasury: "ROYAL TREASURY", guild: "GUILD HALL", market: "GRAND BAZAAR", harbour: "PORT & CUSTOMS" };

/** How far the agreement has come, as the wheat fields show it: 0 waiting … 4 paid and harvested. */
function cropStage(p: Project): number {
  if (isPaid(p)) return 4;
  if (["SUBMITTED", "REVIEW", "APPROVED"].includes(p.status)) return 3;
  if (p.status === "INVITED") return 0;
  return p.funding.mode !== "HOLD" || ["HELD", "PENDING"].includes(p.funding.status) ? 2 : 1;
}
/** The news the banner plane carries over the kingdom. */
function bannerFor(p: Project, money: (c: number) => string): string {
  const amt = money(p.amount_cents), bounties = p.realm.bounties.filter(b => b.status === "COMPLETED").length;
  const extra = bounties ? ` · ${bounties} BOUNT${bounties === 1 ? "Y" : "IES"} PAID` : "";
  if (isPaid(p)) return `PAID BY PAYPAL · ${amt}${extra}`;
  if (["HELD", "PENDING"].includes(p.funding.status)) return `${amt} SAFE WITH PAYPAL${extra}`;
  if (p.status === "INVITED") return `NEW QUEST · ${amt}`;
  return `${amt} · PAID WITH PAYPAL ON APPROVAL${extra}`;
}
const short = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

async function api(payload: Record<string, unknown>) {
  const res = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json() as Record<string, unknown> & { error?: string };
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/** Where the viewer's next real action lives. */
function questFor(p: Project): Landmark | null {
  const paid = p.funding.status === "CAPTURED" || PAID.includes(p.payment_status);
  if (p.realm?.openAppeal && p.role === "freelancer") return "harbour";
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
  const [picked, setPicked] = useState<{ path: string; title: string | null; status: number } | null>(null);
  const [court, setCourt] = useState<Landmark | null>(null);
  const [atlas, setAtlas] = useState(false);
  const [logOpen, setLogOpen] = useState(true);
  const [sound, setSound] = useState(true);
  const [seen, setSeen] = useState<Set<string> | null>(null);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const [ordersOpen, setOrdersOpen] = useState(true);
  const [pops, setPops] = useState<Array<{ id: number; x: number; y: number; xp: number }>>([]);
  const [walking, setWalking] = useState(false);
  const [near, setNear] = useState<string | null>(null);
  useEffect(() => { setSound(sfxEnabled()); }, []);
  const toggleSound = () => { const on = !sound; setSfxEnabled(on); setSound(on); if (on) sfx.click(); };
  // the kingdom keeps the viewer's clock by default; the sky button holds it at day or night instead
  const [sky, setSky] = useState<SkyMode>("auto");
  useEffect(() => { try { const m = localStorage.getItem("savepal:sky"); if (m === "day" || m === "night") setSky(m); } catch { /* storage unavailable */ } }, []);
  const cycleSky = () => {
    const next: SkyMode = sky === "auto" ? "day" : sky === "day" ? "night" : "auto";
    sfx.click(); setSky(next);
    try { localStorage.setItem("savepal:sky", next); } catch { /* storage unavailable */ }
  };
  /** Opening a building plays its door; closing plays it backwards. */
  const enter = (l: Landmark | null) => { if (l) { sfx.open(); realm.current?.focus(l); } setCourt(l); setPicked(null); };
  const leave = () => { sfx.close(); setCourt(null); };
  const realm = useRef<RealmCanvasHandle>(null);
  const cursor = useRef(0);
  const driving = useRef(false);

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
    if (body.events.length) {
      const fresh = cursor.current > 0, found = body.events.find(e => e.kind === "FINDING" && e.verdict);
      if (fresh && found?.verdict) sfx.found(found.verdict); else if (fresh && body.events.some(e => e.kind === "DONE")) sfx.seal();
      cursor.current = body.events[body.events.length - 1].id; setEvents(prev => [...prev, ...body.events].slice(-120));
    }
    return body.run;
  }, [id]);

  useEffect(() => { loadProject().catch(e => setError(e.message)); loadCrew().catch(() => {}); }, [loadProject, loadCrew]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(t); }, [notice]);

  /** Every court action is the real workspace API; the world redraws from the new state. */
  const act = async (payload: Record<string, unknown>, done: string) => {
    setBusy(true); setError(""); setNotice("");
    try {
      await api({ ...payload, id }); await loadProject(); setNotice(done);
      const a = payload.action;
      if (a === "release_funds") { fly(); sfx.coins(); setTimeout(sfx.horn, 450); }
      else if (a === "approve" || a === "accept") sfx.seal();
      else if (a === "submit") sfx.chest();
      else if (a === "verify") sfx.quest();
      else if (a === "void_hold" || a === "revise" || a === "appeal_withdraw") sfx.close();
      else if (a === "hold_renew") sfx.seal();
      else if (a === "appeal_file") sfx.horn();
      else if (a === "appeal_answer") { if (payload.decision === "grant") { sfx.coins(); setTimeout(sfx.horn, 450); } else sfx.close(); }
      else sfx.click();
    }
    catch (e) { sfx.error(); setError(e instanceof Error ? e.message : "The court could not do that"); }
    finally { setBusy(false); }
  };
  /** Money moved: the camera flies to the treasury, where the gold now stands (or has left). */
  const fly = () => { realm.current?.focus("treasury"); realm.current?.celebrate(); };
  const onFunded = useCallback(() => { fly(); sfx.coins(); setTimeout(sfx.chest, 380); setNotice("The gold is locked in the treasury. PayPal holds it until the decree."); loadProject().catch(() => {}); }, [loadProject]);
  const onPaid = useCallback(() => { fly(); sfx.coins(); setTimeout(sfx.horn, 450); setNotice("PayPal confirmed the payment. The galleon sails."); loadProject().catch(() => {}); }, [loadProject]);
  const onBounty = useCallback(() => { fly(); sfx.coins(); setTimeout(sfx.quest, 300); setNotice("Bounty paid through PayPal. A gold notice goes up on the board."); loadProject().catch(() => {}); }, [loadProject]);
  const onPayError = useCallback((m: string) => { sfx.error(); setError(m); }, []);

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
    try { const r = await api({ action: "crew_start", id }) as { runId: string }; sfx.quest(); cursor.current = 0; setEvents([]); await loadCrew(); drive(r.runId); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not dispatch the inspectors"); }
  };

  /* ── world model from data ── */
  const pageList = useMemo(() => {
    const sizes = new Map<string, { bytes: number; title: string | null; status: number }>();
    for (const pg of pages) { try { sizes.set(new URL(pg.url).pathname, { bytes: pg.bytes, title: pg.title, status: pg.status }); } catch { /* skip */ } }
    for (const e of events) if (e.kind === "VISIT" && e.page_url && !sizes.has(e.page_url)) sizes.set(e.page_url, { bytes: 6000, title: null, status: 200 });
    return [...sizes].slice(0, 12).map(([path, v]) => ({ path, ...v }));
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

  /* ── town progress: XP from real work, rewards to collect, a level that grows the town ── */
  const earned = useMemo(() => list ? rewards(list.projects) : [], [list]);
  const xp = earned.reduce((n, r) => n + r.xp, 0);
  const lvl = levelFor(xp);
  useEffect(() => {
    if (!list) return;
    let stored: string[] | null = null;
    try { const raw = localStorage.getItem("savepal-collected"); stored = raw ? JSON.parse(raw) as string[] : null; } catch { /* storage blocked */ }
    // First visit: everything already earned counts as collected, so the town isn't buried in bubbles.
    setSeen(new Set(stored ?? earned.map(r => r.key)));
    if (!stored) try { localStorage.setItem("savepal-collected", JSON.stringify(earned.map(r => r.key))); } catch { /* ignore */ }
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!list) return;
    let last = 0;
    try { last = Number(localStorage.getItem("savepal-level")) || 0; localStorage.setItem("savepal-level", String(lvl.level)); } catch { /* ignore */ }
    if (last && lvl.level > last) { setLevelUp(lvl.level); sfx.horn(); setTimeout(sfx.quest, 500); }
  }, [lvl.level, list]);
  const bubbles = seen ? earned.filter(r => r.projectId === id && !seen.has(r.key)) : [];
  const collect = (key: string, at: { x: number; y: number }) => {
    const r = earned.find(e => e.key === key); if (!r) return;
    const { x, y } = at;
    sfx.coins();
    const next = new Set(seen ?? []); next.add(r.key); setSeen(next);
    try { localStorage.setItem("savepal-collected", JSON.stringify([...next])); } catch { /* ignore */ }
    flyCoins(x, y);
    const popId = Date.now() + Math.random();
    setPops(ps => [...ps, { id: popId, x, y, xp: r.xp }]);
    setTimeout(() => setPops(ps => ps.filter(q => q.id !== popId)), 1100);
  };
  const orders = useMemo(() => (list?.projects ?? []).map(o => ({ o, place: questFor(o) })).filter((x): x is { o: Project; place: Landmark } => !!x.place), [list]);
  useEffect(() => {
    if (!p) return;
    const go = new URLSearchParams(window.location.search).get("go") as Landmark | null;
    if (go && go in NAMES) { setCourt(go); const u = new URL(window.location.href); u.searchParams.delete("go"); window.history.replaceState(null, "", u); }
  }, [!!p]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── the city: built from the agreement's real state ── */
  const realmInput = useMemo<RealmInput | null>(() => {
    if (!p || !list) return null;
    const toA = (o: Project) => ({ id: o.id, title: o.title, amount_cents: o.amount_cents, held: ["HELD", "PENDING"].includes(o.funding.status), paid: isPaid(o) });
    return {
      current: toA(p), others: list.projects.filter(o => o.id !== p.id).map(toA), pages: pageList.map(({ path, bytes }) => ({ path, bytes })),
      homes: housesBuilt(lvl.level, MAX_HOMES), stage: cropStage(p), bounties: p.realm.bounties.filter(b => b.status === "COMPLETED").length,
      appealOpen: !!p.realm.openAppeal, inspecting: running ? active : null, banner: bannerFor(p, money),
    };
  }, [p, list, pageList, lvl.level, running, active]);
  const bubbleRewards = useMemo(() => bubbles.map(r => ({ key: r.key, xp: r.xp, place: r.place })), [bubbles.map(r => r.key).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Every tap in the city lands here: a landmark opens its court, a page its card, another agreement its own realm. */
  const pick = (k: RealmPick) => {
    if ("place" in k) { enter(k.place); return; }
    if ("agreement" in k) { sfx.click(); window.location.href = `/app/realm?id=${encodeURIComponent(k.agreement)}`; return; }
    if ("info" in k) { sfx.click(); setError(""); setNotice(k.info); return; }
    const page = pageList.find(pg => pg.path === k.page);
    sfx.click(); setCourt(null); setPicked({ path: k.page, title: page?.title ?? null, status: page?.status ?? 200 });
  };
  useEffect(() => { if (typeof window !== "undefined" && window.innerWidth <= 900) { setLogOpen(false); setOrdersOpen(false); } }, []);

  if (error && !p) return <main className="realm realm-empty"><p>{error}</p><a href="/app">Back to workspace</a></main>;
  if (!p || !list) return <main className="realm realm-empty"><div className="realm-spinner" /><p>RAISING THE KINGDOM…</p></main>;

  const held = p.funding.status === "HELD" || p.funding.status === "PENDING";
  const paid = p.funding.status === "CAPTURED" || PAID.includes(p.payment_status);
  const treasuryState = paid ? "PAID TO THE GUILD" : held ? "HELD BY PAYPAL" : p.funding.mode === "HOLD" ? "AWAITING GOLD" : "PAID AFTER APPROVAL";
  const days = held && p.funding.expiresAt ? Math.max(0, Math.ceil((new Date(p.funding.expiresAt).getTime() - Date.now()) / 86_400_000)) : null;
  const canDispatch = p.role === "client" && !!p.evidence_url && ["SUBMITTED", "REVIEW", "APPROVED", "REVISION_REQUESTED"].includes(p.status);
  const others = list.projects.filter(x => x.id !== id);

  return <main className="realm">
    {realmInput && <RealmCanvas ref={realm} input={realmInput} rewards={bubbleRewards} onPick={pick} onCollect={collect} onNear={setNear} sky={sky} />}
    {pops.map(q => <span key={q.id} className="realm-pop" style={{ left: q.x, top: q.y }} aria-hidden="true">+{q.xp} XP</span>)}

    <div className="hud-top" aria-label="Town progress">
      <div className="top-level" title={`${xp} XP earned from real work`}>
        <div className="top-star" aria-label={`Town level ${lvl.level}`}><span>{lvl.level}</span></div>
        <div className="top-xp" role="progressbar" aria-label="Experience" aria-valuemin={0} aria-valuemax={lvl.need} aria-valuenow={lvl.into}>
          <i style={{ width: `${Math.max(4, Math.round(lvl.into / lvl.need * 100))}%` }} /><span>{lvl.into}/{lvl.need} XP</span>
        </div>
      </div>
      <div className="top-pill coin" title="Paid out through PayPal, all agreements"><img src={coinIconUrl()} alt="" aria-hidden="true" /><span>{money(list.projects.reduce((n, o) => n + (isPaid(o) ? o.amount_cents - (o.realm?.refundedCents ?? 0) : 0), 0) + list.projects.reduce((n, o) => n + (o.realm?.bountyCents ?? 0), 0))}</span></div>
      <div className="top-pill lock" title="Held by PayPal right now, all agreements"><b aria-hidden="true" /><span>{money(list.projects.reduce((n, o) => n + (["HELD", "PENDING"].includes(o.funding.status) ? o.amount_cents : 0), 0))}</span></div>
    </div>
    <header className="hud hud-title">
      <div className="hud-bar"><span>THE REALM</span><i /><em className="hud-live">LIVE</em></div>

      <button className="hud-kingdom" onClick={() => { sfx.click(); setAtlas(!atlas); }} aria-expanded={atlas}><h1>{p.title}</h1><b>{others.length ? (atlas ? "▴" : "▾") : ""}</b></button>
      {atlas && others.length > 0 && <ul className="hud-atlas">{others.map(o => { const q = questFor(o); return <li key={o.id}><a href={`/app/realm?id=${encodeURIComponent(o.id)}`}><span>{o.title}</span><small>{money(o.amount_cents)}</small>{q && <em>!</em>}</a></li>; })}</ul>}
      <p><b className="c">{p.client_email}</b><span>×</span><b className="f">{p.freelancer_email}</b></p>
      <Ledger projects={list.projects} />
      <div className="hud-orders">
        <button className="hud-orders-head" onClick={() => { sfx.click(); setOrdersOpen(!ordersOpen); }} aria-expanded={ordersOpen}><span>ORDERS</span><b>{orders.length}</b><em>{ordersOpen ? "▴" : "▾"}</em></button>
        {ordersOpen && (orders.length ? <ol>{orders.slice(0, 5).map(({ o, place }) => <li key={o.id}>
          <a href={o.id === id ? undefined : `/app/realm?id=${encodeURIComponent(o.id)}&go=${place}`} onClick={o.id === id ? e => { e.preventDefault(); enter(place); } : undefined}>
            <i className={`ord-${place}`} aria-hidden="true" /><span><b>{questLine(o)}</b><small>{o.title}</small></span><em>+{nextXp(o)}</em>
          </a></li>)}</ol> : <p className="hud-orders-empty">No orders waiting. Start a new agreement to grow the town.</p>)}
      </div>
      <a href={`/app?project=${encodeURIComponent(p.id)}`} className="hud-link">◂ WORKSPACE</a>
    </header>

    <button className={`hud hud-treasury ${quest === "treasury" ? "quest" : ""}`} aria-label="Open the treasury" onClick={() => enter("treasury")}>
      <div className="hud-bar"><span>TREASURY</span><i /><img src="/paypal-logo.webp" alt="PayPal" className="hud-pp" /></div>
      <strong>{money(p.amount_cents)}</strong>
      <span className={`hud-state ${paid ? "paid" : held ? "held" : ""}`}>{treasuryState}</span>
      {days !== null && <div className="hud-meter" aria-label={`${days} of 29 days left on the hold`}>{Array.from({ length: 29 }, (_, i) => <i key={i} className={i < days ? "on" : ""} />)}</div>}
    </button>

    {quest && !court && <button className="hud hud-quest" onClick={() => enter(quest)}><b>!</b><span>{questLine(p)}</span><em>GO ▸</em></button>}

    <div className="hud hud-zoom" role="group" aria-label="Zoom">
      <button onClick={() => { sfx.click(); realm.current?.zoom(1); }} aria-label="Zoom in">+</button>
      <button onClick={() => { sfx.click(); realm.current?.zoom(-1); }} aria-label="Zoom out">−</button>
      <button onClick={() => { sfx.click(); realm.current?.fit(); }} aria-label="Show the whole kingdom">FIT</button>
      <button className={`hud-walk ${walking ? "on" : ""}`} onClick={() => { sfx.click(); if (walking) { realm.current?.stopWalk(); setWalking(false); setNear(null); } else { setCourt(null); realm.current?.walk(p.role === "client" ? "swordsman" : "architect"); setWalking(true); } }} aria-pressed={walking} aria-label={walking ? "Stop walking" : "Walk the kingdom"} title={walking ? "Stop walking" : "Walk the kingdom (arrow keys or WASD)"}>{walking ? "EXIT" : "WALK"}</button>
      <button className={`hud-sky ${sky}`} onClick={cycleSky} aria-label={`Sky: ${sky === "auto" ? "following your clock" : sky}. Change it`} title={sky === "auto" ? "Day and night follow your clock" : sky === "day" ? "Always day" : "Always night"}>{sky === "auto" ? "AUTO" : sky === "day" ? "DAY" : "NIGHT"}</button>
      <button className={`hud-sound ${sound ? "" : "off"}`} onClick={toggleSound} aria-pressed={sound} aria-label={sound ? "Mute sounds" : "Turn sounds on"} title={sound ? "Sound on" : "Sound off"}>{sound ? "♪" : "×"}</button>
    </div>

    <aside className={`hud hud-log ${logOpen ? "" : "closed"}`} aria-label="Inspector's log">
      <div className="hud-bar"><span>INSPECTORS</span><i />{running ? <em className="hud-live">ON PATROL</em> : <em>{run?.status === "DONE" ? "SEALED" : "IDLE"}</em>}<button onClick={() => { sfx.click(); setLogOpen(!logOpen); }} aria-expanded={logOpen} aria-label={logOpen ? "Hide the log" : "Show the log"}>{logOpen ? "HIDE" : "SHOW"}</button></div>
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
      onFunded={onFunded} onPaid={onPaid} onBounty={onBounty} onPayError={onPayError} close={leave} />}

    {levelUp && <div className="hud hud-levelup" role="dialog" aria-label="Level up">
      <div className="lu-burst" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ "--a": `${i * 20}deg`, "--d": `${(i % 3) * 80}ms` } as React.CSSProperties} />)}</div>
      <b className="hud-star big">{levelUp}</b>
      <h2>LEVEL UP</h2>
      <p>{UNLOCKS[levelUp] ?? "The town grows: new homes are going up."}</p>
      <button className="court-btn gold" onClick={() => { sfx.click(); setLevelUp(null); }}>WONDERFUL</button>
    </div>}
    {walking && <>
      <div className="walk-pad" aria-label="Walk">
        {([["▲", 0, -1, "up"], ["◀", -1, 0, "left"], ["▶", 1, 0, "right"], ["▼", 0, 1, "down"]] as const).map(([glyph, x, y, name]) =>
          <button key={name} className={`walk-${name}`} aria-label={`Walk ${name}`}
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); realm.current?.pad(x, y); }}
            onPointerUp={() => realm.current?.pad(0, 0)} onPointerCancel={() => realm.current?.pad(0, 0)}>{glyph}</button>)}
      </div>
      {near ? <button className="hud walk-enter" onClick={() => { sfx.open(); realm.current?.enter(); }}><span>ENTER</span><b>{near}</b><em>E ▸</em></button>
        : <p className="walk-help">Walk with the arrow keys, WASD or the pad. Stand at a door to go inside.</p>}
    </>}
    {(notice || error) && <div className={`hud hud-toast ${error ? "err" : ""}`} role="status"><span>{error || notice}</span><button onClick={() => { setError(""); setNotice(""); }} aria-label="Dismiss">✕</button></div>}
    <p className="realm-hint">DRAG · SCROLL TO ZOOM · TAP THE PALACE, TREASURY, BAZAAR, GUILD OR PORT</p>
  </main>;
}

/** Every agreement you're in, as one kingdom's books: what PayPal holds, has paid, and has returned. */
function Ledger({ projects }: { projects: Project[] }) {
  const sum = (f: (p: Project) => number) => projects.reduce((n, p) => n + f(p), 0);
  const isPaid = (p: Project) => p.funding.status === "CAPTURED" || PAID.includes(p.payment_status);
  const rows: Array<[string, number, string]> = [
    ["IN HOLDS", sum(p => ["HELD", "PENDING"].includes(p.funding.status) ? p.amount_cents : 0), "held"],
    ["PAID OUT", sum(p => isPaid(p) ? p.amount_cents - (p.realm?.refundedCents ?? 0) : 0), "paid"],
    ["BOUNTIES", sum(p => p.realm?.bountyCents ?? 0), "bounty"],
    ["REFUNDED", sum(p => p.realm?.refundedCents ?? 0), "refund"],
  ];
  return <dl className="hud-ledger" aria-label="Your PayPal books across every agreement">{rows.map(([k, v, c]) => <div key={k} className={c}><dt>{k}</dt><dd>{money(v)}</dd></div>)}</dl>;
}

/** XP the next step of an agreement is worth, matching what progress.ts awards for it. */
function nextXp(p: Project): number {
  if (p.realm?.openAppeal && p.role === "freelancer") return 20;
  if (p.status === "INVITED") return 30;
  if (p.role === "client" && p.funding.canFund) return 50;
  if (p.status === "SUBMITTED" || p.status === "REVIEW") return 60;
  if (p.status === "APPROVED" && !isPaid(p)) return 100 + Math.min(400, Math.floor(p.amount_cents / 1000));
  return 40;
}

/** Coins fly from the collected bubble into the coin counter in the top bar. */
function flyCoins(x: number, y: number): void {
  if (typeof document === "undefined") return;
  const target = document.querySelector(".top-pill.coin img")?.getBoundingClientRect();
  if (!target || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const tx = target.left + target.width / 2, ty = target.top + target.height / 2;
  for (let i = 0; i < 7; i++) {
    const coin = document.createElement("img");
    coin.src = coinIconUrl(); coin.className = "fly-coin"; coin.alt = "";
    coin.style.left = `${x}px`; coin.style.top = `${y}px`;
    document.body.appendChild(coin);
    const dx = (Math.random() - .5) * 90, dy = -40 - Math.random() * 50;
    coin.animate([
      { transform: "translate(-50%,-50%) scale(.6)", opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1)`, opacity: 1, offset: .35 },
      { transform: `translate(calc(-50% + ${tx - x}px), calc(-50% + ${ty - y}px)) scale(.7)`, opacity: .9 },
    ], { duration: 900 + i * 70, easing: "cubic-bezier(.5,0,.3,1)", delay: i * 45 }).onfinish = () => {
      coin.remove();
      document.querySelector(".top-pill.coin")?.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], { duration: 220 });
    };
  }
}

function questLine(p: Project): string {
  const amt = money(p.amount_cents);
  if (p.realm?.openAppeal && p.role === "freelancer") return `Answer the client’s appeal for ${money(p.realm.openAppeal.amount_cents)}`;
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
function Court({ place, p, list, audit, busy, act, dispatch, onFunded, onPaid, onBounty, onPayError, close }: {
  place: Landmark; p: Project; list: ListData; audit: Audit[]; busy: boolean;
  act: (payload: Record<string, unknown>, done: string) => Promise<void>; dispatch: (() => void) | null;
  onFunded: () => void; onPaid: () => void; onBounty: () => void; onPayError: (m: string) => void; close: () => void;
}) {
  const [reason, setReason] = useState(""), [override, setOverride] = useState(false), [url, setUrl] = useState(""), [notes, setNotes] = useState("");
  const [bounty, setBounty] = useState("25"), [bountyNote, setBountyNote] = useState("");
  const [claim, setClaim] = useState(() => (p.realm.refundableCents / 100).toFixed(2)), [reply, setReply] = useState("");
  const bountyRef = useRef({ amount: bounty, note: bountyNote });
  bountyRef.current = { amount: bounty, note: bountyNote };
  const bountyExtra = useCallback(() => ({ ...bountyRef.current }), []);
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
      <div className={`court-vault ${paid ? "paid" : held ? "held" : "empty"}`}>
        <img src={coinPileUrl()} alt="" aria-hidden="true" />
        <div className="court-gold"><strong>{amt}</strong><span className={paid ? "paid" : held ? "held" : ""}>{paid ? "PAID" : held ? (p.funding.status === "PENDING" ? "PAYPAL REVIEWING" : "HELD BY PAYPAL") : "NOT SECURED"}</span></div>
      </div>
      {client && p.funding.mode === "HOLD" && p.funding.canFund && !sellerMissing && (list.paypalReady && list.paypalClientId
        ? <div className="court-pp"><PayPalCheckout project={p} clientId={list.paypalClientId} merchantId={merchant} bnCode={list.paypalPartnerBnCode} mode="hold" onPaid={onFunded} onError={onPayError} /></div>
        : <p className="court-note">PayPal keys aren’t set on this site.</p>)}
      {client && p.funding.canRelease && <button className="court-btn gold" disabled={busy} onClick={() => act({ action: "release_funds" }, `${amt} released through PayPal. The galleon sails.`)}>RELEASE {amt} TO THE GUILD</button>}
      {client && p.status === "APPROVED" && p.funding.mode !== "HOLD" && !paid && list.paypalReady && list.paypalClientId && !sellerMissing &&
        <div className="court-pp"><PayPalCheckout project={p} clientId={list.paypalClientId} merchantId={merchant} bnCode={list.paypalPartnerBnCode} onPaid={onPaid} onError={onPayError} /></div>}
      {p.funding.canVoid.allowed && <button className="court-btn ghost" disabled={busy} onClick={() => { if (window.confirm(client ? "Recall the gold? PayPal will cancel the hold." : "Decline the quest and release the client’s gold? This can’t be undone.")) act({ action: "void_hold" }, client ? "The hold was recalled." : "You released the client’s gold."); }}>{client ? "RECALL THE GOLD" : "DECLINE THE QUEST"}</button>}
      {client && p.realm.renew && (p.realm.renew.allowed
        ? <button className="court-btn ghost" disabled={busy} onClick={() => act({ action: "hold_renew" }, "PayPal renewed the hold. The gold stays locked for another full term.")}>RENEW THE HOLD WITH PAYPAL</button>
        : <p className="court-note">{p.realm.renew.renewedAt ? `Hold renewed ${short(p.realm.renew.renewedAt)}. PayPal allows one renewal.` : p.realm.renew.from ? `Long job? Renew this hold from ${short(p.realm.renew.from)}.` : p.realm.renew.reason}</p>)}
      {p.funding.status !== "NONE" && p.funding.status !== "ORDER_CREATED" && !paid && <button className="court-btn ghost" disabled={busy} onClick={() => act({ action: "sync_payment" }, "A rider returned from PayPal with the latest word.")}>SEND A RIDER TO PAYPAL</button>}
      {ledger.length > 0 && <ol className="court-ledger" aria-label="PayPal ledger">{ledger.slice(0, 6).map((e, i) => <li key={i}><span>{LEDGER[e.type]}</span><time>{new Date(e.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</time></li>)}</ol>}
      {(p.paypal_order_id || p.paypal_capture_id) && <p className="court-ids">{p.paypal_order_id && <>ORDER {p.paypal_order_id}</>}{p.paypal_capture_id && <> · CAPTURE {p.paypal_capture_id}</>}</p>}
    </>;
  } else if (place === "castle") {
    lore = client ? "Your palace. Here you inspect the delivery and seal the decree that frees the gold." : "The client’s palace. The decree that frees your gold is sealed here.";
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
  } else if (place === "market") {
    const done = p.realm.bounties.filter(b => b.status === "COMPLETED");
    lore = client ? "Great work deserves more than the agreed price. Pin a bounty here and PayPal pays it to the guild at once." : "Bounties the client paid you on top of the agreement. Each one is a separate PayPal payment.";
    const valid = /^\d{1,4}(\.\d{1,2})?$/.test(bounty.trim()) && Number(bounty) >= 1 && Number(bounty) <= 5000 && bountyNote.trim().length >= 3;
    body = <>
      <div className="court-gold"><strong>{money(p.realm.bountyCents)}</strong><span className={p.realm.bountyCents ? "paid" : ""}>{done.length ? `${done.length} BOUNT${done.length === 1 ? "Y" : "IES"} PAID` : "NO BOUNTIES YET"}</span></div>
      {client && p.realm.canBounty && list.paypalClientId && <div className="court-bounty">
        <div className="court-row">
          <label className="court-money"><span>$</span><input className="court-input" inputMode="decimal" value={bounty} onChange={e => setBounty(e.target.value)} aria-label="Bounty amount in US dollars" /></label>
          {[10, 25, 50, 100].map(n => <button key={n} type="button" className={`court-pill ${Number(bounty) === n ? "on" : ""}`} onClick={() => setBounty(String(n))}>${n}</button>)}
        </div>
        <input className="court-input" value={bountyNote} maxLength={140} onChange={e => setBountyNote(e.target.value)} placeholder="For what? e.g. Shipped two days early" aria-label="What the bounty is for" />
        {valid ? <div className="court-pp"><PayPalCheckout project={p} clientId={list.paypalClientId} merchantId={list.paymentMode === "SELLER" ? p.seller_merchant_id || undefined : undefined} bnCode={list.paypalPartnerBnCode} mode="bounty" extra={bountyExtra} onPaid={onBounty} onError={onPayError} /></div>
          : <p className="court-note">Pick an amount from $1 to $5,000 and say what it’s for.</p>}
      </div>}
      {client && !p.realm.canBounty && <p className="court-note">{p.status === "INVITED" ? "Bounties open once the guild swears to the terms." : "Bounties need PayPal connected on this site."}</p>}
      {done.length > 0 && <ol className="court-ledger" aria-label="Bounties">{done.map(b => <li key={b.id}><span><b>{money(b.amount_cents)}</b> {b.note}</span><time>{short(b.created_at)}</time></li>)}</ol>}
    </>;
  } else if (place === "harbour") {
    const open = p.realm.openAppeal;
    lore = client ? "Something wrong after you paid? File an appeal here. If the guild grants it, PayPal refunds you directly." : "Appeals from the client land here. Granting one sends a real PayPal refund back across the sea.";
    body = <>
      <div className="court-gold"><strong>{money(p.realm.refundedCents)}</strong><span className={open ? "alert" : p.realm.refundedCents ? "paid" : ""}>{open ? "APPEAL OPEN" : p.realm.refundedCents ? "REFUNDED" : "NO REFUNDS"}</span></div>
      {open && <div className="court-appeal">
        <p><b>{money(open.amount_cents)}</b> requested · {short(open.created_at)}</p>
        <blockquote>“{open.reason}”</blockquote>
        {open.status === "REFUNDING" && <p className="court-note">PayPal is processing this refund.</p>}
      </div>}
      {open && client && open.status === "OPEN" && <button className="court-btn ghost" disabled={busy} onClick={() => act({ action: "appeal_withdraw", appealId: open.id }, "Appeal withdrawn.")}>WITHDRAW THE APPEAL</button>}
      {open && !client && <>
        <textarea className="court-input" rows={2} value={reply} onChange={e => setReply(e.target.value)} placeholder="Your answer to the client" aria-label="Your answer" />
        <button className="court-btn gold" disabled={busy} onClick={() => { if (window.confirm(`Refund ${money(open.amount_cents)} to the client through PayPal? This can’t be undone.`)) act({ action: "appeal_answer", appealId: open.id, decision: "grant", reply }, `PayPal refunded ${money(open.amount_cents)}. The cutter sails home.`); }}>GRANT · REFUND {money(open.amount_cents)}</button>
        <button className="court-btn ghost" disabled={busy || reply.trim().length < 10} onClick={() => act({ action: "appeal_answer", appealId: open.id, decision: "decline", reply }, "You answered the appeal.")}>DECLINE WITH THIS ANSWER</button>
      </>}
      {!open && client && p.realm.canAppeal && <form className="court-form" onSubmit={e => { e.preventDefault(); act({ action: "appeal_file", amount: claim, reason }, "Appeal filed. The guild will answer it here."); }}>
        <label className="court-money"><span>$</span><input className="court-input" inputMode="decimal" value={claim} onChange={e => setClaim(e.target.value)} aria-label="Refund amount" /></label>
        <textarea className="court-input" rows={2} required minLength={10} value={reason} onChange={e => setReason(e.target.value)} placeholder="What went wrong after payment?" aria-label="Reason" />
        <button className="court-btn gold" disabled={busy || reason.trim().length < 10}>FILE AN APPEAL · UP TO {money(p.realm.refundableCents)}</button>
      </form>}
      {!open && !p.realm.canAppeal && <p className="court-note">{paid ? (p.realm.refundableCents ? "Only the client can file an appeal." : "Everything paid has been refunded.") : "Appeals open once PayPal has paid the guild."}</p>}
      {p.realm.appeals.some(a => a.id !== open?.id) && <ol className="court-ledger" aria-label="Past appeals">{p.realm.appeals.filter(a => a.id !== open?.id).map(a => <li key={a.id}><span><b>{money(a.amount_cents)}</b> {a.status === "REFUNDED" ? "refunded" : a.status.toLowerCase()}{a.reply ? ` · “${a.reply}”` : ""}</span><time>{short(a.resolved_at ?? a.created_at)}</time></li>)}</ol>}
    </>;
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

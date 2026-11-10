"use client";

import Link from "next/link";
import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Ban, Castle, Check, ChevronRight, CircleDollarSign, Clock3, Coins, CreditCard, ExternalLink, Eye, FileText, Fingerprint,
  Globe, Handshake, Heading1, History, Hourglass, Inbox, Link2Off, ListChecks, Lock, LogOut, Menu, MousePointerClick, PackageCheck,
  Download, LayoutGrid, Link2, Plus, RefreshCw, RotateCcw, SearchCheck, Send, ShieldAlert, Table2, TrendingDown, TrendingUp, Type, Undo2, Wallet, X,
} from "lucide-react";
import "./dashboard.css";
import PayPalCheckout from "./paypal-checkout";
import { agreementRows, type RunRecord } from "../lib/grid-adapters";
import type { Ledger } from "../lib/payment-ledger";

/* ───────────────────────── tables ─────────────────────────
 * The Evidence and Payments tabs and the agreements table are AG Grid views, loaded only when
 * opened. Each sits behind GridBoundary: if a table fails to load, the agreement, its payment and
 * its approval controls are all still there on the Overview. */
const EvidenceTab = lazy(() => import("./grids/evidence-grid"));
const PaymentsTab = lazy(() => import("./grids/payment-grid"));
const AgreementsTable = lazy(() => import("./grids/agreements-grid"));
class GridBoundary extends Component<{ children: ReactNode; what: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p className="g-empty" role="alert">The {this.props.what} could not load. Everything else, including payment and approval, is on the Overview.</p>
      : this.props.children;
  }
}
const GridLoading = () => <div className="g-loading" role="status">Loading the table…</div>;
type Submission = { id: string; submission_hash: string; snapshot_hash: string | null; created_at: string };
/** What the agreement page keeps from the detail response, beyond the activity and check history. */
type DetailData = { run: RunRecord | null; submissions: Submission[]; payments: Ledger | null; currentSubmissionId: string | null };
const NO_DETAIL: DetailData = { run: null, submissions: [], payments: null, currentSubmissionId: null };

/** Cards or table on the homepage: the viewer's choice, kept in this browser (in memory if storage is unavailable). */
const VIEW_KEY = "savepal:agreements-view";
let viewChoice: "cards" | "table" | null = null;
const viewListeners = new Set<() => void>();
const readView = (): "cards" | "table" => viewChoice ?? (() => { try { return localStorage.getItem(VIEW_KEY) === "table" ? "table" : "cards"; } catch { return "cards"; } })();
const writeView = (v: "cards" | "table") => { viewChoice = v; try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ } viewListeners.forEach(fn => fn()); };
const subscribeView = (fn: () => void) => { viewListeners.add(fn); return () => { viewListeners.delete(fn); }; };

/* ───────────────────────── types ───────────────────────── */
/** The Realm's PayPal powers for this agreement, each tile opening the building where it lives. */
function RealmPowers({ project: p }: { project: Project }) {
  const r = p.realm; if (!r) return null;
  const client = p.role === "client", href = `/app/realm?id=${encodeURIComponent(p.id)}`;
  const paidBounties = r.bounties.filter(b => b.status === "COMPLETED").length;
  const tiles: Array<{ icon: React.ReactNode; label: string; value: string; hot?: boolean; show: boolean }> = [
    { icon: <Coins size={16} />, label: "Bounties", value: paidBounties ? `${money(r.bountyCents)} · ${paidBounties} paid` : client && r.canBounty ? "Tip great work" : "None yet", show: paidBounties > 0 || r.canBounty },
    { icon: <Undo2 size={16} />, label: "Appeals", value: r.openAppeal ? `${money(r.openAppeal.amount_cents)} open` : r.refundedCents ? `${money(r.refundedCents)} refunded` : client && r.canAppeal ? "Ask for a refund" : "None", hot: !!r.openAppeal && !client, show: !!r.openAppeal || r.refundedCents > 0 || r.canAppeal },
    { icon: <Hourglass size={16} />, label: "Hold", value: r.renew?.renewedAt ? "Renewed" : r.renew?.allowed ? "Renew available" : "Renewable after 3 days", show: !!r.renew && client },
  ];
  const shown = tiles.filter(t => t.show);
  if (!shown.length) return null;
  return <nav className="d-powers" aria-label="Realm powers">
    {shown.map(t => <a key={t.label} href={href} className={t.hot ? "hot" : ""}><i>{t.icon}</i><span><small>{t.label}</small>{t.value}</span><ArrowUpRight size={14} /></a>)}
  </nav>;
}

type Kind = "reachable" | "contains" | "absent" | "title" | "link" | "path" | "no_broken_pages" | "manual";
type Criterion = { label: string; kind: Kind; needle?: string; required?: boolean };
type Status = "VERIFIED" | "FAILED" | "INCONCLUSIVE";
type Finding = { label: string; status: Status; explanation: string; check: string; confidence?: "HIGH" | "MEDIUM" | "LOW"; evidenceRefs?: Array<{ url: string; excerpt?: string }> };
type GateItem = { index: number; label: string; status: Status; required: boolean };
type Gate = { blocking: GateItem[]; unconfirmed: GateItem[]; advisory: GateItem[]; verified: number; total: number; mode: "CLEAR" | "CONFIRM" | "OVERRIDE"; minimumReason: number };
type Consent = { legacy: boolean; termsHash: string; fingerprint: string; clientBound: boolean; freelancerBound: boolean; tampered: boolean };
type RunSummary = { runId: string; submissionId: string | null; completedAt: string | null; verified: number; failed: number; inconclusive: number; improved: number; regressed: number; score: number; scoreChange: number | null; deltas: Array<{ index: number; label: string; from: Status | null; to: Status; transition: "IMPROVED" | "REGRESSED" | "UNCHANGED" | "CHANGED" | "FIRST" }> };
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
  funding: { mode: "CAPTURE" | "HOLD"; status: string; heldAt: string | null; expiresAt: string | null; canFund: boolean; canRelease: boolean; canVoid: { allowed: boolean; reason?: string } };
  realm?: { bountyCents: number; bounties: Array<{ status: string }>; canBounty: boolean; openAppeal: { amount_cents: number } | null; refundedCents: number; canAppeal: boolean; renew: { allowed: boolean; renewedAt: string | null } | null };
};
type Event = { actor: string; type: string; detail: string; created_at: string };
type User = { name: string; email: string; avatar: string | null };
type WorkspaceData = { user: User; projects: Project[]; paypalReady: boolean; sellerOnboardingReady: boolean; paymentMode: "SELLER" | "MERCHANT"; paypalClientId: string | null; paypalPartnerBnCode: string | null; aiReady: boolean; crewReady?: boolean };
type Run = (payload: Record<string, unknown>, success: string) => Promise<void>;

/* ───────────────────────── helpers ───────────────────────── */
const KINDS: Record<Kind, { label: string; icon: typeof Globe; needle?: { placeholder: string; label: string } }> = {
  reachable: { label: "Site loads", icon: Globe },
  contains: { label: "Shows text", icon: Type, needle: { placeholder: "e.g. Products", label: "Text to find" } },
  absent: { label: "Text is gone", icon: Ban, needle: { placeholder: "e.g. lorem ipsum", label: "Forbidden text" } },
  title: { label: "Page title", icon: Heading1, needle: { placeholder: "e.g. Acme Store", label: "Title text" } },
  link: { label: "Button exists", icon: MousePointerClick, needle: { placeholder: "e.g. Add to cart", label: "Button label" } },
  path: { label: "Page exists", icon: FileText, needle: { placeholder: "/pricing", label: "Page path" } },
  no_broken_pages: { label: "No broken pages", icon: Link2Off },
  manual: { label: "You check it", icon: Eye },
};
const TEMPLATES: Array<Criterion> = [
  { label: "The site loads over HTTPS", kind: "reachable", required: true },
  { label: "The home page shows the products", kind: "contains", needle: "Products", required: true },
  { label: "No placeholder text is left", kind: "absent", needle: "lorem ipsum", required: true },
  { label: "Visitors can add to cart", kind: "link", needle: "Add to cart", required: true },
  { label: "A pricing page exists", kind: "path", needle: "/pricing", required: true },
  { label: "No page is broken", kind: "no_broken_pages", required: true },
  { label: "Checkout works end to end", kind: "manual", required: false },
];
const PAID = ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"];
const HOLD_DAYS = 29;
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const date = (value: string | null) => value ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
const shortDate = (value: string | null) => value ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
const ago = (value: string) => {
  const s = (Date.now() - new Date(value).getTime()) / 1000;
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};
const initials = (value: string) => value.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(x => x[0]?.toUpperCase()).join("") || "?";
const handle = (email: string) => email.split("@")[0];
const firstName = (name: string) => name.split(/[\s@.]/)[0];
const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const isPaid = (p: Project) => p.funding.status === "CAPTURED" || PAID.includes(p.payment_status);
const isHeld = (p: Project) => p.funding.status === "HELD" || p.funding.status === "PENDING";
const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

async function api(payload: Record<string, unknown>) {
  const res = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json() as { error?: string; id?: string; orderId?: string; status?: string; actionUrl?: string; connected?: boolean };
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/** The milestone's journey. Fund-first agreements secure money before delivery; the others pay after approval. */
type Stage = { key: string; label: string; icon: typeof Globe; done: boolean };
function journey(p: Project): Stage[] {
  const paid = isPaid(p), approved = p.status === "APPROVED" || paid;
  const funded = paid || isHeld(p) || p.funding.status === "CAPTURED";
  const delivered = !!p.evidence_url && p.status !== "AGREED";
  const checked = !!p.findings && ["REVIEW", "APPROVED"].includes(p.status) || approved;
  const base: Stage[] = [{ key: "agreed", label: "Agreed", icon: Handshake, done: p.status !== "INVITED" }];
  if (p.funding.mode === "HOLD") base.push({ key: "funded", label: "Funded", icon: Lock, done: funded });
  base.push({ key: "delivered", label: "Delivered", icon: PackageCheck, done: delivered || checked });
  base.push({ key: "checked", label: "Checked", icon: SearchCheck, done: checked });
  if (p.funding.mode !== "HOLD") base.push({ key: "approved", label: "Approved", icon: ListChecks, done: approved });
  base.push({ key: "paid", label: "Paid", icon: CircleDollarSign, done: paid });
  return base;
}

/** Whose turn it is, in one line. */
type Move = { mine: boolean; title: string; sub: string; tone: "act" | "wait" | "done" | "warn" };
function nextMove(p: Project, data: WorkspaceData): Move {
  const client = p.role === "client", amt = money(p.amount_cents), other = handle(client ? p.freelancer_email : p.client_email);
  if (p.consent.tampered) return { mine: false, title: "Terms changed", sub: "Approval and payment are frozen.", tone: "warn" };
  if (isPaid(p)) return { mine: false, title: "Paid", sub: `${amt} reached ${client ? other : "you"} through PayPal.`, tone: "done" };
  if (p.status === "INVITED") return client ? { mine: false, title: `Waiting for ${other}`, sub: "They need to accept the terms.", tone: "wait" } : { mine: true, title: "Accept the terms", sub: "Lock in exactly what “done” means.", tone: "act" };
  if (p.funding.mode === "HOLD" && p.funding.canFund) {
    if (data.paymentMode === "SELLER" && !p.seller_merchant_id) return { mine: !client, title: client ? `Waiting for ${other}` : "Connect PayPal", sub: client ? "They need to connect PayPal first." : "So the money can reach you.", tone: client ? "wait" : "act" };
    return client ? { mine: true, title: `Secure ${amt}`, sub: "PayPal holds it. You’re charged only when you approve.", tone: "act" } : { mine: false, title: `Waiting for ${other}`, sub: "They’re securing the payment with PayPal.", tone: "wait" };
  }
  if (["AGREED", "REVISION_REQUESTED"].includes(p.status)) return client ? { mine: false, title: `${other} is working`, sub: p.status === "REVISION_REQUESTED" ? "Revision requested." : "Funds are safe while they deliver.", tone: "wait" } : { mine: true, title: p.status === "REVISION_REQUESTED" ? "Send the revision" : "Deliver the work", sub: "Share the live link.", tone: "act" };
  if (p.status === "SUBMITTED") return client ? { mine: true, title: "Check the delivery", sub: "Run the checks against the live site.", tone: "act" } : { mine: false, title: "Delivered", sub: `${other} is checking it.`, tone: "wait" };
  if (p.status === "REVIEW") return client ? { mine: true, title: "Your decision", sub: "Approve, or ask for a revision.", tone: "act" } : { mine: false, title: "In review", sub: `${other} is deciding.`, tone: "wait" };
  if (p.status === "APPROVED") return client ? { mine: true, title: `Pay ${amt}`, sub: p.funding.mode === "HOLD" ? "Release the held funds." : "Pay through PayPal.", tone: "act" } : { mine: false, title: "Approved", sub: `Waiting for ${other} to release ${amt}.`, tone: "wait" };
  return { mine: false, title: p.status.toLowerCase(), sub: "", tone: "wait" };
}

const EVENT: Record<string, { label: string; icon: typeof Globe; tone?: string }> = {
  AGREEMENT_CREATED: { label: "Agreement created", icon: FileText }, AGREEMENT_ACCEPTED: { label: "Terms accepted", icon: Handshake, tone: "ok" },
  PAYPAL_HOLD_ORDER_CREATED: { label: "PayPal checkout opened", icon: CreditCard }, FUNDS_PENDING: { label: "PayPal reviewing hold", icon: Hourglass },
  FUNDS_HELD: { label: "Funds held by PayPal", icon: Lock, tone: "pp" }, FUNDS_RELEASED: { label: "Released to freelancer", icon: Coins, tone: "ok" },
  FUNDS_RETURNED: { label: "Hold cancelled", icon: Undo2, tone: "bad" }, FUNDS_STATUS_CHANGED: { label: "PayPal updated the hold", icon: RefreshCw, tone: "pp" },
  EVIDENCE_SUBMITTED: { label: "Work delivered", icon: Send }, VERIFICATION_COMPLETED: { label: "Checks finished", icon: SearchCheck },
  VERIFICATION_FAILED: { label: "Checks couldn’t run", icon: ShieldAlert, tone: "bad" }, REVIEW_REQUIRED: { label: "Ready for decision", icon: ListChecks },
  CLIENT_APPROVED: { label: "Work approved", icon: Check, tone: "ok" }, REVISION_REQUESTED: { label: "Revision requested", icon: RotateCcw, tone: "warn" },
  POLICY_OVERRIDE: { label: "Approved with override", icon: ShieldAlert, tone: "warn" }, PAYPAL_ORDER_CREATED: { label: "PayPal order created", icon: CreditCard },
  CAPTURE_CONFIRMED: { label: "PayPal confirmed payment", icon: Coins, tone: "ok" }, CREW_DISPATCHED: { label: "Inspectors dispatched", icon: Castle },
  CREW_REPORT: { label: "Inspectors reported", icon: Castle }, PARTIALLY_REFUNDED: { label: "Partially refunded", icon: Undo2, tone: "warn" },
};

/* ───────────────────────── small parts ───────────────────────── */
function Avatar({ email, name, src, size = 32, ring = false }: { email: string; name?: string | null; src?: string | null; size?: number; ring?: boolean }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * .36), ["--h" as string]: hue(email) };
  return <span className={`d-ava ${ring ? "ring" : ""}`} style={style} title={name || email}>
    {src && !broken ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : initials(name || email)}
  </span>;
}

function JourneyBar({ project, compact = false }: { project: Project; compact?: boolean }) {
  const stages = journey(project);
  const current = stages.findIndex(s => !s.done);
  return <ol className={`d-journey ${compact ? "compact" : ""}`} aria-label="Progress">
    {stages.map((s, i) => { const Icon = s.icon; const state = s.done ? "done" : i === current ? "now" : ""; return <li key={s.key} className={state} aria-current={i === current ? "step" : undefined}>
      <span className="d-j-dot">{s.done && compact ? <Check size={10} strokeWidth={3} /> : <Icon size={compact ? 10 : 15} />}</span>
      {!compact && <em>{s.label}</em>}
    </li>; })}
  </ol>;
}

function PayPalMark({ h = 16 }: { h?: number }) { return <img className="d-pp" src="/paypal-logo.webp" alt="PayPal" width={2000} height={511} style={{ height: h }} />; }

/* ── The PayPal vault: where the money physically is, driven by real states and audit events ── */
type Spot = "client" | "vault" | "freelancer";
const SPOTS: Record<Spot, { x: number; y: number }> = { client: { x: 120, y: 92 }, vault: { x: 380, y: 52 }, freelancer: { x: 640, y: 92 } };
const ROUTES: Record<string, string> = {
  "client>vault": "M120 92 Q 250 0 380 52", "vault>freelancer": "M380 52 Q 510 0 640 92",
  "vault>client": "M380 52 Q 250 0 120 92", "client>freelancer": "M120 92 Q 380 -60 640 92",
};
function spotFor(p: Project): Spot { return isPaid(p) ? "freelancer" : ["HELD", "PENDING", "VOIDING"].includes(p.funding.status) ? "vault" : "client"; }
type MoneyMoment = { at: string; label: string; spot: Spot };
function moneyMoments(audit: Event[]): MoneyMoment[] {
  const keys = ["AGREEMENT_ACCEPTED", "PAYPAL_HOLD_ORDER_CREATED", "FUNDS_PENDING", "FUNDS_HELD", "CLIENT_APPROVED", "FUNDS_RELEASED", "FUNDS_RETURNED", "FUNDS_STATUS_CHANGED"];
  let spot: Spot = "client";
  return [...audit].reverse().filter(e => keys.includes(e.type)).map(e => {
    if (e.type === "FUNDS_HELD" || e.type === "FUNDS_PENDING") spot = "vault";
    if (e.type === "FUNDS_RELEASED") spot = "freelancer";
    if (e.type === "FUNDS_RETURNED") spot = "client";
    if (e.type === "FUNDS_STATUS_CHANGED") spot = /CAPTURED/.test(e.detail) ? "freelancer" : /VOIDED|EXPIRED|FAILED/.test(e.detail) ? "client" : spot;
    return { at: e.created_at, label: EVENT[e.type]?.label ?? e.type, spot };
  });
}
function Wallet3({ x, name, email, avatar, active, tone }: { x: number; name: string; email: string; avatar?: string | null; active: boolean; tone: "client" | "freelancer" }) {
  return <g className={`vs-wallet ${active ? "on" : ""}`} transform={`translate(${x - 62} 112)`}>
    <rect width="124" height="78" rx="16" className="vs-wallet-body" />
    <path d="M0 30 H124" className="vs-wallet-line" />
    <rect x="78" y="40" width="34" height="22" rx="7" className="vs-wallet-clasp" />
    <clipPath id={`ava-${tone}`}><circle cx="22" cy="18" r="11" /></clipPath>
    <circle cx="22" cy="18" r="11" className={`vs-ava ${tone}`} />
    {avatar ? <image href={avatar} x="11" y="7" width="22" height="22" clipPath={`url(#ava-${tone})`} preserveAspectRatio="xMidYMid slice" /> : <text x="22" y="22" className="vs-ava-t">{initials(email)}</text>}
    <text x="62" y="104" className="vs-label">{name}</text>
  </g>;
}
function VaultScene({ project, audit, me }: { project: Project; audit: Event[]; me: User }) {
  const moments = useMemo(() => moneyMoments(audit), [audit]);
  const [viewing, setViewing] = useState<number | null>(null);
  const live = viewing === null;
  const target: Spot = live ? spotFor(project) : moments[viewing]?.spot ?? spotFor(project);
  const coins = useRef<SVGGElement>(null), shown = useRef<Spot>(target);
  const paths = useRef<Record<string, SVGPathElement | null>>({});
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const from = shown.current, to = target, el = coins.current;
    const place = (x: number, y: number) => el?.setAttribute("transform", `translate(${x} ${y})`);
    if (from === to || reducedMotion()) { place(SPOTS[to].x, SPOTS[to].y); shown.current = to; return; }
    const forward = paths.current[`${from}>${to}`], backward = paths.current[`${to}>${from}`];
    const path = forward ?? backward, reverse = !forward;
    if (!path) { place(SPOTS[to].x, SPOTS[to].y); shown.current = to; return; }
    const length = path.getTotalLength(), start = performance.now(), duration = 1300;
    let frame = 0;
    setMoving(true);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration), e = 1 - Math.pow(1 - t, 3);
      const p = path.getPointAtLength((reverse ? 1 - e : e) * length);
      place(p.x, p.y);
      if (t < 1) frame = requestAnimationFrame(tick); else { shown.current = to; setMoving(false); }
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); shown.current = to; };
  }, [target]);
  const locked = target === "vault";
  const daysLeft = project.funding.expiresAt ? Math.max(0, Math.ceil((new Date(project.funding.expiresAt).getTime() - Date.now()) / 86_400_000)) : null;
  const ring = live && locked && daysLeft !== null ? Math.min(1, daysLeft / HOLD_DAYS) : locked ? 1 : 0;
  const amount = money(project.amount_cents);
  const iAmClient = project.role === "client";
  return <div className="d-vault">
    <svg viewBox="44 6 672 226" className={`vault-svg ${moving ? "moving" : ""}`} role="img" aria-label={target === "vault" ? `${amount} held by PayPal` : target === "freelancer" ? `${amount} with the freelancer` : `${amount} with the client`}>
      <defs>
        <linearGradient id="vs-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#123a8c" /><stop offset="1" stopColor="#0a2463" /></linearGradient>
        <linearGradient id="vs-coin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffd766" /><stop offset="1" stopColor="#f2b21b" /></linearGradient>
      </defs>
      {Object.entries(ROUTES).filter(([k]) => k !== "vault>client").map(([k, d]) => <path key={k} d={d} className={`vs-track ${k === "client>freelancer" ? "direct" : ""}`} />)}
      {Object.entries(ROUTES).map(([k, d]) => <path key={`p-${k}`} ref={el => { paths.current[k] = el; }} d={d} fill="none" stroke="none" />)}
      <Wallet3 x={SPOTS.client.x} name={iAmClient ? "You" : "Client"} email={project.client_email} avatar={iAmClient ? me.avatar : null} active={target === "client"} tone="client" />
      <Wallet3 x={SPOTS.freelancer.x} name={iAmClient ? "Freelancer" : "You"} email={project.freelancer_email} avatar={iAmClient ? null : me.avatar} active={target === "freelancer"} tone="freelancer" />
      <g className={`vs-vault ${locked ? "locked" : "open"}`} transform="translate(305 86)">
        <rect x="0" y="0" width="150" height="122" rx="18" fill="url(#vs-body)" />
        <rect x="14" y="118" width="18" height="10" rx="3" className="vs-leg" /><rect x="118" y="118" width="18" height="10" rx="3" className="vs-leg" />
        <circle cx="75" cy="61" r="47" className="vs-ring-bg" />
        <circle cx="75" cy="61" r="47" className="vs-ring" pathLength={1} style={{ strokeDasharray: `${ring} 1` }} transform="rotate(-90 75 61)" />
        <g className="vs-door"><circle cx="75" cy="61" r="38" className="vs-door-face" /><g className="vs-dial"><circle cx="75" cy="61" r="12" className="vs-dial-c" /><path d="M75 43 V52 M75 70 V79 M57 61 H66 M84 61 H93" className="vs-dial-s" /></g></g>
        <text x="75" y="141" className="vs-label">PayPal</text>
      </g>
      <g ref={coins} className="vs-coins" transform={`translate(${SPOTS[target].x} ${SPOTS[target].y})`}>
        <ellipse cx="0" cy="22" rx="22" ry="5" className="vs-coin-shadow" />
        {[14, 7, 0].map(y => <g key={y}><ellipse cx="0" cy={y + 4} rx="20" ry="6.5" className="vs-coin-edge" /><ellipse cx="0" cy={y} rx="20" ry="6.5" fill="url(#vs-coin)" className="vs-coin-top" /></g>)}
        <g transform="translate(0 -34) scale(1.6)"><rect x="-38" y="-13" width="76" height="22" rx="11" className="vs-amount" /><text x="0" y="2" className="vs-amount-t">{amount}</text></g>
      </g>
    </svg>
    {moments.length > 0 && <div className="d-replay" role="list" aria-label="Money history">
      {!live && <button className="d-replay-live" onClick={() => setViewing(null)}><span className="d-live-dot" /> Live</button>}
      {moments.map((m, i) => <button key={`${m.at}-${i}`} role="listitem" className={`d-replay-pt s-${m.spot} ${viewing === i ? "on" : ""}`} onClick={() => setViewing(viewing === i ? null : i)} title={`${m.label} · ${date(m.at)}`}><i /><span>{m.label}</span></button>)}
    </div>}
  </div>;
}

/* ───────────────────────── the PayPal hold card ─────────────────────────
 * Card layout and flip inspired by Muhammed Erdem's "Credit Card Form" (MIT licence).
 * It collects nothing: it is a picture of this agreement's PayPal hold. The amount is real,
 * the "number" is the terms fingerprint, the holder is who the money is held for, "valid thru"
 * is the day PayPal's hold lapses, and the back carries the real PayPal order and capture IDs.
 * Card details only ever go to PayPal's own checkout. */
function HoldCard({ project }: { project: Project }) {
  const [flipped, setFlipped] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const f = project.funding, held = isHeld(project), paid = isPaid(project);
  const tone = paid ? "paid" : held ? "held" : ["VOIDED", "EXPIRED", "FAILED"].includes(f.status) ? "void" : "open";
  const state = paid ? "Released" : held ? (f.status === "PENDING" ? "PayPal reviewing" : "Held by PayPal") : f.status === "VOIDED" ? "Hold cancelled" : f.status === "EXPIRED" ? "Hold expired" : f.status === "FAILED" ? "Declined" : f.mode === "HOLD" ? "Not secured yet" : project.status === "APPROVED" ? "Ready to pay" : "Pays on approval";
  const digits = `${project.consent.fingerprint || ""}${project.id}`.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 16);
  const thru = paid ? "PAID" : f.expiresAt ? new Date(f.expiresAt).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" }) : "--/--";
  const move = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== "mouse" || reducedMotion()) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTilt({ x: (e.clientX - r.left) / r.width * 2 - 1, y: (e.clientY - r.top) / r.height * 2 - 1 });
  };
  const style = { ["--rx" as string]: `${(-tilt.y * 5).toFixed(2)}deg`, ["--ry" as string]: `${(tilt.x * 7).toFixed(2)}deg`, ["--gx" as string]: `${50 + tilt.x * 40}%`, ["--gy" as string]: `${50 + tilt.y * 40}%` };
  return <button type="button" className={`d-hc t-${tone} ${flipped ? "flip" : ""}`} style={style} onClick={() => setFlipped(!flipped)} onPointerMove={move} onPointerLeave={() => setTilt({ x: 0, y: 0 })}
    aria-label={`PayPal hold card: ${state}, ${money(project.amount_cents)}. ${flipped ? "Showing PayPal references." : "Flip for PayPal references."}`}>
    <span className="d-hc-inner">
      <span className="d-hc-face d-hc-front" aria-hidden={flipped}>
        <span className="d-hc-shine" />
        <span className="d-hc-row"><span className="d-hc-chip"><i /><i /><i /><i /></span><span className="d-hc-wave"><i /><i /><i /></span><img src="/paypal-logo.webp" alt="" className="d-hc-pp" /></span>
        <span className="d-hc-amt">{money(project.amount_cents)}<small>USD</small></span>
        <span className="d-hc-num">{digits.match(/.{4}/g)!.map((g, i) => <span key={i}>{g}</span>)}</span>
        <span className="d-hc-row d-hc-foot">
          <span><small>Held for</small><b>{handle(project.freelancer_email)}</b></span>
          <span><small>Valid thru</small><b>{thru}</b></span>
          <span className="d-hc-state">{state}</span>
        </span>
      </span>
      <span className="d-hc-face d-hc-back" aria-hidden={!flipped}>
        <span className="d-hc-stripe" />
        <span className="d-hc-sig"><span>{project.title}</span><b>{(project.paypal_capture_id || project.paypal_order_id || "------").slice(-6)}</b></span>
        <span className="d-hc-refs">
          <span><small>PayPal order</small><b>{project.paypal_order_id || "Not opened yet"}</b></span>
          <span><small>Capture</small><b>{project.paypal_capture_id || "After approval"}</b></span>
        </span>
        <span className="d-hc-fine">A picture of the PayPal hold. Card details never touch SavePal.</span>
      </span>
    </span>
  </button>;
}

/* ───────────────────────── money card ───────────────────────── */
function MoneyCard({ project, data, audit, busy, run }: { project: Project; data: WorkspaceData; audit: Event[]; busy: boolean; run: Run }) {
  const f = project.funding, held = isHeld(project), paid = isPaid(project), client = project.role === "client";
  const days = held && f.expiresAt ? Math.max(0, Math.ceil((new Date(f.expiresAt).getTime() - Date.now()) / 86_400_000)) : null;
  const state = paid ? "Released" : held ? (f.status === "PENDING" ? "PayPal reviewing" : "Held by PayPal") : f.status === "VOIDED" ? "Hold cancelled" : f.status === "EXPIRED" ? "Hold expired" : f.status === "FAILED" ? "Declined" : f.mode === "HOLD" ? "Not secured yet" : project.status === "APPROVED" ? "Ready to pay" : "Paid after approval";
  const tone = paid ? "ok" : held ? "pp" : ["VOIDED", "EXPIRED", "FAILED"].includes(f.status) ? "bad" : "";
  return <section className="d-card d-money" aria-label="Payment">
    <header className="d-money-head"><PayPalMark h={16} /><span className={`d-state ${tone}`}>{state}</span></header>
    <HoldCard project={project} />
    {f.mode === "HOLD" && <VaultScene project={project} audit={audit} me={data.user} />}
    {days !== null && <div className="d-hold" aria-label={`${days} of ${HOLD_DAYS} days left on the hold`}>
      <div className="d-hold-bar"><i style={{ width: `${days / HOLD_DAYS * 100}%` }} className={days <= 3 ? "warn" : ""} /></div>
      <span><Hourglass size={12} /> {days} days left on the hold</span>
    </div>}
    <div className="d-money-actions">
      {f.canVoid.allowed && <button className="d-btn ghost sm" disabled={busy} onClick={() => {
        if (window.confirm(client ? "Cancel the PayPal hold? The money will no longer be reserved." : "Decline this milestone and release the client’s money? This can’t be undone."))
          run({ action: "void_hold", id: project.id }, client ? "PayPal hold cancelled." : "You released the client’s funds.");
      }}><Undo2 size={14} /> {client ? "Cancel hold" : "Decline"}</button>}
      {f.status !== "NONE" && f.status !== "ORDER_CREATED" && !paid && <button className="d-btn ghost sm" disabled={busy} onClick={() => run({ action: "sync_payment", id: project.id }, "Checked the latest status with PayPal.")}><RefreshCw size={14} /> Check PayPal</button>}
      {f.mode !== "HOLD" && project.role === "client" && project.paymentAwaitingReconciliation && <button className="d-btn ghost sm" disabled={busy} onClick={() => run({ action: "sync_payment", id: project.id }, "Payment status checked with PayPal.")}><RefreshCw size={14} /> Reconcile</button>}
    </div>
    <p className="d-sandbox">Sandbox</p>
  </section>;
}

/* ───────────────────────── your move ───────────────────────── */
function MoveCard({ project, data, busy, run, onFunded, onPaid, onError, connectSeller }: {
  project: Project; data: WorkspaceData; busy: boolean; run: Run;
  onFunded: () => void; onPaid: () => void; onError: (m: string) => void; connectSeller: (id: string) => void;
}) {
  const move = nextMove(project, data), p = project, client = p.role === "client", amt = money(p.amount_cents);
  const [url, setUrl] = useState(""), [notes, setNotes] = useState(""), [reason, setReason] = useState(""), [override, setOverride] = useState(false);
  const other = client ? p.freelancer_email : p.client_email;
  const sellerMissing = data.paymentMode === "SELLER" && !p.seller_merchant_id;
  const Icon = move.tone === "done" ? Coins : move.tone === "warn" ? ShieldAlert : move.mine ? ArrowRight : Hourglass;

  let body: React.ReactNode = null;
  if (p.status === "INVITED" && !client) body = <>
    {!p.consent.legacy && <div className="d-fp"><Fingerprint size={16} /><code>{p.consent.fingerprint}</code></div>}
    <button className="d-btn primary wide" disabled={busy || p.consent.tampered} onClick={() => run({ action: "accept", id: p.id, termsHash: p.consent.termsHash }, "You accepted. Both sides are bound to the same terms.")}><Handshake size={16} /> Accept these terms</button>
  </>;
  else if (p.funding.mode === "HOLD" && p.funding.canFund && client && !sellerMissing) body = data.paypalReady && data.paypalClientId
    ? <PayPalCheckout project={p} clientId={data.paypalClientId} merchantId={data.paymentMode === "SELLER" ? p.seller_merchant_id || undefined : undefined} bnCode={data.paypalPartnerBnCode} mode="hold" onPaid={onFunded} onError={onError} />
    : <p className="d-note">PayPal keys aren’t set on this site yet.</p>;
  else if (!client && data.paymentMode === "SELLER" && !p.seller_merchant_id && data.sellerOnboardingReady && !p.paypal_order_id) body =
    <button className="d-btn primary wide" disabled={busy} onClick={() => connectSeller(p.id)}><Wallet size={16} /> Connect PayPal</button>;
  else if (!client && ["AGREED", "REVISION_REQUESTED"].includes(p.status) && (p.funding.mode !== "HOLD" || p.funding.status === "HELD")) body =
    <form className="d-form" onSubmit={e => { e.preventDefault(); run({ action: "submit", id: p.id, url, notes }, "Delivered. The client can now check it."); }}>
      {p.status === "REVISION_REQUESTED" && p.decision_reason && <blockquote className="d-quote"><RotateCcw size={13} /> {p.decision_reason}</blockquote>}
      <label className="d-field"><Globe size={15} /><input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://your-site.com" required aria-label="Live link" /></label>
      <label className="d-field area"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="What changed, how to test" required aria-label="Notes" /></label>
      <button className="d-btn primary wide" disabled={busy}><Send size={15} /> Deliver</button>
    </form>;
  else if (client && p.status === "SUBMITTED") body = <div className="d-row2">
    <button className="d-btn primary" disabled={busy} onClick={() => run({ action: "verify", id: p.id }, "Checks finished.")}>{busy ? "Checking…" : <><SearchCheck size={16} /> Run checks</>}</button>
    <a className="d-btn realm" href={`/app/realm?id=${encodeURIComponent(p.id)}`}><Castle size={16} /> Send inspectors</a>
  </div>;
  else if (client && p.status === "REVIEW") {
    const gate = p.gate, mode = gate?.mode ?? "CONFIRM", min = gate?.minimumReason ?? 5, short = reason.trim().length < min;
    body = <div className="d-decide">
      {gate && <div className={`d-gate g-${mode.toLowerCase()}`}><div className="d-gate-ring" style={{ ["--v" as string]: gate.verified / Math.max(1, gate.total) }}><b>{gate.verified}</b><small>/{gate.total}</small></div>
        <span>{mode === "CLEAR" ? "Everything passed" : mode === "CONFIRM" ? `${gate.unconfirmed.length + gate.advisory.length} to confirm by eye` : `${gate.blocking.length} required failed`}</span></div>}
      <textarea className="d-textarea" value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder={mode === "CLEAR" ? "Note (optional)" : mode === "OVERRIDE" ? "Why approve anyway?" : "How did you check the open items?"} aria-label="Decision note" />
      {mode === "OVERRIDE" && <label className="d-check"><input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} /><span>Override {gate!.blocking.map(b => `#${b.index + 1}`).join(", ")} (recorded on the receipt)</span></label>}
      <button className={`d-btn primary wide ${mode === "OVERRIDE" ? "danger" : ""}`} disabled={busy || (mode === "OVERRIDE" && !override) || (mode !== "CLEAR" && short)} onClick={() => run({ action: "approve", id: p.id, reason, override: mode === "OVERRIDE" && override }, "Approved.")}><Check size={16} /> Approve</button>
      <button className="d-btn ghost wide" disabled={busy || p.revisions.exhausted || reason.trim().length < 5} onClick={() => run({ action: "revise", id: p.id, reason }, "Revision requested.")}><RotateCcw size={14} /> {p.revisions.exhausted ? "No revisions left" : `Ask for revision${p.revisions.remaining !== null ? ` · ${p.revisions.remaining} left` : ""}`}</button>
    </div>;
  }
  else if (client && p.status === "APPROVED" && p.funding.canRelease) body =
    <button className="d-btn gold wide" disabled={busy} onClick={() => run({ action: "release_funds", id: p.id }, `${amt} released through PayPal.`)}><Coins size={16} /> Release {amt}</button>;
  else if (client && p.status === "APPROVED" && p.funding.mode !== "HOLD" && !isPaid(p)) body = data.paypalReady && data.paypalClientId && (data.paymentMode === "MERCHANT" || !!p.seller_merchant_id)
    ? <PayPalCheckout project={p} clientId={data.paypalClientId} merchantId={data.paymentMode === "SELLER" ? p.seller_merchant_id || undefined : undefined} bnCode={data.paypalPartnerBnCode} onPaid={onPaid} onError={onError} />
    : <p className="d-note">{sellerMissing ? "The freelancer needs to connect PayPal first." : "PayPal keys aren’t set on this site yet."}</p>;
  else if (!move.mine && move.tone === "wait") body = <div className="d-waiting"><Avatar email={other} size={26} /><span className="d-dots"><i /><i /><i /></span></div>;

  return <section className={`d-card d-move t-${move.tone} ${move.mine ? "mine" : ""}`} aria-label="Next step">
    <div className="d-move-tag">{move.mine ? "Your move" : move.tone === "done" ? "Complete" : "Up next"}</div>
    <div className="d-move-head"><span className="d-move-ic"><Icon size={18} /></span><div><h2>{move.title}</h2>{move.sub && <p>{move.sub}</p>}</div></div>
    {body}
  </section>;
}

/* ───────────────────────── checklist ───────────────────────── */
function Checklist({ project }: { project: Project }) {
  const findings = project.findings;
  const counts = findings ? { ok: findings.filter(f => f.status === "VERIFIED").length, bad: findings.filter(f => f.status === "FAILED").length } : null;
  return <section className="d-card" aria-label="What done means">
    <header className="d-card-head"><h3><ListChecks size={16} /> What “done” means</h3>
      {counts ? <span className="d-tally"><b className="ok">{counts.ok}</b>/{project.criteria.length} passed{counts.bad ? <> · <b className="bad">{counts.bad}</b> failed</> : null}</span> : <span className="d-lock"><Lock size={12} /> Locked</span>}
    </header>
    <ul className="d-checks">
      {project.criteria.map((c, i) => {
        const f = findings?.[i], st = f?.status?.toLowerCase() ?? "todo", K = KINDS[c.kind] ?? KINDS.manual, KIcon = K.icon;
        const quote = f?.evidenceRefs?.find(r => r.excerpt)?.excerpt;
        return <li key={i} className={`d-check-row s-${st}`}>
          <details>
            <summary>
              <span className="d-check-st" aria-label={f ? f.status.toLowerCase() : "not checked"}>{f?.status === "VERIFIED" ? <Check size={14} strokeWidth={3} /> : f?.status === "FAILED" ? <X size={14} strokeWidth={3} /> : f ? "?" : i + 1}</span>
              <span className="d-check-txt"><strong>{c.label}</strong><small><KIcon size={12} /> {K.label}{c.needle ? <> · <q>{c.needle}</q></> : null}</small></span>
              {c.required === false && <em className="d-opt">Optional</em>}
              {f && <ChevronRight size={15} className="d-chev" />}
            </summary>
            {f && <div className="d-check-more"><p>{f.explanation}</p>{quote && <q>{quote}</q>}{f.confidence && <span className={`d-conf c-${f.confidence.toLowerCase()}`}>{f.confidence.toLowerCase()} confidence</span>}</div>}
          </details>
        </li>;
      })}
    </ul>
  </section>;
}

function Delivery({ project }: { project: Project }) {
  if (!project.evidence_url) return null;
  let host = project.evidence_url;
  try { host = new URL(project.evidence_url).host; } catch { /* keep raw */ }
  return <section className="d-card d-delivery" aria-label="Delivery">
    <header className="d-card-head"><h3><PackageCheck size={16} /> Delivery</h3><span className="d-muted">{ago(project.evidence_at || project.created_at)}</span></header>
    <a className="d-site" href={project.evidence_url} target="_blank" rel="noopener noreferrer">
      <span className="d-site-ic"><Globe size={18} /></span>
      <span><strong>{host}</strong><small>{project.evidence_url}</small></span><ExternalLink size={15} />
    </a>
    {project.evidence_notes && <p className="d-notes">{project.evidence_notes}</p>}
    {project.evidence_hash && <span className="d-hash" title="SHA-256 of the captured delivery"><Fingerprint size={12} /> {project.evidence_hash.slice(0, 12)}</span>}
  </section>;
}

function Revisions({ history, project }: { history: RunSummary[]; project: Project }) {
  if (!history.length) return null;
  return <section className="d-card" aria-label="Check history">
    <header className="d-card-head"><h3><History size={16} /> Check history</h3><span className="d-muted">{project.revisions.max === null ? `${project.revisions.used} revisions` : `${project.revisions.used}/${project.revisions.max} revisions`}</span></header>
    <div className="d-runs">{history.map((r, i) => <div key={r.runId} className="d-run" title={`${r.verified} passed · ${r.failed} failed · ${r.inconclusive} open`}>
      <div className="d-run-bar"><i style={{ height: `${Math.max(6, r.score)}%` }} className={r.score >= 80 ? "ok" : r.score >= 50 ? "mid" : "bad"} /></div>
      <b>{r.score}</b>
      {r.scoreChange !== null && r.scoreChange !== 0 && <span className={r.scoreChange > 0 ? "up" : "down"}>{r.scoreChange > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{Math.abs(r.scoreChange)}</span>}
      <small>#{i + 1}</small>
    </div>)}</div>
  </section>;
}

function Terms({ project }: { project: Project }) {
  const c = project.consent;
  return <section className={`d-card d-terms ${c.tampered ? "bad" : ""}`} aria-label="Terms">
    <header className="d-card-head"><h3><Fingerprint size={16} /> Terms</h3><span className="d-lock"><Lock size={12} /> Locked</span></header>
    {c.legacy ? <p className="d-muted">Created before terms binding.</p> : <>
      <code className="d-fp-code">{c.fingerprint}</code>
      <div className="d-bound"><span className={c.clientBound ? "on" : ""}>{c.clientBound ? <Check size={12} strokeWidth={3} /> : <Clock3 size={12} />} Client</span><span className={c.freelancerBound ? "on" : ""}>{c.freelancerBound ? <Check size={12} strokeWidth={3} /> : <Clock3 size={12} />} Freelancer</span></div>
      {c.tampered && <p className="d-alert">These terms no longer match. Approval and payment are frozen.</p>}
    </>}
    <dl className="d-facts">
      <div><dt>Revisions</dt><dd>{project.revisions.max === null ? "Unlimited" : `${project.revisions.used} of ${project.revisions.max}`}</dd></div>
      <div><dt>Payment</dt><dd>{project.funding.mode === "HOLD" ? "Fund first" : "After approval"}</dd></div>
      <div><dt>Created</dt><dd>{shortDate(project.created_at)}</dd></div>
    </dl>
  </section>;
}

function dayLabel(value: string) {
  const d = new Date(value), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
  return d.toDateString() === today.toDateString() ? "Today" : d.toDateString() === y.toDateString() ? "Yesterday" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function ActivityFeed({ audit }: { audit: Event[] }) {
  if (!audit.length) return <div className="d-empty-sm"><Inbox size={20} /> Nothing yet</div>;
  const days: Array<{ day: string; items: Event[] }> = [];
  for (const e of audit) { const day = dayLabel(e.created_at); if (days[days.length - 1]?.day !== day) days.push({ day, items: [] }); days[days.length - 1].items.push(e); }
  return <div className="d-feed-days">{days.map(g => <section key={g.day}>
    <h4 className="d-feed-day">{g.day}</h4>
    <ol className="d-feed">{g.items.map((e, i) => { const m = EVENT[e.type] ?? { label: e.type.replaceAll("_", " ").toLowerCase(), icon: FileText }; const Icon = m.icon; return <li key={i} className={m.tone ? `t-${m.tone}` : ""}>
      <span className="d-feed-ic"><Icon size={14} /></span>
      <div><strong>{m.label}</strong><p>{e.detail}</p></div>
      <time title={date(e.created_at)}>{new Date(e.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time>
    </li>; })}</ol>
  </section>)}</div>;
}

/* ───────────────────────── views ───────────────────────── */
function AgreementCard({ p, data, onOpen }: { p: Project; data: WorkspaceData; onOpen: () => void }) {
  const move = nextMove(p, data), other = p.role === "client" ? p.freelancer_email : p.client_email;
  return <button className={`d-agree ${move.mine ? "mine" : ""}`} onClick={onOpen}>
    <div className="d-agree-top"><Avatar email={other} size={34} /><div className="d-agree-who"><strong>{p.title}</strong><small>{p.role === "client" ? "to" : "from"} {handle(other)}</small></div><span className="d-agree-amt">{money(p.amount_cents)}</span></div>
    <JourneyBar project={p} compact />
    <div className={`d-agree-move t-${move.tone}`}>{move.mine && <span className="d-pulse" />}<span>{move.title}</span>{isHeld(p) && !isPaid(p) && <em className="d-held"><Lock size={11} /> Held{p.funding.expiresAt ? ` · ${Math.max(0, Math.ceil((new Date(p.funding.expiresAt).getTime() - Date.now()) / 86_400_000))}d` : ""}</em>}<ArrowRight size={15} className="d-agree-go" /></div>
  </button>;
}

function Overview({ data, open, create }: { data: WorkspaceData; open: (id: string) => void; create: () => void }) {
  const t = useMemo(() => {
    const held = data.projects.filter(p => isHeld(p) && !isPaid(p)).reduce((s, p) => s + p.amount_cents, 0);
    const paid = data.projects.filter(isPaid).reduce((s, p) => s + p.amount_cents, 0);
    const mine = data.projects.filter(p => nextMove(p, data).mine);
    return { held, paid, mine };
  }, [data]);
  const [filter, setFilter] = useState<"all" | "mine" | "held" | "paid">("all");
  const [query, setQuery] = useState("");
  const sorted = useMemo(() => [...data.projects].sort((a, b) => Number(nextMove(b, data).mine) - Number(nextMove(a, data).mine)), [data]);
  const shown = sorted.filter(p => (filter === "all" || (filter === "mine" ? nextMove(p, data).mine : filter === "held" ? isHeld(p) && !isPaid(p) : isPaid(p)))
    && (!query.trim() || `${p.title} ${p.client_email} ${p.freelancer_email}`.toLowerCase().includes(query.trim().toLowerCase())));
  const counts = { all: data.projects.length, mine: t.mine.length, held: data.projects.filter(p => isHeld(p) && !isPaid(p)).length, paid: data.projects.filter(isPaid).length };
  const layout = useSyncExternalStore(subscribeView, readView, () => "cards" as const);
  const tableRows = useMemo(() => layout === "table" ? agreementRows(shown, p => nextMove(p as Project, data)) : [], [layout, shown, data]);
  return <div className="d-view">
    <section className="d-hello">
      <Avatar email={data.user.email} name={data.user.name} src={data.user.avatar} size={56} ring />
      <div><h1>Hi, {firstName(data.user.name || data.user.email)}</h1><p>{t.mine.length ? `${t.mine.length} thing${t.mine.length === 1 ? "" : "s"} need${t.mine.length === 1 ? "s" : ""} you` : "You’re all caught up"}</p></div>
      <button className="d-btn primary" onClick={create}><Plus size={16} /> New agreement</button>
    </section>
    <section className="d-tiles" aria-label="Totals">
      <button className={`d-tile pp ${filter === "held" ? "on" : ""}`} onClick={() => setFilter(filter === "held" ? "all" : "held")}><span className="d-tile-ic"><Lock size={18} /></span><small>Held by PayPal</small><strong>{money(t.held)}</strong></button>
      <button className={`d-tile ok ${filter === "paid" ? "on" : ""}`} onClick={() => setFilter(filter === "paid" ? "all" : "paid")}><span className="d-tile-ic"><CircleDollarSign size={18} /></span><small>Paid out</small><strong>{money(t.paid)}</strong></button>
      <button className={`d-tile act ${filter === "mine" ? "on" : ""}`} onClick={() => setFilter(filter === "mine" ? "all" : "mine")}><span className="d-tile-ic"><ArrowRight size={18} /></span><small>Your move</small><strong>{t.mine.length}</strong></button>
    </section>
    {data.projects.length ? <>
      <div className="d-sec"><h2>Agreements</h2>
        <div className="d-filters" role="tablist" aria-label="Filter agreements">{([["all", "All"], ["mine", "Your move"], ["held", "In PayPal"], ["paid", "Paid"]] as const).map(([k, label]) =>
          <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{label}<span>{counts[k]}</span></button>)}</div>
        <label className="d-search"><SearchCheck size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" aria-label="Search agreements" /></label>
        <div className="g-seg g-seg-ic" role="group" aria-label="Show agreements as">
          <button className={layout === "cards" ? "on" : ""} aria-pressed={layout === "cards"} onClick={() => writeView("cards")} title="Cards"><LayoutGrid size={15} /><span>Cards</span></button>
          <button className={layout === "table" ? "on" : ""} aria-pressed={layout === "table"} onClick={() => writeView("table")} title="Table"><Table2 size={15} /><span>Table</span></button>
        </div>
      </div>
      {shown.length ? layout === "table"
        ? <GridBoundary what="agreements table"><Suspense fallback={<GridLoading />}><AgreementsTable rows={tableRows} onOpen={open} /></Suspense></GridBoundary>
        : <div className="d-grid">{shown.map(p => <AgreementCard key={p.id} p={p} data={data} onOpen={() => open(p.id)} />)}</div>
        : <div className="d-empty-sm"><Inbox size={18} /> Nothing here <button className="d-link" onClick={() => { setFilter("all"); setQuery(""); }}>Show all</button></div>}
    </> : <section className="d-empty">
      <div className="d-empty-art" aria-hidden="true"><span><Handshake size={22} /></span><i /><span className="pp"><Lock size={22} /></span><i /><span className="ok"><Coins size={22} /></span></div>
      <h2>Agree. Secure. Get paid.</h2>
      <p>Set what “done” means, PayPal holds the money, and it’s released when the work checks out.</p>
      <button className="d-btn primary" onClick={create}><Plus size={16} /> Create your first agreement</button>
    </section>}
  </div>;
}

function Detail({ project, data, audit, history, detail, busy, run, onFunded, onPaid, onError, connectSeller, back, notify }: {
  project: Project; data: WorkspaceData; audit: Event[]; history: RunSummary[]; detail: DetailData; busy: boolean; run: Run;
  onFunded: () => void; onPaid: () => void; onError: (m: string) => void; connectSeller: (id: string) => void; back: () => void; notify: (m: string) => void;
}) {
  const [tab, setTab] = useState<"work" | "evidence" | "payments" | "activity">("work");
  const failing = project.findings?.filter(f => f.status !== "VERIFIED").length ?? 0;
  const tabs: Array<[typeof tab, string, ReactNode]> = [
    ["work", "Overview", null],
    ["evidence", "Evidence", project.findings ? <span className={failing ? "bad" : ""}>{failing ? failing : project.findings.length}</span> : null],
    ["payments", "Payments", detail.payments?.rows.length ? <span>{detail.payments.rows.length}</span> : null],
    ["activity", "Activity", <span key="n">{audit.length}</span>],
  ];
  const client = project.role === "client";
  const me = data.user;
  const copyLink = async () => {
    const url = `${window.location.origin}/app?project=${encodeURIComponent(project.id)}`;
    try { await navigator.clipboard.writeText(url); notify(client ? "Link copied. Send it to your freelancer." : "Link copied."); } catch { notify(url); }
  };
  /** The whole agreement and its audit trail as one file, for your own records or a dispute. */
  const downloadRecord = () => {
    const record = { exportedAt: new Date().toISOString(), agreement: project, activity: audit, checkHistory: history };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
    a.download = `savepal-${project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${project.id.slice(0, 8)}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  return <div className="d-view">
    <button className="d-back" onClick={back}><ArrowLeft size={15} /> All agreements</button>
    <section className="d-head">
      <div className="d-head-main">
        <h1>{project.title}</h1>
        <div className="d-parties">
          <span className="d-party"><Avatar email={project.client_email} src={client ? me.avatar : null} size={28} /><span><small>Client</small>{client ? "You" : handle(project.client_email)}</span></span>
          <span className="d-flow" aria-hidden="true"><i /><Coins size={14} /><i /></span>
          <span className="d-party"><Avatar email={project.freelancer_email} src={client ? null : me.avatar} size={28} /><span><small>Freelancer</small>{client ? handle(project.freelancer_email) : "You"}</span></span>
        </div>
      </div>
      <div className="d-head-actions">
        <button className="d-icon-btn" onClick={copyLink} title="Copy link to this agreement" aria-label="Copy link"><Link2 size={16} /></button>
        <button className="d-icon-btn" onClick={downloadRecord} title="Download the full record (JSON)" aria-label="Download record"><Download size={16} /></button>
        <a className="d-btn realm" href={`/app/realm?id=${encodeURIComponent(project.id)}`}><Castle size={16} /> Enter the realm <ArrowUpRight size={14} /></a>
      </div>
    </section>
    <div className="d-card d-journey-card"><JourneyBar project={project} /></div>
    <RealmPowers project={project} />
    <div className="d-tabs" role="tablist" aria-label="Agreement sections">{tabs.map(([k, label, badge]) =>
      <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}{badge ? <> {badge}</> : null}</button>)}</div>
    {tab === "evidence" ? <GridBoundary what="evidence table"><Suspense fallback={<GridLoading />}>
      <EvidenceTab project={project} history={history} run={detail.run} submissions={detail.submissions} currentSubmissionId={detail.currentSubmissionId} onOverview={() => setTab("work")} />
    </Suspense></GridBoundary>
    : tab === "payments" ? <GridBoundary what="payments table"><Suspense fallback={<GridLoading />}><PaymentsTab ledger={detail.payments} audit={audit} /></Suspense></GridBoundary>
    : tab === "work" ? <div className="d-cols">
      <div className="d-col-side">
        <MoveCard key={`${project.id}-${project.status}-${project.funding.status}`} project={project} data={data} busy={busy} run={run} onFunded={onFunded} onPaid={onPaid} onError={onError} connectSeller={connectSeller} />
        <MoneyCard project={project} data={data} audit={audit} busy={busy} run={run} />
      </div>
      <div className="d-col-main">
        {project.description && <p className="d-scope">{project.description}</p>}
        <Checklist project={project} />
        <Delivery project={project} />
        <Revisions history={history} project={project} />
        <Terms project={project} />
      </div>
    </div> : <section className="d-card"><ActivityFeed audit={audit} /></section>}
  </div>;
}

function Create({ data, busy, run, cancel }: { data: WorkspaceData; busy: boolean; run: Run; cancel: () => void }) {
  const [title, setTitle] = useState("Online store");
  const [description, setDescription] = useState("A responsive store with a product catalog and a working cart.");
  const [freelancerEmail, setFreelancerEmail] = useState("");
  const [amount, setAmount] = useState("1000");
  const [criteria, setCriteria] = useState<Criterion[]>(TEMPLATES.slice(0, 4));
  const [maxRevisions, setMaxRevisions] = useState("2");
  const [fundingMode, setFundingMode] = useState<"HOLD" | "CAPTURE">("HOLD");
  const mode = data.paypalReady ? fundingMode : "CAPTURE";
  const update = (i: number, patch: Partial<Criterion>) => setCriteria(criteria.map((x, j) => j === i ? { ...x, ...patch } : x));
  return <div className="d-view d-create">
    <button className="d-back" type="button" onClick={cancel}><ArrowLeft size={15} /> Back</button>
    <h1>New agreement</h1>
    <form onSubmit={e => { e.preventDefault(); run({ action: "create", title, description, freelancerEmail, amount, criteria: criteria.map(c => KINDS[c.kind].needle ? c : { ...c, needle: undefined }), maxRevisions, fundingMode: mode }, "Agreement created. Share the link with your freelancer."); }}>
      <section className="d-card d-step"><span className="d-step-n">1</span><div className="d-step-body"><h3>The work</h3>
        <div className="d-fields">
          <label className="d-lab"><span>Title</span><input value={title} onChange={e => setTitle(e.target.value)} required maxLength={120} /></label>
          <label className="d-lab"><span>Freelancer’s email</span><input type="email" value={freelancerEmail} onChange={e => setFreelancerEmail(e.target.value)} placeholder="name@example.com" required /></label>
          <label className="d-lab full"><span>Scope</span><textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} required maxLength={2000} /></label>
        </div>
      </div></section>

      <section className="d-card d-step"><span className="d-step-n">2</span><div className="d-step-body"><h3>The money</h3>
        <div className="d-fields">
          <label className="d-lab"><span>Amount</span><div className="d-amount-in"><b>$</b><input type="number" min="1" max="1000000" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required /><em>USD</em></div></label>
          <label className="d-lab"><span>Revision rounds</span><select value={maxRevisions} onChange={e => setMaxRevisions(e.target.value)}>{["0", "1", "2", "3", "5"].map(n => <option key={n} value={n}>{n === "0" ? "None" : n}</option>)}<option value="">Unlimited</option></select></label>
        </div>
        <div className="d-choice" role="radiogroup" aria-label="How it’s paid">
          {([["HOLD", Lock, "Fund first", "PayPal holds it until you approve"], ["CAPTURE", CreditCard, "Pay on approval", "Pay with PayPal at the end"]] as const).map(([value, Ic, name, sub]) => {
            const disabled = value === "HOLD" && !data.paypalReady;
            return <button type="button" role="radio" aria-checked={mode === value} key={value} disabled={disabled} className={`d-opt-card ${mode === value ? "on" : ""}`} onClick={() => setFundingMode(value)}>
              <span className="d-opt-ic"><Ic size={18} /></span><b>{name}{value === "HOLD" && <em>Best</em>}</b><small>{disabled ? "Needs PayPal keys" : sub}</small>
            </button>;
          })}
        </div>
      </div></section>

      <section className="d-card d-step"><span className="d-step-n">3</span><div className="d-step-body"><h3>What “done” means</h3>
        <ul className="d-crit">{criteria.map((c, i) => { const K = KINDS[c.kind], KI = K.icon; return <li key={i}>
          <span className="d-crit-ic"><KI size={15} /></span>
          <div className="d-crit-f">
            <input aria-label={`Requirement ${i + 1}`} value={c.label} onChange={e => update(i, { label: e.target.value })} placeholder="What must be true?" required minLength={3} maxLength={240} />
            <div className="d-crit-o">
              <select aria-label={`Check type ${i + 1}`} value={c.kind} onChange={e => update(i, { kind: e.target.value as Kind })}>{(Object.keys(KINDS) as Kind[]).map(k => <option key={k} value={k}>{KINDS[k].label}</option>)}</select>
              {K.needle && <input aria-label={K.needle.label} value={c.needle || ""} onChange={e => update(i, { needle: e.target.value })} placeholder={K.needle.placeholder} required maxLength={c.kind === "path" ? 200 : 100} />}
              <button type="button" role="switch" aria-checked={c.required !== false} className={`d-req ${c.required === false ? "" : "on"}`} onClick={() => update(i, { required: c.required === false })}><i />{c.required === false ? "Optional" : "Required"}</button>
            </div>
          </div>
          <button type="button" className="d-x" disabled={criteria.length === 1} onClick={() => setCriteria(criteria.filter((_, j) => j !== i))} aria-label="Remove"><X size={15} /></button>
        </li>; })}</ul>
        {criteria.length < 8 && <div className="d-chips" aria-label="Add a requirement">
          {TEMPLATES.filter(t => !criteria.some(c => c.label === t.label)).slice(0, 4).map(t => { const TI = KINDS[t.kind].icon; return <button type="button" key={t.label} className="d-chip" onClick={() => setCriteria([...criteria, t])}><Plus size={12} /><TI size={12} /> {t.label}</button>; })}
          <button type="button" className="d-chip" onClick={() => setCriteria([...criteria, { label: "", kind: "manual", required: true }])}><Plus size={12} /> Custom</button>
        </div>}
      </div></section>

      <div className="d-create-go"><span><Lock size={14} /> Terms lock when created</span><button className="d-btn primary" disabled={busy}>{busy ? "Creating…" : <>Create agreement <ArrowRight size={16} /></>}</button></div>
    </form>
  </div>;
}

/* ───────────────────────── shell ───────────────────────── */
export default function Workspace() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [audit, setAudit] = useState<Event[]>([]);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [detail, setDetail] = useState<DetailData>(NO_DETAIL);
  const [creating, setCreating] = useState(false);
  const [nav, setNav] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { const id = new URLSearchParams(window.location.search).get("project"); if (id) setSelected(id); }, []);
  const refresh = useCallback(async (chosen?: string | null) => {
    const res = await fetch("/api/workspace", { cache: "no-store" });
    if (!res.ok) throw new Error("Your workspace could not load");
    setData(await res.json() as WorkspaceData);
    const id = chosen === undefined ? selected : chosen;
    if (id) {
      const detail = await fetch(`/api/workspace?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (detail.ok) {
        const body = await detail.json() as { audit: Event[]; revisionHistory?: RunSummary[]; verificationRun?: RunRecord | null; evidenceHistory?: Submission[]; payments?: Ledger; currentSubmissionId?: string | null };
        setAudit(body.audit); setHistory(body.revisionHistory || []);
        setDetail({ run: body.verificationRun ?? null, submissions: body.evidenceHistory ?? [], payments: body.payments ?? null, currentSubmissionId: body.currentSubmissionId ?? null });
      }
    }
  }, [selected]);
  useEffect(() => { refresh().catch(e => setError(e.message)); }, [refresh]);
  const project = data?.projects.find(p => p.id === selected) || null;
  const moneyMoving = !!project && project.funding.mode === "HOLD" && !isPaid(project) && ["ORDER_CREATED", "PENDING", "HELD", "VOIDING"].includes(project.funding.status);
  useEffect(() => {
    if (!moneyMoving || !selected) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(selected).catch(() => {}); }, 15_000);
    return () => window.clearInterval(timer);
  }, [moneyMoving, selected, refresh]);
  useEffect(() => { if (!notice) return; const t = window.setTimeout(() => setNotice(""), 5000); return () => window.clearTimeout(t); }, [notice]);

  const setUrl = (id: string | null) => { const u = new URL(window.location.href); if (id) u.searchParams.set("project", id); else u.searchParams.delete("project"); window.history.replaceState(null, "", u); };
  const open = (id: string) => { setSelected(id); setCreating(false); setError(""); setNotice(""); setHistory([]); setAudit([]); setDetail(NO_DETAIL); setNav(false); setUrl(id); refresh(id).catch(e => setError(e.message)); window.scrollTo({ top: 0 }); };
  const home = () => { setSelected(null); setCreating(false); setNav(false); setUrl(null); };
  const create = () => { setCreating(true); setSelected(null); setNav(false); setUrl(null); };
  const run: Run = async (payload, success) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api(payload);
      await refresh(result.id || selected);
      if (result.id) { setSelected(result.id); setCreating(false); setUrl(result.id); }
      setNotice(success);
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(false); }
  };
  const connectSeller = async (id: string) => {
    setBusy(true); setError("");
    try {
      const result = await api({ action: "begin_seller_onboarding", id });
      if (result.connected) { await refresh(id); setNotice("PayPal connected."); setBusy(false); return; }
      if (!result.actionUrl) throw new Error("PayPal did not return an onboarding link");
      window.location.assign(result.actionUrl);
    } catch (e) { setError(e instanceof Error ? e.message : "PayPal connection failed"); setBusy(false); }
  };
  const onPaid = useCallback(() => { setNotice("PayPal confirmed the payment."); refresh().catch(e => setError(e.message)); }, [refresh]);
  const onFunded = useCallback(() => { setNotice("Secured. PayPal is holding the money until you approve."); refresh().catch(e => setError(e.message)); }, [refresh]);
  const onError = useCallback((message: string) => setError(message), []);
  const mineCount = data ? data.projects.filter(p => nextMove(p, data).mine).length : 0;

  return <div className="d-shell">
    <aside className={`d-side ${nav ? "open" : ""}`}>
      <div className="d-side-top"><Link href="/" className="d-logo">savepal</Link><button className="d-icon d-side-x" onClick={() => setNav(false)} aria-label="Close menu"><X size={18} /></button></div>
      <button className={`d-nav ${!selected && !creating ? "on" : ""}`} onClick={home}><Inbox size={17} /> Home {mineCount > 0 && <span className="d-badge">{mineCount}</span>}</button>
      <button className="d-new" onClick={create}><Plus size={16} /> New agreement</button>
      <div className="d-side-label">Agreements</div>
      <div className="d-side-list">{data?.projects.map(p => { const m = nextMove(p, data); return <button key={p.id} className={`d-side-item ${selected === p.id ? "on" : ""}`} onClick={() => open(p.id)}>
        <span className={`d-side-dot t-${m.tone} ${m.mine ? "mine" : ""}`} /><span className="d-side-t">{p.title}</span><small>{money(p.amount_cents)}</small>
      </button>; })}</div>
      <div className="d-me">
        {data ? <Avatar email={data.user.email} name={data.user.name} src={data.user.avatar} size={36} /> : <span className="d-ava sk" style={{ width: 36, height: 36 }} />}
        <div><strong>{data?.user.name?.split("@")[0] || "…"}</strong><small>{data?.user.email}</small></div>
        <form method="post" action="/signout"><button className="d-icon" aria-label="Sign out" title="Sign out"><LogOut size={16} /></button></form>
      </div>
    </aside>
    {nav && <div className="d-scrim" onClick={() => setNav(false)} />}
    <main className="d-main">
      <header className="d-top">
        <button className="d-icon d-burger" onClick={() => setNav(true)} aria-label="Open menu"><Menu size={20} /></button>
        <Link href="/" className="d-logo d-logo-top">savepal</Link>
        <div className="d-top-r">
          <button className="d-icon" onClick={() => refresh().catch(e => setError(e.message))} aria-label="Refresh"><RefreshCw size={16} /></button>
          {data && <Avatar email={data.user.email} name={data.user.name} src={data.user.avatar} size={32} />}
        </div>
      </header>
      <div className="d-content">
        {error && <div className="d-toast bad" role="alert"><ShieldAlert size={16} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button></div>}
        {notice && <div className="d-toast ok" role="status"><span className="d-live-dot" /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
        {!data && !error && <div className="d-skel"><span /><span /><span /></div>}
        {data && creating && <Create data={data} busy={busy} run={run} cancel={home} />}
        {data && !creating && project && <Detail key={project.id} project={project} data={data} audit={audit} history={history} detail={detail} busy={busy} run={run} onFunded={onFunded} onPaid={onPaid} onError={onError} connectSeller={connectSeller} back={home} notify={setNotice} />}
        {data && !creating && !project && <Overview data={data} open={open} create={create} />}
      </div>
    </main>
  </div>;
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ─────────────────────────────────────────────────────────────────────────────
 * The Realm: an agreement rendered as a small isometric kingdom.
 * Everything on screen comes from real data:
 *   castle = client · treasury = the PayPal hold · guild hall = freelancer
 *   town houses = pages of the delivered website (from the evidence snapshot)
 *   inspectors = the Groq crew, walking to whichever page it is reading
 *   coin cart = where the money is · royal seal = the client's approval
 * ──────────────────────────────────────────────────────────────────────────── */

type Verdict = "VERIFIED" | "FAILED" | "INCONCLUSIVE";
type Criterion = { label: string; kind: string; needle?: string; required?: boolean };
type Finding = { status: Verdict };
type Project = {
  id: string; role: "client" | "freelancer"; title: string; client_email: string; freelancer_email: string;
  amount_cents: number; status: string; payment_status: string; evidence_url: string | null;
  criteria: Criterion[]; findings: Finding[] | null;
  funding: { mode: string; status: string; expiresAt: string | null };
};
type ManifestPage = { url: string; status: number; title: string | null; bytes: number };
type CrewEvent = { id: number; kind: string; page_url: string | null; criterion_index: number | null; verdict: Verdict | null; text: string; created_at: string };
type CrewRun = { id: string; status: string; steps: number; pages_read: number; current: boolean; report: { summary: string | null; findings: Array<{ index: number; verdict: Verdict; explanation: string; path: string | null }> } | null };

const TW = 76, TH = 38, GRID = 16;
const PAID = ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"];
const iso = (gx: number, gy: number, z = 0) => ({ x: (gx - gy) * TW / 2, y: (gx + gy) * TH / 2 - z });
const pts = (list: Array<{ x: number; y: number }>) => list.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const initials = (v: string) => v.split(/[\s@.]+/).slice(0, 2).map(x => x[0]?.toUpperCase()).join("");
const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

async function api(payload: Record<string, unknown>) {
  const res = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json() as Record<string, unknown> & { error?: string };
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/* ── drawing primitives ── */

type Palette = { top: string; left: string; right: string; stroke?: string };
/** An isometric box on footprint (gx, gy, w, d), raised from z0 to z0 + h. */
function Box({ gx, gy, w, d, h, z0 = 0, c }: { gx: number; gy: number; w: number; d: number; h: number; z0?: number; c: Palette }) {
  const t = (x: number, y: number, z: number) => iso(x, y, z0 + z);
  return <g>
    <polygon points={pts([t(gx, gy + d, h), t(gx + w, gy + d, h), t(gx + w, gy + d, 0), t(gx, gy + d, 0)])} fill={c.left} stroke={c.stroke} strokeWidth={c.stroke ? .8 : 0} />
    <polygon points={pts([t(gx + w, gy, h), t(gx + w, gy + d, h), t(gx + w, gy + d, 0), t(gx + w, gy, 0)])} fill={c.right} stroke={c.stroke} strokeWidth={c.stroke ? .8 : 0} />
    <polygon points={pts([t(gx, gy, h), t(gx + w, gy, h), t(gx + w, gy + d, h), t(gx, gy + d, h)])} fill={c.top} stroke={c.stroke} strokeWidth={c.stroke ? .8 : 0} />
  </g>;
}
/** A gable roof whose ridge runs along x. */
function Gable({ gx, gy, w, d, z, rise, c }: { gx: number; gy: number; w: number; d: number; z: number; rise: number; c: Palette }) {
  const a = iso(gx, gy + d / 2, z + rise), b = iso(gx + w, gy + d / 2, z + rise);
  return <g>
    <polygon points={pts([iso(gx, gy + d, z), iso(gx + w, gy + d, z), b, a])} fill={c.left} />
    <polygon points={pts([iso(gx + w, gy, z), iso(gx + w, gy + d, z), b])} fill={c.right} />
    <polygon points={pts([iso(gx, gy, z), iso(gx + w, gy, z), b, a])} fill={c.top} />
  </g>;
}
/** A four-sided pyramid (tower caps, treasury dome stand-in). */
function Pyramid({ gx, gy, w, d, z, rise, c }: { gx: number; gy: number; w: number; d: number; z: number; rise: number; c: Palette }) {
  const apex = iso(gx + w / 2, gy + d / 2, z + rise);
  return <g>
    <polygon points={pts([iso(gx, gy + d, z), iso(gx + w, gy + d, z), apex])} fill={c.left} />
    <polygon points={pts([iso(gx + w, gy, z), iso(gx + w, gy + d, z), apex])} fill={c.right} />
  </g>;
}
function Flag({ at, color, label }: { at: { x: number; y: number }; color: string; label?: string }) {
  return <g transform={`translate(${at.x} ${at.y})`}>
    <line x1="0" y1="0" x2="0" y2="-34" className="r-pole" />
    <g className="r-flag"><path d="M0 -34 L22 -29 L0 -23 Z" fill={color} />{label && <text x="7" y="-26.5" className="r-flag-t">{label}</text>}</g>
  </g>;
}

/* ── the structures ── */

function Castle({ who }: { who: string }) {
  const stone: Palette = { top: "#dfe3ea", left: "#b8c0cd", right: "#9aa5b6" };
  const cap: Palette = { top: "#3b6fd4", left: "#2f5fbe", right: "#234a99" };
  const g = 1.6, s = 7.2;
  return <g>
    <Box gx={g} gy={s} w={2.4} d={2.4} h={54} c={stone} />
    {[[g - .25, s - .25], [g + 1.85, s - .25], [g - .25, s + 1.85], [g + 1.85, s + 1.85]].map(([x, y], i) => <g key={i}>
      <Box gx={x} gy={y} w={.8} d={.8} h={78} c={stone} /><Pyramid gx={x} gy={y} w={.8} d={.8} z={78} rise={34} c={cap} />
    </g>)}
    <polygon points={pts([iso(g + .9, s + 2.4, 0), iso(g + 1.5, s + 2.4, 0), iso(g + 1.5, s + 2.4, 24), iso(g + .9, s + 2.4, 24)])} fill="#5b4632" />
    <Flag at={iso(g + 1.2, s + 1.2, 54)} color="#2f6fdc" label={who} />
  </g>;
}

function Treasury({ held, approved, days }: { held: boolean; approved: boolean; days: number | null }) {
  const base: Palette = { top: "#f2ede3", left: "#d9d0bf", right: "#c4b9a4" };
  const col: Palette = { top: "#fbf8f1", left: "#e8e1d2", right: "#d3c9b5" };
  const roof: Palette = { top: "#173f8f", left: "#0f2f6e", right: "#0a2358" };
  const gx = 6.6, gy = 6.8;
  return <g className={`r-treasury ${held ? "held" : ""}`}>
    {held && <ellipse cx={iso(gx + 1.6, gy + 1.6).x} cy={iso(gx + 1.6, gy + 1.6).y} rx="120" ry="58" className="r-aura" />}
    <Box gx={gx - .3} gy={gy - .3} w={3.8} d={3.8} h={10} c={base} />
    <Box gx={gx} gy={gy} w={3.2} d={3.2} h={8} z0={10} c={base} />
    {[0, 1, 2, 3].map(i => <Box key={`f${i}`} gx={gx + .2 + i * .82} gy={gy + 2.75} w={.32} d={.32} h={48} z0={18} c={col} />)}
    {[0, 1, 2].map(i => <Box key={`s${i}`} gx={gx + 2.75} gy={gy + .2 + i * .82} w={.32} d={.32} h={48} z0={18} c={col} />)}
    <Box gx={gx} gy={gy} w={3.2} d={3.2} h={9} z0={66} c={{ top: "#e9e2d3", left: "#cfc5b1", right: "#b9ad96" }} />
    <Gable gx={gx} gy={gy} w={3.2} d={3.2} z={75} rise={30} c={roof} />
    <g transform={`translate(${iso(gx + 1.6, gy + 3.2, 52).x} ${iso(gx + 1.6, gy + 3.2, 52).y})`}><rect x="-30" y="-9" width="60" height="16" rx="3" className="r-plaque" /><text y="3" className="r-plaque-t">TREASURY</text></g>
    {held && [0, 1, 2].map(i => { const p = iso(gx + 1 + i * .6, gy + 2.2, 18); return <g key={i} className="r-chest" style={{ animationDelay: `${i * 120}ms` }} transform={`translate(${p.x} ${p.y})`}>
      <rect x="-11" y="-12" width="22" height="13" rx="2" fill="#8a5a2b" /><rect x="-11" y="-16" width="22" height="6" rx="3" fill="#a56d35" /><rect x="-2" y="-12" width="4" height="5" fill="#ffd15c" />
      <circle cx="-5" cy="-18" r="3" fill="#ffd15c" /><circle cx="3" cy="-19" r="3" fill="#ffc439" />
    </g>; })}
    {held && <Guard at={iso(gx + .6, gy + 3.7)} />}
    {held && <Guard at={iso(gx + 2.8, gy + 3.7)} flip />}
    {held && days !== null && <g transform={`translate(${iso(gx + 1.6, gy + 1.6, 140).x} ${iso(gx + 1.6, gy + 1.6, 140).y})`}><rect x="-44" y="-14" width="88" height="24" rx="12" className="r-days" /><text y="3" className="r-days-t">{days} days held</text></g>}
    {approved && <g className="r-seal" transform={`translate(${iso(gx + 1.6, gy + 1.6, 105).x} ${iso(gx + 1.6, gy + 1.6, 105).y})`}>
      <circle r="27" fill="#b3261e" /><circle r="21" fill="none" stroke="#e8766d" strokeWidth="2" strokeDasharray="3 3" />
      <path d="M0 -11 L3.2 -3.4 L11 -3.4 L4.8 1.6 L7 9.4 L0 4.8 L-7 9.4 L-4.8 1.6 L-11 -3.4 L-3.2 -3.4 Z" fill="#ffe1dc" />
    </g>}
  </g>;
}

function GuildHall({ who }: { who: string }) {
  const wood: Palette = { top: "#efe2cf", left: "#d7b98f", right: "#bf9c6d" };
  const roof: Palette = { top: "#b5523b", left: "#97402d", right: "#7d3324" };
  const gx = 12, gy = 7.2;
  return <g>
    <Box gx={gx} gy={gy} w={2.6} d={2.2} h={46} c={wood} />
    <Gable gx={gx} gy={gy} w={2.6} d={2.2} z={46} rise={34} c={roof} />
    <Box gx={gx + 2} gy={gy + .3} w={.4} d={.4} h={40} z0={46} c={{ top: "#9a8a7a", left: "#7d6e60", right: "#665a4e" }} />
    <g className="r-smoke" transform={`translate(${iso(gx + 2.2, gy + .5, 92).x} ${iso(gx + 2.2, gy + .5, 92).y})`}><circle r="6" /><circle r="8" cx="8" cy="-12" /><circle r="5" cx="3" cy="-24" /></g>
    {[0.5, 1.5].map(x => <polygon key={x} points={pts([iso(gx + x, gy + 2.2, 32), iso(gx + x + .5, gy + 2.2, 32), iso(gx + x + .5, gy + 2.2, 20), iso(gx + x, gy + 2.2, 20)])} fill="#ffe7a8" />)}
    <Flag at={iso(gx + .3, gy + .3, 46)} color="#1f9e62" label={who} />
  </g>;
}

const HOUSE_COLORS: Palette[] = [
  { top: "#f4efe6", left: "#e2d6c0", right: "#cdbd9f" }, { top: "#eef3f8", left: "#d3deea", right: "#b9c8da" },
  { top: "#f5ece9", left: "#e6d2cb", right: "#d1b6ad" }, { top: "#eef4ec", left: "#d4e1cf", right: "#bccdb5" },
];
const ROOFS: Palette[] = [
  { top: "#d1683f", left: "#b55734", right: "#97462a" }, { top: "#4e78c4", left: "#3f66ad", right: "#33548f" },
  { top: "#7a5aa8", left: "#664a8f", right: "#523b74" }, { top: "#3f8f6e", left: "#357a5d", right: "#2a624b" },
];
type House = { path: string; gx: number; gy: number; size: number; title: string | null; status: number };

function TownHouse({ house, i, verdict, inspected, active, onPick }: { house: House; i: number; verdict: Verdict | null; inspected: boolean; active: boolean; onPick: (h: House) => void }) {
  const h = 26 + house.size * 26, w = .9 + house.size * .5;
  const top = iso(house.gx + w / 2, house.gy + w / 2, h + 26);
  return <g className={`r-house ${active ? "active" : ""} ${inspected ? "seen" : ""}`} onClick={() => onPick(house)} role="button" aria-label={`${house.path}${house.title ? `, ${house.title}` : ""}`}>
    <Box gx={house.gx} gy={house.gy} w={w} d={w} h={h} c={HOUSE_COLORS[i % 4]} />
    <Pyramid gx={house.gx - .08} gy={house.gy - .08} w={w + .16} d={w + .16} z={h} rise={26} c={ROOFS[i % 4]} />
    <polygon points={pts([iso(house.gx + w * .35, house.gy + w, h * .55), iso(house.gx + w * .65, house.gy + w, h * .55), iso(house.gx + w * .65, house.gy + w, h * .55 - 10), iso(house.gx + w * .35, house.gy + w, h * .55 - 10)])} fill={inspected ? "#ffe7a8" : "#b8c4d6"} />
    {verdict && <Flag at={top} color={verdict === "VERIFIED" ? "#1f9e62" : verdict === "FAILED" ? "#d14343" : "#e0a400"} />}
    <g transform={`translate(${iso(house.gx + w / 2, house.gy + w, 0).x} ${iso(house.gx + w / 2, house.gy + w, 0).y + 16})`}><rect x={-Math.min(64, house.path.length * 3.6 + 12)} y="-9" width={Math.min(128, house.path.length * 7.2 + 24)} height="17" rx="8.5" className="r-sign" /><text y="3" className="r-sign-t">{house.path.length > 16 ? `${house.path.slice(0, 15)}…` : house.path}</text></g>
  </g>;
}

function Guard({ at, flip }: { at: { x: number; y: number }; flip?: boolean }) {
  return <g transform={`translate(${at.x} ${at.y}) scale(${flip ? -1 : 1} 1)`} className="r-guard">
    <ellipse cy="1" rx="8" ry="3" className="r-shadow" /><rect x="-5" y="-20" width="10" height="16" rx="3" fill="#123a8c" /><circle cy="-25" r="5" fill="#f1c9a5" />
    <path d="M-5.5 -27 Q0 -35 5.5 -27 Z" fill="#c9d3e3" /><line x1="8" y1="-30" x2="8" y2="0" stroke="#8a6a44" strokeWidth="1.6" /><path d="M6 -33 L8 -38 L10 -33 Z" fill="#c9d3e3" />
  </g>;
}

function Inspector({ at, hue, delay, busy }: { at: { x: number; y: number }; hue: string; delay: number; busy: boolean }) {
  return <g className={`r-inspector ${busy ? "busy" : ""}`} style={{ transform: `translate(${at.x}px, ${at.y}px)`, transitionDelay: `${delay}ms` }}>
    <g className="r-bob" style={{ animationDelay: `${delay}ms` }}>
      <ellipse cy="1" rx="9" ry="3.5" className="r-shadow" />
      <path d="M-6 -2 L-5 -18 Q0 -21 5 -18 L6 -2 Z" fill={hue} />
      <circle cy="-23" r="5.2" fill="#f1c9a5" />
      <path d="M-6.5 -24 Q0 -33 6.5 -24 Z" fill="#2a2f3a" /><path d="M2 -31 Q9 -38 7 -27" fill="none" stroke="#ffc439" strokeWidth="2" strokeLinecap="round" />
      <g className="r-scroll"><rect x="5" y="-16" width="9" height="11" rx="1.5" fill="#fff6dd" stroke="#d9c79a" strokeWidth=".8" /><line x1="7" y1="-12.5" x2="12" y2="-12.5" stroke="#c9b37c" strokeWidth=".8" /><line x1="7" y1="-9.5" x2="11" y2="-9.5" stroke="#c9b37c" strokeWidth=".8" /></g>
    </g>
  </g>;
}

function CoinCart({ at }: { at: { x: number; y: number } }) {
  return <g className="r-cart" style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
    <ellipse cy="2" rx="18" ry="5" className="r-shadow" />
    <path d="M-15 -14 L15 -14 L12 -2 L-12 -2 Z" fill="#8a5a2b" /><path d="M-15 -14 L15 -14" stroke="#5d3c1c" strokeWidth="2" />
    {[[-8, -17], [-1, -19], [6, -17], [-4, -22], [3, -23]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4.2" fill={i % 2 ? "#ffd15c" : "#ffc439"} stroke="#d79a0b" strokeWidth=".8" />)}
    <circle cx="-9" cy="0" r="4" fill="#3b2a1a" /><circle cx="9" cy="0" r="4" fill="#3b2a1a" />
  </g>;
}

/* ── the world ── */

function World({ project, houses, findingsByPath, visited, activePath, crewBusy, onPick }: {
  project: Project; houses: House[]; findingsByPath: Record<string, Verdict>; visited: Set<string>; activePath: string | null; crewBusy: boolean; onPick: (h: House) => void;
}) {
  const roads = useMemo(() => {
    const set = new Set<string>();
    for (let x = 3; x <= 13; x++) set.add(`${x},8`);
    for (let y = 9; y <= 11; y++) set.add(`8,${y}`);
    for (let x = 2; x <= 14; x++) set.add(`${x},11`);
    return set;
  }, []);
  const held = project.funding.status === "HELD" || project.funding.status === "PENDING";
  const paid = project.funding.status === "CAPTURED" || PAID.includes(project.payment_status);
  const approved = project.status === "APPROVED" || paid;
  const cartAt = paid ? iso(11.4, 8.5) : held ? iso(8.2, 9.6) : iso(4.6, 8.5);
  const days = project.funding.expiresAt ? Math.max(0, Math.ceil((new Date(project.funding.expiresAt).getTime() - Date.now()) / 86_400_000)) : null;
  const target = activePath ? houses.find(h => h.path === activePath) : null;
  const crewBase = target ? iso(target.gx + .6, target.gy - .5) : iso(8.6, 10.6);
  const party = [{ dx: -14, dy: 4, hue: "#2f5fbe" }, { dx: 12, dy: 6, hue: "#7a5aa8" }, { dx: -2, dy: 14, hue: "#1f9e62" }];

  // Island tiles, back to front.
  const tiles: React.ReactNode[] = [];
  for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
    const road = roads.has(`${gx},${gy}`);
    const shade = (gx * 7 + gy * 13) % 5;
    const fill = road ? (shade % 2 ? "#e7d9b8" : "#e2d2ae") : ["#a9d28a", "#a2cd83", "#accf8e", "#9fc97f", "#a6d088"][shade];
    tiles.push(<polygon key={`t${gx}-${gy}`} points={pts([iso(gx, gy), iso(gx + 1, gy), iso(gx + 1, gy + 1), iso(gx, gy + 1)])} fill={fill} stroke={road ? "#d8c79f" : "#97c179"} strokeWidth=".6" />);
  }
  const trees = [[1, 2], [3, 1], [5, 2.4], [12.6, 2], [14.2, 3.4], [1, 13.6], [14, 13.4], [10.5, 2.6], [0.8, 5], [14.6, 9.6], [6.2, 14.2], [11.2, 14.3]];

  const sorted = [...houses].sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy));
  return <g>
    <polygon points={pts([iso(0, GRID), iso(GRID, GRID), iso(GRID, GRID, -46), iso(0, GRID, -46)])} fill="#8b6b4a" />
    <polygon points={pts([iso(GRID, 0), iso(GRID, GRID), iso(GRID, GRID, -46), iso(GRID, 0, -46)])} fill="#735738" />
    <polygon points={pts([iso(0, GRID, -46), iso(GRID, GRID, -46), iso(GRID, GRID, -60), iso(0, GRID, -60)])} fill="#6b7a8c" opacity=".35" />
    {tiles}
    {trees.map(([x, y], i) => { const p = iso(x, y); return <g key={i} transform={`translate(${p.x} ${p.y})`} className="r-tree"><ellipse rx="12" ry="5" className="r-shadow" /><rect x="-2" y="-14" width="4" height="14" fill="#7a5532" /><circle cy="-22" r="13" fill={i % 2 ? "#5c9e55" : "#4f9150"} /><circle cx="-5" cy="-26" r="6" fill="#74b56a" opacity=".7" /></g>; })}
    <Castle who={initials(project.client_email)} />
    <Treasury held={held} approved={approved} days={held ? days : null} />
    <GuildHall who={initials(project.freelancer_email)} />
    {sorted.map(h => <TownHouse key={h.path} house={h} i={houses.indexOf(h)} verdict={findingsByPath[h.path] ?? null} inspected={visited.has(h.path)} active={activePath === h.path} onPick={onPick} />)}
    <CoinCart at={cartAt} />
    {(crewBusy || visited.size > 0) && party.map((m, i) => <Inspector key={i} at={{ x: crewBase.x + m.dx, y: crewBase.y + m.dy }} hue={m.hue} delay={i * 140} busy={crewBusy} />)}
  </g>;
}

/* ── page ── */

const kindIcon: Record<string, string> = { VISIT: "🏠", FINDING: "📜", THINK: "💭", NOTE: "🪶", DONE: "👑", ERROR: "⚠️" };

export default function Realm({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [pages, setPages] = useState<ManifestPage[]>([]);
  const [crewReady, setCrewReady] = useState(false);
  const [run, setRun] = useState<CrewRun | null>(null);
  const [events, setEvents] = useState<CrewEvent[]>([]);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<House | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const cursor = useRef(0);
  const driving = useRef(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

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
    if (body.events.length) {
      cursor.current = body.events[body.events.length - 1].id;
      setEvents(prev => [...prev, ...body.events].slice(-120));
    }
    return body.run;
  }, [id]);

  useEffect(() => { loadProject().catch(e => setError(e.message)); loadCrew().catch(() => {}); }, [loadProject, loadCrew]);

  /** Drives the crew one step at a time so the world can react to each move. */
  const drive = useCallback(async (runId: string) => {
    if (driving.current) return;
    driving.current = true;
    try {
      for (let guard = 0; guard < 40; guard++) {
        const step = await api({ action: "crew_step", id, runId }) as { done?: boolean; busy?: boolean; retryAfterMs?: number };
        await loadCrew();
        if (step.done) break;
        await new Promise(r => setTimeout(r, step.retryAfterMs ?? (step.busy ? 1500 : 700)));
      }
    } catch (e) { setError(e instanceof Error ? e.message : "The inspection stopped"); }
    finally { driving.current = false; await loadCrew(); loadProject().catch(() => {}); }
  }, [id, loadCrew, loadProject]);

  useEffect(() => { if (run?.status === "RUNNING") drive(run.id); }, [run?.id, run?.status, drive]);
  // Keep the treasury live while money is moving.
  useEffect(() => {
    if (!project || !["ORDER_CREATED", "PENDING", "HELD"].includes(project.funding.status)) return;
    const t = window.setInterval(() => { if (document.visibilityState === "visible") loadProject().catch(() => {}); }, 15_000);
    return () => window.clearInterval(t);
  }, [project, loadProject]);

  const dispatch = async () => {
    setError("");
    try { const r = await api({ action: "crew_start", id }) as { runId: string }; cursor.current = 0; setEvents([]); await loadCrew(); drive(r.runId); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not dispatch the inspectors"); }
  };

  const houses: House[] = useMemo(() => {
    const paths = new Map<string, { title: string | null; status: number; bytes: number }>();
    for (const p of pages) { try { paths.set(new URL(p.url).pathname, { title: p.title, status: p.status, bytes: p.bytes }); } catch { /* skip */ } }
    for (const e of events) if (e.kind === "VISIT" && e.page_url && !paths.has(e.page_url)) paths.set(e.page_url, { title: null, status: 200, bytes: 4000 });
    const list = [...paths.entries()].slice(0, 10);
    const max = Math.max(1, ...list.map(([, v]) => v.bytes));
    const spots = [[2.4, 12.4], [4.6, 12.6], [6.6, 12.4], [9.6, 12.6], [11.6, 12.4], [13.4, 12.8], [3.4, 14.2], [5.6, 14.3], [10.4, 14.3], [12.6, 14.4]];
    return list.map(([path, v], i) => ({ path, title: v.title, status: v.status, gx: spots[i][0], gy: spots[i][1], size: Math.sqrt(v.bytes / max) }));
  }, [pages, events]);

  const visited = useMemo(() => new Set(events.filter(e => e.kind === "VISIT" && e.page_url).map(e => e.page_url!)), [events]);
  const activePath = run?.status === "RUNNING" ? [...events].reverse().find(e => e.kind === "VISIT")?.page_url ?? null : null;
  const crewFindings = useMemo(() => {
    const byIndex: Record<number, { verdict: Verdict; path: string | null }> = {};
    if (run?.report) for (const f of run.report.findings) byIndex[f.index] = { verdict: f.verdict, path: f.path };
    for (const e of events) if (e.kind === "FINDING" && e.criterion_index !== null && e.verdict) byIndex[e.criterion_index] = { verdict: e.verdict, path: e.page_url };
    return byIndex;
  }, [run, events]);
  const findingsByPath = useMemo(() => {
    const rank: Record<Verdict, number> = { FAILED: 0, INCONCLUSIVE: 1, VERIFIED: 2 };
    const out: Record<string, Verdict> = {};
    for (const f of Object.values(crewFindings)) if (f.path && (!out[f.path] || rank[f.verdict] < rank[out[f.path]])) out[f.path] = f.verdict;
    return out;
  }, [crewFindings]);

  // Pan and zoom like a map.
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; (e.target as Element).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => { if (drag.current) setView(v => ({ ...v, x: drag.current!.vx + (e.clientX - drag.current!.x) / v.k, y: drag.current!.vy + (e.clientY - drag.current!.y) / v.k })); };
  const onUp = () => { drag.current = null; };
  const onWheel = (e: React.WheelEvent) => setView(v => ({ ...v, k: Math.min(2.2, Math.max(.6, v.k * (e.deltaY < 0 ? 1.1 : .9))) }));

  if (error && !project) return <main className="realm realm-empty"><p>{error}</p><a href="/app">Back to workspace</a></main>;
  if (!project) return <main className="realm realm-empty"><div className="realm-spinner" /><p>Raising the kingdom…</p></main>;

  const held = project.funding.status === "HELD" || project.funding.status === "PENDING";
  const paid = project.funding.status === "CAPTURED" || PAID.includes(project.payment_status);
  const treasury = paid ? "Paid to the guild" : held ? "Held in the treasury" : project.funding.mode === "HOLD" ? "Awaiting the client’s gold" : "Paid after approval";
  const running = run?.status === "RUNNING";
  const canDispatch = project.role === "client" && !!project.evidence_url && ["SUBMITTED", "REVIEW", "APPROVED", "REVISION_REQUESTED"].includes(project.status);
  const center = iso(GRID / 2, GRID / 2);

  return <main className="realm">
    <svg className="realm-world" viewBox={`${center.x - 700} ${center.y - 430} 1400 820`} preserveAspectRatio="xMidYMid meet"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onWheel={onWheel}>
      <defs><radialGradient id="r-sky" cx="50%" cy="35%" r="75%"><stop offset="0" stopColor="#fdf6e8" /><stop offset=".55" stopColor="#e9eef6" /><stop offset="1" stopColor="#c9d7ea" /></radialGradient></defs>
      <rect x={center.x - 1600} y={center.y - 1200} width="3200" height="2400" fill="url(#r-sky)" />
      <g style={{ transform: `scale(${view.k}) translate(${view.x}px, ${view.y}px)`, transformOrigin: `${center.x}px ${center.y}px`, transition: drag.current ? "none" : "transform .25s ease" }}>
        <World project={project} houses={houses} findingsByPath={findingsByPath} visited={visited} activePath={activePath} crewBusy={running} onPick={setPicked} />
      </g>
    </svg>

    <header className="realm-hud realm-title">
      <a href={`/app?project=${encodeURIComponent(project.id)}`} className="realm-back">← Workspace</a>
      <h1>{project.title}</h1>
      <p><span className="realm-who c">{project.client_email}</span> <span className="realm-x">×</span> <span className="realm-who f">{project.freelancer_email}</span></p>
    </header>

    <section className="realm-hud realm-treasury" aria-label="Treasury">
      <small>ROYAL TREASURY · PAYPAL</small>
      <strong>{money(project.amount_cents)}</strong>
      <span className={`realm-tstate ${paid ? "paid" : held ? "held" : ""}`}>{treasury}</span>
    </section>

    <aside className="realm-hud realm-log" aria-label="Inspector's log">
      <div className="realm-log-head">
        <div><h2>Inspector’s log</h2><p>{running ? `On patrol · ${run!.pages_read} of 8 pages · step ${run!.steps} of 12` : run?.status === "DONE" ? "Report delivered" : run?.status === "FAILED" ? "The patrol was cut short" : "No patrol yet"}</p></div>
        {running && <span className="realm-pulse" aria-hidden="true" />}
      </div>
      <ol className="realm-events">
        {events.length === 0 && <li className="realm-ev muted">{canDispatch ? "Dispatch the inspectors to read the delivered site and report on every requirement." : project.evidence_url ? "The client can dispatch the inspectors." : "The inspectors wait for the freelancer’s delivery."}</li>}
        {[...events].reverse().map(e => <li key={e.id} className={`realm-ev k-${e.kind.toLowerCase()} ${e.verdict ? `v-${e.verdict.toLowerCase()}` : ""}`}><span className="realm-ev-i">{kindIcon[e.kind] ?? "·"}</span><span>{e.text}</span></li>)}
      </ol>
      {canDispatch && <button className="realm-dispatch" disabled={running || !crewReady} onClick={dispatch}>{running ? "Inspectors on patrol…" : run?.status === "DONE" ? "Send a new patrol" : "Dispatch the inspectors"}</button>}
      {canDispatch && !crewReady && <p className="realm-note">Add a Groq API key on the server to enable the crew.</p>}
      {error && <p className="realm-note err">{error}</p>}
      <p className="realm-note">The crew only reads pages. Its report is advice; the client’s seal decides.</p>
    </aside>

    <nav className="realm-hud realm-banners" aria-label="Requirements">
      {project.criteria.map((c, i) => {
        const v = crewFindings[i]?.verdict ?? project.findings?.[i]?.status ?? null;
        return <div key={i} className={`realm-banner ${v ? `v-${v.toLowerCase()}` : ""}`} title={c.label}><b>{i + 1}</b><span>{c.label}</span></div>;
      })}
    </nav>

    {picked && <div className="realm-hud realm-inspect" role="dialog" aria-label="Building">
      <button className="realm-close" onClick={() => setPicked(null)} aria-label="Close">×</button>
      <small>DELIVERED PAGE</small><strong>{picked.path}</strong>
      <span>{picked.title ?? "No title"} · HTTP {picked.status}</span>
      <span>{visited.has(picked.path) ? "Inspected by the crew" : "Not inspected yet"}{findingsByPath[picked.path] ? ` · ${findingsByPath[picked.path].toLowerCase()}` : ""}</span>
    </div>}
    <p className="realm-hint">Drag to look around · scroll to zoom · click a house</p>
  </main>;
}

import { ROAD0, BLOCK, CART, CHEST, G0, GRID, NATIVE_H, NATIVE_W, at, balustrade, box, quoins, pxLine, cone, contactShadow, cylinder, dome, flag, gableRoof, hipRoof, onLit, onShade, person, poly, project, shade, sprite, tree, type P } from "./engine";

/* Palettes per landmark, sharing one gold accent so the kingdom reads as one place. */
const GOLD = "#e8b02a";
const STONE = { wall: "#c9c3b6", keep: "#d4cec2", trim: "#a8a191", slot: "#3a3530", roof: "#3a6ccf", course: "#b6af9f" };
const MARBLE = { base: "#ece6da", column: "#f4f0e6", cella: "#e2dbcc", roof: "#143b8c", door: "#4e3d2c" };
const TIMBER = { wall: "#efe2c6", beam: "#6a4a2c", roof: "#b5523b", glow: "#ffd98a" };
const HOUSE_ROOFS = ["#3b6fd4", "#c4553b", "#2f8f83", "#7a5aa8", "#d08a2b", "#4a7fc0", "#b0463f", "#3f8f5a"];
const HOUSE_WALLS = ["#f2eee4", "#f1e4cf", "#e6ecf0", "#f3e3da", "#ebe9dc"];
const SEA_Z = -26;

export type Verdict = "VERIFIED" | "FAILED" | "INCONCLUSIVE";
export type House = { path: string; u: number; v: number; s: number; floors: number; title: string | null; status: number };
export type Walker = { u: number; v: number; moving: boolean; flip: boolean; tunic: string };
export type SceneState = {
  houses: House[]; verdicts: Record<string, Verdict>; visited: Set<string>; active: string | null;
  held: boolean; approved: boolean; paid: boolean;
  cartU: number; cartMoving: boolean; inspectors: Walker[]; showCrew: boolean;
  chestsSince: number; sealSince: number; paidSince: number;
  /** The landmark where the viewer's next real action waits; it gets a bouncing quest marker. */
  quest?: Landmark | null; hover?: Landmark | null;
  /** Bounties paid (gold notices on the board) and when the latest landed; appeals at the customs house. */
  bounties?: number; bountySince?: number; appealOpen?: boolean; refunded?: boolean; refundSince?: number;
  /** How many quarter homes stand; the rest are building sites until the town levels up. */
  built?: number; builtSince?: number;
  /** When the helicopter last set out to deliver to the treasury (a PayPal payment or a collected reward). */
  heliSince?: number;
};
export type Landmark = "castle" | "treasury" | "guild" | "market" | "harbour";
/** Footprint and height of each landmark, for clicks, hover glow and the quest marker. */
const LANDMARKS: Record<Landmark, { u0: number; v0: number; u1: number; v1: number; top: number }> = {
  castle: { u0: 1.6, v0: 1.9, u1: 5.4, v1: 5.1, top: 92 },
  treasury: { u0: 7.5, v0: 1.2, u1: 11.5, v1: 5.7, top: 128 },
  guild: { u0: 14, v0: 2.2, u1: 17, v1: 4.8, top: 70 },
  market: { u0: 7.3, v0: 8.2, u1: 11.6, v1: 11.1, top: 30 },
  harbour: { u0: 19.3, v0: 13.1, u1: 21.9, v1: 18, top: 34 },
};
/**
 * The town plan. Roads run every BLOCK tiles; each block has one purpose. Landmarks were
 * authored at their old positions and are placed into their blocks with an offset.
 */
const PLACE = { castle: [0, -2.5], treasury: [.7, -3.2], guild: [2, -2.8], market: [1.1, -1.8], mill: [5.9, 1.1], harbour: [6.6, 0] } as const;
type Block = [number, number];
const blockBase = (b: number) => b * BLOCK + 1;
/** Four house plots per block, on an even grid with the same gap everywhere. */
const plotsIn = ([bu, bv]: Block): Array<[number, number]> => [[.55, .55], [2.95, .55], [.55, 2.95], [2.95, 2.95]].map(([du, dv]) => [blockBase(bu) + du, blockBase(bv) + dv]);
/** Where delivered pages are built, nearest the market first. */
export const PLOTS: Array<[number, number]> = [[0, 1], [2, 1], [1, 2]].flatMap(b => plotsIn(b as Block));
/** Neighbourhoods, nearest the centre first. The outer ones fill as the town levels up. */
const HOUSE_BLOCKS: Block[] = [[-1, 0], [-1, 1], [-1, 3], [0, 2], [2, 2], [0, 3], [2, 3],
  [-2, 0], [-2, 1], [-2, 2], [-2, 3], [-1, -2], [0, -2], [2, -2], [3, -2], [-3, 0], [-3, 1], [-3, 2], [-3, 3], [-2, -2]];
const PARKS: Block[] = [[-1, 2], [1, 3], [3, 1], [-3, -1]];
const FARMS: Block[] = [[-1, -1], [0, -1], [1, -1], [-3, -3], [-2, -3], [-1, -3], [0, -3], [1, -3], [-3, -2]];
const ORCHARDS: Block[] = [[2, -1], [3, -1], [2, -3], [3, -3], [-2, -1]];
/** The helipad block, north of the treasury: the town's delivery helicopter lives here. */
const PAD = { u: 9, v: -9 };
const inBlock = (u: number, v: number, [bu, bv]: Block) => u >= blockBase(bu) && u < blockBase(bu) + 5 && v >= blockBase(bv) && v < blockBase(bv) + 5;
export function landmarkBounds(l: Landmark) {
  const b = LANDMARKS[l];
  const left = project(b.u0, b.v1), right = project(b.u1, b.v0), bottom = project(b.u1, b.v1), top = project((b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2, b.top);
  return { x0: left.x, x1: right.x, y0: top.y, y1: bottom.y, cx: (left.x + right.x) / 2, top: top.y };
}
export function landmarkAt(x: number, y: number): Landmark | null {
  for (const l of ["treasury", "guild", "castle", "harbour", "market"] as Landmark[]) { const b = landmarkBounds(l); if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return l; }
  return null;
}
/** Where a reward bubble floats: above the building, or above the bounty board for the market. */
export function bubbleAnchor(l: Landmark): P {
  if (l === "market") return project(10.85, 10.5, 34);
  const b = landmarkBounds(l); return { x: b.cx, y: b.top - 6 };
}
/** A pixel banner with "!" bobbing above the landmark that needs the viewer. */
function questMarker(ctx: CanvasRenderingContext2D, l: Landmark, t: number) {
  const b = landmarkBounds(l), bob = Math.round(Math.sin(t / 260) * 2.5);
  const x = Math.round(b.cx), y = Math.round(b.top) - 14 + bob;
  ctx.fillStyle = "rgba(255,196,57,.28)"; ctx.beginPath(); ctx.ellipse(x, y + 4, 12 + Math.sin(t / 260), 12 + Math.sin(t / 260), 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#1b2333"; ctx.fillRect(x - 6, y - 8, 12, 15); ctx.fillRect(x - 2, y + 7, 4, 3);
  ctx.fillStyle = "#ffc439"; ctx.fillRect(x - 5, y - 7, 10, 13); ctx.fillRect(x - 1, y + 6, 2, 3);
  ctx.fillStyle = "#1b2333"; ctx.fillRect(x - 1, y - 5, 2, 6); ctx.fillRect(x - 1, y + 2, 2, 2);
}
function hoverGlow(ctx: CanvasRenderingContext2D, l: Landmark) {
  const b = LANDMARKS[l], pts = [project(b.u0 - .15, b.v0 - .15), project(b.u1 + .15, b.v0 - .15), project(b.u1 + .15, b.v1 + .15), project(b.u0 - .15, b.v1 + .15)];
  ctx.strokeStyle = "rgba(255,209,92,.9)"; ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x + .5, p.y + .5) : ctx.moveTo(p.x + .5, p.y + .5)); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
}

/* ── terrain (static, rendered once and cached) ── */
const isRoad = (u: number, v: number) =>
  (((u % BLOCK === 0 && u >= ROAD0) && v >= ROAD0) || ((v % BLOCK === 0 && v >= ROAD0) && u >= ROAD0)) || (v === 15 && u >= 19 && u <= 23);
const isPlaza = (u: number, v: number) => inBlock(u, v, [1, 1]);
const isPond = (u: number, v: number) => PARKS.some(([bu, bv]) => u >= blockBase(bu) + 1 && u <= blockBase(bu) + 3 && v >= blockBase(bv) + 1 && v <= blockBase(bv) + 3);
const isField = (u: number, v: number) => FARMS.some(b => inBlock(u, v, b)) || (inBlock(u, v, [3, 0]) && !(u >= 20 && u <= 22 && v >= 2 && v <= 4));
const hash = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

let terrainCache: HTMLCanvasElement | null = null;
function terrain(): HTMLCanvasElement {
  if (terrainCache) return terrainCache;
  const c = document.createElement("canvas");
  c.width = NATIVE_W; c.height = NATIVE_H;
  const ctx = c.getContext("2d")!;
  const span = GRID - G0;
  // a sandy beach along the far shores, then cliffs with strata along the near ones
  poly(ctx, [project(G0 - .45, G0 - .45), project(GRID + .2, G0 - .45), project(GRID, GRID), project(G0 - .45, GRID + .2)], "#e6d3a0");
  poly(ctx, [project(G0 - .2, G0 - .2), project(GRID, G0 - .2), project(GRID, GRID), project(G0 - .2, GRID)], "#d8c38d");
  poly(ctx, [project(G0, GRID), project(GRID, GRID), project(GRID, GRID, SEA_Z), project(G0, GRID, SEA_Z)], "#9a7148");
  poly(ctx, [project(GRID, G0), project(GRID, GRID), project(GRID, GRID, SEA_Z), project(GRID, G0, SEA_Z)], "#7a5734");
  for (const z of [-9, -17]) {
    poly(ctx, [project(G0, GRID, z), project(GRID, GRID, z), project(GRID, GRID, z - 2), project(G0, GRID, z - 2)], "#86603b");
    poly(ctx, [project(GRID, G0, z), project(GRID, GRID, z), project(GRID, GRID, z - 2), project(GRID, G0, z - 2)], "#664a2c");
  }
  for (let i = 0; i < 80; i++) { const t = G0 + hash(i, 4) * span; const p = i % 2 ? project(t, GRID, -4 - hash(i, 8) * 18) : project(GRID, t, -4 - hash(i, 8) * 18); ctx.fillStyle = i % 2 ? "#b08559" : "#8d6740"; ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 1); }
  for (let v = G0; v < GRID; v++) for (let u = G0; u < GRID; u++) {
    const quad = [project(u, v), project(u + 1, v), project(u + 1, v + 1), project(u, v + 1)];
    if (isRoad(u, v)) {
      poly(ctx, quad, (u + v) % 2 ? "#d3cab8" : "#cdc4b1");
      ctx.fillStyle = "#b9af9a";
      for (let k = 0; k < 6; k++) { const p = project(u + hash(u, v + k) * .8 + .1, v + hash(v, u + k) * .8 + .1); ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 1); }
    } else if (isPlaza(u, v)) {
      poly(ctx, quad, (u + v) % 2 ? "#e2dacb" : "#ddd4c3");
      ctx.fillStyle = "#c9bfac";
      for (let k = 1; k < 4; k++) { const a1 = project(u + k / 4, v), b1 = project(u + k / 4, v + 1); ctx.fillRect(Math.round((a1.x + b1.x) / 2), Math.round((a1.y + b1.y) / 2), 1, 1); }
    } else if (isField(u, v)) {
      poly(ctx, quad, "#9b7449");
      for (let r = .15; r < 1; r += .25) { const a = project(u + r, v + .08), b = project(u + r, v + .92); ctx.strokeStyle = (u + v) % 2 ? "#d9b84a" : "#7fb84e"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    } else {
      poly(ctx, quad, (u + v) % 2 ? "#7cc24f" : "#74ba48");
      if (hash(u, v) > .5) { ctx.fillStyle = hash(v, u) > .5 ? "#8fd162" : "#62a83d"; const p = project(u + .3 + hash(u, v) * .4, v + .3 + hash(v, u) * .4); ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 2); ctx.fillRect(Math.round(p.x) + 2, Math.round(p.y) + 1, 1, 1); }
      if (hash(u * 3, v * 5) > .93) { const p = project(u + .5, v + .5); ["#ff6f91", "#ffd15c", "#ffffff"].forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(Math.round(p.x) + i * 3 - 3, Math.round(p.y) + (i % 2), 1, 1); }); }
    }
  }
  // each park's pond as one body of water: a sandy bank, the water, a darker rim and a few glints
  for (const [bu, bv] of PARKS) {
    const a0 = blockBase(bu) + 1, b0 = blockBase(bv) + 1, a1 = a0 + 3, b1 = b0 + 3;
    poly(ctx, [project(a0 - .15, b0 - .15), project(a1 + .15, b0 - .15), project(a1 + .15, b1 + .15), project(a0 - .15, b1 + .15)], "#dcc893");
    poly(ctx, [project(a0 + .1, b0 + .1), project(a1 - .1, b0 + .1), project(a1 - .1, b1 - .1), project(a0 + .1, b1 - .1)], "#3f8ccc");
    poly(ctx, [project(a0 + .1, b0 + .1), project(a1 - .1, b0 + .1), project(a1 - .35, b0 + .35), project(a0 + .35, b0 + .35)], "#2f78b6");
    poly(ctx, [project(a0 + .1, b0 + .1), project(a0 + .35, b0 + .35), project(a0 + .35, b1 - .35), project(a0 + .1, b1 - .1)], "#2c70aa");
    ctx.fillStyle = "rgba(255,255,255,.5)";
    for (let k = 0; k < 5; k++) { const p = project(a0 + .6 + hash(k, bu) * 1.8, b0 + .6 + hash(k, bv) * 1.8); ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y), 5, 1); }
    const lily = project(a0 + 2.1, b0 + .9); ctx.fillStyle = "#5fae4a"; ctx.fillRect(Math.round(lily.x), Math.round(lily.y), 3, 2); ctx.fillStyle = "#ff8fb1"; ctx.fillRect(Math.round(lily.x) + 1, Math.round(lily.y), 1, 1);
  }
  ctx.strokeStyle = "rgba(120,104,80,.55)"; ctx.lineWidth = 1;
  for (let v = G0; v < GRID; v++) for (let u = G0; u < GRID; u++) {
    if (!isRoad(u, v)) continue;
    const edges: Array<[number, number, number, number, boolean]> = [[u, v, u + 1, v, !isRoad(u, v - 1)], [u, v + 1, u + 1, v + 1, !isRoad(u, v + 1)], [u, v, u, v + 1, !isRoad(u - 1, v)], [u + 1, v, u + 1, v + 1, !isRoad(u + 1, v)]];
    for (const [a, b, cc, d, on] of edges) if (on) { const p = project(a, b), q = project(cc, d); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
  }
  ctx.strokeStyle = "#5f9e3a"; ctx.lineWidth = 2;
  ctx.beginPath(); const a = project(G0, GRID), b = project(GRID, GRID), cc = project(GRID, G0);
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(cc.x, cc.y); ctx.stroke();
  terrainCache = c;
  return c;
}

function sea(ctx: CanvasRenderingContext2D, t: number) {
  // The sea colour itself is the page background, so it reaches every edge of the screen.
  ctx.clearRect(0, 0, NATIVE_W, NATIVE_H);
  for (let i = 0; i < 110; i++) {
    const x = (hash(i, 3) * NATIVE_W + t * .007 * (1 + hash(i, 7))) % NATIVE_W, y = hash(i, 9) * NATIVE_H;
    if (Math.floor(t / 700 + i) % 3 === 0) continue;
    ctx.fillStyle = i % 4 ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.28)";
    ctx.fillRect(Math.round(x), Math.round(y), i % 3 ? 3 : 5, 1);
  }
  // distant sails on the horizon
  [[.12, .08, 1], [.78, .05, -1], [.92, .2, 1]].forEach(([fx, fy, dir], i) => {
    const x = (fx * NATIVE_W + dir * t * .004) % NATIVE_W, y = fy * NATIVE_H + Math.sin(t / 900 + i) * 1;
    const xx = ((x % NATIVE_W) + NATIVE_W) % NATIVE_W;
    ctx.fillStyle = "#5a3d24"; ctx.fillRect(Math.round(xx) - 4, Math.round(y), 9, 2);
    ctx.fillStyle = "#f3ead6"; ctx.fillRect(Math.round(xx) - 1, Math.round(y) - 7, 3, 6);
    ctx.fillStyle = "#e3d6bb"; ctx.fillRect(Math.round(xx) + 2, Math.round(y) - 5, 2, 4);
  });
}

/** Breaking foam along the foot of the cliffs. */
function foam(ctx: CanvasRenderingContext2D, t: number) {
  const phase = Math.floor(t / 260) % 4;
  ctx.fillStyle = "rgba(255,255,255,.75)";
  for (let i = G0 * 4; i < GRID * 4; i++) {
    if ((i + phase) % 4 === 0) continue;
    const p = project(i / 4, GRID + .12, SEA_Z), q = project(GRID + .12, i / 4, SEA_Z);
    ctx.fillRect(Math.round(p.x), Math.round(p.y) + 1, 3, 1);
    ctx.fillRect(Math.round(q.x) - 2, Math.round(q.y) + 1, 3, 1);
  }
}

/* ── ships ── */
/** A hull built from a sheer line, dropped to the waterline, with two masts and square sails. */
function ship(ctx: CanvasRenderingContext2D, u: number, v: number, alongU: boolean, t: number, opts: { cargo?: boolean; flagColor: string; hull: string; scale?: number }) {
  const k = opts.scale ?? 1;
  const map = (du: number, dv: number): [number, number] => alongU ? [u + du * k, v + dv * k] : [u + dv * k, v + du * k];
  const bob = Math.sin(t / 520 + u) * 1.2;
  const z0 = SEA_Z + bob, deck = SEA_Z + 9 * k + bob;
  const outline: Array<[number, number]> = [[-1.25, -.34], [.75, -.36], [1.35, 0], [.75, .36], [-1.25, .34], [-1.4, 0]];
  // wake
  ctx.fillStyle = "rgba(255,255,255,.55)";
  for (let i = 0; i < 6; i++) { const [wu, wv] = map(-1.5 - i * .25, (i % 2 ? .2 : -.2)); const p = project(wu, wv, SEA_Z); if ((Math.floor(t / 200) + i) % 3) ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 1); }
  const faces = outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const [u0, v0] = map(a[0], a[1]), [u1, v1] = map(b[0], b[1]);
    let nu = v1 - v0, nv = -(u1 - u0); const len = Math.hypot(nu, nv) || 1; nu /= len; nv /= len;
    return { u0, v0, u1, v1, nu, nv, depth: (u0 + u1 + v0 + v1) / 2 };
  }).filter(f => f.nu + f.nv > -0.2).sort((a, b) => a.depth - b.depth);
  for (const f of faces) poly(ctx, [project(f.u0, f.v0, deck), project(f.u1, f.v1, deck), project(f.u1, f.v1, z0), project(f.u0, f.v0, z0)], shade(opts.hull, Math.round(9 * f.nv - 28 * f.nu)));
  // gold strake along the hull
  for (const f of faces) { const a = project(f.u0, f.v0, deck - 3 * k), b = project(f.u1, f.v1, deck - 3 * k); ctx.strokeStyle = GOLD; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  poly(ctx, outline.map(([a, b]) => { const [pu, pv] = map(a, b); return project(pu, pv, deck); }), "#b98a55", "#8a6239");
  const [cu, cv] = map(-1.0, 0); box(ctx, cu - .2 * k, cv - .25 * k, cu + .2 * k, cv + .25 * k, deck, deck + 7 * k, { base: "#8a6239" });
  if (opts.cargo) [[-.3, -.1], [.2, .1], [-.05, .12]].forEach(([a, b]) => { const [pu, pv] = map(a, b); const p = project(pu, pv, deck); sprite(ctx, CHEST, p.x, p.y); });
  [[.45, 44], [-.35, 38]].forEach(([m, h]) => {
    const [mu, mv] = map(m, 0);
    box(ctx, mu - .05 * k, mv - .05 * k, mu + .05 * k, mv + .05 * k, deck, deck + h * k, { base: "#6a4a2c" });
    for (const [lo, hi, w] of [[.42, .72, .55], [.12, .38, .42]]) {
      const [su0, sv0] = map(m + .02, -w), [su1, sv1] = map(m + .02, w);
      const billow = Math.sin(t / 700 + m) * .6;
      poly(ctx, [project(su0, sv0, deck + h * hi * k), project(su1, sv1, deck + h * hi * k), project(su1, sv1, deck + h * lo * k + billow), project(su0, sv0, deck + h * lo * k + billow)], "#f3ead6", "#d6c7a6");
    }
    const top = project(mu, mv, deck + h * k); flag(ctx, top.x, top.y + 1, opts.flagColor, t, 8);
  });
}

function pier(ctx: CanvasRenderingContext2D) {
  for (let u = 18; u < 21.4; u += .7) box(ctx, u, 15.75, u + .12, 15.87, SEA_Z, -2, { base: "#6a4a2c" });
  box(ctx, 17.4, 15.1, 21.6, 15.9, -4, -1, { base: "#a87d4e" });
  for (let u = 17.5; u < 21.6; u += .3) onLit(ctx, 15.9, u, u + .02, -4, -1, "#7d5a36");
  [[20.9, 15.2], [20.9, 15.75]].forEach(([u, v]) => box(ctx, u, v, u + .12, v + .12, -1, 5, { base: "#5d4127" }));
}

function lighthouse(ctx: CanvasRenderingContext2D, t: number) {
  const cu = 21.3, cv = 14.4;
  cylinder(ctx, cu, cv, .75, SEA_Z, -16, "#8d8a84", 12);
  for (let i = 0; i < 6; i++) cylinder(ctx, cu, cv, .42 - i * .02, -16 + i * 12, -4 + i * 12, i % 2 ? "#c94a3b" : "#f1ece2", 12);
  cylinder(ctx, cu, cv, .5, 56, 59, "#3a3f4a", 12);
  const lamp = project(cu, cv, 63), on = .55 + .45 * Math.sin(t / 380);
  ctx.fillStyle = `rgba(255,226,120,${.25 * on})`; ctx.beginPath(); ctx.arc(lamp.x, lamp.y, 16, 0, Math.PI * 2); ctx.fill();
  cylinder(ctx, cu, cv, .3, 59, 67, "#ffe78a", 10);
  cone(ctx, cu, cv, .4, 67, 10, "#c94a3b", 10);
}

/* ── landmarks ── */
function courses(ctx: CanvasRenderingContext2D, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, color: string) {
  for (let z = z0 + 6; z < z1 - 1; z += 6) { onLit(ctx, v1, u0, u1, z, z + 1, color); onShade(ctx, u1, v0, v1, z, z + 1, shade(color, -12)); }
}

function castle(ctx: CanvasRenderingContext2D, t: number) {
  const tower = (cu: number, cv: number, h = 52) => {
    cylinder(ctx, cu, cv, .5, 0, h, STONE.wall);
    for (let z = 8; z < h - 4; z += 8) for (let i = 0; i < 6; i++) { const a = -.4 + i * .55; if (Math.cos(a) + Math.sin(a) < .2) continue; const p = project(cu + .5 * Math.cos(a), cv + .5 * Math.sin(a), z); ctx.fillStyle = STONE.course; ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 1); }
    for (const a of [.25, 1.3]) { const p = project(cu + .5 * Math.cos(a), cv + .5 * Math.sin(a), h - 6); ctx.fillStyle = STONE.slot; ctx.fillRect(Math.round(p.x), Math.round(p.y) - 6, 1, 4); }
    for (const [a, z] of [[.9, h * .5], [.35, h * .28]] as Array<[number, number]>) { const p = project(cu + .5 * Math.cos(a), cv + .5 * Math.sin(a), z); const x = Math.round(p.x) - 1, y = Math.round(p.y) - 7; ctx.fillStyle = shade(STONE.wall, -30); ctx.fillRect(x - 1, y - 1, 5, 9); ctx.fillStyle = "#ffd98a"; ctx.fillRect(x, y + 1, 3, 6); ctx.fillRect(x + 1, y, 1, 1); ctx.fillStyle = STONE.trim; ctx.fillRect(x - 1, y + 7, 5, 1); }
    cylinder(ctx, cu, cv, .52, h - 3, h, shade(STONE.wall, -20));
    cylinder(ctx, cu, cv, .58, h, h + 4, STONE.keep);
    cylinder(ctx, cu, cv, .62, h + 4, h + 5, GOLD);
    cone(ctx, cu, cv, .64, h + 5, 30, STONE.roof);
    const tip = project(cu, cv, h + 34); ctx.fillStyle = GOLD; ctx.fillRect(Math.round(tip.x), Math.round(tip.y) - 2, 1, 2);
  };
  tower(2, 4.8);
  box(ctx, 2, 4.8, 5, 7.2, 0, 30, { base: STONE.wall });
  courses(ctx, 2, 4.8, 5, 7.2, 0, 30, STONE.course);
  onLit(ctx, 7.2, 2, 5, 27, 30, shade(STONE.wall, -18)); onShade(ctx, 5, 4.8, 7.2, 27, 30, shade(STONE.wall, -36));
  onLit(ctx, 7.2, 2, 5, 0, 3, shade(STONE.wall, -26)); onShade(ctx, 5, 4.8, 7.2, 0, 3, shade(STONE.wall, -42));
  for (let u = 2.1; u < 4.95; u += .42) box(ctx, u, 7.0, u + .22, 7.2, 30, 35, { base: STONE.wall });
  for (let v = 4.9; v < 7.15; v += .42) box(ctx, 4.8, v, 5, v + .22, 30, 35, { base: STONE.wall });
  box(ctx, 3, 5.4, 4.4, 6.6, 0, 58, { base: STONE.keep });
  courses(ctx, 3, 5.4, 4.4, 6.6, 30, 58, shade(STONE.keep, -10));
  quoins(ctx, 4.4, 6.6, 31, 56, shade(STONE.keep, 8), .12);
  onLit(ctx, 6.6, 3, 4.4, 55, 58, shade(STONE.keep, -16)); onShade(ctx, 4.4, 5.4, 6.6, 55, 58, shade(STONE.keep, -34));
  for (let u = 3.05; u < 4.35; u += .36) box(ctx, u, 6.42, u + .2, 6.6, 58, 63, { base: STONE.keep });
  for (let v = 5.45; v < 6.55; v += .36) box(ctx, 4.22, v, 4.4, v + .2, 58, 63, { base: STONE.keep });
  [[3.4, 3.62], [3.85, 4.07]].forEach(([a, b]) => { onLit(ctx, 6.6, a, b, 40, 50, "#ffd98a"); onLit(ctx, 6.6, a - .03, b + .03, 50, 52, STONE.trim); });
  onShade(ctx, 4.4, 5.8, 5.95, 40, 50, "#e8c46a"); onShade(ctx, 4.4, 6.15, 6.3, 40, 50, "#e8c46a");
  // hanging banners on the curtain wall
  [[2.45, "#2f5fbe"], [4.4, "#2f5fbe"]].forEach(([u, col]) => { onLit(ctx, 7.2, u as number, (u as number) + .28, 14, 28, col as string); onLit(ctx, 7.2, u as number, (u as number) + .28, 27, 29, GOLD); });
  // gatehouse with flanking gate towers
  box(ctx, 2.85, 6.95, 3.1, 7.45, 0, 38, { base: STONE.keep }); box(ctx, 3.9, 6.95, 4.15, 7.45, 0, 38, { base: STONE.keep });
  for (const u of [2.85, 3.9]) for (let i = 0; i < 2; i++) box(ctx, u + i * .14, 7.3, u + i * .14 + .08, 7.45, 38, 42, { base: STONE.keep });
  onLit(ctx, 7.2, 3.1, 3.9, 0, 18, "#2e2924");
  for (let u = 3.18; u < 3.85; u += .14) onLit(ctx, 7.2, u, u + .03, 1, 18, "#6a5a48");
  onLit(ctx, 7.2, 3.1, 3.9, 18, 21, STONE.trim);
  const top = project(3.7, 6.0, 63); flag(ctx, top.x, top.y, "#2f6fdc", t, 24);
  tower(5, 4.8); tower(2, 7.2, 48); tower(5, 7.2, 48);
}

function treasury(ctx: CanvasRenderingContext2D, s: SceneState, t: number) {
  if (s.held) { const c = project(8.8, 6.4, 6); ctx.fillStyle = `rgba(255,200,70,${.16 + .06 * Math.sin(t / 500)})`; ctx.beginPath(); ctx.ellipse(c.x, c.y, 86, 40, 0, 0, Math.PI * 2); ctx.fill(); }
  box(ctx, 6.8, 4.4, 10.8, 8.4, 0, 5, { base: MARBLE.base });
  box(ctx, 7.0, 4.6, 10.6, 8.1, 5, 10, { base: MARBLE.base });
  // a proper front stair: dark risers, light treads
  for (let i = 0; i < 3; i++) box(ctx, 8.0, 8.4 + i * .18, 9.6, 8.58 + i * .18, 0, 5 - i * 1.6, { base: MARBLE.base, lit: shade(MARBLE.base, -18) });
  box(ctx, 7.6, 5.0, 10.0, 7.2, 10, 50, { base: MARBLE.cella });
  onLit(ctx, 7.2, 8.45, 9.15, 10, 34, MARBLE.door);
  onLit(ctx, 7.2, 8.45, 9.15, 34, 36, GOLD);
  for (let v = 5.15; v < 7.5; v += .62) { box(ctx, 10.18, v, 10.42, v + .24, 10, 48, { base: MARBLE.column }); box(ctx, 10.13, v - .05, 10.47, v + .29, 46, 48, { base: MARBLE.base }); }
  for (let u = 7.2; u < 10.5; u += .6) { box(ctx, u, 7.68, u + .24, 7.92, 10, 48, { base: MARBLE.column }); box(ctx, u - .05, 7.63, u + .29, 7.97, 46, 48, { base: MARBLE.base }); }
  box(ctx, 7.05, 4.8, 10.6, 8.0, 48, 57, { base: MARBLE.base });
  onLit(ctx, 8.0, 7.05, 10.6, 51, 53, GOLD); onShade(ctx, 10.6, 4.8, 8.0, 51, 53, shade(GOLD, -18));
  box(ctx, 7.15, 4.9, 10.5, 7.9, 57, 60, { base: MARBLE.roof });
  const g0 = project(7.15, 7.9, 60), g1 = project(10.5, 7.9, 60), gp = project(8.825, 7.9, 80);
  poly(ctx, [g0, g1, gp], MARBLE.column, shade(MARBLE.base, -26));
  const inner0 = project(7.55, 7.9, 62), inner1 = project(10.1, 7.9, 62), innerp = project(8.825, 7.9, 76);
  poly(ctx, [inner0, inner1, innerp], shade(MARBLE.column, -6));
  const tc = project(8.825, 7.9, 67); ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(tc.x, tc.y, 3, 0, Math.PI * 2); ctx.fill();
  cylinder(ctx, 8.8, 6.35, .8, 60, 66, MARBLE.base);
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; if (Math.cos(a) + Math.sin(a) < 0) continue; box(ctx, 8.8 + .8 * Math.cos(a) - .04, 6.35 + .8 * Math.sin(a) - .04, 8.8 + .8 * Math.cos(a) + .04, 6.35 + .8 * Math.sin(a) + .04, 60, 66, { base: MARBLE.column }); }
  dome(ctx, 8.8, 6.35, .72, 66, 30, GOLD, 16);
  for (const a of [.2, .75, 1.3]) for (let k = 0; k < 14; k++) { const f = k / 14, rr = .72 * Math.cos(f * Math.PI / 2), z = 66 + 30 * Math.pow(Math.sin(f * Math.PI / 2), .78); const p = project(8.8 + rr * Math.cos(a), 6.35 + rr * Math.sin(a), z); ctx.fillStyle = "#c98f12"; ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 2); }
  cylinder(ctx, 8.8, 6.35, .12, 96, 104, GOLD);
  const tip = project(8.8, 6.35, 104); flag(ctx, tip.x, tip.y, "#003087", t, 14);
  if (s.held) {
    const since = t - s.chestsSince;
    [8.0, 8.8, 9.6].forEach((u, i) => { const drop = Math.max(0, 18 - Math.max(0, since - i * 160) / 14); const p = project(u, 8.22, 5 + drop); sprite(ctx, CHEST, p.x, p.y); });
    if (Math.floor(t / 400) % 2) { const sp = project(8.6, 8.2, 16); ctx.fillStyle = "#fff6c8"; ctx.fillRect(Math.round(sp.x), Math.round(sp.y), 1, 1); }
  }
  if (s.approved) {
    const k = Math.min(1, Math.max(.2, (t - s.sealSince) / 450));
    const c = project(8.825, 7.9, 28), r = 10 * (1 + (1 - k) * 1.6);
    ctx.globalAlpha = k;
    ctx.fillStyle = "#9e1f1a"; ctx.beginPath(); ctx.arc(c.x, c.y, r + 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#c0392b"; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f5d0c8"; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .32 : r * .7; const x = c.x + rr * Math.cos(a), y = c.y + rr * Math.sin(a); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
  }
}

function guild(ctx: CanvasRenderingContext2D, t: number) {
  box(ctx, 12.2, 5.2, 14.8, 7.4, 0, 3, { base: "#9a8f80" });
  box(ctx, 12.25, 5.25, 14.75, 7.35, 3, 34, { base: TIMBER.wall });
  for (let u = 12.25; u < 14.8; u += .62) onLit(ctx, 7.35, u, u + .07, 3, 34, TIMBER.beam);
  onLit(ctx, 7.35, 12.25, 14.75, 18, 20, TIMBER.beam); onLit(ctx, 7.35, 12.25, 14.75, 32, 34, TIMBER.beam);
  for (let u = 12.25; u < 14.7; u += 1.24) { const a = project(u + .07, 7.35, 20), b = project(u + .62, 7.35, 32); ctx.strokeStyle = TIMBER.beam; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  for (let v = 5.25; v < 7.4; v += .7) onShade(ctx, 14.75, v, v + .07, 3, 34, shade(TIMBER.beam, -10));
  onShade(ctx, 14.75, 5.25, 7.35, 18, 20, shade(TIMBER.beam, -10));
  [[12.55, 13.0], [13.9, 14.35]].forEach(([a, b]) => { onLit(ctx, 7.35, a, b, 22, 30, TIMBER.glow); onLit(ctx, 7.35, a, b, 21, 22, TIMBER.beam); onLit(ctx, 7.35, (a + b) / 2 - .02, (a + b) / 2 + .02, 22, 30, TIMBER.beam); });
  onLit(ctx, 7.35, 13.25, 13.7, 3, 16, "#5a3c22"); onLit(ctx, 7.35, 13.2, 13.75, 16, 18, TIMBER.beam);
  onShade(ctx, 14.75, 5.7, 6.2, 22, 30, shade(TIMBER.glow, -12)); onShade(ctx, 14.75, 6.6, 7.0, 22, 30, shade(TIMBER.glow, -12));
  onLit(ctx, 7.35, 12.25, 14.75, 3, 4, "#e8b02a"); onShade(ctx, 14.75, 5.25, 7.35, 3, 4, "#b98a1e");
  gableRoof(ctx, 12, 5, 15, 7.6, 34, 26, TIMBER.roof, TIMBER.wall);
  box(ctx, 14.05, 5.55, 14.45, 5.95, 40, 66, { base: "#9a8a7a" });
  box(ctx, 14.0, 5.5, 14.5, 6.0, 64, 67, { base: "#857565" });
  for (let i = 0; i < 4; i++) { const age = ((t / 1400) + i / 4) % 1; const p = project(14.25, 5.75, 68 + age * 30); ctx.fillStyle = `rgba(245,245,245,${.75 * (1 - age)})`; ctx.beginPath(); ctx.arc(p.x + age * 6, p.y, 2 + age * 4, 0, Math.PI * 2); ctx.fill(); }
  const sg = project(13.1, 7.6, 22); ctx.fillStyle = TIMBER.beam; ctx.fillRect(Math.round(sg.x) - 1, Math.round(sg.y) - 2, 10, 1);
  ctx.fillStyle = "#c79a52"; ctx.fillRect(Math.round(sg.x) + 1, Math.round(sg.y), 8, 6); ctx.fillStyle = "#7a5530"; ctx.fillRect(Math.round(sg.x) + 3, Math.round(sg.y) + 2, 4, 2);
  // barrels and crates by the door
  [[14.85, 7.5], [15.05, 7.2]].forEach(([u, v]) => cylinder(ctx, u, v, .14, 0, 8, "#8a5a2b", 8));
  box(ctx, 12.0, 7.5, 12.3, 7.8, 0, 7, { base: "#b07a44" });
  const fp = project(12.4, 5.4, 52); flag(ctx, fp.x, fp.y, "#1f9e62", t, 18);
}

function windmill(ctx: CanvasRenderingContext2D, t: number) {
  const cu = 15.6, cv = 2.4;
  cylinder(ctx, cu, cv, .62, 0, 26, "#d9d1c2", 12);
  cylinder(ctx, cu, cv, .5, 26, 46, "#e2dbcd", 12);
  onLit(ctx, cv + .5, cu - .12, cu + .12, 0, 12, "#5a3c22");
  cone(ctx, cu, cv, .6, 46, 18, "#9c4a36", 12);
  const hub = project(cu + .55, cv + .55, 44), a0 = t / 900;
  for (let i = 0; i < 4; i++) {
    const a = a0 + i * Math.PI / 2, dx = Math.cos(a), dy = Math.sin(a) * .9;
    const tip = { x: hub.x + dx * 26, y: hub.y + dy * 26 }, side = { x: -dy * 4, y: dx * 4 };
    ctx.strokeStyle = "#6a4a2c"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hub.x, hub.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    poly(ctx, [{ x: hub.x + dx * 7, y: hub.y + dy * 7 }, tip, { x: tip.x + side.x, y: tip.y + side.y }, { x: hub.x + dx * 7 + side.x, y: hub.y + dy * 7 + side.y }], "#f3ead6", "#c9b893");
  }
  ctx.fillStyle = "#3b2a1a"; ctx.fillRect(Math.round(hub.x) - 1, Math.round(hub.y) - 1, 3, 3);
}

function stall(ctx: CanvasRenderingContext2D, u0: number, v0: number, color: string, goods: string[]) {
  const u1 = u0 + 1.1, v1 = v0 + .8;
  for (const [u, v] of [[u0, v0], [u1 - .08, v0], [u0, v1 - .08], [u1 - .08, v1 - .08]]) box(ctx, u, v, u + .08, v + .08, 0, 16, { base: "#6a4a2c" });
  box(ctx, u0 + .05, v0 + .35, u1 - .05, v1 - .05, 0, 7, { base: "#b07a44" });
  goods.forEach((g, i) => { const p = project(u0 + .25 + i * .3, v0 + .6, 7); ctx.fillStyle = g; ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 3, 4, 3); ctx.fillStyle = shade(g, 30); ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 3, 2, 1); });
  const n = 5, w = (u1 - u0 + .2) / n;
  for (let k = 0; k < n; k++) gableRoof(ctx, u0 - .1 + k * w, v0 - .1, u0 - .1 + (k + 1) * w, v1 + .1, 16, 7, k % 2 ? "#f3ead6" : color, "#f3ead6");
}

const HOUSE_BASE = 6.5, STOREY = 12;
const houseTop = (h: House) => HOUSE_BASE + h.floors * STOREY;
const houseRise = (h: House) => 10 + h.s * 5;
/**
 * A town house built the way the capitol blocks are: a rusticated plinth with a cap, storeys
 * divided into bays by pilasters, windows with frames, heads and sills, a door bay with a stoop,
 * a projecting cornice, and either a pitched roof or a set-back attic behind a balustrade.
 */
function house(ctx: CanvasRenderingContext2D, h: House, i: number, s: SceneState, t: number) {
  const u0 = h.u, v0 = h.v, u1 = h.u + h.s, v1 = h.v + h.s;
  const wall = HOUSE_WALLS[i % HOUSE_WALLS.length], roof = HOUSE_ROOFS[i % HOUSE_ROOFS.length], kind = i % 3;
  const top = houseTop(h), base = HOUSE_BASE;
  // plinth: dressed stone with two joint courses, then a projecting cap
  box(ctx, u0, v0, u1, v1, 0, 5, { base: "#b8ae9c" });
  for (const z of [1.7, 3.4]) { onLit(ctx, v1, u0, u1, z, z + .6, "#a39a88"); onShade(ctx, u1, v0, v1, z, z + .6, "#857d6e"); }
  box(ctx, u0 - .05, v0 - .05, u1 + .05, v1 + .05, 5, base, { base: "#ddd5c4", finish: false });
  // the storeys
  box(ctx, u0, v0, u1, v1, base, top, { base: wall });
  const n = Math.max(2, Math.round(h.s * 1.7)), bay = h.s / n;
  const lit = !!h.path && s.visited.has(h.path);
  const glass = lit ? "#ffe39a" : "#7fb0e4", glassShade = lit ? "#e8c46a" : "#5f8fc4";
  for (let k = 0; k <= n; k++) {
    const c = u0 + bay * k, d = v0 + bay * k;
    onLit(ctx, v1, Math.max(u0, c - .05), Math.min(u1, c + .05), base, top, shade(wall, 12));
    onLit(ctx, v1, Math.min(u1, c + .035), Math.min(u1, c + .05), base, top, shade(wall, -16));
    onShade(ctx, u1, Math.max(v0, d - .05), Math.min(v1, d + .05), base, top, shade(wall, -12));
  }
  for (let f = 1; f < h.floors; f++) { onLit(ctx, v1, u0, u1, base + f * STOREY - 1, base + f * STOREY, shade(wall, -12)); onShade(ctx, u1, v0, v1, base + f * STOREY - 1, base + f * STOREY, shade(wall, -32)); }
  for (let f = 0; f < h.floors; f++) {
    const z0 = base + f * STOREY + 3, z1 = z0 + 6.5;
    for (let k = 0; k < n; k++) {
      const a = u0 + bay * (k + .28), b = u0 + bay * (k + .72), c = v0 + bay * (k + .28), d = v0 + bay * (k + .72);
      if (f === 0 && k === Math.floor(n / 2)) {
        onLit(ctx, v1, a - .03, b + .03, base, base + 10.5, shade(wall, -30));
        onLit(ctx, v1, a, b, base, base + 9, "#5a3c22"); onLit(ctx, v1, (a + b) / 2 - .008, (a + b) / 2 + .008, base, base + 9, "#3f2a17");
        onLit(ctx, v1, a, b, base + 9, base + 10, glass);
        box(ctx, a - .06, v1, b + .06, v1 + .16, 0, base - .5, { base: "#cfc6b4", lit: "#a39a88", finish: false });
        const lamp = project(b + .09, v1, base + 8); ctx.fillStyle = "#3a3f4a"; ctx.fillRect(Math.round(lamp.x), Math.round(lamp.y) - 1, 1, 2); ctx.fillStyle = "#ffd98a"; ctx.fillRect(Math.round(lamp.x), Math.round(lamp.y) + 1, 1, 2);
      } else {
        onLit(ctx, v1, a - .025, b + .025, z0 - .6, z1 + .6, shade(wall, -32));
        onLit(ctx, v1, a, b, z0, z1, glass); onLit(ctx, v1, a, b, z1 - 1.6, z1, shade(glass, -26));
        onLit(ctx, v1, (a + b) / 2 - .008, (a + b) / 2 + .008, z0, z1, shade(wall, 6));
        onLit(ctx, v1, a - .05, b + .05, z0 - 1.6, z0 - .6, "#fffaf0");
        if (f === 0 && (k + i) % 2 === 0) { onLit(ctx, v1, a, b, z0 - 3, z0 - 1.6, "#9a5b3a"); onLit(ctx, v1, a + .02, b - .02, z0 - 2.2, z0 - 1.6, (k + i) % 4 ? "#e0607e" : "#ffd15c"); }
      }
      onShade(ctx, u1, c - .025, d + .025, z0 - .6, z1 + .6, shade(wall, -44));
      onShade(ctx, u1, c, d, z0, z1, glassShade); onShade(ctx, u1, c, d, z1 - 1.6, z1, shade(glassShade, -24));
      onShade(ctx, u1, c - .05, d + .05, z0 - 1.6, z0 - .6, shade(wall, -10));
    }
  }
  // cornice: a shadow line under it, then the projecting moulding
  onLit(ctx, v1, u0, u1, top - 1.2, top, shade(wall, -26)); onShade(ctx, u1, v0, v1, top - 1.2, top, shade(wall, -44));
  box(ctx, u0 - .1, v0 - .1, u1 + .1, v1 + .1, top, top + 2.5, { base: shade(wall, -5), finish: false });
  pxLine(ctx, project(u0 - .1, v1 + .1, top + 2.5), project(u1 + .1, v1 + .1, top + 2.5), "#fffaf0");
  if (kind === 2) {
    box(ctx, u0 + .22, v0 + .22, u1 - .22, v1 - .22, top + 2.5, top + 8, { base: shade(wall, -6), top: roof });
    balustrade(ctx, "v", v1 + .06, u0 - .06, u1 + .06, top + 2.5, "#efe9dd");
    balustrade(ctx, "u", u1 + .06, v0 - .06, v1 + .06, top + 2.5, "#efe9dd");
  } else {
    const rise = houseRise(h);
    if (kind === 1) gableRoof(ctx, u0 - .1, v0 - .1, u1 + .1, v1 + .1, top + 2.5, rise, roof, wall);
    else hipRoof(ctx, u0 - .1, v0 - .1, u1 + .1, v1 + .1, top + 2.5, rise, roof);
    if (i % 2 === 0) { box(ctx, u1 - .45, v0 + .15, u1 - .2, v0 + .4, top + 2.5, top + rise * .85, { base: "#b0a596" }); box(ctx, u1 - .48, v0 + .12, u1 - .17, v0 + .43, top + rise * .85, top + rise * .85 + 2, { base: "#8c8174" }); }
  }
  const crown = kind === 2 ? top + 10 : top + 2.5 + houseRise(h);
  if (s.active && s.active === h.path) { const a = project((u0 + u1) / 2, (v0 + v1) / 2, crown + 10); ctx.fillStyle = `rgba(255,214,90,${.5 + .4 * Math.sin(t / 160)})`; ctx.beginPath(); ctx.arc(a.x, a.y - 6, 3, 0, Math.PI * 2); ctx.fill(); }
  const verdict = h.path ? s.verdicts[h.path] : undefined;
  if (verdict) { const a = project((u0 + u1) / 2, (v0 + v1) / 2, crown); flag(ctx, a.x, a.y, verdict === "VERIFIED" ? "#1f9e62" : verdict === "FAILED" ? "#d14343" : "#e0a400", t, 18); }
}

/** A harbour warehouse: brick walls, a loading door and a low gable. */
function warehouse(ctx: CanvasRenderingContext2D, u0: number, v0: number) {
  const u1 = u0 + 2.2, v1 = v0 + 1.4;
  box(ctx, u0, v0, u1, v1, 0, 18, { base: "#b9785a" });
  for (let z = 4; z < 18; z += 4) { onLit(ctx, v1, u0, u1, z, z + .6, "#a5664b"); onShade(ctx, u1, v0, v1, z, z + .6, "#7f4c37"); }
  onLit(ctx, v1, u0 + .7, u0 + 1.5, 0, 11, "#4a3424"); onLit(ctx, v1, u0 + .7, u0 + 1.5, 11, 12, "#e8b02a");
  onLit(ctx, v1, u0 + .2, u0 + .5, 12, 15, "#86b6e8"); onLit(ctx, v1, u0 + 1.7, u0 + 2, 12, 15, "#86b6e8");
  gableRoof(ctx, u0 - .08, v0 - .08, u1 + .08, v1 + .08, 18, 9, "#6f7a86", "#b9785a");
  [[u1 + .15, v1 - .4], [u1 + .15, v1 - .1]].forEach(([u, v]) => box(ctx, u, v, u + .28, v + .28, 0, 6, { base: "#b07a44" }));
}

function well(ctx: CanvasRenderingContext2D) {
  cylinder(ctx, 8.5, 12.5, .32, 0, 7, "#a8a191", 10);
  const c = project(8.5, 12.5, 7); ctx.fillStyle = "#2f6f9a"; ctx.beginPath(); ctx.ellipse(c.x, c.y, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
  box(ctx, 8.22, 12.45, 8.28, 12.55, 7, 18, { base: "#6a4a2c" }); box(ctx, 8.72, 12.45, 8.78, 12.55, 7, 18, { base: "#6a4a2c" });
  gableRoof(ctx, 8.12, 12.3, 8.88, 12.7, 18, 6, "#b5523b", "#6a4a2c");
}

/** The bounty board on the market square: one notice per bounty, gold once PayPal has paid it. */
function bountyBoard(ctx: CanvasRenderingContext2D, paid: number, t: number, since: number) {
  const u0 = 10.1, u1 = 11.6, v = 10.45;
  [u0, u1 - .1].forEach(u => box(ctx, u, v, u + .1, v + .1, 0, 24, { base: "#5d4127" }));
  box(ctx, u0 - .04, v, u1 + .04, v + .12, 8, 23, { base: "#8a6239" });
  onLit(ctx, v + .12, u0 + .06, u1 - .06, 8.8, 22.2, "#5d4127");
  gableRoof(ctx, u0 - .16, v - .16, u1 + .16, v + .3, 24, 5, "#c4553b", "#5d4127");
  // the sign: a gold plank across the top
  onLit(ctx, v + .121, u0 + .3, u1 - .3, 19.6, 22, "#e8b02a");
  onLit(ctx, v + .122, u0 + .36, u1 - .36, 20.4, 21.2, "#7a4f12");
  for (let i = 0; i < 6; i++) {
    const col = i % 3, row = Math.floor(i / 3), uu = u0 + .14 + col * .42;
    const z = 18.6 - row * 4.8, gold = i < paid, fresh = gold && i === paid - 1 && t - since < 2500 && Math.floor(t / 160) % 2 === 0;
    onLit(ctx, v + .121, uu, uu + .34, z - 3.8, z, fresh ? "#fff8dc" : gold ? "#ffc439" : "#f4ead2");
    onLit(ctx, v + .122, uu + .06, uu + .28, z - 2.6, z - 2.2, gold ? "#9a6a00" : "#b9ad93");
    onLit(ctx, v + .122, uu + .06, uu + .22, z - 1.6, z - 1.2, gold ? "#9a6a00" : "#b9ad93");
    onLit(ctx, v + .123, uu + .15, uu + .19, z - .7, z, "#c0392b");
  }
}
/** A banner over the customs house: red while an appeal is open, green once a refund has sailed. */
function customsBanner(ctx: CanvasRenderingContext2D, open: boolean, refunded: boolean, t: number) {
  const base = project(20.6, 14, 27);
  ctx.fillStyle = "#3a2a1c"; ctx.fillRect(Math.round(base.x), Math.round(base.y) - 18, 1, 18);
  flag(ctx, Math.round(base.x) + 1, Math.round(base.y) - 18, open ? "#c0392b" : refunded ? "#1f9e62" : "#2f5fbe", t, 10);
}
/** Gold coins springing from the guild hall when a bounty lands. */
function coinBurst(ctx: CanvasRenderingContext2D, t: number, since: number) {
  const age = (t - since) / 1000; if (age < 0 || age > 2.4) return;
  const c = project(15.5, 3.5, 60);
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2, r = age * 26, x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r * .5 - age * 18 + age * age * 16;
    ctx.globalAlpha = Math.max(0, 1 - age / 2.4);
    ctx.fillStyle = "#ffc439"; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3); ctx.fillStyle = "#fff3c4"; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 1, 1);
  }
  ctx.globalAlpha = 1;
}

/* ── the frame ── */
type Drawable = { depth: number; draw: () => void };
const TREES: Array<[number, number]> = (() => {
  const t: Array<[number, number]> = [];
  // the royal forest along the far shores
  for (let v = G0 + .5; v < GRID; v += 1.2) for (let u = G0 + .5; u < GRID; u += 1.2) {
    if (u >= ROAD0 - .5 && v >= ROAD0 - .5) continue;
    const j = hash(Math.round(u * 10), Math.round(v * 10)); if (j > .18) t.push([u + j * .45, v + hash(Math.round(v * 7), Math.round(u * 3)) * .45]);
  }
  // orchards: fruit trees in straight rows
  for (const [bu, bv] of ORCHARDS) for (let dv = .6; dv < 5; dv += 1.25) for (let du = .6; du < 5; du += 1.25) t.push([blockBase(bu) + du, blockBase(bv) + dv]);
  // parks: a ring of trees around each pond
  for (const [bu, bv] of PARKS) { const b0 = blockBase(bu), c0 = blockBase(bv); for (let k = .5; k < 5; k += 1) { t.push([b0 + k, c0 + .35], [b0 + .35, c0 + k]); if (k > 1) t.push([b0 + k, c0 + 4.6], [b0 + 4.6, c0 + k]); } }
  // planters at the corners of the market square, and a coastal copse
  t.push([7.35, 7.35], [11.65, 7.35], [7.35, 11.65], [11.65, 11.65]);
  for (let k = 0; k < 9; k++) t.push([19.4 + hash(k, 1) * 4.2, 19.4 + hash(k, 2) * 4.2]);
  return t.filter(([u, v]) => !isRoad(Math.floor(u), Math.floor(v)) && !isPond(Math.floor(u), Math.floor(v)));
})();
/** Townsfolk homes that make the other blocks real neighbourhoods; they carry no data. */
const QUARTER: House[] = HOUSE_BLOCKS.flatMap(b => plotsIn(b)).map(([u, v], k) => ({ path: "", title: null, status: 200, u, v, s: 1.55 + hash(k, 5) * .15, floors: 1 + Math.round(hash(k, 9) * 1.4) }));
/** Homes nearest the market square are built first, so the town grows outward from its centre. */
const RANK_OF = new Map(QUARTER.map((h, i) => [i, Math.hypot(h.u - 9, h.v - 9)] as const).sort((a, b) => a[1] - b[1]).map(([i], r) => [i, r]));
export const QUARTER_COUNT = QUARTER.length;
/** A plot for later: mown grass, hedged corners and a little "for sale" post. */
function lot(ctx: CanvasRenderingContext2D, h: House) {
  const { u, v, s } = h;
  for (const [a, b] of [[u, v], [u + s - .25, v], [u, v + s - .25], [u + s - .25, v + s - .25]]) box(ctx, a, b, a + .25, b + .25, 0, 4, { base: "#4f9a3a" });
  box(ctx, u + s - .5, v + s - .1, u + s - .44, v + s - .04, 0, 12, { base: "#6a4a2c" });
  onLit(ctx, v + s - .03, u + s - .78, u + s - .2, 8, 13, "#f4ead2");
  onLit(ctx, v + s - .02, u + s - .7, u + s - .28, 10, 11, "#c0392b");
}
/** The helipad: a concrete pad with a painted ring and H, a hangar, landing lights and a windsock. */
function helipad(ctx: CanvasRenderingContext2D, t: number) {
  const { u, v } = PAD;
  poly(ctx, [project(u - 1.6, v - 1.6), project(u + 1.6, v - 1.6), project(u + 1.6, v + 1.6), project(u - 1.6, v + 1.6)], "#8b95a3");
  poly(ctx, [project(u - 1.45, v - 1.45), project(u + 1.45, v - 1.45), project(u + 1.45, v + 1.45), project(u - 1.45, v + 1.45)], "#9aa4b1");
  const c = project(u, v);
  ctx.strokeStyle = "#ffc439"; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(c.x, c.y, 34, 17, 0, 0, Math.PI * 2); ctx.stroke();
  const bar = (u0: number, v0: number, u1: number, v1: number) => poly(ctx, [project(u0, v0), project(u1, v0), project(u1, v1), project(u0, v1)], "#f4f6f8");
  bar(u - .55, v - .5, u - .35, v + .5); bar(u + .35, v - .5, u + .55, v + .5); bar(u - .35, v - .1, u + .35, v + .1);
  const blink = Math.floor(t / 500) % 2;
  for (const [a, b] of [[u - 1.5, v - 1.5], [u + 1.4, v - 1.5], [u - 1.5, v + 1.4], [u + 1.4, v + 1.4]]) box(ctx, a, b, a + .1, b + .1, 0, 3, { base: blink ? "#ff5a4a" : "#7a2a22" });
  // the hangar and its windsock
  box(ctx, u - 3.4, v - 1.6, u - 1.9, v + 1.4, 0, 22, { base: "#c9ced6" });
  onLit(ctx, v + 1.4, u - 3.2, u - 2.1, 0, 16, "#4b5563");
  for (let z = 2; z < 16; z += 2) onLit(ctx, v + 1.401, u - 3.2, u - 2.1, z, z + .5, "#6b7480");
  gableRoof(ctx, u - 3.5, v - 1.7, u - 1.8, v + 1.5, 22, 8, "#2f5fbe", "#c9ced6");
  const pole = project(u + 2, v - 1.2);
  ctx.fillStyle = "#5d6470"; ctx.fillRect(Math.round(pole.x), Math.round(pole.y) - 22, 1, 22);
  const sway = Math.round(Math.sin(t / 400) * 1.5);
  ctx.fillStyle = "#ff7a2f"; ctx.fillRect(Math.round(pole.x) + 1, Math.round(pole.y) - 22 + sway, 4, 3);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(Math.round(pole.x) + 5, Math.round(pole.y) - 21 + sway, 3, 2);
  ctx.fillStyle = "#ff7a2f"; ctx.fillRect(Math.round(pole.x) + 8, Math.round(pole.y) - 21 + sway, 2, 2);
}
type Heli = { u: number; v: number; z: number; flip: boolean; spin: boolean };
const TREASURY_AT = { u: 9.5, v: 3.45 };
const lerpP = (a: { u: number; v: number }, b: { u: number; v: number }, f: number) => ({ u: a.u + (b.u - a.u) * f, v: a.v + (b.v - a.v) * f });
const ease = (f: number) => f < .5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
/** Where the helicopter is: a delivery run to the treasury when money moves, otherwise a patrol lap every 50 seconds. */
function heliAt(s: SceneState, t: number): Heli {
  const pad = { u: PAD.u, v: PAD.v }, cruise = 150;
  const d = s.heliSince ? (t - s.heliSince) / 1000 : Infinity;
  if (d < 10) {
    const over = { u: TREASURY_AT.u, v: TREASURY_AT.v };
    if (d < 1) return { ...pad, z: ease(d) * cruise, flip: false, spin: true };
    if (d < 4) { const p = lerpP(pad, over, ease((d - 1) / 3)); return { ...p, z: cruise, flip: false, spin: true }; }
    if (d < 6) return { ...over, z: cruise - Math.sin((d - 4) / 2 * Math.PI) * 14, flip: false, spin: true };
    if (d < 9) { const p = lerpP(over, pad, ease((d - 6) / 3)); return { ...p, z: cruise, flip: true, spin: true }; }
    return { ...pad, z: (1 - ease(d - 9)) * cruise, flip: true, spin: true };
  }
  const c = (t / 1000) % 50;
  if (c >= 20) return { ...pad, z: 0, flip: false, spin: c < 22 };
  const centre = { u: 6, v: 6 }, r = 15, start = { u: centre.u, v: centre.v - r };
  if (c < 1.5) return { ...pad, z: ease(c / 1.5) * cruise, flip: false, spin: true };
  if (c < 4) { const p = lerpP(pad, start, ease((c - 1.5) / 2.5)); return { ...p, z: cruise, flip: p.u < pad.u, spin: true }; }
  if (c < 16) { const a = -Math.PI / 2 + (c - 4) / 12 * Math.PI * 2; return { u: centre.u + Math.cos(a) * r, v: centre.v + Math.sin(a) * r, z: cruise + Math.sin(a * 2) * 10, flip: Math.sin(a) - Math.cos(a) < 0, spin: true }; }
  if (c < 18.5) { const p = lerpP(start, pad, ease((c - 16) / 2.5)); return { ...p, z: cruise, flip: false, spin: true }; }
  return { ...pad, z: (1 - ease((c - 18.5) / 1.5)) * cruise, flip: false, spin: true };
}
/** A little pixel helicopter: blue body with a gold stripe, glass nose, tail rotor and skids. */
function helicopter(ctx: CanvasRenderingContext2D, h: Heli, t: number) {
  const g = project(h.u, h.v), p = project(h.u, h.v, h.z), x = Math.round(p.x), y = Math.round(p.y) - 6, f = h.flip ? -1 : 1;
  const sh = Math.max(.15, .35 - h.z / 600), sw = Math.max(8, 16 - h.z / 20);
  ctx.fillStyle = `rgba(20,40,10,${sh})`; ctx.beginPath(); ctx.ellipse(g.x, g.y, sw, sw / 2, 0, 0, Math.PI * 2); ctx.fill();
  const px = (dx: number, dy: number, w: number, hh: number, col: string) => { ctx.fillStyle = col; ctx.fillRect(f > 0 ? x + dx : x - dx - w, y + dy, w, hh); };
  px(-17, -4, 12, 2, "#1d4f9c"); px(-19, -8, 3, 6, "#1d4f9c"); // tail boom and fin
  const tr = h.spin && Math.floor(t / 40) % 2; px(-21, tr ? -9 : -6, 1, 5, "#dfe6f2");
  px(-7, -7, 15, 8, "#2f6fdc"); px(-6, -8, 12, 1, "#3f7fe6"); px(-7, -3, 15, 2, "#ffc439");
  px(4, -7, 5, 4, "#9fd8ff"); px(5, -6, 2, 1, "#e8f6ff"); px(-6, 1, 13, 1, "#1d4f9c");
  px(-5, 3, 1, 2, "#3a4250"); px(4, 3, 1, 2, "#3a4250"); px(-8, 5, 16, 1, "#3a4250");
  px(-1, -10, 2, 2, "#3a4250");
  // main rotor: a spinning blade, or still and long when parked
  if (h.spin) { const k = Math.abs(Math.cos(t / 35)) * 18 + 4; ctx.fillStyle = "rgba(230,236,245,.85)"; ctx.fillRect(x - Math.round(k), y - 11, Math.round(k) * 2, 1); ctx.fillStyle = "rgba(230,236,245,.35)"; ctx.fillRect(x - 20, y - 11, 40, 1); }
  else { ctx.fillStyle = "#3a4250"; ctx.fillRect(x - 18, y - 11, 36, 1); }
}
/** Gulls drifting across the sky in loose flocks. */
function birds(ctx: CanvasRenderingContext2D, t: number) {
  ctx.fillStyle = "#f4f6f8";
  for (let f = 0; f < 2; f++) {
    const span = NATIVE_W + 200, bx = ((t / 1000 * (18 + f * 7) + f * 700) % span) - 100, by = 120 + f * 260 + Math.sin(t / 3000 + f) * 20;
    for (let i = 0; i < 5; i++) {
      const x = Math.round(bx - i * 14 + (i % 2) * 4), y = Math.round(by + Math.abs(i - 2) * 6), up = Math.floor(t / 180 + i) % 2;
      ctx.fillRect(x - 3, y - (up ? 1 : 0), 3, 1); ctx.fillRect(x + 1, y - (up ? 1 : 0), 3, 1); ctx.fillRect(x, y, 1, 1);
    }
  }
}
/** A plot under construction: foundation, half-built walls, scaffolding and a pile of bricks. */
function site(ctx: CanvasRenderingContext2D, h: House, t: number, k: number) {
  const { u, v, s } = h, a = u + .2, b = v + .2, c = u + s - .2, d = v + s - .2;
  poly(ctx, [project(u, v), project(u + s, v), project(u + s, v + s), project(u, v + s)], "#c2a476");
  box(ctx, a, b, c, d, 0, 3, { base: "#b3ab9b" });
  const rise = 6 + (k % 3) * 3;
  box(ctx, a + .08, b + .08, c - .08, d - .08, 3, 3 + rise, { base: "#eadfcb" });
  onLit(ctx, d - .08, a + .4, a + .75, 3, 3 + Math.min(rise, 8), "#5a4632");
  for (const [pu, pv] of [[a - .1, b - .1], [c + .02, b - .1], [a - .1, d + .02], [c + .02, d + .02]]) box(ctx, pu, pv, pu + .07, pv + .07, 0, 24, { base: "#8a6239" });
  for (const z of [12, 23]) { onLit(ctx, d + .09, a - .1, c + .09, z, z + 1, "#a0743f"); onShade(ctx, c + .09, b - .1, d + .09, z, z + 1, "#7d5a36"); }
  box(ctx, u + .02, v + s - .42, u + .38, v + s - .06, 0, 3, { base: "#b0463f" });
  box(ctx, u + .08, v + s - .36, u + .32, v + s - .12, 3, 5, { base: "#c4553b" });
  // a builder at work, hammering on the near corner
  const p = project(c + .25, d + .3), swing = Math.floor((t + k * 300) / 260) % 2;
  sprite(ctx, person("artisan", "#d08a2b", swing as 0 | 1), p.x, p.y, k % 2 === 0);
}

const VILLAGERS = [{ road: .5, speed: .016, phase: .1, tunic: "#c47a2c" }, { road: 12.5, speed: .015, phase: .55, tunic: "#7a5aa8" }, { road: 6.5, speed: .013, phase: .8, tunic: "#3f8f83" }, { road: 18.5, speed: .014, phase: .3, tunic: "#b0463f" }, { road: -5.5, speed: .016, phase: .65, tunic: "#2f5fbe" }, { road: 12.5, speed: .012, phase: .2, tunic: "#d08a2b" }, { road: -11.5, speed: .014, phase: .4, tunic: "#5a7d3a" }, { road: -17.5, speed: .012, phase: .9, tunic: "#c0392b" }, { road: 0.5, speed: .011, phase: .7, tunic: "#7a5aa8" }];

export function drawScene(ctx: CanvasRenderingContext2D, s: SceneState, t: number) {
  sea(ctx, t);
  // ships behind the island would hide under it; the routes all pass in front
  ctx.drawImage(terrain(), 0, 0);
  foam(ctx, t);
  // contact shadows first, so no shadow paints over a neighbour
  for (const [key, u0, v0, u1, v1] of [["castle", 1.6, 4.4, 5.4, 7.6], ["treasury", 6.8, 4.4, 10.8, 8.4], ["guild", 12, 5, 15, 7.6]] as const) at(PLACE[key][0], PLACE[key][1], () => contactShadow(ctx, u0, v0, u1, v1));
  const spare = PLOTS.slice(s.houses.length).map(([u, v], k) => ({ path: "", title: null, status: 200, u, v, s: 1.5, floors: 1 + (k % 2) }));
  const standing = (i: number) => (RANK_OF.get(i) ?? 0) < (s.built ?? QUARTER.length);
  [...spare, ...QUARTER.filter((_, i) => standing(i))].forEach(h => contactShadow(ctx, h.u, h.v, h.u + h.s, h.v + h.s));
  if (s.hover) hoverGlow(ctx, s.hover);
  s.houses.forEach(h => contactShadow(ctx, h.u, h.v, h.u + h.s, h.v + h.s));
  const frame = (moving: boolean) => (moving ? Math.floor(t / 170) % 2 : 0) as 0 | 1;
  const placed = (key: keyof typeof PLACE, depth: number, draw: () => void): Drawable => ({ depth: depth + PLACE[key][0] + PLACE[key][1], draw: () => at(PLACE[key][0], PLACE[key][1], draw) });
  const items: Drawable[] = [
    placed("castle", 12.6, () => castle(ctx, t)),
    placed("treasury", 18.8, () => treasury(ctx, s, t)),
    placed("guild", 22.6, () => guild(ctx, t)),
    placed("mill", 18.6, () => windmill(ctx, t)),
    placed("market", 25, () => well(ctx)),
    placed("market", 6.4 + 10.2 + 1.9, () => stall(ctx, 6.4, 10.2, "#c4553b", ["#e05a3a", "#f2c14e", "#7fb84e"])),
    placed("market", 9.2 + 10.2 + 1.9, () => stall(ctx, 9.2, 10.2, "#2f6fdc", ["#9fd0ff", "#f2c14e", "#b07a44"])),
    placed("harbour", 17.4 + 15.9, () => pier(ctx)),
    placed("harbour", 21.3 + 14.4 + .6, () => lighthouse(ctx, t)),
    { depth: 19.5 + 13.3 + 3.6, draw: () => warehouse(ctx, 19.5, 13.3) },
    { depth: 19.5 + 16.4 + 3.6, draw: () => warehouse(ctx, 19.5, 16.4) },
    { depth: 19.5 + 13.3 + 3.7, draw: () => customsBanner(ctx, !!s.appealOpen, !!s.refunded, t) },
    { depth: 10.9 + 10.5 + .3, draw: () => bountyBoard(ctx, s.bounties ?? 0, t, s.bountySince ?? 0) },
  ];
  s.houses.forEach((h, i) => items.push({ depth: h.u + h.v + 2 * h.s, draw: () => house(ctx, h, i, s, t) }));
  spare.forEach((h, i) => items.push({ depth: h.u + h.v + 2 * h.s, draw: () => house(ctx, h, i + 5, s, t) }));
  const rank = (i: number) => (RANK_OF.get(i) ?? 0) - (s.built ?? QUARTER.length);
  QUARTER.forEach((h, i) => items.push({ depth: h.u + h.v + 2 * h.s, draw: () => standing(i) ? house(ctx, h, i + 5 + spare.length, s, t) : rank(i) < 4 ? site(ctx, h, t, i) : lot(ctx, h) }));
  items.push({ depth: PAD.u + PAD.v - 1.4, draw: () => helipad(ctx, t) });
  const heli = heliAt(s, t);
  if (heli.z < 2) items.push({ depth: heli.u + heli.v + .5, draw: () => helicopter(ctx, heli, t) });
  TREES.forEach(([u, v], i) => items.push({ depth: u + v, draw: () => tree(ctx, u, v, i) }));
  // ships: the guild's galleon at the pier sails out carrying the gold once it is released
  const sailing = s.paid ? Math.min(1, (t - s.paidSince) / 9000) : 0;
  const galleonU = 26.8 + sailing * 9, galleonV = 16.9 + sailing * 4;
  items.push({ depth: galleonU + galleonV, draw: () => ship(ctx, galleonU, galleonV, true, t, { cargo: s.paid, flagColor: "#1f9e62", hull: "#3d2a1c" }) });
  // a granted appeal: a cutter carries the refunded gold back west to the client
  if (s.refunded && s.refundSince !== undefined) {
    const f = Math.min(1, (t - s.refundSince) / 10000), ru = 24 - f * 22, rv = 19 + f * 8.5;
    if (f < 1) items.push({ depth: ru + rv, draw: () => { ctx.globalAlpha = Math.min(1, (1 - f) * 6); ship(ctx, ru, rv, true, t, { cargo: true, flagColor: "#2f5fbe", hull: "#2a3348", scale: .7 }); ctx.globalAlpha = 1; } });
  }
  // two trading ships on loops that stay inside the visible sea, fading in and out at each end
  const voyage = (speed: number, offset: number, from: number, to: number) => { const f = ((t / 1000 * speed + offset) % (to - from)) / (to - from); return { at: from + f * (to - from), alpha: Math.min(1, f * 8, (1 - f) * 8) }; };
  const a = voyage(.32, 0, -10, 30), b = voyage(.25, 11, -12, 26);
  items.push({ depth: a.at + 27.5, draw: () => { ctx.globalAlpha = a.alpha; ship(ctx, a.at, 27.5, true, t, { flagColor: "#2f6fdc", hull: "#2a3348", scale: .85 }); ctx.globalAlpha = 1; } });
  items.push({ depth: 29.8 + b.at, draw: () => { ctx.globalAlpha = b.alpha; ship(ctx, 29.8, b.at, false, t, { flagColor: "#c0392b", hull: "#4a2e22", scale: .75 }); ctx.globalAlpha = 1; } });
  // the people of the realm
  items.push({ depth: 3.5 + 5.25, draw: () => { const p = project(3.5, 5.25); sprite(ctx, person("king", "#2f5fbe", 0), p.x, p.y); } });
  items.push({ depth: 15.5 + 5, draw: () => { const p = project(15.5, 5); sprite(ctx, person("artisan", "#5a7d3a", 0), p.x, p.y, true); } });
  VILLAGERS.forEach(vl => {
    const x = (t / 1000 * vl.speed + vl.phase) % 2, dir = x < 1 ? 1 : -1, u = ROAD0 + .5 + 41 * (x < 1 ? x : 2 - x);
    if (vl.road === 6.5 && Math.abs(u - s.cartU) < .8) return;
    items.push({ depth: u + vl.road + .2, draw: () => { const p = project(u, vl.road + .2); sprite(ctx, person("artisan", vl.tunic, frame(true)), p.x, p.y, dir < 0); } });
  });
  if (s.held) [[7.6, 5.45], [11.4, 5.45]].forEach(([u, v], i) => items.push({ depth: u + v, draw: () => {
    const p = project(u, v); sprite(ctx, person("guard", "#c0392b", 0), p.x, p.y, i === 1);
    ctx.fillStyle = "#8a6a44"; ctx.fillRect(Math.round(p.x) + (i ? -5 : 5), Math.round(p.y) - 20, 1, 19); ctx.fillStyle = "#c9d3e3"; ctx.fillRect(Math.round(p.x) + (i ? -5 : 5), Math.round(p.y) - 23, 1, 3);
  } }));
  items.push({ depth: s.cartU + 6.5, draw: () => { const p = project(s.cartU, 6.5); sprite(ctx, CART, p.x, p.y + (s.cartMoving && Math.floor(t / 140) % 2 ? -1 : 0)); } });
  if (s.showCrew) s.inspectors.forEach(w => items.push({ depth: w.u + w.v, draw: () => {
    const p = project(w.u, w.v);
    ctx.fillStyle = "rgba(20,40,10,.25)"; ctx.beginPath(); ctx.ellipse(p.x + 1, p.y, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
    sprite(ctx, person("inspector", w.tunic, frame(w.moving)), p.x, p.y, w.flip);
  } }));
  items.sort((a, b) => a.depth - b.depth).forEach(i => i.draw());
  if (heli.z >= 2) helicopter(ctx, heli, t);
  birds(ctx, t);
  if (s.bountySince) coinBurst(ctx, t, s.bountySince);
  if (s.quest) questMarker(ctx, s.quest, t);
}

/** Screen-space box for a house, in native pixels, for clicks and labels. */
export function houseBounds(h: House): { x0: number; x1: number; y0: number; y1: number; label: P } {
  const wallTop = houseTop(h) + 2.5, rise = houseRise(h);
  const left = project(h.u, h.v + h.s), right = project(h.u + h.s, h.v), bottom = project(h.u + h.s, h.v + h.s), apex = project(h.u + h.s / 2, h.v + h.s / 2, wallTop + rise);
  return { x0: left.x, x1: right.x, y0: apex.y, y1: bottom.y, label: { x: (left.x + right.x) / 2, y: bottom.y + 9 } };
}

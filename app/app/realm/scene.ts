import { CART, CHEST, GRID, NATIVE_H, NATIVE_W, box, cone, contactShadow, cylinder, dome, flag, gableRoof, hipRoof, onLit, onShade, person, poly, project, shade, sprite, tree, type P } from "./engine";

/* Palettes per landmark, sharing one gold accent so the kingdom reads as one place. */
const GOLD = "#e8b02a";
const STONE = { wall: "#c9c3b6", keep: "#d4cec2", trim: "#a8a191", slot: "#3a3530", roof: "#3a6ccf", course: "#b6af9f" };
const MARBLE = { base: "#ece6da", column: "#f4f0e6", cella: "#e2dbcc", roof: "#143b8c", door: "#4e3d2c" };
const TIMBER = { wall: "#efe2c6", beam: "#6a4a2c", roof: "#b5523b", glow: "#ffd98a" };
const HOUSE_ROOFS = ["#3b6fd4", "#c4553b", "#2f8f83", "#7a5aa8", "#d08a2b", "#4a7fc0", "#b0463f", "#3f8f5a"];
const HOUSE_WALL = "#f2eee4";
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
};
export type Landmark = "castle" | "treasury" | "guild";
/** Footprint and height of each landmark, for clicks, hover glow and the quest marker. */
const LANDMARKS: Record<Landmark, { u0: number; v0: number; u1: number; v1: number; top: number }> = {
  castle: { u0: 1.6, v0: 4.4, u1: 5.4, v1: 7.6, top: 92 },
  treasury: { u0: 6.8, v0: 4.4, u1: 10.8, v1: 8.4, top: 128 },
  guild: { u0: 12, v0: 5, u1: 15, v1: 7.6, top: 70 },
};
export function landmarkBounds(l: Landmark) {
  const b = LANDMARKS[l];
  const left = project(b.u0, b.v1), right = project(b.u1, b.v0), bottom = project(b.u1, b.v1), top = project((b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2, b.top);
  return { x0: left.x, x1: right.x, y0: top.y, y1: bottom.y, cx: (left.x + right.x) / 2, top: top.y };
}
export function landmarkAt(x: number, y: number): Landmark | null {
  for (const l of ["treasury", "guild", "castle"] as Landmark[]) { const b = landmarkBounds(l); if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return l; }
  return null;
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
  (v === 8 && u >= 1 && u <= 16) || (u === 8 && v >= 8 && v <= 12) || (v === 12 && u >= 1 && u <= 16) || (v === 15 && u >= 15 && u <= 17);
const isField = (u: number, v: number) => u >= 11 && u <= 14 && v >= 0 && v <= 3;
const hash = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

let terrainCache: HTMLCanvasElement | null = null;
function terrain(): HTMLCanvasElement {
  if (terrainCache) return terrainCache;
  const c = document.createElement("canvas");
  c.width = NATIVE_W; c.height = NATIVE_H;
  const ctx = c.getContext("2d")!;
  // cliffs with strata
  poly(ctx, [project(0, GRID), project(GRID, GRID), project(GRID, GRID, SEA_Z), project(0, GRID, SEA_Z)], "#9a7148");
  poly(ctx, [project(GRID, 0), project(GRID, GRID), project(GRID, GRID, SEA_Z), project(GRID, 0, SEA_Z)], "#7a5734");
  for (const z of [-9, -17]) {
    poly(ctx, [project(0, GRID, z), project(GRID, GRID, z), project(GRID, GRID, z - 2), project(0, GRID, z - 2)], "#86603b");
    poly(ctx, [project(GRID, 0, z), project(GRID, GRID, z), project(GRID, GRID, z - 2), project(GRID, 0, z - 2)], "#664a2c");
  }
  for (let i = 0; i < 40; i++) { const t = hash(i, 4); const p = i % 2 ? project(t * GRID, GRID, -4 - hash(i, 8) * 18) : project(GRID, t * GRID, -4 - hash(i, 8) * 18); ctx.fillStyle = i % 2 ? "#b08559" : "#8d6740"; ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 1); }
  for (let v = 0; v < GRID; v++) for (let u = 0; u < GRID; u++) {
    const quad = [project(u, v), project(u + 1, v), project(u + 1, v + 1), project(u, v + 1)];
    if (isRoad(u, v)) {
      poly(ctx, quad, (u + v) % 2 ? "#d3cab8" : "#cdc4b1");
      ctx.fillStyle = "#b9af9a";
      for (let k = 0; k < 6; k++) { const p = project(u + hash(u, v + k) * .8 + .1, v + hash(v, u + k) * .8 + .1); ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 1); }
    } else if (isField(u, v)) {
      poly(ctx, quad, "#9b7449");
      for (let r = .15; r < 1; r += .25) { const a = project(u + r, v + .08), b = project(u + r, v + .92); ctx.strokeStyle = (u + v) % 2 ? "#d9b84a" : "#7fb84e"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    } else {
      poly(ctx, quad, (u + v) % 2 ? "#7cc24f" : "#74ba48");
      if (hash(u, v) > .5) { ctx.fillStyle = hash(v, u) > .5 ? "#8fd162" : "#62a83d"; const p = project(u + .3 + hash(u, v) * .4, v + .3 + hash(v, u) * .4); ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 2); ctx.fillRect(Math.round(p.x) + 2, Math.round(p.y) + 1, 1, 1); }
      if (hash(u * 3, v * 5) > .93) { const p = project(u + .5, v + .5); ["#ff6f91", "#ffd15c", "#ffffff"].forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(Math.round(p.x) + i * 3 - 3, Math.round(p.y) + (i % 2), 1, 1); }); }
    }
  }
  ctx.strokeStyle = "rgba(120,104,80,.55)"; ctx.lineWidth = 1;
  for (let v = 0; v < GRID; v++) for (let u = 0; u < GRID; u++) {
    if (!isRoad(u, v)) continue;
    const edges: Array<[number, number, number, number, boolean]> = [[u, v, u + 1, v, !isRoad(u, v - 1)], [u, v + 1, u + 1, v + 1, !isRoad(u, v + 1)], [u, v, u, v + 1, !isRoad(u - 1, v)], [u + 1, v, u + 1, v + 1, !isRoad(u + 1, v)]];
    for (const [a, b, cc, d, on] of edges) if (on) { const p = project(a, b), q = project(cc, d); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
  }
  ctx.strokeStyle = "#5f9e3a"; ctx.lineWidth = 2;
  ctx.beginPath(); const a = project(0, GRID), b = project(GRID, GRID), cc = project(GRID, 0);
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
  for (let i = 0; i < GRID * 4; i++) {
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
    cylinder(ctx, cu, cv, .58, h, h + 4, STONE.keep);
    cone(ctx, cu, cv, .64, h + 4, 30, STONE.roof);
    const tip = project(cu, cv, h + 34); ctx.fillStyle = GOLD; ctx.fillRect(Math.round(tip.x), Math.round(tip.y) - 2, 1, 2);
  };
  tower(2, 4.8);
  box(ctx, 2, 4.8, 5, 7.2, 0, 30, { base: STONE.wall });
  courses(ctx, 2, 4.8, 5, 7.2, 0, 30, STONE.course);
  for (let u = 2.1; u < 4.95; u += .42) box(ctx, u, 7.0, u + .22, 7.2, 30, 35, { base: STONE.wall });
  for (let v = 4.9; v < 7.15; v += .42) box(ctx, 4.8, v, 5, v + .22, 30, 35, { base: STONE.wall });
  box(ctx, 3, 5.4, 4.4, 6.6, 0, 58, { base: STONE.keep });
  courses(ctx, 3, 5.4, 4.4, 6.6, 30, 58, shade(STONE.keep, -10));
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
  dome(ctx, 8.8, 6.35, .72, 66, 30, GOLD);
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

function house(ctx: CanvasRenderingContext2D, h: House, i: number, s: SceneState, t: number) {
  const u0 = h.u, v0 = h.v, u1 = h.u + h.s, v1 = h.v + h.s, wallTop = 8 + h.floors * 13, roof = HOUSE_ROOFS[i % HOUSE_ROOFS.length];
  box(ctx, u0, v0, u1, v1, 0, wallTop, { base: HOUSE_WALL });
  onLit(ctx, v1, u0, u1, 0, 4, "#2c4f8f"); onShade(ctx, u1, v0, v1, 0, 4, "#22406f");
  const lit = s.visited.has(h.path);
  const glass = lit ? "#ffe39a" : "#86b6e8", glassShade = lit ? "#e8c46a" : "#6a95c4";
  const n = Math.max(2, Math.round(h.s * 2));
  for (let f = 0; f < h.floors; f++) {
    const z0 = 8 + f * 13, z1 = z0 + 7;
    for (let k = 0; k < n; k++) {
      const a = u0 + (h.s / n) * (k + .28), b = a + (h.s / n) * .44;
      if (f === 0 && k === Math.floor(n / 2)) {
        onLit(ctx, v1, a - .03, b + .03, 0, 13, "#8a6a44"); onLit(ctx, v1, a, b, 0, 11, "#5a3c22");
        const step = project((a + b) / 2, v1 + .06); ctx.fillStyle = "#b9b2a3"; ctx.fillRect(Math.round(step.x) - 3, Math.round(step.y) - 1, 7, 2);
        continue;
      }
      onLit(ctx, v1, a, b, z0, z1, glass); onLit(ctx, v1, (a + b) / 2 - .01, (a + b) / 2 + .01, z0, z1, "#d9d3c4"); onLit(ctx, v1, a - .03, b + .03, z0 - 1, z0, "#b7b1a3");
      if ((k + f + i) % 3 === 0) onLit(ctx, v1, a, b, z0 - 3, z0 - 1, "#e0607e");
      const c = v0 + (h.s / n) * (k + .28), d = c + (h.s / n) * .44;
      onShade(ctx, u1, c, d, z0, z1, glassShade); onShade(ctx, u1, c - .03, d + .03, z0 - 1, z0, "#a39d90");
    }
  }
  box(ctx, u0 - .06, v0 - .06, u1 + .06, v1 + .06, wallTop, wallTop + 2, { base: shade(HOUSE_WALL, -6) });
  const rise = 12 + h.s * 5;
  if (i % 3 === 1) gableRoof(ctx, u0 - .08, v0 - .08, u1 + .08, v1 + .08, wallTop + 2, rise, roof, HOUSE_WALL);
  else hipRoof(ctx, u0 - .08, v0 - .08, u1 + .08, v1 + .08, wallTop + 2, rise, roof);
  if (i % 2 === 0) box(ctx, u1 - .45, v0 + .15, u1 - .2, v0 + .4, wallTop + 2, wallTop + rise * .85, { base: "#b0a596" });
  if (s.active === h.path) { const a = project((u0 + u1) / 2, (v0 + v1) / 2, wallTop + rise + 10); ctx.fillStyle = `rgba(255,214,90,${.5 + .4 * Math.sin(t / 160)})`; ctx.beginPath(); ctx.arc(a.x, a.y - 6, 3, 0, Math.PI * 2); ctx.fill(); }
  const verdict = s.verdicts[h.path];
  if (verdict) { const a = project((u0 + u1) / 2, (v0 + v1) / 2, wallTop + rise); flag(ctx, a.x, a.y, verdict === "VERIFIED" ? "#1f9e62" : verdict === "FAILED" ? "#d14343" : "#e0a400", t, 18); }
}

function well(ctx: CanvasRenderingContext2D) {
  cylinder(ctx, 8.5, 12.5, .32, 0, 7, "#a8a191", 10);
  const c = project(8.5, 12.5, 7); ctx.fillStyle = "#2f6f9a"; ctx.beginPath(); ctx.ellipse(c.x, c.y, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
  box(ctx, 8.22, 12.45, 8.28, 12.55, 7, 18, { base: "#6a4a2c" }); box(ctx, 8.72, 12.45, 8.78, 12.55, 7, 18, { base: "#6a4a2c" });
  gableRoof(ctx, 8.12, 12.3, 8.88, 12.7, 18, 6, "#b5523b", "#6a4a2c");
}

/* ── the frame ── */
type Drawable = { depth: number; draw: () => void };
const TREES: Array<[number, number]> = [[.7, .8], [2.6, .6], [5.6, 1.2], [8.8, .8], [16.8, .7], [.6, 3.2], [16.9, 6.2], [.6, 10.2], [16.7, 10.6], [.7, 15.2], [3.2, 16.7], [7.2, 16.6], [11.6, 16.7], [6.2, 3], [10.2, 2.8], [14.6, 16.8], [16.8, 12.8], [9.4, 16.8]];
const VILLAGERS = [{ road: 8.5, speed: .045, phase: .1, tunic: "#c47a2c" }, { road: 12.5, speed: .038, phase: .55, tunic: "#7a5aa8" }, { road: 8.5, speed: .03, phase: .8, tunic: "#3f8f83" }];

export function drawScene(ctx: CanvasRenderingContext2D, s: SceneState, t: number) {
  sea(ctx, t);
  // ships behind the island would hide under it; the routes all pass in front
  ctx.drawImage(terrain(), 0, 0);
  foam(ctx, t);
  // contact shadows first, so no shadow paints over a neighbour
  contactShadow(ctx, 1.6, 4.4, 5.4, 7.6); contactShadow(ctx, 6.8, 4.4, 10.8, 8.4); contactShadow(ctx, 12, 5, 15, 7.6);
  if (s.hover) hoverGlow(ctx, s.hover);
  s.houses.forEach(h => contactShadow(ctx, h.u, h.v, h.u + h.s, h.v + h.s));
  const frame = (moving: boolean) => (moving ? Math.floor(t / 170) % 2 : 0) as 0 | 1;
  const items: Drawable[] = [
    { depth: 12.6, draw: () => castle(ctx, t) },
    { depth: 18.8, draw: () => treasury(ctx, s, t) },
    { depth: 22.6, draw: () => guild(ctx, t) },
    { depth: 18.6, draw: () => windmill(ctx, t) },
    { depth: 25, draw: () => well(ctx) },
    { depth: 6.4 + 10.2 + 1.9, draw: () => stall(ctx, 6.4, 10.2, "#c4553b", ["#e05a3a", "#f2c14e", "#7fb84e"]) },
    { depth: 9.2 + 10.2 + 1.9, draw: () => stall(ctx, 9.2, 10.2, "#2f6fdc", ["#9fd0ff", "#f2c14e", "#b07a44"]) },
    { depth: 17.4 + 15.9, draw: () => pier(ctx) },
    { depth: 21.3 + 14.4 + .6, draw: () => lighthouse(ctx, t) },
  ];
  s.houses.forEach((h, i) => items.push({ depth: h.u + h.v + 2 * h.s, draw: () => house(ctx, h, i, s, t) }));
  TREES.forEach(([u, v], i) => items.push({ depth: u + v, draw: () => tree(ctx, u, v, i) }));
  // ships: the guild's galleon at the pier sails out carrying the gold once it is released
  const sailing = s.paid ? Math.min(1, (t - s.paidSince) / 9000) : 0;
  const galleonU = 20.2 + sailing * 9, galleonV = 16.9 + sailing * 4;
  items.push({ depth: galleonU + galleonV, draw: () => ship(ctx, galleonU, galleonV, true, t, { cargo: s.paid, flagColor: "#1f9e62", hull: "#3d2a1c" }) });
  // two trading ships on loops that stay inside the visible sea, fading in and out at each end
  const voyage = (speed: number, offset: number, from: number, to: number) => { const f = ((t / 1000 * speed + offset) % (to - from)) / (to - from); return { at: from + f * (to - from), alpha: Math.min(1, f * 8, (1 - f) * 8) }; };
  const a = voyage(.32, 0, 2, 24), b = voyage(.25, 11, 0, 22);
  items.push({ depth: a.at + 21.5, draw: () => { ctx.globalAlpha = a.alpha; ship(ctx, a.at, 21.5, true, t, { flagColor: "#2f6fdc", hull: "#2a3348", scale: .85 }); ctx.globalAlpha = 1; } });
  items.push({ depth: 23.2 + b.at, draw: () => { ctx.globalAlpha = b.alpha; ship(ctx, 23.2, b.at, false, t, { flagColor: "#c0392b", hull: "#4a2e22", scale: .75 }); ctx.globalAlpha = 1; } });
  // the people of the realm
  items.push({ depth: 3.5 + 7.75, draw: () => { const p = project(3.5, 7.75); sprite(ctx, person("king", "#2f5fbe", 0), p.x, p.y); } });
  items.push({ depth: 13.5 + 7.8, draw: () => { const p = project(13.5, 7.8); sprite(ctx, person("artisan", "#5a7d3a", 0), p.x, p.y, true); } });
  VILLAGERS.forEach(vl => {
    const x = (t / 1000 * vl.speed + vl.phase) % 2, dir = x < 1 ? 1 : -1, u = 1.6 + 14.8 * (x < 1 ? x : 2 - x);
    if (vl.road === 8.5 && Math.abs(u - s.cartU) < .8) return;
    items.push({ depth: u + vl.road + .2, draw: () => { const p = project(u, vl.road + .2); sprite(ctx, person("artisan", vl.tunic, frame(true)), p.x, p.y, dir < 0); } });
  });
  if (s.held) [[6.9, 8.6], [10.7, 8.6]].forEach(([u, v], i) => items.push({ depth: u + v, draw: () => {
    const p = project(u, v); sprite(ctx, person("guard", "#c0392b", 0), p.x, p.y, i === 1);
    ctx.fillStyle = "#8a6a44"; ctx.fillRect(Math.round(p.x) + (i ? -5 : 5), Math.round(p.y) - 20, 1, 19); ctx.fillStyle = "#c9d3e3"; ctx.fillRect(Math.round(p.x) + (i ? -5 : 5), Math.round(p.y) - 23, 1, 3);
  } }));
  items.push({ depth: s.cartU + 8.5, draw: () => { const p = project(s.cartU, 8.5); sprite(ctx, CART, p.x, p.y + (s.cartMoving && Math.floor(t / 140) % 2 ? -1 : 0)); } });
  if (s.showCrew) s.inspectors.forEach(w => items.push({ depth: w.u + w.v, draw: () => {
    const p = project(w.u, w.v);
    ctx.fillStyle = "rgba(20,40,10,.25)"; ctx.beginPath(); ctx.ellipse(p.x + 1, p.y, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
    sprite(ctx, person("inspector", w.tunic, frame(w.moving)), p.x, p.y, w.flip);
  } }));
  items.sort((a, b) => a.depth - b.depth).forEach(i => i.draw());
  if (s.quest) questMarker(ctx, s.quest, t);
}

/** Screen-space box for a house, in native pixels, for clicks and labels. */
export function houseBounds(h: House): { x0: number; x1: number; y0: number; y1: number; label: P } {
  const wallTop = 8 + h.floors * 13, rise = 12 + h.s * 5;
  const left = project(h.u, h.v + h.s), right = project(h.u + h.s, h.v), bottom = project(h.u + h.s, h.v + h.s), apex = project(h.u + h.s / 2, h.v + h.s / 2, wallTop + rise);
  return { x0: left.x, x1: right.x, y0: apex.y, y1: bottom.y, label: { x: (left.x + right.x) / 2, y: bottom.y + 9 } };
}

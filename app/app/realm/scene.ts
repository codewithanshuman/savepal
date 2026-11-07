import { CART, CHEST, GRID, NATIVE_H, NATIVE_W, box, cone, contactShadow, cylinder, dome, flag, gableRoof, hipRoof, onLit, onShade, person, poly, project, shade, sprite, tree, type P } from "./engine";

/* Palettes per landmark, sharing one gold accent so the kingdom reads as one place. */
const GOLD = "#e8b02a";
const STONE = { wall: "#c9c3b6", keep: "#d4cec2", trim: "#a8a191", slot: "#3a3530", roof: "#3a6ccf" };
const MARBLE = { base: "#ece6da", column: "#f4f0e6", cella: "#e2dbcc", roof: "#143b8c", door: "#4e3d2c" };
const TIMBER = { wall: "#efe2c6", beam: "#6a4a2c", roof: "#b5523b", glow: "#ffd98a" };
const HOUSE_ROOFS = ["#3b6fd4", "#c4553b", "#2f8f83", "#7a5aa8", "#d08a2b", "#4a7fc0", "#b0463f"];
const HOUSE_WALL = "#f2eee4";

export type Verdict = "VERIFIED" | "FAILED" | "INCONCLUSIVE";
export type House = { path: string; u: number; v: number; s: number; floors: number; title: string | null; status: number };
export type Walker = { u: number; v: number; moving: boolean; flip: boolean; tunic: string };
export type SceneState = {
  houses: House[]; verdicts: Record<string, Verdict>; visited: Set<string>; active: string | null;
  held: boolean; approved: boolean; paid: boolean;
  cartU: number; cartMoving: boolean; inspectors: Walker[]; showCrew: boolean;
  chestsSince: number; sealSince: number;
};

/* ── terrain ── */
const isRoad = (u: number, v: number) =>
  (v === 8 && u >= 1 && u <= 16) || (u === 8 && v >= 8 && v <= 12) || (v === 12 && u >= 1 && u <= 16);
const hash = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

function drawSea(ctx: CanvasRenderingContext2D, t: number) {
  const g = ctx.createLinearGradient(0, 0, 0, NATIVE_H);
  g.addColorStop(0, "#2f7fb3"); g.addColorStop(1, "#1f5f8f");
  ctx.fillStyle = g; ctx.fillRect(0, 0, NATIVE_W, NATIVE_H);
  ctx.fillStyle = "rgba(255,255,255,.18)";
  for (let i = 0; i < 70; i++) {
    const x = (hash(i, 3) * NATIVE_W + t * .006 * (1 + hash(i, 7))) % NATIVE_W, y = hash(i, 9) * NATIVE_H;
    if (Math.floor(t / 600 + i) % 3 === 0) continue;
    ctx.fillRect(Math.round(x), Math.round(y), 3, 1);
  }
}

function drawTerrain(ctx: CanvasRenderingContext2D) {
  // Cliffs under the island: earth with a darker strata line.
  poly(ctx, [project(0, GRID), project(GRID, GRID), project(GRID, GRID, -26), project(0, GRID, -26)], "#9a7148");
  poly(ctx, [project(GRID, 0), project(GRID, GRID), project(GRID, GRID, -26), project(GRID, 0, -26)], "#7a5734");
  poly(ctx, [project(0, GRID, -14), project(GRID, GRID, -14), project(GRID, GRID, -16), project(0, GRID, -16)], "#86603b");
  poly(ctx, [project(GRID, 0, -14), project(GRID, GRID, -14), project(GRID, GRID, -16), project(GRID, 0, -16)], "#664a2c");
  for (let v = 0; v < GRID; v++) for (let u = 0; u < GRID; u++) {
    const road = isRoad(u, v);
    const quad = [project(u, v), project(u + 1, v), project(u + 1, v + 1), project(u, v + 1)];
    if (road) {
      poly(ctx, quad, (u + v) % 2 ? "#d3cab8" : "#cdc4b1");
      ctx.fillStyle = "#b9af9a";
      for (let k = 0; k < 5; k++) { const p = project(u + hash(u, v + k) * .8 + .1, v + hash(v, u + k) * .8 + .1); ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 1); }
    } else {
      poly(ctx, quad, (u + v) % 2 ? "#7cc24f" : "#74ba48");
      if (hash(u, v) > .55) { ctx.fillStyle = hash(v, u) > .5 ? "#8fd162" : "#62a83d"; const p = project(u + .3 + hash(u, v) * .4, v + .3 + hash(v, u) * .4); ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 2); ctx.fillRect(Math.round(p.x) + 2, Math.round(p.y) + 1, 1, 1); }
    }
  }
  // Curbs: a darker seam where road meets grass reads as kerbstone.
  ctx.strokeStyle = "rgba(120,104,80,.55)"; ctx.lineWidth = 1;
  for (let v = 0; v < GRID; v++) for (let u = 0; u < GRID; u++) {
    if (!isRoad(u, v)) continue;
    const edges: Array<[number, number, number, number, boolean]> = [[u, v, u + 1, v, !isRoad(u, v - 1)], [u, v + 1, u + 1, v + 1, !isRoad(u, v + 1)], [u, v, u, v + 1, !isRoad(u - 1, v)], [u + 1, v, u + 1, v + 1, !isRoad(u + 1, v)]];
    for (const [a, b, c, d, on] of edges) if (on) { const p = project(a, b), q = project(c, d); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
  }
  // Grass lip along the cliff edge.
  ctx.strokeStyle = "#5f9e3a"; ctx.lineWidth = 2;
  ctx.beginPath(); const a = project(0, GRID), b = project(GRID, GRID), c = project(GRID, 0);
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke();
}

/* ── landmarks ── */
function castle(ctx: CanvasRenderingContext2D, t: number) {
  contactShadow(ctx, 1.6, 4.4, 5.4, 7.6);
  const tower = (cu: number, cv: number) => {
    cylinder(ctx, cu, cv, .5, 0, 50, STONE.wall);
    for (let i = 0; i < 6; i++) { const a = Math.PI * (i / 6) - .2; const p = project(cu + .5 * Math.cos(a), cv + .5 * Math.sin(a), 46); if (Math.cos(a) + Math.sin(a) > 0) { ctx.fillStyle = STONE.slot; ctx.fillRect(Math.round(p.x), Math.round(p.y) - 8, 1, 4); } }
    cone(ctx, cu, cv, .62, 50, 30, STONE.roof);
  };
  tower(2, 4.8);
  box(ctx, 2, 4.8, 5, 7.2, 0, 30, { base: STONE.wall });
  // battlements along the two visible walls
  for (let u = 2.1; u < 4.95; u += .42) box(ctx, u, 7.0, u + .22, 7.2, 30, 35, { base: STONE.wall });
  for (let v = 4.9; v < 7.15; v += .42) box(ctx, 4.8, v, 5, v + .22, 30, 35, { base: STONE.wall });
  box(ctx, 3, 5.4, 4.4, 6.6, 0, 56, { base: STONE.keep });
  for (let u = 3.05; u < 4.35; u += .36) box(ctx, u, 6.42, u + .2, 6.6, 56, 61, { base: STONE.keep });
  onLit(ctx, 6.6, 3.5, 3.62, 38, 47, STONE.slot); onLit(ctx, 6.6, 3.85, 3.97, 38, 47, STONE.slot);
  onShade(ctx, 4.4, 5.8, 5.92, 38, 47, STONE.slot); onShade(ctx, 4.4, 6.1, 6.22, 38, 47, STONE.slot);
  // gatehouse: dark arch with portcullis bars and a timber lintel
  onLit(ctx, 7.2, 3.1, 3.9, 0, 18, "#2e2924");
  for (let u = 3.22; u < 3.85; u += .16) onLit(ctx, 7.2, u, u + .04, 0, 18, "#6a5a48");
  onLit(ctx, 7.2, 3.0, 4.0, 18, 21, STONE.trim);
  for (let u = 2.4; u < 4.9; u += .9) if (u < 3 || u > 4) onLit(ctx, 7.2, u, u + .1, 14, 22, STONE.slot);
  const top = project(3.7, 6.0, 61); flag(ctx, top.x, top.y, "#2f6fdc", t, 22);
  tower(5, 4.8); tower(2, 7.2); tower(5, 7.2);
}

function treasury(ctx: CanvasRenderingContext2D, s: SceneState, t: number) {
  if (s.held) { const c = project(8.8, 6.4, 6); ctx.fillStyle = `rgba(255,200,70,${.16 + .06 * Math.sin(t / 500)})`; ctx.beginPath(); ctx.ellipse(c.x, c.y, 82, 38, 0, 0, Math.PI * 2); ctx.fill(); }
  contactShadow(ctx, 6.8, 4.4, 10.8, 8.2);
  box(ctx, 6.8, 4.4, 10.8, 8.4, 0, 5, { base: MARBLE.base });
  box(ctx, 7.0, 4.6, 10.6, 8.1, 5, 10, { base: MARBLE.base });
  // risers darker than treads so the stair reads
  onLit(ctx, 8.4, 7.6, 10.0, 0, 5, shade(MARBLE.base, -16));
  box(ctx, 7.6, 5.0, 10.0, 7.2, 10, 50, { base: MARBLE.cella });
  onLit(ctx, 7.2, 8.45, 9.15, 10, 34, MARBLE.door);
  onLit(ctx, 7.2, 8.45, 9.15, 34, 36, GOLD);
  for (let v = 5.15; v < 7.5; v += .62) box(ctx, 10.18, v, 10.42, v + .24, 10, 48, { base: MARBLE.column });
  for (let u = 7.2; u < 10.5; u += .6) box(ctx, u, 7.68, u + .24, 7.92, 10, 48, { base: MARBLE.column });
  // entablature with a gold frieze band
  box(ctx, 7.05, 4.8, 10.6, 8.0, 48, 57, { base: MARBLE.base });
  onLit(ctx, 8.0, 7.05, 10.6, 51, 53, GOLD); onShade(ctx, 10.6, 4.8, 8.0, 51, 53, shade(GOLD, -18));
  // flat deck with a gable standing on its front edge (true slopes read as a shed)
  box(ctx, 7.15, 4.9, 10.5, 7.9, 57, 60, { base: MARBLE.roof });
  const g0 = project(7.15, 7.9, 60), g1 = project(10.5, 7.9, 60), gp = project(8.825, 7.9, 80);
  poly(ctx, [g0, g1, gp], MARBLE.column, shade(MARBLE.base, -26));
  const tc = project(8.825, 7.9, 67); ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(tc.x, tc.y, 3, 0, Math.PI * 2); ctx.fill();
  cylinder(ctx, 8.8, 6.35, .8, 60, 66, MARBLE.base);
  dome(ctx, 8.8, 6.35, .72, 66, 30, GOLD);
  cylinder(ctx, 8.8, 6.35, .12, 96, 104, GOLD);
  const tip = project(8.8, 6.35, 104); flag(ctx, tip.x, tip.y, "#003087", t, 14);
  if (s.held) {
    const since = t - s.chestsSince;
    [8.0, 8.8, 9.6].forEach((u, i) => { const drop = Math.max(0, 18 - Math.max(0, since - i * 160) / 14); const p = project(u, 8.25, 5 + drop); sprite(ctx, CHEST, p.x, p.y); });
    if (Math.floor(t / 400) % 2) { const sp = project(8.6, 8.2, 16); ctx.fillStyle = "#fff6c8"; ctx.fillRect(Math.round(sp.x), Math.round(sp.y), 1, 1); }
  }
  if (s.approved) {
    const k = Math.min(1, Math.max(.2, (t - s.sealSince) / 450));
    const c = project(8.825, 7.9, 30), r = 11 * (1 + (1 - k) * 1.6);
    ctx.globalAlpha = k;
    ctx.fillStyle = "#9e1f1a"; ctx.beginPath(); ctx.arc(c.x, c.y, r + 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#c0392b"; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f5d0c8"; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .32 : r * .7; const x = c.x + rr * Math.cos(a), y = c.y + rr * Math.sin(a); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
  }
}

function guild(ctx: CanvasRenderingContext2D, t: number) {
  contactShadow(ctx, 12, 5, 15, 7.6);
  box(ctx, 12.2, 5.2, 14.8, 7.4, 0, 3, { base: "#9a8f80" });
  box(ctx, 12.25, 5.25, 14.75, 7.35, 3, 34, { base: TIMBER.wall });
  for (let u = 12.25; u < 14.8; u += .62) onLit(ctx, 7.35, u, u + .07, 3, 34, TIMBER.beam);
  onLit(ctx, 7.35, 12.25, 14.75, 18, 20, TIMBER.beam); onLit(ctx, 7.35, 12.25, 14.75, 32, 34, TIMBER.beam);
  for (let v = 5.25; v < 7.4; v += .7) onShade(ctx, 14.75, v, v + .07, 3, 34, shade(TIMBER.beam, -10));
  onShade(ctx, 14.75, 5.25, 7.35, 18, 20, shade(TIMBER.beam, -10));
  [[12.55, 13.0], [13.9, 14.35]].forEach(([a, b]) => { onLit(ctx, 7.35, a, b, 22, 30, TIMBER.glow); onLit(ctx, 7.35, a, b, 21, 22, TIMBER.beam); });
  onLit(ctx, 7.35, 13.25, 13.7, 3, 16, "#5a3c22");
  onShade(ctx, 14.75, 5.7, 6.2, 22, 30, shade(TIMBER.glow, -12)); onShade(ctx, 14.75, 6.6, 7.0, 22, 30, shade(TIMBER.glow, -12));
  gableRoof(ctx, 12, 5, 15, 7.6, 34, 26, TIMBER.roof, TIMBER.wall);
  box(ctx, 14.05, 5.55, 14.45, 5.95, 40, 66, { base: "#9a8a7a" });
  for (let i = 0; i < 4; i++) { const age = ((t / 1400) + i / 4) % 1; const p = project(14.25, 5.75, 68 + age * 30); ctx.fillStyle = `rgba(245,245,245,${.75 * (1 - age)})`; ctx.beginPath(); ctx.arc(p.x + age * 6, p.y, 2 + age * 4, 0, Math.PI * 2); ctx.fill(); }
  // hanging sign over the door
  const sg = project(13.1, 7.6, 22); ctx.fillStyle = TIMBER.beam; ctx.fillRect(Math.round(sg.x) - 1, Math.round(sg.y) - 2, 10, 1);
  ctx.fillStyle = "#c79a52"; ctx.fillRect(Math.round(sg.x) + 1, Math.round(sg.y), 8, 6); ctx.fillStyle = "#7a5530"; ctx.fillRect(Math.round(sg.x) + 3, Math.round(sg.y) + 2, 4, 2);
  const fp = project(12.4, 5.4, 52); flag(ctx, fp.x, fp.y, "#1f9e62", t, 18);
}

function house(ctx: CanvasRenderingContext2D, h: House, i: number, s: SceneState, t: number) {
  const u0 = h.u, v0 = h.v, u1 = h.u + h.s, v1 = h.v + h.s, wallTop = 8 + h.floors * 13, roof = HOUSE_ROOFS[i % HOUSE_ROOFS.length];
  contactShadow(ctx, u0, v0, u1, v1);
  box(ctx, u0, v0, u1, v1, 0, wallTop, { base: HOUSE_WALL });
  onLit(ctx, v1, u0, u1, 0, 4, "#2c4f8f"); onShade(ctx, u1, v0, v1, 0, 4, "#22406f");        // painted plinth band
  const lit = s.visited.has(h.path);
  const glass = lit ? "#ffe39a" : "#86b6e8", glassShade = lit ? "#e8c46a" : "#6a95c4";
  for (let f = 0; f < h.floors; f++) {
    const z0 = 8 + f * 13, z1 = z0 + 7;
    for (let k = 0, n = Math.max(2, Math.round(h.s * 2)); k < n; k++) {
      const a = u0 + (h.s / n) * (k + .28), b = a + (h.s / n) * .44;
      if (f === 0 && k === Math.floor(n / 2)) { onLit(ctx, v1, a, b, 0, 11, "#5a3c22"); continue; }
      onLit(ctx, v1, a, b, z0, z1, glass); onLit(ctx, v1, a - .02, b + .02, z0 - 1, z0, "#b7b1a3");
      const c = v0 + (h.s / n) * (k + .28), d = c + (h.s / n) * .44;
      onShade(ctx, u1, c, d, z0, z1, glassShade);
    }
  }
  box(ctx, u0 - .06, v0 - .06, u1 + .06, v1 + .06, wallTop, wallTop + 2, { base: shade(HOUSE_WALL, -6) });   // cornice
  hipRoof(ctx, u0 - .08, v0 - .08, u1 + .08, v1 + .08, wallTop + 2, 12 + h.s * 5, roof);
  if (s.active === h.path) { const a = project((u0 + u1) / 2, (v0 + v1) / 2, wallTop + 22 + h.s * 5); ctx.fillStyle = `rgba(255,214,90,${.5 + .4 * Math.sin(t / 160)})`; ctx.beginPath(); ctx.arc(a.x, a.y - 6, 3, 0, Math.PI * 2); ctx.fill(); }
  const verdict = s.verdicts[h.path];
  if (verdict) { const a = project((u0 + u1) / 2, (v0 + v1) / 2, wallTop + 14 + h.s * 5); flag(ctx, a.x, a.y, verdict === "VERIFIED" ? "#1f9e62" : verdict === "FAILED" ? "#d14343" : "#e0a400", t, 18); }
}

function well(ctx: CanvasRenderingContext2D) {
  cylinder(ctx, 8.5, 12.5, .32, 0, 7, "#a8a191", 10);
  const c = project(8.5, 12.5, 7); ctx.fillStyle = "#2f6f9a"; ctx.beginPath(); ctx.ellipse(c.x, c.y, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
  box(ctx, 8.22, 12.45, 8.28, 12.55, 7, 18, { base: "#6a4a2c" }); box(ctx, 8.72, 12.45, 8.78, 12.55, 7, 18, { base: "#6a4a2c" });
  gableRoof(ctx, 8.12, 12.3, 8.88, 12.7, 18, 6, "#b5523b", "#6a4a2c");
}

/* ── the frame ── */
type Drawable = { depth: number; draw: () => void };
export function drawScene(ctx: CanvasRenderingContext2D, s: SceneState, t: number, names: { king: string; artisan: string }) {
  drawSea(ctx, t);
  drawTerrain(ctx);
  const frame = (moving: boolean) => (moving ? Math.floor(t / 170) % 2 : 0) as 0 | 1;
  const items: Drawable[] = [
    { depth: 12.6, draw: () => castle(ctx, t) },
    { depth: 18.8, draw: () => treasury(ctx, s, t) },
    { depth: 22.6, draw: () => guild(ctx, t) },
    { depth: 25, draw: () => well(ctx) },
  ];
  s.houses.forEach((h, i) => items.push({ depth: h.u + h.v + 2 * h.s, draw: () => house(ctx, h, i, s, t) }));
  const trees: Array<[number, number]> = [[.7, .8], [2.6, .6], [5.6, 1.2], [8.8, .8], [11.8, 1.4], [15.2, .9], [16.8, 2.8], [.6, 3.2], [16.9, 6.2], [.6, 10.2], [16.7, 10.6], [.7, 15.2], [3.2, 16.7], [7.2, 16.6], [11.6, 16.7], [16.6, 15.6], [6.2, 3], [11, 3.4], [15.8, 13.8]];
  trees.forEach(([u, v], i) => items.push({ depth: u + v, draw: () => tree(ctx, u, v, i) }));
  // the people of the realm
  items.push({ depth: 3.6 + 7.75, draw: () => { const p = project(3.5, 7.75); sprite(ctx, person("king", "#2f5fbe", 0), p.x, p.y); } });
  items.push({ depth: 13.5 + 7.8, draw: () => { const p = project(13.5, 7.8); sprite(ctx, person("artisan", "#5a7d3a", 0), p.x, p.y, true); } });
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
  void names;
}

/** Screen-space box for a house, in native pixels, for clicks and labels. */
export function houseBounds(h: House): { x0: number; x1: number; y0: number; y1: number; label: P } {
  const wallTop = 8 + h.floors * 13, rise = 12 + h.s * 5;
  const left = project(h.u, h.v + h.s), right = project(h.u + h.s, h.v), bottom = project(h.u + h.s, h.v + h.s), apex = project(h.u + h.s / 2, h.v + h.s / 2, wallTop + rise);
  return { x0: left.x, x1: right.x, y0: apex.y, y1: bottom.y, label: { x: (left.x + right.x) / 2, y: bottom.y + 9 } };
}

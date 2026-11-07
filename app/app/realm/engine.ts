/* ─────────────────────────────────────────────────────────────────────────────
 * Realm renderer: a small pixel-crisp isometric engine on a 2D canvas.
 * The world is drawn at low native resolution and scaled up with sharp pixels.
 *
 * Projection (u, v in tiles on the ground, z in native pixels up):
 *   x = OX + (u − v) · HW        y = OY + (u + v) · HH − z
 * Lighting is fixed to the world: the sun is upper-left, so the +v face is lit,
 * the +u face is shaded and tops are lightest. Painter's order is ascending u + v.
 * ──────────────────────────────────────────────────────────────────────────── */

export const HW = 16, HH = 8;
export const GRID = 18;
export const NATIVE_W = 620, NATIVE_H = 420;
export const OX = NATIVE_W / 2, OY = 70;

export type P = { x: number; y: number };
export const project = (u: number, v: number, z = 0): P => ({ x: OX + (u - v) * HW, y: OY + (u + v) * HH - z });

/* ── colour ── */
/** Accepts "#rrggbb" or an "rgb(r,g,b)" produced by shade(), so shading can be chained. */
function hexToRgb(color: string) {
  if (color.startsWith("rgb")) { const [r, g, b] = color.slice(color.indexOf("(") + 1, -1).split(",").map(Number); return [r, g, b]; }
  const n = parseInt(color.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Lighten (+) or darken (−) by a percentage, the way the face shading needs. */
export function shade(hex: string, pct: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(pct >= 0 ? c + (255 - c) * pct / 100 : c * (1 + pct / 100))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/* ── primitives ── */
export function poly(ctx: CanvasRenderingContext2D, points: P[], fill: string, stroke?: string) {
  ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(Math.round(p.x), Math.round(p.y)) : ctx.moveTo(Math.round(p.x), Math.round(p.y)));
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

export type BoxPaint = { base: string; top?: string; lit?: string; dark?: string; edge?: string };
/** A solid box: the three faces a viewer sees under the fixed sun. */
export function box(ctx: CanvasRenderingContext2D, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, c: BoxPaint) {
  const top = c.top ?? shade(c.base, 18), lit = c.lit ?? c.base, dark = c.dark ?? shade(c.base, -22);
  poly(ctx, [project(u1, v0, z1), project(u1, v1, z1), project(u1, v1, z0), project(u1, v0, z0)], dark, c.edge);
  poly(ctx, [project(u0, v1, z1), project(u1, v1, z1), project(u1, v1, z0), project(u0, v1, z0)], lit, c.edge);
  poly(ctx, [project(u0, v0, z1), project(u1, v0, z1), project(u1, v1, z1), project(u0, v1, z1)], top, c.edge);
}

/** A window or panel on the lit (+v) wall at v, spanning u0..u1 and z0..z1. */
export function onLit(ctx: CanvasRenderingContext2D, v: number, u0: number, u1: number, z0: number, z1: number, fill: string) {
  poly(ctx, [project(u0, v, z1), project(u1, v, z1), project(u1, v, z0), project(u0, v, z0)], fill);
}
/** The same on the shaded (+u) wall at u, spanning v0..v1. */
export function onShade(ctx: CanvasRenderingContext2D, u: number, v0: number, v1: number, z0: number, z1: number, fill: string) {
  poly(ctx, [project(u, v0, z1), project(u, v1, z1), project(u, v1, z0), project(u, v0, z0)], fill);
}

/** A hip roof: four slopes to an apex, drawn back to front. */
export function hipRoof(ctx: CanvasRenderingContext2D, u0: number, v0: number, u1: number, v1: number, z: number, rise: number, base: string) {
  const a = project((u0 + u1) / 2, (v0 + v1) / 2, z + rise);
  poly(ctx, [project(u0, v0, z), project(u0, v1, z), a], shade(base, 22));          // −u slope, toward the sun
  poly(ctx, [project(u0, v0, z), project(u1, v0, z), a], shade(base, 6));           // −v slope
  poly(ctx, [project(u0, v1, z), project(u1, v1, z), a], base);                     // +v slope
  poly(ctx, [project(u1, v0, z), project(u1, v1, z), a], shade(base, -24));         // +u slope, in shade
  ctx.strokeStyle = shade(base, -36); ctx.lineWidth = 1;
  ctx.beginPath(); const e = project(u1, v1, z); ctx.moveTo(Math.round(e.x), Math.round(e.y)); ctx.lineTo(Math.round(a.x), Math.round(a.y)); ctx.stroke();
}

/** A gable roof whose ridge runs along u, with the gable end facing +u. */
export function gableRoof(ctx: CanvasRenderingContext2D, u0: number, v0: number, u1: number, v1: number, z: number, rise: number, base: string, wall: string) {
  const vm = (v0 + v1) / 2, r0 = project(u0, vm, z + rise), r1 = project(u1, vm, z + rise);
  poly(ctx, [project(u0, v0, z), project(u1, v0, z), r1, r0], shade(base, 14));      // back slope
  poly(ctx, [project(u0, v1, z), project(u1, v1, z), r1, r0], base);                 // front slope
  poly(ctx, [project(u1, v0, z), project(u1, v1, z), r1], shade(wall, -20));         // gable end, shaded wall
  ctx.strokeStyle = shade(base, -30); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(Math.round(r0.x), Math.round(r0.y)); ctx.lineTo(Math.round(r1.x), Math.round(r1.y)); ctx.stroke();
}

/** A cylinder (towers, the treasury drum). Slices shade from their unit normal and fill near-last. */
export function cylinder(ctx: CanvasRenderingContext2D, cu: number, cv: number, r: number, z0: number, z1: number, base: string, segments = 14) {
  const slices = [];
  for (let i = 0; i < segments; i++) {
    const a0 = Math.PI * 2 * i / segments, a1 = Math.PI * 2 * (i + 1) / segments, mid = (a0 + a1) / 2;
    if (Math.cos(mid) + Math.sin(mid) < -0.05) continue;
    slices.push({ depth: Math.cos(mid) + Math.sin(mid), a0, a1, mid });
  }
  slices.sort((a, b) => a.depth - b.depth);
  for (const s of slices) {
    const u0 = cu + r * Math.cos(s.a0), v0 = cv + r * Math.sin(s.a0), u1 = cu + r * Math.cos(s.a1), v1 = cv + r * Math.sin(s.a1);
    poly(ctx, [project(u0, v0, z1), project(u1, v1, z1), project(u1, v1, z0), project(u0, v0, z0)], shade(base, Math.round(9 * Math.sin(s.mid) - 28 * Math.cos(s.mid))));
  }
  const ring: P[] = [];
  for (let i = 0; i < segments; i++) { const a = Math.PI * 2 * i / segments; ring.push(project(cu + r * Math.cos(a), cv + r * Math.sin(a), z1)); }
  poly(ctx, ring, shade(base, 16));
}

/** A cone (tower caps), all slices back to front. */
export function cone(ctx: CanvasRenderingContext2D, cu: number, cv: number, r: number, z: number, rise: number, base: string, segments = 14) {
  const apex = project(cu, cv, z + rise);
  const slices = [];
  for (let i = 0; i < segments; i++) { const mid = Math.PI * 2 * (i + .5) / segments; slices.push({ i, depth: Math.cos(mid) + Math.sin(mid), mid }); }
  slices.sort((a, b) => a.depth - b.depth);
  for (const s of slices) {
    const a0 = Math.PI * 2 * s.i / segments, a1 = Math.PI * 2 * (s.i + 1) / segments;
    poly(ctx, [project(cu + r * Math.cos(a0), cv + r * Math.sin(a0), z), project(cu + r * Math.cos(a1), cv + r * Math.sin(a1), z), apex],
      shade(base, Math.round(14 * Math.sin(s.mid) - 26 * Math.cos(s.mid) + 6)));
  }
}

/** A dome as stacked bands; the crown is lifted so the silhouette doesn't read as squat. */
export function dome(ctx: CanvasRenderingContext2D, cu: number, cv: number, r: number, z: number, height: number, base: string, bands = 7) {
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands, t1 = (i + 1) / bands;
    const rr = r * Math.cos(t0 * Math.PI / 2);
    cylinder(ctx, cu, cv, Math.max(.04, rr), z + height * Math.pow(Math.sin(t0 * Math.PI / 2), .78), z + height * Math.pow(Math.sin(t1 * Math.PI / 2), .78), shade(base, i * 3));
  }
}

/** Soft contact shadow, offset down-right, so props don't look pasted on. */
export function contactShadow(ctx: CanvasRenderingContext2D, u0: number, v0: number, u1: number, v1: number) {
  ctx.fillStyle = "rgba(20,40,10,.22)";
  ctx.beginPath();
  [project(u0 + .15, v0 + .15), project(u1 + .35, v0 + .15), project(u1 + .35, v1 + .35), project(u0 + .15, v1 + .35)]
    .forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath(); ctx.fill();
}

/* ── pixel sprites ── */
export type Sprite = { rows: string[]; palette: Record<string, string> };
/** Draws a hand-authored pixel sprite with its feet at (x, y). */
export function sprite(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, flip = false) {
  const h = s.rows.length, w = s.rows[0].length, left = Math.round(x - w / 2), top = Math.round(y - h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const ch = s.rows[j][flip ? w - 1 - i : i];
    if (ch === "." || !s.palette[ch]) continue;
    ctx.fillStyle = s.palette[ch];
    ctx.fillRect(left + i, top + j, 1, 1);
  }
}

const PERSON_A = [
  "....pp....",
  "...hhhh...",
  "..hhhhhh..",
  "..Hssssh..",
  "..Hsesesh.",
  "...ssss...",
  "..tttttt..",
  ".ttttttTxx",
  ".ttbbbbTxX",
  "..tttttT..",
  "..tttttT..",
  "..ll..ll..",
  "..ll..ll..",
  "..kk..kk..",
];
const PERSON_B = [...PERSON_A.slice(0, 11), "...ll.l...", "..l...ll..", "..kk...kk."];

export function person(kind: "inspector" | "guard" | "king" | "artisan", tunic: string, frame: 0 | 1): Sprite {
  const base: Record<string, string> = {
    s: "#f2c9a0", e: "#2b2420", b: "#6b4a2a", l: "#3b3f4a", k: "#2a2220", t: tunic, T: shade(tunic, -28),
    h: "#a3afbf", H: "#6f7b8c", p: "#ffc439", x: "#f6ecd0", X: "#cdb98a",
  };
  if (kind === "guard") Object.assign(base, { p: "#c0392b", x: "", X: "" });
  if (kind === "king") Object.assign(base, { h: "#7a4b2a", H: "#5a361e", p: "#ffd34e", x: "", X: "" });
  if (kind === "artisan") Object.assign(base, { h: "#4a3424", H: "#33241a", p: "", x: "#9a7b55", X: "#6d5436" });
  return { rows: frame ? PERSON_B : PERSON_A, palette: base };
}

export const CART: Sprite = {
  rows: [
    "....yYyYy.....",
    "...yYyYyYy....",
    ".wwwwwwwwwwww.",
    ".wWWWWWWWWWWw.",
    ".wwwwwwwwwwww.",
    "..kKk....kKk..",
    "...k......k...",
  ],
  palette: { y: "#ffd15c", Y: "#e8a815", w: "#8a5a2b", W: "#6a4320", k: "#3b2a1a", K: "#5a4330" },
};

export const CHEST: Sprite = {
  rows: [
    ".yy.yy..",
    "bbbbbbbb",
    "bBBByBBb",
    "bbbbbbbb",
    "bBBBBBBb",
    "bbbbbbbb",
  ],
  palette: { y: "#ffd15c", b: "#8a5a2b", B: "#a56d35" },
};

/** A swallow-tailed banner on a pole; two frames of wave. */
export function flag(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, t: number, height = 16) {
  const px = Math.round(x), py = Math.round(y);
  ctx.fillStyle = "#5d4a36"; ctx.fillRect(px, py - height, 1, height);
  ctx.fillStyle = "#d9b45a"; ctx.fillRect(px, py - height - 1, 1, 1);
  const wave = Math.floor(t / 300) % 2;
  for (let j = 0; j < 7; j++) {
    const width = j === 3 ? 7 : 10;                  // the swallow-tail notch
    for (let i = 0; i < width; i++) {
      ctx.fillStyle = j === 0 || j === 6 ? shade(color, -18) : i > 6 ? shade(color, -12) : color;
      ctx.fillRect(px + 1 + i, py - height + j + (wave && i > 4 ? 1 : 0), 1, 1);
    }
  }
}

export function tree(ctx: CanvasRenderingContext2D, u: number, v: number, variant: number) {
  const p = project(u, v);
  ctx.fillStyle = "rgba(20,40,10,.24)";
  ctx.beginPath(); ctx.ellipse(p.x + 3, p.y + 1, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#6e4a2c"; ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 9, 3, 9);
  const greens = variant % 2 ? ["#3f8a3c", "#4f9e45", "#6dbb55"] : ["#3a7f40", "#4a944a", "#66b05b"];
  const blob = (dx: number, dy: number, r: number, c: string) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(Math.round(p.x + dx), Math.round(p.y + dy), r, 0, Math.PI * 2); ctx.fill(); };
  blob(1, -15, 8, greens[0]); blob(-1, -18, 7, greens[1]); blob(-3, -21, 4, greens[2]); blob(3, -12, 4, greens[0]);
}

/*
 * The Realm's drawing kit: the city renderer's own isometric projection and masonry primitives
 * (the Claude Clan capitol kit, as grounded uses them in landmarks/architecture.ts), plus the
 * pieces an ancient kingdom needs -- battlements, arches, conical and hipped roofs, gardens.
 *
 * Coordinates are tiles: u runs to the lower right, v to the lower left, z is pixels up. The +v
 * face is lit (frontLeft), the +u face is in shade (frontRight), tops are lightest. Everything is
 * painted back to front, so each structure is drawn in the order its parts stand from the camera.
 */
import type { Scene } from "phaser";
import { HALF_H, HALF_W, shade, type Point3 } from "../../reference-city/textures/core";
import type { Box } from "../../reference-city/textures/capitol/primitives";
import type { Colors } from "../../reference-city/textures/capitol/base";
import { Ink, maxTextureSide, unit, type Vec } from "./ink";

export { unit };

export type { Box, Colors, Point3 };
export { shade };

export const mat = (top: number, frontLeft: number, frontRight: number): Colors => ({ top, frontLeft, frontRight });
/** Building materials, lit the engine's way: top, +v face, +u face. */
export const M = {
  limestone: mat(0xf3e7cc, 0xe0cfaa, 0xb8a37f),
  granite: mat(0xd6d0c4, 0xbab3a5, 0x928b7f),
  darkStone: mat(0xa9a397, 0x8d877b, 0x6c675e),
  sandstone: mat(0xf2d3a2, 0xdcb683, 0xb58e63),
  plaster: mat(0xfbf5e8, 0xefe4cd, 0xcfbfa2),
  ochre: mat(0xf6dca8, 0xe6c184, 0xc09a62),
  rose: mat(0xf3d2c4, 0xe3b6a4, 0xbf8f7d),
  timber: mat(0xa7744a, 0x8a5c36, 0x654225),
  paving: mat(0xded5bf, 0xc2b8a0, 0xa09783),
  cobble: mat(0xc9c1ad, 0xaca48f, 0x8c8573),
  lawn: mat(0x7cbc56, 0x62a044, 0x4e8336),
  meadow: mat(0x8ccb5e, 0x6fae49, 0x5a933a),
  soil: mat(0xa77a4f, 0x8c6340, 0x6e4c30),
  hedge: mat(0x3f8a3f, 0x2f7232, 0x245a27),
  water: mat(0x4aa3dc, 0x3a8cc4, 0x2f76a8),
  gold: mat(0xffd35c, 0xf2b134, 0xc98a14),
  hay: mat(0xf0d27a, 0xd9b55a, 0xb08f3c),
} as const;
export type Roof = readonly [light: number, dark: number];
export const ROOF = {
  terracotta: [0xcf6a3f, 0x9e4428],
  slate: [0x56679a, 0x3b4a74],
  royal: [0x3157b8, 0x22408a],
  thatch: [0xdcb860, 0xae8b36],
  verdigris: [0x5fa894, 0x3f7f6e],
  barn: [0xb8453a, 0x8a2f27],
} as const satisfies Record<string, Roof>;
export const GLASS = 0x2f3650, GLOW = 0xffd98a, DOOR = 0x4a3424, GOLD = 0xf2b134;

export type Asset = { key: string; width: number; height: number; anchorY: number; originX?: number };

/**
 * Bake resolution: every structure is drawn this many times larger than the world's pixel grid
 * and shown at 1/RES, so it stays crisp on high-density screens and when the camera zooms in.
 * Phones get a lighter bake; their screens are small and the textures are mostly downscaled.
 */
export const RES = typeof window !== "undefined" && window.innerWidth < 900 ? 1.15 : 1.5;

/** Every lamp each structure's builder set up, keyed by texture: (u, v, height). The night lights them. */
export const LAMPS: Record<string, Array<[number, number, number]>> = {};
let lampLog: Array<[number, number, number]> | null = null;

const trace = (c: CanvasRenderingContext2D, pts: readonly Vec[]) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); };
const span = (pts: readonly Vec[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/**
 * The lighting model, applied by the primitives so every structure shares it. The sun stands high
 * to the left: tops are brightest, the +v faces are lit and the +u faces in shade (the materials
 * carry those three tones). On top of that, every wall and roof slope falls off toward its foot,
 * round shafts are shaded across their width, roofs and cornices shade the wall beneath them,
 * glass reflects the sky, edges catch a line of light, and footprints throw a soft shadow.
 */
export class Atelier {
  constructor(readonly g: Ink, readonly x: number, readonly y: number) {}
  at(p: Point3): Vec { return { x: this.x + (p[0] - p[1]) * HALF_W, y: this.y + (p[0] + p[1]) * HALF_H - p[2] }; }

  /** A filled polygon in the world. Walls and slopes darken toward their foot; glass reflects the sky. */
  face(color: number, points: Point3[], alpha = 1): void {
    const g = this.g, pts = points.map(p => this.at(p));
    g.fillStyle(color, alpha).fillPoints(pts, true);
    if (g.flat || alpha < .9) return;
    if (color === GLASS) { this.glaze(pts); return; }
    if (color === GLOW) { this.warm(pts); return; }
    let z0 = Infinity, z1 = -Infinity;
    for (const p of points) { z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
    const rise = z1 - z0;
    if (rise < 6) return;
    // lines of equal height run along the wall: along v on a +u face, along u on a +v face,
    // and along the eave on a roof slope. The falloff runs square to them.
    const first = points[0]!;
    let ex = 1, ey = 0;
    if (points.every(p => Math.abs(p[0] - first[0]) < 1e-3)) { ex = -HALF_W; ey = HALF_H; }
    else if (points.every(p => Math.abs(p[1] - first[1]) < 1e-3)) { ex = HALF_W; ey = HALF_H; }
    else {
      const low = pts.filter((_, i) => points[i]![2] - z0 < .5);
      if (low.length >= 2) { ex = low[low.length - 1]!.x - low[0]!.x; ey = low[low.length - 1]!.y - low[0]!.y; }
    }
    const len = Math.hypot(ex, ey) || 1;
    let nx = -ey / len, ny = ex / len;
    if (ny < 0) { nx = -nx; ny = -ny; }
    let t0 = Infinity, t1 = -Infinity;
    for (const p of pts) { const t = p.x * nx + p.y * ny; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    const k = Math.min(1, Math.max(.35, rise / 40)), c = g.ctx, grad = c.createLinearGradient(nx * t0, ny * t0, nx * t1, ny * t1);
    grad.addColorStop(0, `rgba(255,255,255,${.09 * k})`); grad.addColorStop(.4, "rgba(255,255,255,0)"); grad.addColorStop(1, `rgba(10,16,34,${.2 * k})`);
    c.fillStyle = grad; trace(c, pts); c.fill();
  }
  /** Window glass: the sky in its upper pane, a diagonal glint, and a dark reveal round the opening. */
  private glaze(pts: Vec[]): void {
    const c = this.g.ctx, b = span(pts);
    if (b.w < 1.5 || b.h < 3) return;
    c.save(); trace(c, pts); c.clip();
    const sky = c.createLinearGradient(b.x, b.y, b.x + b.w * .5, b.y + b.h);
    sky.addColorStop(0, "rgba(178,212,255,.62)"); sky.addColorStop(.5, "rgba(120,160,230,.18)"); sky.addColorStop(1, "rgba(8,12,34,.3)");
    c.fillStyle = sky; c.fillRect(b.x, b.y, b.w, b.h);
    c.fillStyle = "rgba(255,255,255,.2)";
    c.beginPath(); c.moveTo(b.x + b.w * .1, b.y + b.h); c.lineTo(b.x + b.w * .62, b.y); c.lineTo(b.x + b.w * .86, b.y); c.lineTo(b.x + b.w * .34, b.y + b.h); c.closePath(); c.fill();
    c.restore();
    c.strokeStyle = "rgba(8,12,30,.55)"; c.lineWidth = .7; trace(c, pts); c.stroke();
  }
  /** A lit pane or lantern: brightest at its heart. */
  private warm(pts: Vec[]): void {
    const c = this.g.ctx, b = span(pts), r = Math.max(b.w, b.h) * .7;
    if (r < 2) return;
    c.save(); trace(c, pts); c.clip();
    const glow = c.createRadialGradient(b.x + b.w / 2, b.y + b.h * .55, 0, b.x + b.w / 2, b.y + b.h * .55, r);
    glow.addColorStop(0, "rgba(255,250,224,.75)"); glow.addColorStop(.6, "rgba(255,214,130,0)"); glow.addColorStop(1, "rgba(214,120,30,.32)");
    c.fillStyle = glow; c.fillRect(b.x, b.y, b.w, b.h);
    c.restore();
    c.strokeStyle = "rgba(90,52,16,.45)"; c.lineWidth = .7; trace(c, pts); c.stroke();
  }
  /** A stroked run of world points in a CSS colour (edge light, seams, contact lines). */
  private edge(points: Point3[], css: string, width: number): void {
    const c = this.g.ctx;
    c.strokeStyle = css; c.lineWidth = width; c.lineCap = "round";
    c.beginPath(); points.forEach((p, i) => { const q = this.at(p); if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y); }); c.stroke();
    c.lineCap = "butt";
  }
  /** Shade hanging below an edge on a wall (under eaves and cornices), fading as it falls. */
  private shadeBelow(p0: Point3, p1: Point3, depth: number, alpha: number): void {
    if (this.g.flat) return;
    const c = this.g.ctx, steps = 5;
    for (let i = 0; i < steps; i++) {
      const a = depth * i / steps, b = depth * (i + 1) / steps;
      c.fillStyle = `rgba(10,14,30,${alpha * (1 - i / steps) ** 1.4})`;
      trace(c, [this.at([p0[0], p0[1], p0[2] - a]), this.at([p1[0], p1[1], p1[2] - a]), this.at([p1[0], p1[1], p1[2] - b]), this.at([p0[0], p0[1], p0[2] - b])]);
      c.fill();
    }
  }
  /** A roof's overhang shading the tops of the two walls the camera sees. */
  private eaves(b: Box, depth = 9): void {
    this.shadeBelow([b.u0, b.v1 + .003, b.z1], [b.u1, b.v1 + .003, b.z1], depth, .3);
    this.shadeBelow([b.u1 + .003, b.v0, b.z1], [b.u1 + .003, b.v1, b.z1], depth, .34);
  }

  /** A box: lit top, lit +v wall, shaded +u wall, with light on its near top edges and a seam down the corner. */
  box(b: Box, colors: Colors = M.limestone): void {
    const { u0, u1, v0, v1, z0, z1 } = b;
    this.face(colors.top, [[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]]);
    this.face(colors.frontRight, [[u1, v0, z1], [u1, v1, z1], [u1, v1, z0], [u1, v0, z0]]);
    this.face(colors.frontLeft, [[u0, v1, z1], [u1, v1, z1], [u1, v1, z0], [u0, v1, z0]]);
    if (this.g.flat || z1 - z0 < 5 || colors.frontLeft === GLOW) return;
    this.edge([[u0, v1, z1], [u1, v1, z1], [u1, v0, z1]], "rgba(255,255,255,.3)", .8);
    this.edge([[u1, v1, z1 - .5], [u1, v1, z0]], "rgba(10,16,34,.2)", .8);
    if (z0 === 0) this.edge([[u0, v1, 0], [u1, v1, 0], [u1, v0, 0]], "rgba(10,16,34,.3)", 1.4);
  }
  line(color: number, points: Point3[], width = 1, alpha = 1): void {
    this.g.lineStyle(width, color, alpha);
    this.g.strokePoints(points.map(p => this.at(p)), false);
  }
  /** A round shaft, shaded across its width so it reads as round: lit on the left, dark on the right. */
  cylinder(u: number, v: number, r: number, z0: number, z1: number, color: number, cap = shade(color, 12)): void {
    const g = this.g, c = g.ctx, o = this.at([u, v, 0]), a = r * HALF_W * Math.SQRT2, b = r * HALF_H * Math.SQRT2, yT = o.y - z1, yB = o.y - z0;
    const wall = () => { c.beginPath(); c.moveTo(o.x - a, yT); c.lineTo(o.x - a, yB); c.ellipse(o.x, yB, a, b, 0, Math.PI, 0, true); c.lineTo(o.x + a, yT); c.ellipse(o.x, yT, a, b, 0, 0, Math.PI, false); c.closePath(); };
    g.fillStyle(color, 1); wall(); c.fill();
    if (!g.flat) {
      const round = c.createLinearGradient(o.x - a, 0, o.x + a, 0);
      round.addColorStop(0, "rgba(255,255,255,.06)"); round.addColorStop(.2, "rgba(255,255,255,.2)"); round.addColorStop(.45, "rgba(255,255,255,0)");
      round.addColorStop(.78, "rgba(10,16,34,.22)"); round.addColorStop(1, "rgba(10,16,34,.4)");
      c.fillStyle = round; wall(); c.fill();
      if (z1 - z0 >= 12) {
        const fall = c.createLinearGradient(0, yT, 0, yB + b);
        fall.addColorStop(0, "rgba(255,255,255,.05)"); fall.addColorStop(.45, "rgba(255,255,255,0)"); fall.addColorStop(1, "rgba(10,16,34,.18)");
        c.fillStyle = fall; wall(); c.fill();
      }
      if (z0 === 0 && z1 - z0 >= 5) { c.strokeStyle = "rgba(10,16,34,.3)"; c.lineWidth = 1.3; c.beginPath(); c.ellipse(o.x, yB, a, b, 0, 0, Math.PI, false); c.stroke(); }
    }
    g.fillStyle(cap, 1); c.beginPath(); c.ellipse(o.x, yT, a, b, 0, 0, Math.PI * 2); c.fill();
    if (!g.flat && a > 3) { c.strokeStyle = "rgba(255,255,255,.3)"; c.lineWidth = .8; c.beginPath(); c.ellipse(o.x, yT, a, b, 0, 0, Math.PI, false); c.stroke(); }
  }
  /** A projecting band round the top of a box, shading the wall beneath it. */
  cornice(b: Box, overhang = .05, thickness = 4, colors: Colors = M.limestone): void {
    const z = b.z1 - thickness;
    this.shadeBelow([b.u0, b.v1 + .003, z], [b.u1, b.v1 + .003, z], Math.max(3, thickness * 1.3), .22);
    this.shadeBelow([b.u1 + .003, b.v0, z], [b.u1 + .003, b.v1, z], Math.max(3, thickness * 1.3), .26);
    this.box({ u0: b.u0 - overhang, u1: b.u1 + overhang, v0: b.v0 - overhang, v1: b.v1 + overhang, z0: z, z1: b.z1 }, colors);
  }
  /** A flat rectangle on the ground (lawn, paving, water, soil). */
  pad(u0: number, v0: number, u1: number, v1: number, color: number, z = 0, alpha = 1): void {
    this.face(color, [[u0, v0, z], [u1, v0, z], [u1, v1, z], [u0, v1, z]], alpha);
  }
  /** The soft shadow a footprint throws on the ground, away from the sun: to the right and a little forward. */
  shadow(u0: number, v0: number, u1: number, v1: number, z = 0, alpha = .22, reach = .6): void {
    const su = reach, sv = -reach * .3;
    const hull: Point3[] = [[u0, v0, z], [u0 + su, v0 + sv, z], [u1 + su, v0 + sv, z], [u1 + su, v1 + sv, z], [u1, v1 + .08, z], [u0, v1 + .08, z]];
    this.g.softShadow(hull.map(p => this.at(p)), `rgba(16,28,14,${Math.min(.7, alpha * 2.1)})`, 4.5);
  }
  /** A ball of foliage or fruit, lit from the upper left. */
  private ball(x: number, y: number, r: number, color: number): void {
    const g = this.g, c = g.ctx;
    if (g.flat || r < 1.6) { g.fillStyle(color, 1).fillCircle(x, y, r); return; }
    const grad = c.createRadialGradient(x - r * .35, y - r * .4, r * .05, x, y, r);
    grad.addColorStop(0, g.css(shade(color, 26))); grad.addColorStop(.55, g.css(color)); grad.addColorStop(1, g.css(shade(color, -30)));
    c.fillStyle = grad; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  /** A soft dark patch on the ground under a plant. */
  private patch(x: number, y: number, w: number, h: number, alpha = .3): void {
    const g = this.g, c = g.ctx;
    if (g.flat) return;
    c.save(); c.translate(x, y); c.scale(1, h / w);
    const grad = c.createRadialGradient(0, 0, 0, 0, 0, w / 2);
    grad.addColorStop(0, `rgba(16,28,14,${alpha})`); grad.addColorStop(.6, `rgba(16,28,14,${alpha * .6})`); grad.addColorStop(1, "rgba(16,28,14,0)");
    c.fillStyle = grad; c.beginPath(); c.arc(0, 0, w / 2, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  /** A conical roof, painted segment by segment back to front, lit on the +v side. */
  cone(u: number, v: number, r: number, z0: number, height: number, color: number, finial = GOLD): void {
    const n = 24, segs: Array<{ depth: number; pts: Point3[]; light: number }> = [];
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
      segs.push({ depth: Math.cos(am) + Math.sin(am), light: Math.sin(am) * 20 - Math.cos(am) * 12,
        pts: [[u + Math.cos(a0) * r, v + Math.sin(a0) * r, z0], [u + Math.cos(a1) * r, v + Math.sin(a1) * r, z0], [u, v, z0 + height]] });
    }
    for (const s of segs.sort((a, b) => a.depth - b.depth)) this.face(shade(color, s.light), s.pts);
    // courses of roof tiles: rings around the visible side, with staggered joints between them
    for (let k = 1; k < 6; k++) {
      const t = k / 6, rr = r * (1 - t), zz = z0 + height * t, prev = r * (1 - (k - 1) / 6), zp = z0 + height * (k - 1) / 6;
      const ring: Point3[] = [];
      for (let i = 0; i <= 12; i++) { const ang = -Math.PI * .25 + i / 12 * Math.PI; ring.push([u + Math.cos(ang) * rr, v + Math.sin(ang) * rr, zz]); }
      this.line(shade(color, -26), ring, 1, .55);
      for (let i = 0; i < 6; i++) {
        const ang = -Math.PI * .25 + (i + (k % 2) * .5 + .25) / 6 * Math.PI;
        this.line(shade(color, -22), [[u + Math.cos(ang) * rr, v + Math.sin(ang) * rr, zz], [u + Math.cos(ang) * prev, v + Math.sin(ang) * prev, zp]], .8, .45);
      }
    }
    const eave: Point3[] = [];
    for (let i = 0; i <= 14; i++) { const ang = -Math.PI * .25 + i / 14 * Math.PI; eave.push([u + Math.cos(ang) * r, v + Math.sin(ang) * r, z0 + 1]); }
    this.line(finial, eave, 1.6, .9);
    // a ring of eaves and the gilded finial
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      if (Math.cos(a0) + Math.sin(a0) < -.3) continue;
      this.line(shade(color, -30), [[u + Math.cos(a0) * r, v + Math.sin(a0) * r, z0], [u + Math.cos(a1) * r, v + Math.sin(a1) * r, z0]], 1.4);
    }
    this.line(finial, [[u, v, z0 + height - 2], [u, v, z0 + height + 9]], 2.4);
    const top = this.at([u, v, z0 + height + 10]); this.g.fillStyle(finial, 1).fillCircle(top.x, top.y, 2.6);
  }
  /** A four-sided pyramid roof on a box. */
  pyramid(b: Box, rise: number, roof: Roof): void {
    const cu = (b.u0 + b.u1) / 2, cv = (b.v0 + b.v1) / 2, o = .08, apex: Point3 = [cu, cv, b.z1 + rise];
    this.eaves(b);
    this.face(roof[1], [[b.u0 - o, b.v0 - o, b.z1], [b.u1 + o, b.v0 - o, b.z1], apex]);
    this.face(roof[1], [[b.u0 - o, b.v0 - o, b.z1], [b.u0 - o, b.v1 + o, b.z1], apex]);
    this.face(shade(roof[1], -10), [[b.u1 + o, b.v0 - o, b.z1], [b.u1 + o, b.v1 + o, b.z1], apex]);
    this.face(roof[0], [[b.u0 - o, b.v1 + o, b.z1], [b.u1 + o, b.v1 + o, b.z1], apex]);
    this.line(shade(roof[0], 25), [[b.u1 + o, b.v1 + o, b.z1], apex], 1.2);
    this.line(GOLD, [[cu, cv, b.z1 + rise - 1], [cu, cv, b.z1 + rise + 8]], 2);
  }
  /** A hipped roof: four slopes up to a short ridge along the long side. */
  hip(b: Box, rise: number, roof: Roof, ridge?: number): void {
    const o = .1, alongU = b.u1 - b.u0 >= b.v1 - b.v0, inset = Math.min(b.u1 - b.u0, b.v1 - b.v0) / 2;
    const r0: Point3 = alongU ? [b.u0 + inset, (b.v0 + b.v1) / 2, b.z1 + rise] : [(b.u0 + b.u1) / 2, b.v0 + inset, b.z1 + rise];
    const r1: Point3 = alongU ? [b.u1 - inset, (b.v0 + b.v1) / 2, b.z1 + rise] : [(b.u0 + b.u1) / 2, b.v1 - inset, b.z1 + rise];
    const A: Point3 = [b.u0 - o, b.v0 - o, b.z1], B: Point3 = [b.u1 + o, b.v0 - o, b.z1], C: Point3 = [b.u1 + o, b.v1 + o, b.z1], D: Point3 = [b.u0 - o, b.v1 + o, b.z1];
    this.eaves(b);
    if (alongU) {
      this.face(roof[1], [A, B, r1, r0]); this.face(roof[1], [A, D, r0]);
      this.face(shade(roof[1], -8), [B, C, r1]); this.face(roof[0], [D, C, r1, r0]);
      for (let t = .12; t < 1; t += .12) { const u = b.u0 + (b.u1 - b.u0) * t; this.line(shade(roof[0], -18), [[u, b.v1 + o, b.z1], [Math.min(Math.max(u, r0[0]), r1[0]), r0[1], r0[2]]], .8, .7); }
    } else {
      this.face(roof[1], [A, D, r1, r0]); this.face(roof[1], [A, B, r0]);
      this.face(roof[0], [D, C, r1]); this.face(shade(roof[1], -8), [B, C, r1, r0]);
      for (let t = .12; t < 1; t += .12) { const v = b.v0 + (b.v1 - b.v0) * t; this.line(shade(roof[1], -22), [[b.u1 + o, v, b.z1], [r0[0], Math.min(Math.max(v, r0[1]), r1[1]), r0[2]]], .8, .7); }
    }
    this.line(ridge ?? shade(roof[0], 30), [r0, r1], ridge ? 2.6 : 2);
  }
  /** A gabled roof whose ridge runs along u (gable end on the +u face) or along v. */
  gable(b: Box, rise: number, roof: Roof, wall: Colors, alongU = true): void {
    const o = .12;
    this.eaves(b);
    if (alongU) {
      const mv = (b.v0 + b.v1) / 2;
      this.face(roof[1], [[b.u0 - o, b.v0 - o, b.z1], [b.u1 + o, b.v0 - o, b.z1], [b.u1 + o, mv, b.z1 + rise], [b.u0 - o, mv, b.z1 + rise]]);
      this.face(wall.frontRight, [[b.u1, b.v0, b.z1], [b.u1, b.v1, b.z1], [b.u1, mv, b.z1 + rise - 2]]);
      this.face(roof[0], [[b.u0 - o, mv, b.z1 + rise], [b.u1 + o, mv, b.z1 + rise], [b.u1 + o, b.v1 + o, b.z1], [b.u0 - o, b.v1 + o, b.z1]]);
      for (let u = b.u0; u <= b.u1 + .01; u += .14) this.line(shade(roof[0], -20), [[u, mv, b.z1 + rise], [u, b.v1 + o, b.z1]], .8, .75);
      this.line(shade(roof[0], 28), [[b.u0 - o, mv, b.z1 + rise + 1], [b.u1 + o, mv, b.z1 + rise + 1]], 2);
    } else {
      const mu = (b.u0 + b.u1) / 2;
      this.face(roof[1], [[mu, b.v0 - o, b.z1 + rise], [b.u1 + o, b.v0 - o, b.z1], [b.u1 + o, b.v1 + o, b.z1], [mu, b.v1 + o, b.z1 + rise]]);
      this.face(roof[0], [[b.u0 - o, b.v0 - o, b.z1], [mu, b.v0 - o, b.z1 + rise], [mu, b.v1 + o, b.z1 + rise], [b.u0 - o, b.v1 + o, b.z1]]);
      this.face(wall.frontLeft, [[b.u0, b.v1, b.z1], [b.u1, b.v1, b.z1], [mu, b.v1, b.z1 + rise - 2]]);
      for (let v = b.v0; v <= b.v1 + .01; v += .14) this.line(shade(roof[1], -20), [[b.u1 + o, v, b.z1], [mu, v, b.z1 + rise]], .8, .75);
      this.line(shade(roof[0], 28), [[mu, b.v0 - o, b.z1 + rise + 1], [mu, b.v1 + o, b.z1 + rise + 1]], 2);
    }
  }
  /** Battlements along the two faces the camera sees. */
  merlons(b: Box, colors: Colors, size = .15, height = 8): void {
    for (let u = b.u0; u < b.u1 - size * .6; u += size * 2) this.box({ u0: u, u1: Math.min(b.u1, u + size), v0: b.v1 - size, v1: b.v1, z0: b.z1, z1: b.z1 + height }, colors);
    for (let v = b.v0; v < b.v1 - size * .6; v += size * 2) this.box({ u0: b.u1 - size, u1: b.u1, v0: v, v1: Math.min(b.v1, v + size), z0: b.z1, z1: b.z1 + height }, colors);
  }
  /** A ring of battlements on a round tower. */
  ringMerlons(u: number, v: number, r: number, z: number, colors: Colors, height = 8): void {
    for (let i = 0; i < 16; i += 2) {
      const a = i / 16 * Math.PI * 2; if (Math.cos(a) + Math.sin(a) < -.6) continue;
      const cu = u + Math.cos(a) * (r - .06), cv = v + Math.sin(a) * (r - .06);
      this.box({ u0: cu - .07, u1: cu + .07, v0: cv - .07, v1: cv + .07, z0: z, z1: z + height }, colors);
    }
  }
  /** A round tower: shaft, string courses, arrow slits, crenellated top and a conical roof. */
  tower(u: number, v: number, r: number, height: number, stone: Colors, roof: Roof, coneRise = r * 95): void {
    this.cylinder(u, v, r, 0, height, stone.frontLeft, stone.top);
    // stone courses on the shaft, each a little lighter towards the top
    for (let z = 12; z < height - 6; z += 12) {
      const ring: Point3[] = [];
      for (let i = 0; i <= 10; i++) { const ang = -Math.PI * .2 + i / 10 * Math.PI * .95; ring.push([u + Math.cos(ang) * r, v + Math.sin(ang) * r, z]); }
      this.line(shade(stone.frontLeft, -12), ring, .6, .45);
    }
    this.line(GOLD, [[u - r * .7, v + r * .7, height - 4], [u + r * .7, v + r * .7, height - 4]], 1.4, .8);
    for (let z = 34; z < height - 10; z += 34) this.line(shade(stone.frontLeft, -18), [[u - r * .7, v + r * .7, z], [u + r * .7, v + r * .7, z]], .8, .6);
    for (let z = 28; z < height - 20; z += 38) this.face(GLASS, [[u - .03, v + r + .002, z], [u + .03, v + r + .002, z], [u + .03, v + r + .002, z + 12], [u - .03, v + r + .002, z + 12]]);
    this.cylinder(u, v, r + .08, height, height + 6, stone.frontLeft, stone.top);
    this.ringMerlons(u, v, r + .08, height + 6, stone);
    this.cone(u, v, r + .14, height + 6, coneRise, roof[0]);
  }
  /** Arched openings across the +v face. */
  arches(v: number, u0: number, u1: number, z0: number, z1: number, count: number, color: number = GLASS, frame = 0): void {
    const w = (u1 - u0) / count;
    for (let i = 0; i < count; i++) {
      const a = u0 + i * w + w * .24, b = u0 + (i + 1) * w - w * .24, mid = (a + b) / 2, top = z1 - (z1 - z0) * .2;
      const pts: Point3[] = [[a, v, z0], [b, v, z0], [b, v, top]];
      for (let k = 1; k < 9; k++) { const t = k / 9 * Math.PI; pts.push([mid + Math.cos(t) * (b - a) / 2, v, top + Math.sin(t) * (z1 - top)]); }
      pts.push([a, v, top]);
      if (frame) this.face(frame, pts.map(([pu, pv, pz]): Point3 => [mid + (pu - mid) * 1.25, pv - .001, z0 + (pz - z0) * 1.08]));
      this.face(color, pts);
      if (color === GLASS || color === GLOW) this.dress(false, v, a, b, z0, top, z1, frame);
    }
  }
  /** What makes an opening a window: glazing bars across the pane and a sill that shades the wall below. */
  private dress(side: boolean, at: number, a: number, b: number, z0: number, top: number, z1: number, frame: number): void {
    const P = (t: number, z: number, out = .003): Point3 => side ? [at + out, t, z] : [t, at + out, z];
    const mid = (a + b) / 2, stone = frame || 0xe6dcc6;
    if ((b - a) * HALF_W > 6.5) {
      this.line(shade(stone, 12), [P(mid, z0), P(mid, z1 - .5)], .9, .9);
      this.line(shade(stone, 12), [P(a, (z0 + top) / 2), P(b, (z0 + top) / 2)], .9, .9);
    }
    const e = (b - a) * .14;
    this.shadeBelow(P(a - e, z0 - 2.4), P(b + e, z0 - 2.4), 3.5, .22);
    this.face(shade(stone, side ? -6 : 8), [P(a - e, z0, .02), P(b + e, z0, .02), P(b + e, z0 - 2.4, .02), P(a - e, z0 - 2.4, .02)]);
    this.line(shade(stone, 30), [P(a - e, z0, .02), P(b + e, z0, .02)], .7, .9);
  }
  /** A window box of flowers on a +v wall. */
  flowerBox(u: number, v: number, z: number, w = .3, bloom = 0xff7aa2): void {
    this.box({ u0: u - w / 2, u1: u + w / 2, v0: v, v1: v + .07, z0: z - 4, z1: z }, M.timber);
    for (let k = 0; k < 5; k++) { const p = this.at([u - w / 2 + w * (k + .5) / 5, v + .04, z + 1.5 + (k % 2)]); this.ball(p.x, p.y, 2.1, k % 2 ? 0x4f9a3f : bloom); }
  }
  /** A wall lantern on a +v wall; it glows at night like the street lamps. */
  sconce(u: number, v: number, z: number): void {
    lampLog?.push([u, v + .12, z]);
    this.line(0x3a3328, [[u, v, z + 7], [u, v + .08, z + 7]], 1.4);
    this.box({ u0: u - .035, u1: u + .035, v0: v + .05, v1: v + .12, z0: z, z1: z + 6 }, mat(0x5a4a32, GLOW, 0xd9a64a));
  }
  /** Arched windows across the +u face. */
  sideArches(u: number, v0: number, v1: number, z0: number, z1: number, count: number, color: number = GLASS, frame = 0): void {
    const w = (v1 - v0) / count;
    for (let i = 0; i < count; i++) {
      const a = v0 + i * w + w * .28, b = v0 + (i + 1) * w - w * .28, mid = (a + b) / 2, top = z1 - (z1 - z0) * .22;
      const pts: Point3[] = [[u, a, z0], [u, b, z0], [u, b, top]];
      for (let k = 1; k < 9; k++) { const t = k / 9 * Math.PI; pts.push([u, mid + Math.cos(t) * (b - a) / 2, top + Math.sin(t) * (z1 - top)]); }
      pts.push([u, a, top]);
      if (frame) this.face(frame, pts.map(([pu, pv, pz]): Point3 => [pu - .001, mid + (pv - mid) * 1.25, z0 + (pz - z0) * 1.08]));
      this.face(color, pts);
      if (color === GLASS || color === GLOW) this.dress(true, u, a, b, z0, top, z1, frame);
    }
  }
  /** Rows of arched windows on both visible faces, floor by floor, with a cornice per floor. */
  storeys(b: Box, floors: number, baysU: number, baysV: number, stone: Colors, lit = false): void {
    const pitch = (b.z1 - b.z0) / floors;
    for (let f = 0; f < floors; f++) {
      const z = b.z0 + f * pitch, glass = lit && (f + baysU) % 2 === 0 ? GLOW : GLASS;
      this.arches(b.v1 + .004, b.u0 + .06, b.u1 - .06, z + pitch * .22, z + pitch * .82, baysU, glass, shade(stone.frontLeft, 14));
      this.sideArches(b.u1 + .004, b.v0 + .06, b.v1 - .06, z + pitch * .22, z + pitch * .82, baysV, glass, shade(stone.frontRight, 14));
      if (f > 0) this.cornice({ ...b, z1: z }, .02, 2.4, stone);
    }
  }
  /** A banner hanging flat on the +v face of a wall. */
  hanging(u: number, v: number, z: number, color: number, w = .3, h = 34): void {
    this.face(color, [[u - w / 2, v, z], [u + w / 2, v, z], [u + w / 2, v, z - h], [u, v, z - h - 8], [u - w / 2, v, z - h]]);
    this.face(GOLD, [[u - w / 2, v + .001, z], [u + w / 2, v + .001, z], [u + w / 2, v + .001, z - 3], [u - w / 2, v + .001, z - 3]]);
    this.face(GOLD, [[u - .05, v + .002, z - h * .45], [u + .05, v + .002, z - h * .45], [u + .05, v + .002, z - h * .45 - 9], [u - .05, v + .002, z - h * .45 - 9]]);
  }
  /** A round, layered canopy tree. */
  tree(u: number, v: number, s = 1, leaf = 0x3f8f3c, fruit = 0): void {
    const g = this.g, foot = this.at([u, v, 0]);
    this.patch(foot.x + 9 * s, foot.y + 2, 40 * s, 15 * s, .34);
    // the trunk, lit down its left side, with a fork into the canopy
    this.line(0x5a3d24, [[u, v, 0], [u, v, 18 * s]], 4 * s);
    this.line(0x8a6540, [[u - .012 * s, v + .012 * s, 1], [u - .012 * s, v + .012 * s, 17 * s]], 1.2 * s, .8);
    // the canopy: shaded underside first, then clusters lit from the upper left, then dappled light
    const under = this.at([u + .03, v, 20 * s]); this.ball(under.x + 2 * s, under.y + 3 * s, 15 * s, shade(leaf, -34));
    for (const [du, dz, r, l] of [[-.1, 22, 13, -10], [.1, 22, 12, -16], [0, 30, 14, 0], [-.05, 38, 10, 10], [.06, 34, 8, 4]] as const) {
      const p = this.at([u + du, v, dz * s]); this.ball(p.x, p.y, r * s, shade(leaf, l));
    }
    if (!g.flat) for (const [dx, dy, r] of [[-7, -34, 2.6], [-11, -25, 2.2], [-2, -41, 2.4], [4, -31, 1.8], [-5, -20, 1.6], [9, -24, 1.5]] as const) {
      g.fillStyle(shade(leaf, 34), .5).fillEllipse(foot.x + dx * s, foot.y + dy * s, r * 2.4 * s, r * 1.5 * s);
    }
    if (fruit) for (const [du, dz] of [[-.12, 26], [.1, 30], [0, 36], [-.04, 22], [.12, 22]] as const) { const p = this.at([u + du, v + .05, dz * s]); this.ball(p.x, p.y, 2.4 * s, fruit); }
  }
  /** A tall Mediterranean cypress. */
  cypress(u: number, v: number, s = 1): void {
    const g = this.g, c = g.ctx, foot = this.at([u, v, 0]);
    this.patch(foot.x + 6 * s, foot.y + 2, 24 * s, 9 * s, .3);
    // each tier is lit across its width: bright on the left flank, dark on the right
    for (let k = 0; k < 6; k++) {
      const p = this.at([u, v, (8 + k * 9) * s]), w = (15 - k * 2) * s, tone = shade(0x2c6b33, k * 5 - 10);
      if (g.flat) { g.fillStyle(tone, 1).fillEllipse(p.x, p.y, w, 22 * s); continue; }
      const grad = c.createLinearGradient(p.x - w / 2, 0, p.x + w / 2, 0);
      grad.addColorStop(0, g.css(shade(tone, 24))); grad.addColorStop(.45, g.css(tone)); grad.addColorStop(1, g.css(shade(tone, -34)));
      c.fillStyle = grad; c.beginPath(); c.ellipse(p.x, p.y, w / 2, 11 * s, 0, 0, Math.PI * 2); c.fill();
    }
  }
  /** A round shrub, optionally dotted with berries or flowers. */
  bush(u: number, v: number, s = 1, leaf = 0x3f8a3f, dots = 0): void {
    const g = this.g, p = this.at([u, v, 6 * s]);
    this.patch(p.x + 4 * s, p.y + 6 * s, 26 * s, 10 * s, .3);
    g.fillStyle(shade(leaf, -22), 1).fillEllipse(p.x, p.y + 2, 20 * s, 13 * s);
    this.ball(p.x - 3 * s, p.y, 6.4 * s, leaf); this.ball(p.x + 4 * s, p.y + .5 * s, 5.6 * s, shade(leaf, -8)); this.ball(p.x, p.y - 2.5 * s, 5.4 * s, shade(leaf, 8));
    if (dots) for (const [dx, dy] of [[-6, 0], [-1, -4], [4, 1], [6, -3], [0, 3], [-4, -5]] as const) this.ball(p.x + dx * s, p.y + dy * s, 1.9 * s, dots);
  }
  /** A low clipped hedge running along u or v. */
  hedge(u0: number, v0: number, u1: number, v1: number, height = 10): void { this.box({ u0, u1, v0, v1, z0: 0, z1: height }, M.hedge); }
  /** A wooden post-and-rail fence along the +v or +u edge of a plot. */
  fence(points: Array<[number, number]>, height = 11, color = 0x8a6239): void {
    for (let i = 0; i < points.length - 1; i++) {
      const [u0, v0] = points[i]!, [u1, v1] = points[i + 1]!, n = Math.max(1, Math.round(Math.hypot(u1 - u0, v1 - v0) / .32));
      for (let k = 0; k <= n; k++) { const u = u0 + (u1 - u0) * k / n, v = v0 + (v1 - v0) * k / n; this.line(shade(color, -20), [[u, v, 0], [u, v, height]], 2); }
      this.line(color, [[u0, v0, height * .55], [u1, v1, height * .55]], 1.6);
      this.line(shade(color, 18), [[u0, v0, height - 1], [u1, v1, height - 1]], 1.6);
    }
  }
  /** A lamp post with a warm lantern. */
  lamp(u: number, v: number, h = 30): void {
    lampLog?.push([u, v, h]);
    this.line(0x3a3328, [[u, v, 0], [u, v, h]], 2);
    this.box({ u0: u - .05, u1: u + .05, v0: v - .05, v1: v + .05, z0: h, z1: h + 7 }, mat(0x5a4a32, GLOW, 0xd9a64a));
  }
  /** Ivy climbing the +v face of a wall, from the ground up to z. */
  ivy(u: number, v: number, width: number, z: number): void {
    for (let k = 0; k < 22; k++) {
      const t = k / 22, du = (Math.sin(k * 7.3) * .5) * width, zz = (1 - t * t) * z * (.4 + .6 * Math.abs(Math.sin(k * 3.1)));
      const p = this.at([u + du, v + .006, zz]);
      this.g.fillStyle(k % 3 ? 0x3f8a3f : 0x5fae4a, .95).fillCircle(p.x, p.y, 3.2 + (k % 2));
    }
  }
  /** A bench facing +v. */
  bench(u: number, v: number): void {
    this.box({ u0: u - .22, u1: u + .22, v0: v - .05, v1: v + .05, z0: 4, z1: 6 }, M.timber);
    this.box({ u0: u - .22, u1: u + .22, v0: v - .08, v1: v - .05, z0: 6, z1: 11 }, M.timber);
  }
  /** A tiered fountain with a statue. */
  fountain(u: number, v: number, s = 1): void {
    this.cylinder(u, v, .62 * s, 0, 8, M.granite.frontLeft, 0x5fb2e8);
    this.cylinder(u, v, .5 * s, 8, 9, 0x5fb2e8, 0x7cc3ef);
    this.cylinder(u, v, .14 * s, 9, 24, M.limestone.frontLeft, M.limestone.top);
    this.cylinder(u, v, .3 * s, 24, 28, M.granite.frontLeft, 0x7cc3ef);
    this.cylinder(u, v, .07 * s, 28, 40, M.limestone.frontLeft, M.limestone.top);
    const top = this.at([u, v, 42]); this.g.fillStyle(0xbfe3fb, .9).fillCircle(top.x, top.y, 3);
    for (const dx of [-8, -4, 4, 8]) { this.g.lineStyle(1.2, 0xd8f0ff, .8).beginPath().moveTo(top.x, top.y).lineTo(top.x + dx * s, top.y + 14).strokePath(); }
  }
  /** A barrel. */
  barrel(u: number, v: number): void { this.cylinder(u, v, .12, 0, 15, 0x8a5a32, 0x6b4527); this.line(0x3b2a1c, [[u - .12, v + .1, 5], [u + .12, v + .1, 5]], 1); this.line(0x3b2a1c, [[u - .12, v + .1, 11], [u + .12, v + .1, 11]], 1); }
  /** A wooden crate. */
  crate(u: number, v: number, s = .17, h = 14): void { this.box({ u0: u - s, u1: u + s, v0: v - s, v1: v + s, z0: 0, z1: h }, M.timber); this.line(0x4a3020, [[u - s, v + s, 0], [u + s, v + s, h]], 1); }
  /** A basket of produce. */
  basket(u: number, v: number, fill: number): void {
    this.cylinder(u, v, .11, 0, 8, 0xb0844c, fill);
    const p = this.at([u, v, 9]); for (const [dx, dy] of [[-3, 0], [2, -1], [0, 2], [3, 2], [-2, -2]] as const) this.g.fillStyle(fill, 1).fillCircle(p.x + dx, p.y + dy, 2);
  }
}

/** Bakes one asset with its builder, unless it is already baked (so only what a kingdom shows is ever drawn). */
export function bakeOne(scene: Scene, asset: Asset, builder: (a: Atelier) => void): void {
  if (scene.textures.exists(asset.key)) return;
  const ink = new Ink(asset.width, asset.height, RES, maxTextureSide(scene));
  lampLog = LAMPS[asset.key] = [];
  builder(new Atelier(ink, asset.originX ?? asset.width / 2, asset.height - asset.anchorY));
  lampLog = null;
  ink.grain(.5);
  ink.publish(scene, asset.key);
}

/** Bakes every asset once with its builder (idempotent across scene restarts). */
export function bakeAll<K extends string>(scene: Scene, assets: Record<K, Asset>, builders: Record<K, (a: Atelier) => void>): void {
  for (const name of Object.keys(assets) as K[]) bakeOne(scene, assets[name], builders[name]);
}

/** The night's light map of a structure: its texture key with this suffix. */
export const LIGHTS = ":lights";

/**
 * Bakes one structure's light map by running its own builder again with every colour remapped:
 * window glass glows warm (some rooms left dark), lit windows and lanterns glow brighter, fires
 * keep their colour, and everything else paints black -- so a wall drawn in front of a window
 * still hides it. Shown with additive blending over the night, black adds nothing. Light is soft,
 * so the map is drawn at half the day's resolution, flat, with none of the day's shading.
 */
export function bakeLights(scene: Scene, asset: Asset, builder: (a: Atelier) => void): void {
  const key = asset.key + LIGHTS;
  if (scene.textures.exists(key)) return;
  const ink = new Ink(asset.width, asset.height, RES * .5, maxTextureSide(scene), 1.25);
  let rooms = 0;
  ink.flat = true;
  ink.remap = (c: number) => {
    if (c === GLASS) { rooms++; return rooms % 7 === 3 || rooms % 5 === 1 ? 0x000000 : 0xffa94d; }
    if (c === GLOW) return 0xffd27a;
    if (c === 0xd9a64a) return 0xffc060;
    if (c === 0xffd36a || c === 0xff9a3c || c === 0xff8a2a) return c;
    return 0x000000;
  };
  builder(new Atelier(ink, asset.originX ?? asset.width / 2, asset.height - asset.anchorY));
  ink.publish(scene, key);
}

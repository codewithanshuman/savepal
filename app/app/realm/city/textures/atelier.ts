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
import { createBaker, fillFace, shade, type Baker, type Point3 } from "../../reference-city/textures/core";
import { drawCapitolBox, drawCornice, type Box } from "../../reference-city/textures/capitol/primitives";
import { drawCylinder } from "../../reference-city/textures/capitol/dome";
import type { Colors } from "../../reference-city/textures/capitol/base";

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

export class Atelier {
  constructor(readonly baker: Baker, readonly x: number, readonly y: number) {}
  at(p: Point3) { return this.baker.at(p, this.x, this.y); }
  get g() { return this.baker.graphics; }

  box(b: Box, colors: Colors = M.limestone): void { drawCapitolBox(this.baker, b, this.x, this.y, colors); }
  face(color: number, points: Point3[], alpha = 1): void { fillFace(this.baker, color, alpha, points, this.x, this.y); }
  line(color: number, points: Point3[], width = 1, alpha = 1): void {
    this.g.lineStyle(width, color, alpha);
    this.g.strokePoints(points.map(p => this.at(p)), false);
  }
  cylinder(u: number, v: number, r: number, z0: number, z1: number, color: number, cap = shade(color, 12)): void {
    drawCylinder(this.baker, this.x, this.y, u, v, r, z0, z1, color, cap, 24);
  }
  cornice(b: Box, overhang = .05, thickness = 4, colors: Colors = M.limestone): void {
    drawCornice(this.baker, b, this.x, this.y, overhang, thickness, colors);
  }
  /** A flat rectangle on the ground (lawn, paving, water, soil). */
  pad(u0: number, v0: number, u1: number, v1: number, color: number, z = 0, alpha = 1): void {
    this.face(color, [[u0, v0, z], [u1, v0, z], [u1, v1, z], [u0, v1, z]], alpha);
  }
  /** A soft contact shadow under a footprint, offset away from the sun. */
  shadow(u0: number, v0: number, u1: number, v1: number, z = 0, alpha = .22): void {
    this.face(0x1c2e14, [[u0 + .12, v0 + .1, z], [u1 + .22, v0 + .1, z], [u1 + .22, v1 + .2, z], [u0 + .12, v1 + .2, z]], alpha);
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
    }
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
    g.fillStyle(0x1c2e14, .22).fillEllipse(foot.x + 6 * s, foot.y + 2, 30 * s, 12 * s);
    this.line(0x6b4a2c, [[u, v, 0], [u, v, 16 * s]], 3.5 * s);
    for (const [du, dz, r, l] of [[-.1, 22, 13, -10], [.1, 22, 12, -16], [0, 30, 14, 0], [-.05, 38, 10, 12], [.06, 34, 8, 6]] as const) {
      const p = this.at([u + du, v, dz * s]); g.fillStyle(shade(leaf, l), 1).fillCircle(p.x, p.y, r * s);
    }
    if (fruit) for (const [du, dz] of [[-.12, 26], [.1, 30], [0, 36], [-.04, 22], [.12, 22]] as const) { const p = this.at([u + du, v + .05, dz * s]); g.fillStyle(fruit, 1).fillCircle(p.x, p.y, 2.2 * s); }
  }
  /** A tall Mediterranean cypress. */
  cypress(u: number, v: number, s = 1): void {
    const g = this.g, foot = this.at([u, v, 0]);
    g.fillStyle(0x1c2e14, .2).fillEllipse(foot.x + 5 * s, foot.y + 2, 18 * s, 8 * s);
    for (let k = 0; k < 6; k++) { const p = this.at([u, v, (8 + k * 9) * s]); g.fillStyle(shade(0x2c6b33, k * 5 - 10), 1).fillEllipse(p.x, p.y, (15 - k * 2) * s, 22 * s); }
  }
  /** A round shrub, optionally dotted with berries or flowers. */
  bush(u: number, v: number, s = 1, leaf = 0x3f8a3f, dots = 0): void {
    const g = this.g, p = this.at([u, v, 6 * s]);
    g.fillStyle(0x1c2e14, .2).fillEllipse(p.x + 3, p.y + 6 * s, 20 * s, 8 * s);
    g.fillStyle(shade(leaf, -12), 1).fillEllipse(p.x, p.y + 2, 20 * s, 13 * s);
    g.fillStyle(leaf, 1).fillEllipse(p.x - 2 * s, p.y - 1, 16 * s, 11 * s);
    g.fillStyle(shade(leaf, 18), 1).fillEllipse(p.x - 4 * s, p.y - 3 * s, 8 * s, 5 * s);
    if (dots) for (const [dx, dy] of [[-6, 0], [-1, -4], [4, 1], [6, -3], [0, 3], [-4, -5]] as const) g.fillStyle(dots, 1).fillCircle(p.x + dx * s, p.y + dy * s, 1.8 * s);
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

/** Bakes every asset once with its builder (idempotent across scene restarts). */
export function bakeAll<K extends string>(scene: Scene, assets: Record<K, Asset>, builders: Record<K, (a: Atelier) => void>): void {
  const baker = createBaker(scene);
  // The whole drawing is scaled up by RES (lines, circles and all), then baked at RES x the size.
  baker.graphics.setScale(RES);
  for (const name of Object.keys(assets) as K[]) {
    const asset = assets[name];
    if (scene.textures.exists(asset.key)) continue;
    builders[name](new Atelier(baker, asset.originX ?? asset.width / 2, asset.height - asset.anchorY));
    baker.finish(asset.key, Math.ceil(asset.width * RES), Math.ceil(asset.height * RES));
    scene.textures.get(asset.key).setFilter(1 /* LINEAR */);
  }
  baker.destroy();
}

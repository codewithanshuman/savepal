/*
 * The countryside blocks. The wheat fields carry meaning: they grow with the agreement --
 * bare furrows while it waits, sprouts once sworn, green while the work is under way and PayPal
 * holds the gold, golden and ripe once delivered and approved, and harvested (sheaves and sacks)
 * once PayPal has paid. Berry fields, a vineyard, an orchard, a park and a barn fill the rest;
 * windmills stand in the fields with sails that turn (see life.ts).
 */
import { Atelier, GLASS, GOLD, M, ROOF, shade, type Asset } from "./atelier";

const block = (key: string, height = 400): Asset => ({ key, width: 560, height, anchorY: 150 });
export const FARMS = {
  wheat0: block("savepal:wheat:0"), wheat1: block("savepal:wheat:1"), wheat2: block("savepal:wheat:2"),
  wheat3: block("savepal:wheat:3"), wheat4: block("savepal:wheat:4"),
  strawberries: block("savepal:berries:red"), blueberries: block("savepal:berries:blue"),
  vineyard: block("savepal:vineyard"), orchard: block("savepal:orchard"), park: block("savepal:park"),
  barn: block("savepal:barn", 440), windmill: block("savepal:windmill", 520),
} as const satisfies Record<string, Asset>;
export type FarmKind = keyof typeof FARMS;
/** The windmill's hub, in block tiles and pixels up, where the turning sails are mounted. */
export const WINDMILL_HUB = { u: .42, v: .3, z: 168 } as const;

type Pt = { x: number; y: number };
/** A leaf (or grain head, or petal) as a rotated ellipse in screen space, with a thin outline for clarity. */
function leaf(a: Atelier, at: Pt, ang: number, len: number, wid: number, color: number, outline = 0x2f5a22): void {
  const pts: Pt[] = [];
  for (let i = 0; i < 14; i++) {
    const t = i / 14 * Math.PI * 2, lx = Math.cos(t) * len / 2 + len / 2, ly = Math.sin(t) * wid / 2;
    pts.push({ x: at.x + Math.cos(ang) * lx - Math.sin(ang) * ly, y: at.y + Math.sin(ang) * lx + Math.cos(ang) * ly });
  }
  a.g.fillStyle(color, 1).fillPoints(pts, true).lineStyle(1, outline, .85).strokePoints(pts, true);
}
const UP = -Math.PI / 2;

function fieldEdge(a: Atelier, soil = true): void {
  a.pad(-2.5, -2.5, 2.5, 2.5, M.meadow.top);
  if (soil) {
    a.pad(-2.3, -2.3, 2.3, 2.3, shade(M.soil.top, -14), .15);
    a.pad(-2.2, -2.2, 2.2, 2.2, M.soil.top, .2);
  }
  a.fence([[-2.35, 2.35], [-.4, 2.35]]); a.fence([[.4, 2.35], [2.35, 2.35], [2.35, -2.35]]);
}

/** Raised furrows, one per crop row, lit on their near side. */
function furrows(a: Atelier, rows: number[]): void {
  for (const v of rows) {
    a.pad(-2.1, v - .2, 2.1, v + .16, shade(M.soil.top, -18), .3);
    a.pad(-2.1, v - .16, 2.1, v + .12, shade(M.soil.top, 10), .5);
  }
}

const WHEAT_ROWS = Array.from({ length: 8 }, (_, r) => -1.85 + r * .53);
function wheat(a: Atelier, stage: number): void {
  fieldEdge(a);
  furrows(a, WHEAT_ROWS);
  for (const v of WHEAT_ROWS) for (let u = -1.9; u <= 1.92; u += .38) {
    const p = a.at([u, v, 1]), j = Math.sin(u * 11 + v * 7);
    if (stage === 0) { a.g.fillStyle(0x6e4c30, 1).fillEllipse(p.x, p.y, 7, 3).fillStyle(0xd9b58a, .8).fillEllipse(p.x - 1, p.y - 1, 3, 1.2); continue; }
    if (stage === 1) {
      a.line(0x4f9a35, [[u, v, 1], [u, v, 5]], 1.4);
      const top = a.at([u, v, 5]);
      leaf(a, top, UP - .65, 9, 4.2, 0x86d860); leaf(a, top, UP + .65, 9, 4.2, 0x7fd35a);
      continue;
    }
    if (stage === 2) {
      for (const [da, len, c] of [[-.75, 14, 0x5fb83f], [.75, 14, 0x5fb83f], [-.35, 18, 0x7fd35a], [.35, 18, 0x7fd35a], [0, 21, 0x8fdf68]] as const) leaf(a, p, UP + da + j * .06, len, 5.4, c);
      continue;
    }
    if (stage === 3) {
      leaf(a, p, UP - .9, 11, 4, 0x9aa83a, 0x5a6a20); leaf(a, p, UP + .9, 11, 4, 0x9aa83a, 0x5a6a20);
      for (let k = 0; k < 5; k++) {
        const ang = UP + (k - 2) * .17 + j * .05, len = 24 + (k % 2) * 4, tip = { x: p.x + Math.cos(ang) * len, y: p.y + Math.sin(ang) * len };
        a.g.lineStyle(1.6, 0xc9a43a, 1).beginPath().moveTo(p.x, p.y).lineTo(tip.x, tip.y).strokePath();
        leaf(a, { x: tip.x - Math.cos(ang) * 2, y: tip.y - Math.sin(ang) * 2 }, ang, 11, 4.8, 0xf4d264, 0xb58a1f);
        a.g.lineStyle(.8, 0xe8c45a, .9).beginPath().moveTo(tip.x + Math.cos(ang) * 8, tip.y + Math.sin(ang) * 8).lineTo(tip.x + Math.cos(ang) * 14, tip.y + Math.sin(ang) * 14).strokePath();
      }
      continue;
    }
    // harvested: short golden stubble
    for (let k = -1; k <= 1; k++) a.g.lineStyle(1.4, 0xc9a43a, 1).beginPath().moveTo(p.x + k * 3, p.y).lineTo(p.x + k * 3 + 1, p.y - 4).strokePath();
  }
  if (stage >= 1 && stage <= 3) {
    // a scarecrow keeping watch over the crop
    a.line(0x6b4527, [[0, .1, 0], [0, .1, 46]], 2.8); a.line(0x6b4527, [[-.32, .1, 34], [.32, .1, 34]], 2.8);
    a.box({ u0: -.14, u1: .14, v0: .03, v1: .17, z0: 22, z1: 38 }, M.hay);
    a.box({ u0: -.2, u1: .2, v0: .02, v1: .18, z0: 30, z1: 37 }, { top: 0xd0584a, frontLeft: 0xb8453a, frontRight: 0x8a2f27 });
    const head = a.at([0, .1, 48]);
    a.g.fillStyle(0xf0d27a, 1).fillCircle(head.x, head.y, 6).lineStyle(1, 0x8a6a2a, 1).strokeCircle(head.x, head.y, 6);
    a.g.fillStyle(0x6b3a22, 1).fillTriangle(head.x - 10, head.y - 3, head.x + 10, head.y - 3, head.x, head.y - 14);
  }
  if (stage === 4) {
    for (const [u, v] of [[-1.5, -1.2], [-.4, -1.5], [.8, -1], [-1.1, .5], [.3, .2], [1.4, .7], [-.6, 1.6], [1, 1.7]] as const) {
      a.cylinder(u, v, .17, 0, 24, 0xd9b55a, 0xf0d27a);
      a.line(0xa9862f, [[u - .17, v + .17, 9], [u + .17, v + .17, 9]], 2); a.line(0xa9862f, [[u - .17, v + .17, 17], [u + .17, v + .17, 17]], 2);
    }
    for (const [u, v] of [[1.9, -1.9], [2.05, -1.6]] as const) { a.cylinder(u, v, .15, 0, 18, 0xe9dcc0, 0xf4ead6); a.line(GOLD, [[u - .15, v + .15, 9], [u + .15, v + .15, 9]], 2); }
  }
}

function strawberries(a: Atelier): void {
  fieldEdge(a);
  const rows = Array.from({ length: 6 }, (_, r) => -1.75 + r * .7);
  furrows(a, rows);
  for (const v of rows) for (let u = -1.85; u <= 1.9; u += .53) {
    const p = a.at([u, v, 1]);
    for (const ang of [UP - 1.25, UP - .45, UP + .45, UP + 1.25]) leaf(a, p, ang, 12, 8, 0x5fb83f, 0x2f6a24);
    leaf(a, p, UP, 10, 7, 0x7fd35a, 0x2f6a24);
    for (const [dx, dy] of [[-7, 3], [6, 2], [0, 5]] as const) {
      const b = { x: p.x + dx, y: p.y + dy };
      a.g.fillStyle(0xd8333a, 1).fillPoints([{ x: b.x - 4, y: b.y - 2 }, { x: b.x + 4, y: b.y - 2 }, { x: b.x + 2.4, y: b.y + 4 }, { x: b.x, y: b.y + 6 }, { x: b.x - 2.4, y: b.y + 4 }], true);
      a.g.fillStyle(0x3f8a2a, 1).fillTriangle(b.x - 3, b.y - 2.5, b.x + 3, b.y - 2.5, b.x, b.y - .5);
      a.g.fillStyle(0xffe08a, 1).fillCircle(b.x - 1.2, b.y + .8, .6).fillCircle(b.x + 1.2, b.y + 2, .6);
      a.g.fillStyle(0xffffff, .7).fillCircle(b.x - 1.6, b.y - .6, .9);
    }
  }
  a.basket(1.9, 2.05, 0xd8333a); a.basket(1.6, 2.15, 0xd8333a);
}

function blueberries(a: Atelier): void {
  fieldEdge(a);
  for (let r = 0; r < 5; r++) for (let k = 0; k < 6; k++) {
    const u = -1.75 + k * .7 + (r % 2) * .2, v = -1.7 + r * .85, p = a.at([u, v, 9]);
    a.g.fillStyle(0x1c2e14, .2).fillEllipse(p.x + 4, p.y + 9, 30, 9);
    for (const [dx, dy, rr, c] of [[-7, 3, 9, 0x2f7a4a], [7, 3, 9, 0x2f7a4a], [0, -3, 11, 0x3f8f58], [-3, -6, 6, 0x56a66c]] as const) a.g.fillStyle(c, 1).fillCircle(p.x + dx, p.y + dy, rr);
    a.g.lineStyle(1, 0x1f5a34, .8).strokeCircle(p.x, p.y - 3, 11);
    for (const [dx, dy] of [[-8, 2], [-5, 5], [-2, 2], [5, 4], [8, 1], [3, -2], [-4, -4], [6, -5]] as const) {
      a.g.fillStyle(0x34509e, 1).fillCircle(p.x + dx, p.y + dy, 2.6).fillStyle(0x8fa8ff, 1).fillCircle(p.x + dx - .8, p.y + dy - .8, .9);
    }
  }
  a.basket(1.9, 2.05, 0x3f5fd0); a.basket(1.6, 2.15, 0x3f5fd0);
}

function vineyard(a: Atelier): void {
  fieldEdge(a);
  for (let r = 0; r < 6; r++) {
    const v = -1.8 + r * .72;
    a.pad(-2.1, v - .08, 2.1, v + .14, shade(M.soil.top, -10), .3);
    for (let u = -2.0; u <= 2.05; u += 1) a.line(0x6b4527, [[u, v, 0], [u, v, 26]], 2.2);
    a.line(0x8a6239, [[-2.0, v, 24], [2.0, v, 24]], 1.1);
    for (let u = -1.95; u <= 2.0; u += .21) {
      const p = a.at([u, v, 20 + Math.sin(u * 7 + r) * 2]);
      a.g.fillStyle(Math.sin(u * 13 + r) > 0 ? 0x4f9a3a : 0x6fbf4a, 1).fillCircle(p.x, p.y, 7).lineStyle(1, 0x2f6a24, .6).strokeCircle(p.x, p.y, 7);
    }
    for (let u = -1.75; u <= 1.8; u += .5) {
      const p = a.at([u + .1, v + .02, 12]);
      for (const [dx, dy, rr] of [[-3, 0, 2.6], [0, 0, 2.6], [3, 0, 2.6], [-1.5, 3, 2.5], [1.5, 3, 2.5], [0, 6, 2.3]] as const) a.g.fillStyle(0x5a2a7a, 1).fillCircle(p.x + dx, p.y + dy, rr).fillStyle(0xa77ad0, 1).fillCircle(p.x + dx - .7, p.y + dy - .7, .8);
    }
  }
}

function orchard(a: Atelier): void {
  a.pad(-2.5, -2.5, 2.5, 2.5, M.meadow.top);
  for (const [u, v] of [[-1.7, -1.7], [0, -1.7], [1.7, -1.7], [-1.7, 0], [0, 0], [1.7, 0], [-1.7, 1.7], [0, 1.7], [1.7, 1.7]] as const) a.tree(u, v, 1, 0x3f8f3c, (u + v) % 2 ? 0xd8333a : 0xff9a3c);
  a.line(0x8a6239, [[.4, .5, 0], [.55, .5, 40]], 2); a.line(0x8a6239, [[.65, .5, 0], [.8, .5, 40]], 2);
  for (let z = 6; z < 40; z += 7) a.line(0x8a6239, [[.4 + z / 270, .5, z], [.65 + z / 270, .5, z]], 1.5);
  a.basket(1, 1, 0xd8333a);
}

function park(a: Atelier): void {
  a.pad(-2.5, -2.5, 2.5, 2.5, M.lawn.top);
  a.pad(-2.4, -.15, 2.4, .15, M.paving.top, .2); a.pad(-.15, -2.4, .15, 2.4, M.paving.top, .2);
  a.pad(-1.9, -1.9, -.5, -.5, M.paving.top, .25); a.pad(-1.8, -1.8, -.6, -.6, M.water.top, .4);
  for (const [u, v] of [[-1.4, -1.3], [-1, -.9]] as const) { const p = a.at([u, v, .5]); a.g.fillStyle(0xd8f0ff, .8).fillRect(p.x - 4, p.y, 8, 1); }
  const lily = a.at([-1.2, -1.5, .6]); a.g.fillStyle(0x5fae4a, 1).fillEllipse(lily.x, lily.y, 7, 4).fillStyle(0xff8fb1, 1).fillCircle(lily.x + 1, lily.y - 1, 1.5);
  for (const [u, v] of [[1.6, -1.6], [-1.6, 1.6], [1.7, 1.7], [.9, -2], [-2, .9]] as const) a.tree(u, v, .95);
  for (const [u, v, c] of [[.8, .8, 0xff7aa2], [1.4, .7, 0xffd15c], [.7, 1.5, 0xb07cff]] as const) a.bush(u, v, .7, 0x3f8a3f, c);
  a.bench(-1.2, .55); a.bench(.6, -.55); a.lamp(.3, .3, 28);
  // a small round temple folly
  a.cylinder(1.25, -1.0, .45, 0, 4, M.paving.frontLeft, M.paving.top);
  for (let i = 0; i < 6; i++) { const t = Math.PI * .05 + i * Math.PI * .19; a.line(0xfaf3e2, [[1.25 + Math.cos(t) * .36, -1 + Math.sin(t) * .36, 4], [1.25 + Math.cos(t) * .36, -1 + Math.sin(t) * .36, 34]], 3); }
  for (let k = 0; k < 4; k++) a.cylinder(1.25, -1, .48 - k * .1, 34 + k * 5, 39 + k * 5, shade(M.limestone.frontLeft, k * 4), M.limestone.top);
}

function barn(a: Atelier): void {
  fieldEdge(a, false);
  a.pad(-2.2, .4, 2.2, 2.2, 0xb08a5a, .2);
  const b = { u0: -2.1, u1: .9, v0: -2.1, v1: .1, z0: 0, z1: 58 };
  a.shadow(b.u0, b.v0, b.u1, b.v1);
  a.box(b, { top: 0xc4554a, frontLeft: 0xb8453a, frontRight: 0x8a2f27 });
  for (let u = b.u0 + .2; u < b.u1; u += .2) a.line(0x8a2f27, [[u, b.v1 + .003, 0], [u, b.v1 + .003, 58]], .8, .7);
  a.face(0x5a2a22, [[-1.0, b.v1 + .005, 0], [-.1, b.v1 + .005, 0], [-.1, b.v1 + .005, 44], [-1.0, b.v1 + .005, 44]]);
  a.line(0xf4ead6, [[-1.0, b.v1 + .006, 0], [-.1, b.v1 + .006, 44]], 2); a.line(0xf4ead6, [[-.1, b.v1 + .006, 0], [-1, b.v1 + .006, 44]], 2);
  a.line(0xf4ead6, [[-1.0, b.v1 + .006, 44], [-.1, b.v1 + .006, 44], [-.1, b.v1 + .006, 0], [-1, b.v1 + .006, 0], [-1, b.v1 + .006, 44]], 2);
  a.face(GLASS, [[.3, b.v1 + .005, 34], [.6, b.v1 + .005, 34], [.6, b.v1 + .005, 48], [.3, b.v1 + .005, 48]]);
  a.gable(b, 40, ROOF.barn, { top: 0xc4554a, frontLeft: 0xb8453a, frontRight: 0x8a2f27 }, true);
  for (const [u, v] of [[1.4, -1.6], [1.8, -1.2], [1.5, -.8], [1.6, -1.3]] as const) a.box({ u0: u - .2, u1: u + .2, v0: v - .14, v1: v + .14, z0: 0, z1: 14 }, M.hay);
  a.box({ u0: 1.35, u1: 1.75, v0: -1.4, v1: -1.12, z0: 14, z1: 28 }, M.hay);
  for (const [u, v] of [[-1.5, 1.1], [-.6, 1.5], [.6, 1.0]] as const) { const p = a.at([u, v, 6]); a.g.fillStyle(0xf4ead6, 1).fillEllipse(p.x, p.y, 16, 10).fillStyle(0x2a2a2a, 1).fillEllipse(p.x + 4, p.y - 2, 6, 4).fillStyle(0xf4ead6, 1).fillCircle(p.x + 9, p.y - 4, 4); }
  a.cylinder(1.9, 1.6, .3, 0, 9, 0x8a6239, 0x5fb2e8);
}

function windmill(a: Atelier): void {
  wheat(a, 3);
  const { u, v } = WINDMILL_HUB;
  // a slim, tapering stone tower with a thatched cap
  const cu = u - .42, cv = v - .42;
  a.box({ u0: cu - .7, u1: cu + .7, v0: cv - .7, v1: cv + .7, z0: 0, z1: 6 }, M.granite);
  for (let k = 0; k < 10; k++) a.cylinder(cu, cv, .62 - k * .028, 6 + k * 14, 6 + (k + 1) * 14, shade(M.plaster.frontLeft, -k * .6), M.plaster.top);
  for (let z = 20; z < 140; z += 28) a.line(shade(M.plaster.frontLeft, -14), [[cu - .4, cv + .4, z], [cu + .4, cv + .4, z]], .7, .5);
  a.face(0x5a3a22, [[cu - .16, cv + .6, 6], [cu + .16, cv + .6, 6], [cu + .16, cv + .58, 34], [cu - .16, cv + .58, 34]]);
  for (const z of [58, 96, 128]) a.face(GLASS, [[cu - .05, cv + .55, z], [cu + .05, cv + .55, z], [cu + .05, cv + .53, z + 13], [cu - .05, cv + .53, z + 13]]);
  a.box({ u0: cu - .5, u1: cu + .5, v0: cv - .5, v1: cv + .5, z0: 146, z1: 150 }, M.timber);
  a.cone(cu, cv, .58, 150, 48, ROOF.thatch[0]);
  a.box({ u0: u - .1, u1: u + .04, v0: v - .1, v1: v + .04, z0: WINDMILL_HUB.z - 8, z1: WINDMILL_HUB.z + 4 }, M.timber);
  for (const [bu, bv] of [[-1.6, 1.7], [-1.9, 1.4]] as const) a.cylinder(bu, bv, .16, 0, 16, 0xe9dcc0, 0xf4ead6);
}

export const FARM_BUILDERS: Record<FarmKind, (a: Atelier) => void> = {
  wheat0: a => wheat(a, 0), wheat1: a => wheat(a, 1), wheat2: a => wheat(a, 2), wheat3: a => wheat(a, 3), wheat4: a => wheat(a, 4),
  strawberries, blueberries,
  vineyard, orchard, park, barn, windmill,
};

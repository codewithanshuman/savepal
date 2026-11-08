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

function fieldEdge(a: Atelier, soil = true): void {
  a.pad(-2.5, -2.5, 2.5, 2.5, M.meadow.top);
  if (soil) a.pad(-2.25, -2.25, 2.25, 2.25, M.soil.top, .2);
  a.fence([[-2.35, 2.35], [-.4, 2.35]]); a.fence([[.4, 2.35], [2.35, 2.35], [2.35, -2.35]]);
}

function wheat(a: Atelier, stage: number): void {
  fieldEdge(a);
  for (let v = -2.05; v <= 2.1; v += .3) {
    a.line(shade(M.soil.top, -14), [[-2.2, v + .1, .3], [2.2, v + .1, .3]], 1.2, .8);
    for (let u = -2.1; u <= 2.15; u += .16) {
      const p = a.at([u, v, 0]), j = Math.sin(u * 17 + v * 11) * 1.5;
      if (stage === 1) a.g.fillStyle(0x7fcf5a, 1).fillRect(p.x - 1, p.y - 3, 2, 3);
      if (stage === 2) { a.g.lineStyle(1.6, 0x4f9a35, 1).beginPath().moveTo(p.x, p.y).lineTo(p.x + j, p.y - 11).strokePath(); a.g.fillStyle(0x6fbe48, 1).fillEllipse(p.x + j, p.y - 11, 4, 5); }
      if (stage === 3) { a.g.lineStyle(1.6, 0xc9a43a, 1).beginPath().moveTo(p.x, p.y).lineTo(p.x + j, p.y - 16).strokePath(); a.g.fillStyle(0xf2cf5a, 1).fillEllipse(p.x + j, p.y - 17, 4, 8); }
      if (stage === 4) a.g.fillStyle(0xd9b55a, 1).fillRect(p.x - 1, p.y - 2, 2, 2);
    }
  }
  if (stage >= 1 && stage <= 3) {
    // a scarecrow keeping watch over the crop
    a.line(0x6b4527, [[0, 0, 0], [0, 0, 40]], 2.5); a.line(0x6b4527, [[-.28, 0, 30], [.28, 0, 30]], 2.5);
    a.box({ u0: -.12, u1: .12, v0: -.06, v1: .06, z0: 20, z1: 34 }, M.hay);
    const head = a.at([0, 0, 42]); a.g.fillStyle(0xf0d27a, 1).fillCircle(head.x, head.y, 5).fillStyle(0x8a3a2a, 1).fillRect(head.x - 7, head.y - 7, 14, 3);
  }
  if (stage === 4) {
    for (const [u, v] of [[-1.5, -1.2], [-.4, -1.5], [.8, -1], [-1.1, .5], [.3, .2], [1.4, .7], [-.6, 1.6], [1, 1.7]] as const) {
      a.cylinder(u, v, .14, 0, 22, 0xd9b55a, 0xf0d27a);
      a.line(0xa9862f, [[u - .14, v + .14, 12], [u + .14, v + .14, 12]], 1.5);
    }
    for (const [u, v] of [[1.9, -1.9], [2.05, -1.6]] as const) { a.cylinder(u, v, .14, 0, 16, 0xe9dcc0, 0xf4ead6); a.line(GOLD, [[u - .14, v + .14, 8], [u + .14, v + .14, 8]], 2); }
  }
}

function berries(a: Atelier, fruit: number): void {
  fieldEdge(a);
  for (let r = 0; r < 7; r++) for (let k = 0; k < 8; k++) {
    const u = -1.95 + k * .55, v = -1.9 + r * .62;
    a.bush(u, v, .7, fruit === 0xd8333a ? 0x4f9a3f : 0x2f7a4a);
    const p = a.at([u, v, 5]);
    for (const [dx, dy] of [[-5, -1], [-1, -4], [4, 0], [1, 3], [5, -4], [-4, 3]] as const) a.g.fillStyle(fruit, 1).fillCircle(p.x + dx, p.y + dy, 2.6).fillStyle(0xffffff, .55).fillCircle(p.x + dx - .8, p.y + dy - .8, .9);
  }
  for (const [u, v, c] of [[1.9, 2.05, fruit], [1.6, 2.1, fruit]] as const) a.basket(u, v, c);
}

function vineyard(a: Atelier): void {
  fieldEdge(a);
  for (let r = 0; r < 8; r++) {
    const v = -2 + r * .56;
    for (let u = -2.1; u <= 2.15; u += .7) a.line(0x6b4527, [[u, v, 0], [u, v, 20]], 1.8);
    a.line(0x8a6239, [[-2.1, v, 18], [2.1, v, 18]], 1);
    for (let u = -2.05; u <= 2.1; u += .22) { const p = a.at([u, v, 15]); a.g.fillStyle(0x4f8a3a, 1).fillEllipse(p.x, p.y, 11, 8); if (Math.sin(u * 9 + r) > .2) a.g.fillStyle(0x6a3a8a, 1).fillCircle(p.x + 2, p.y + 4, 2.6).fillStyle(0x8a5ab0, 1).fillCircle(p.x + 1, p.y + 3, 1.2); }
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
  strawberries: a => berries(a, 0xd8333a), blueberries: a => berries(a, 0x3f5fd0),
  vineyard, orchard, park, barn, windmill,
};

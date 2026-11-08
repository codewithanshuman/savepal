/*
 * The town's buildings: the grand bazaar (two blocks), the guild hall and its workshop yard, the
 * port with its customs house, pier, lighthouse and moored galley, and the houses that fill the
 * neighbourhood blocks -- homesteads, artisans' workshops (one per delivered page) and manors
 * (one per other agreement, flying a banner that says where its money is).
 */
import { Atelier, GLASS, GLOW, GOLD, M, ROOF, mat, shade, type Asset, type Box, type Colors, type Roof } from "./atelier";

export const TOWN = {
  bazaar: { key: "savepal:bazaar", width: 840, height: 540, anchorY: 220 },
  bountyStall: { key: "savepal:bounty-stall", width: 120, height: 120, anchorY: 34 },
  guild: { key: "savepal:guild", width: 580, height: 500, anchorY: 150 },
  port: { key: "savepal:port", width: 1000, height: 720, anchorY: 520, originX: 300 },
  galley: { key: "savepal:galley", width: 380, height: 280, anchorY: 120 },
  homestead0: { key: "savepal:homestead:0", width: 560, height: 420, anchorY: 150 },
  homestead1: { key: "savepal:homestead:1", width: 560, height: 420, anchorY: 150 },
  homestead2: { key: "savepal:homestead:2", width: 560, height: 420, anchorY: 150 },
  homestead3: { key: "savepal:homestead:3", width: 560, height: 420, anchorY: 150 },
  workshop0: { key: "savepal:workshop:0", width: 560, height: 420, anchorY: 150 },
  workshop1: { key: "savepal:workshop:1", width: 560, height: 420, anchorY: 150 },
  manorHeld: { key: "savepal:manor:held", width: 560, height: 470, anchorY: 150 },
  manorPaid: { key: "savepal:manor:paid", width: 560, height: 470, anchorY: 150 },
  manorOpen: { key: "savepal:manor:open", width: 560, height: 470, anchorY: 150 },
} as const satisfies Record<string, Asset>;
export type TownKind = keyof typeof TOWN;

/** Half-extents of the bazaar estate, and where bounty stalls are raised, one per bounty paid. */
export const BAZAAR_HALF = { u: 5.5, v: 2.5 } as const;
export const BOUNTY_SLOTS: ReadonlyArray<readonly [number, number]> = [[-3.9, 2.05], [-2.6, 2.1], [2.6, 2.1], [3.9, 2.05], [4.9, .4], [4.9, -.9]];
/** The lighthouse fire and the customs flag, in port tiles. */
export const PORT_FLAG = { u: .9, v: -1.0, z: 152 } as const;
/** The treadwheel crane's hub and the guild's sign, in guild tiles. */
export const GUILD_FLAG = { u: -1.95, v: -1.9, z: 150 } as const;

const AWNINGS = [0xc0392b, 0x2f6fdc, 0x1f9e62, 0xe8b02a, 0x7a5aa8, 0xd0702b];
const GOODS = [0xd8333a, 0x3f5fd0, 0xe8b02a, 0x7fb84e, 0xd98a4a, 0xa05ad0];

function stall(a: Atelier, u: number, v: number, awning: number, goods: number[], wide = .42): void {
  a.shadow(u - wide, v - .3, u + wide, v + .3, 1);
  a.box({ u0: u - wide, u1: u + wide, v0: v - .22, v1: v + .22, z0: 0, z1: 15 }, M.timber);
  a.box({ u0: u - wide, u1: u + wide, v0: v - .22, v1: v + .22, z0: 15, z1: 17 }, mat(0xc79a62, 0xa77d4a, 0x86603a));
  goods.forEach((c, i) => a.basket(u - wide + .16 + i * ((wide * 2 - .32) / Math.max(1, goods.length - 1)), v + .02, c));
  for (const [pu, pv] of [[u - wide + .02, v + .2], [u + wide - .02, v + .2], [u + wide - .02, v - .2]] as const) a.line(0x5c3b22, [[pu, pv, 17], [pu, pv, 40]], 2);
  const n = Math.round(wide * 10);
  for (let k = 0; k < n; k++) {
    const u0 = u - wide - .06 + k * (wide * 2 + .12) / n, u1 = u0 + (wide * 2 + .12) / n;
    a.face(k % 2 ? 0xfbf3e2 : awning, [[u0, v - .32, 46], [u1, v - .32, 46], [u1, v + .34, 36], [u0, v + .34, 36]]);
    a.face(k % 2 ? 0xe8dcc4 : shade(awning, -20), [[u0, v + .34, 36], [u1, v + .34, 36], [u1, v + .35, 31], [u0, v + .35, 31]]);
  }
}

function bazaar(a: Atelier): void {
  const { u: hu, v: hv } = BAZAAR_HALF;
  a.pad(-hu, -hv, hu, hv, M.cobble.top);
  for (let u = -hu + .5; u < hu; u += .5) a.line(shade(M.cobble.top, -9), [[u, -hv, .2], [u, hv, .2]], .5, .55);
  for (let v = -hv + .5; v < hv; v += .5) a.line(shade(M.cobble.top, -9), [[-hu, v, .2], [hu, v, .2]], .5, .55);
  a.pad(-1.2, -1.2, 1.2, 1.4, M.paving.top, .3);
  // the stoa: a long colonnade along the back with shops behind it
  const back: Box = { u0: -5.3, u1: 5.3, v0: -2.45, v1: -2.2, z0: 0, z1: 66 };
  a.box({ u0: -5.35, u1: 5.35, v0: -2.45, v1: -1.6, z0: 0, z1: 5 }, M.limestone);
  a.box(back, M.ochre);
  a.arches(back.v1 + .003, back.u0 + .1, back.u1 - .1, 5, 50, 10, 0x3b2a20, shade(M.ochre.frontLeft, 14));
  for (let i = 0; i < 10; i++) { const u = back.u0 + .1 + (i + .5) * (back.u1 - back.u0 - .2) / 10; a.face(AWNINGS[i % AWNINGS.length]!, [[u - .3, back.v1 + .006, 50], [u + .3, back.v1 + .006, 50], [u + .3, back.v1 + .006, 44], [u - .3, back.v1 + .006, 44]]); }
  for (let u = -5.1; u <= 5.15; u += .6) a.cylinder(u, -1.78, .08, 5, 62, 0xfaf3e2, 0xffffff);
  const ent: Box = { u0: -5.35, u1: 5.35, v0: -2.45, v1: -1.62, z0: 62, z1: 70 };
  a.box(ent, M.limestone); a.cornice(ent, .04, 3);
  a.gable({ ...ent, z1: 70 }, 26, ROOF.terracotta, M.limestone, true);
  // the covered hall on the west side
  const hall: Box = { u0: -5.3, u1: -3.6, v0: -1.2, v1: 2.2, z0: 0, z1: 4 };
  a.box(hall, M.limestone);
  for (const [cu, cv] of [[-5.2, -1.1], [-3.7, -1.1], [-5.2, .5], [-3.7, .5], [-5.2, 2.1], [-3.7, 2.1]] as const) a.box({ u0: cu - .06, u1: cu + .06, v0: cv - .06, v1: cv + .06, z0: 4, z1: 48 }, M.timber);
  for (const [cu, cv, c] of [[-4.8, -.6, 0xd8333a], [-4.2, -.4, 0x3f5fd0], [-4.7, .9, 0xe8b02a], [-4.1, 1.3, 0x7fb84e], [-4.5, 1.8, 0xd98a4a]] as const) { a.crate(cu, cv, .15, 10); a.basket(cu, cv, c); }
  a.gable({ u0: -5.35, u1: -3.55, v0: -1.25, v1: 2.25, z0: 0, z1: 48 }, 30, ROOF.thatch, M.timber, false);
  // the fountain at the heart of the square
  a.fountain(0, .1, 1.3);
  // stall rows, back to front
  const rows: Array<[number, number]> = [[-2.6, -.95], [-1.3, -.95], [1.3, -.95], [2.6, -.95], [3.9, -.6], [-2.6, .9], [-1.3, 1.05], [1.3, 1.05], [2.6, .9]];
  rows.sort((p, q) => p[0] + p[1] - q[0] - q[1]).forEach(([u, v], i) => stall(a, u, v, AWNINGS[i % AWNINGS.length]!, [GOODS[i % 6]!, GOODS[(i + 2) % 6]!, GOODS[(i + 4) % 6]!]));
  // carts, lanterns and banners at the edges
  for (const [u, v] of [[-5, 2.4], [5.2, 2.4], [-.9, 2.4], [.9, 2.4], [5.2, -1.4]] as const) a.lamp(u, v, 30);
  for (const [u, v] of [[4.5, 1.9], [4.75, 2.15]] as const) a.barrel(u, v);
  a.crate(-3.3, 2.25); a.crate(-3.05, 2.3, .13, 10);
}

/** A golden stall raised in the bazaar for every bounty paid through PayPal. */
function bountyStall(a: Atelier): void {
  a.pad(-.5, -.35, .5, .35, 0xc79a3a, .2);
  a.box({ u0: -.4, u1: .4, v0: -.22, v1: .22, z0: 0, z1: 15 }, M.gold);
  a.basket(-.2, .02, GOLD); a.basket(.15, .02, 0xffe48a);
  for (const [pu, pv] of [[-.38, .2], [.38, .2], [.38, -.2]] as const) a.line(0x8a5a1a, [[pu, pv, 15], [pu, pv, 40]], 2);
  for (let k = 0; k < 4; k++) { const u0 = -.46 + k * .23; a.face(k % 2 ? 0xfff3c4 : GOLD, [[u0, -.3, 46], [u0 + .23, -.3, 46], [u0 + .23, .32, 36], [u0, .32, 36]]); }
}

function guild(a: Atelier): void {
  a.pad(-2.5, -2.5, 2.5, 2.5, M.meadow.top);
  a.pad(.7, -1.4, 2.4, 2.4, M.cobble.top, .2);
  a.pad(-.9, .3, .1, 2.5, M.cobble.top, .2);
  const base: Box = { u0: -2.2, u1: .6, v0: -2.2, v1: .25, z0: 0, z1: 26 }, body: Box = { ...base, z0: 26, z1: 92 };
  a.shadow(base.u0, base.v0, base.u1, base.v1);
  a.box(base, M.sandstone); a.box(body, M.plaster);
  for (let u = body.u0 + .18; u < body.u1; u += .35) a.line(0x6b4527, [[u, body.v1 + .004, 26], [u, body.v1 + .004, 92]], 3);
  for (let v = body.v0 + .18; v < body.v1; v += .35) a.line(0x5c3b22, [[body.u1 + .004, v, 26], [body.u1 + .004, v, 92]], 3);
  for (const z of [26, 58, 91]) { a.line(0x6b4527, [[body.u0, body.v1 + .004, z], [body.u1, body.v1 + .004, z]], 3); a.line(0x5c3b22, [[body.u1 + .004, body.v0, z], [body.u1 + .004, body.v1, z]], 3); }
  a.arches(base.v1 + .004, base.u0 + .3, base.u1 - .3, 0, 26, 3, 0x3b2c22);
  a.arches(body.v1 + .006, body.u0 + .2, body.u1 - .2, 32, 52, 4, GLOW);
  a.arches(body.v1 + .006, body.u0 + .2, body.u1 - .2, 64, 84, 4, GLOW);
  a.sideArches(body.u1 + .006, body.v0 + .15, body.v1 - .15, 32, 52, 3, GLOW); a.sideArches(body.u1 + .006, body.v0 + .15, body.v1 - .15, 64, 84, 3, GLOW);
  a.gable(body, 60, ROOF.terracotta, M.plaster, true);
  a.box({ u0: -1.95 - .17, u1: -1.95 + .17, v0: -1.9 - .17, v1: -1.9 + .17, z0: 100, z1: 150 }, M.sandstone);
  // the hanging sign: a gold hammer on red
  a.line(0x3a2a1a, [[.6, .1, 70], [1.1, .1, 70]], 2);
  a.face(0x8a1f1a, [[.85, .1, 68], [1.15, .1, 68], [1.15, .1, 46], [.85, .1, 46]]);
  a.face(GOLD, [[.92, .101, 62], [1.08, .101, 62], [1.08, .101, 57], [.92, .101, 57]]); a.face(GOLD, [[.98, .101, 57], [1.02, .101, 57], [1.02, .101, 48], [.98, .101, 48]]);
  // the workshop yard: timber, cut stone and a treadwheel crane
  for (let k = 0; k < 3; k++) for (let j = 0; j < 3 - k; j++) a.cylinder(1.2 + j * .26 + k * .13, 1.7, .12, k * 11, k * 11 + 0.01, 0x8a5a32, 0xc79a62);
  for (let j = 0; j < 4; j++) { const p0 = a.at([1.1 + j * .25, 1.62, 6]); a.g.fillStyle(0xc79a62, 1).fillCircle(p0.x, p0.y, 5).lineStyle(1, 0x6b4527, 1).strokeCircle(p0.x, p0.y, 5); }
  a.box({ u0: 1.75, u1: 2.15, v0: -.2, v1: .2, z0: 0, z1: 12 }, M.granite); a.box({ u0: 1.85, u1: 2.15, v0: .3, v1: .6, z0: 0, z1: 10 }, M.granite);
  const hub = a.at([1.5, -.9, 34]);
  a.line(0x6b4527, [[1.2, -1.2, 0], [1.5, -.9, 34], [1.8, -.6, 0]], 3);
  a.g.lineStyle(3, 0x7a4e2c, 1).strokeEllipse(hub.x, hub.y, 34, 46).lineStyle(1.5, 0x7a4e2c, 1);
  for (let k = 0; k < 6; k++) { const t = k / 6 * Math.PI; a.g.beginPath().moveTo(hub.x - Math.cos(t) * 17, hub.y - Math.sin(t) * 23).lineTo(hub.x + Math.cos(t) * 17, hub.y + Math.sin(t) * 23).strokePath(); }
  a.line(0x6b4527, [[1.5, -.9, 34], [2.2, -1.9, 92]], 3); a.line(0x3a2a1a, [[2.2, -1.9, 92], [2.2, -1.9, 40]], 1);
  a.box({ u0: 2.1, u1: 2.3, v0: -2, v1: -1.8, z0: 32, z1: 40 }, M.granite);
  a.tree(-2.1, 2, 1.1); a.cypress(2.25, 2.25, .9); a.barrel(.35, 1.9); a.barrel(.6, 2.15);
}

/** A galley under oar and sail; z lifts the whole ship (sea level at the port is below the cliff). */
export function galley(a: Atelier, u0: number, u1: number, v: number, z = 0): void {
  const hull = 0x5a3a22, mid = (u0 + u1) / 2;
  a.face(shade(hull, -15), [[u0 + .3, v - .4, z - 6], [u1 - .2, v - .4, z - 6], [u1 + .25, v, z + 6], [u1 - .2, v + .4, z - 6], [u0 + .3, v + .4, z - 6], [u0, v, z + 4]]);
  a.face(hull, [[u0 + .3, v + .4, z - 6], [u1 - .2, v + .4, z - 6], [u1 - .2, v + .4, z + 10], [u0 + .3, v + .4, z + 10]]);
  a.face(shade(hull, -25), [[u1 - .2, v + .4, z - 6], [u1 + .25, v, z + 6], [u1 + .25, v, z + 14], [u1 - .2, v + .4, z + 10]]);
  a.face(0xc79a62, [[u0 + .3, v - .4, z + 10], [u1 - .2, v - .4, z + 10], [u1 + .25, v, z + 14], [u1 - .2, v + .4, z + 10], [u0 + .3, v + .4, z + 10], [u0, v, z + 12]]);
  for (let u = u0 + .5; u < u1 - .3; u += .3) a.line(0xd8b27a, [[u, v + .4, z + 4], [u - .2, v + .75, z - 10]], 1.2);
  a.face(GOLD, [[u0 + .3, v + .41, z + 7], [u1 - .2, v + .41, z + 7], [u1 - .2, v + .41, z + 9], [u0 + .3, v + .41, z + 9]]);
  for (const [du, c] of [[.25, 0xc0392b], [.75, 0x2f6fdc]] as const) { const p = a.at([u0 + (u1 - u0) * du, v + .412, z + 4]); a.g.fillStyle(c, 1).fillCircle(p.x, p.y, 3.4).fillStyle(GOLD, 1).fillCircle(p.x, p.y, 1.4); }
  a.line(0x4a3020, [[mid, v, z + 12], [mid, v, z + 96]], 3);
  a.face(0xf6eedb, [[mid - .05, v - .52, z + 90], [mid - .05, v + .52, z + 90], [mid - .05, v + .58, z + 36], [mid - .05, v - .58, z + 36]]);
  a.face(0xc0392b, [[mid - .052, v - .54, z + 70], [mid - .052, v + .54, z + 70], [mid - .052, v + .56, z + 59], [mid - .052, v - .56, z + 59]]);
  a.line(0x4a3020, [[mid, v - .58, z + 91], [mid, v + .58, z + 91]], 2);
  a.line(0x3a2a1a, [[mid, v, z + 96], [u1 + .2, v, z + 14]], .8, .7); a.line(0x3a2a1a, [[mid, v, z + 96], [u0 + .1, v, z + 12]], .8, .7);
}

/** The cliff: the island's edge is 2 tiles east of the port block; the sea is 130 px below. */
const EDGE = 4.5, SEA = -130;

function port(a: Atelier): void {
  // the cliff-top quay: grass, a cobbled lane to the edge and a stone parapet with a gap for the stair
  a.pad(-2.5, -2.5, 2.5, 2.5, M.meadow.top);
  a.pad(-1.2, -2.4, 2.5, 2.4, M.cobble.top, .2);
  a.pad(2.4, -.45, EDGE, .45, M.cobble.top, .2);
  for (let v = -2.4; v < -.55; v += .5) a.box({ u0: EDGE - .18, u1: EDGE, v0: v, v1: v + .4, z0: 0, z1: 12 }, M.granite);
  for (let v = .65; v < 2.6; v += .5) a.box({ u0: EDGE - .18, u1: EDGE, v0: v, v1: Math.min(2.5, v + .4), z0: 0, z1: 12 }, M.granite);
  // the customs house with its arcade and watch tower
  const body: Box = { u0: -2.2, u1: .6, v0: -2.2, v1: .6, z0: 0, z1: 80 };
  a.shadow(body.u0, body.v0, body.u1, body.v1);
  a.box(body, M.sandstone);
  a.arches(body.v1 + .004, body.u0 + .1, body.u1 - .1, 0, 40, 4, 0x3b2c22, shade(M.sandstone.frontLeft, 14));
  a.cornice({ ...body, z1: 46 }, .03, 3, M.sandstone);
  a.arches(body.v1 + .004, body.u0 + .1, body.u1 - .1, 52, 74, 6, GLASS, shade(M.sandstone.frontLeft, 14));
  a.sideArches(body.u1 + .004, body.v0 + .15, body.v1 - .15, 6, 40, 3, 0x3b2c22); a.sideArches(body.u1 + .004, body.v0 + .15, body.v1 - .15, 52, 74, 4, GLASS);
  a.cornice(body, .07, 5, M.sandstone); a.merlons(body, M.sandstone, .15, 8);
  const tower: Box = { u0: .2, u1: 1.4, v0: -1.6, v1: -.4, z0: 0, z1: 136 };
  a.box(tower, M.sandstone); a.storeys({ ...tower, z0: 40, z1: 132 }, 3, 2, 2, M.sandstone, true);
  a.cornice(tower, .07, 5, M.sandstone); a.merlons(tower, M.sandstone, .13, 8);
  a.line(0x4a3a2a, [[PORT_FLAG.u, PORT_FLAG.v, 144], [PORT_FLAG.u, PORT_FLAG.v, PORT_FLAG.z]], 2);
  for (const [u, v] of [[-1.6, 1.5], [-1.3, 1.8], [-.9, 1.6], [1.2, 1.4], [1.5, 1.7]] as const) a.crate(u, v);
  for (const [u, v] of [[1.9, -1.8], [2.05, -1.5], [1.85, 1.2]] as const) a.barrel(u, v);
  a.lamp(-1.6, 2.35, 28); a.lamp(1.8, 2.35, 28); a.lamp(EDGE - .3, -.6, 28);
  // the stone stair down the cliff face: a masonry flank, then the steps from the top to the sea
  const v0 = -.45, v1 = 3.0, steps = 18, uo = EDGE + .62;
  a.face(M.granite.frontRight, [[uo, v0, 0], [uo, v1, SEA], [uo, v1, SEA - 4], [uo, v0, SEA - 4]]);
  for (let z = -16; z > SEA; z -= 16) a.line(shade(M.granite.frontRight, -14), [[uo + .001, v0, z], [uo + .001, Math.min(v1, v0 + (v1 - v0) * (z / SEA)), z]], .7, .55);
  for (let k = 0; k < steps; k++) {
    const t0 = k / steps, t1 = (k + 1) / steps, va = v0 + (v1 - v0) * t0, vb = v0 + (v1 - v0) * t1, z = SEA * t0;
    a.box({ u0: EDGE, u1: uo, v0: va, v1: vb, z0: z - 6, z1: z }, M.paving);
  }
  // the landing and the wooden dock at sea level, on posts
  a.box({ u0: EDGE, u1: EDGE + 1.3, v0: 2.6, v1: 3.6, z0: SEA - 6, z1: SEA + 2 }, M.granite);
  for (let u = EDGE + 1.5; u < 10.1; u += .55) for (const v of [2.5, 3.5]) a.line(0x4a3020, [[u, v, SEA - 18], [u, v, SEA + 2]], 2.5);
  a.box({ u0: EDGE + 1.3, u1: 10.1, v0: 2.45, v1: 3.55, z0: SEA, z1: SEA + 3 }, M.timber);
  for (let u = EDGE + 1.4; u < 10.1; u += .18) a.line(0x5c3b22, [[u, 2.45, SEA + 3.1], [u, 3.55, SEA + 3.1]], .7);
  for (const u of [6.4, 7.9, 9.4]) for (const v of [2.4, 3.6]) a.cylinder(u, v, .06, SEA + 3, SEA + 11, 0x4a3020, 0x6b4527);
  galley(a, 6.0, 9.4, 1.55, SEA);
  // the lighthouse on its rock at the end of the dock, its fire level with the cliff top
  a.cylinder(10.8, 3.0, .78, SEA - 14, SEA + 6, 0x7d7468, 0x9a9286);
  a.cylinder(10.8, 3.0, .46, SEA + 6, SEA + 104, M.limestone.frontLeft, M.limestone.top);
  for (const z of [SEA + 34, SEA + 66]) a.line(shade(M.limestone.frontLeft, -16), [[10.5, 3.32, z], [11.1, 3.32, z]], .8, .6);
  a.cylinder(10.8, 3.0, .54, SEA + 104, SEA + 110, M.granite.frontLeft, M.granite.top);
  a.cylinder(10.8, 3.0, .28, SEA + 110, SEA + 124, 0xff9a3c, 0xffd36a);
  const fire = a.at([10.8, 3.0, SEA + 130]); a.g.fillStyle(0xffd36a, .55).fillCircle(fire.x, fire.y, 16).fillStyle(0xfff3c4, .9).fillCircle(fire.x, fire.y, 7);
  a.cone(10.8, 3.0, .38, SEA + 124, 28, ROOF.terracotta[0]);
}

type House = { wall: Colors; roof: Roof; storeys: number; timber?: boolean; hip?: boolean; garden: "veg" | "berries" | "orchard" | "vines"; door?: number };
function homestead(a: Atelier, h: House, shop?: { awning: number; goods: number[] }): void {
  a.pad(-2.5, -2.5, 2.5, 2.5, M.meadow.top);
  a.pad(-.35, .1, .35, 2.5, M.cobble.top, .2);
  const z1 = 12 + h.storeys * 34, b: Box = { u0: -2.1, u1: .5, v0: -2.1, v1: -.15, z0: 0, z1 };
  a.tree(-2.15, -2.15, 1.05, 0x3a8a3c);
  a.shadow(b.u0, b.v0, b.u1, b.v1);
  a.box({ ...b, z1: 10 }, M.granite); a.box({ ...b, z0: 10 }, h.wall);
  if (h.timber) {
    for (let u = b.u0 + .2; u < b.u1; u += .4) a.line(0x6b4527, [[u, b.v1 + .004, 10], [u, b.v1 + .004, z1]], 2.5);
    for (let v = b.v0 + .2; v < b.v1; v += .4) a.line(0x5c3b22, [[b.u1 + .004, v, 10], [b.u1 + .004, v, z1]], 2.5);
  }
  for (let f = 0; f < h.storeys; f++) {
    const z = 12 + f * 34;
    a.arches(b.v1 + .006, b.u0 + .12, b.u1 - .12, z + 6, z + 28, f === 0 ? 3 : 4, f === 0 ? GLASS : GLOW, shade(h.wall.frontLeft, 16));
    a.sideArches(b.u1 + .006, b.v0 + .12, b.v1 - .12, z + 6, z + 28, 3, f === 0 ? GLOW : GLASS, shade(h.wall.frontRight, 16));
    if (f > 0) a.cornice({ ...b, z1: z }, .02, 2.2, h.wall);
  }
  // the front door on the path
  a.face(h.door ?? 0x5a3a22, [[-.2, b.v1 + .008, 10], [.12, b.v1 + .008, 10], [.12, b.v1 + .008, 34], [-.04, b.v1 + .008, 40], [-.2, b.v1 + .008, 34]]);
  if (h.hip) a.hip(b, 38, h.roof); else a.gable(b, 40, h.roof, h.wall, true);
  a.box({ u0: -1.6, u1: -1.3, v0: -1.8, v1: -1.5, z0: z1 + 6, z1: z1 + 34 }, M.granite);
  if (shop) {
    for (let k = 0; k < 6; k++) { const u0 = -2.05 + k * .42; a.face(k % 2 ? 0xfbf3e2 : shop.awning, [[u0, -.15, 40], [u0 + .42, -.15, 40], [u0 + .42, .35, 30], [u0, .35, 30]]); }
    a.box({ u0: -1.9, u1: -.6, v0: .05, v1: .4, z0: 0, z1: 13 }, M.timber);
    shop.goods.forEach((c, i) => a.basket(-1.75 + i * .4, .22, c));
    a.line(0x3a2a1a, [[.5, -.2, 62], [.95, -.2, 62]], 2);
    a.face(shop.awning, [[.7, -.2, 60], [1, -.2, 60], [1, -.2, 40], [.7, -.2, 40]]);
    a.face(GOLD, [[.78, -.199, 54], [.92, -.199, 54], [.92, -.199, 46], [.78, -.199, 46]]);
  }
  // the garden in front, fenced along the street
  const g0 = .5, g1 = 2.3;
  if (h.garden === "veg") for (let r = 0; r < 4; r++) { const v = .55 + r * .42; a.pad(-2.2, v - .12, -.6, v + .12, M.soil.top, .2); for (let u = -2.05; u < -.65; u += .28) { const p = a.at([u, v, 2]); a.g.fillStyle(r % 2 ? 0x7fb84e : 0x5d9a3a, 1).fillEllipse(p.x, p.y, 9, 6); if (r === 2) a.g.fillStyle(0xe2552f, 1).fillCircle(p.x + 2, p.y - 1, 2); } }
  if (h.garden === "berries") for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) a.bush(-2.05 + k * .45, .7 + r * .55, .8, 0x3f8a3f, r === 1 ? 0x3f5fd0 : 0xd8333a);
  if (h.garden === "orchard") for (const [u, v] of [[-1.9, .9], [-1, 1.2], [-1.7, 2], [-.85, 2.1]] as const) a.tree(u, v, .75, 0x3f8f3c, 0xd8333a);
  if (h.garden === "vines") { for (let r = 0; r < 4; r++) { const v = .6 + r * .45; a.line(0x6b4527, [[-2.2, v, 12], [-.6, v, 12]], 1.2); for (let u = -2.1; u < -.6; u += .3) { const p = a.at([u, v, 10]); a.g.fillStyle(0x4f8a3a, 1).fillEllipse(p.x, p.y, 10, 7).fillStyle(0x6a3a8a, 1).fillCircle(p.x + 2, p.y + 3, 2.4); } } a.cypress(-.75, 2.2, .8); }
  a.fence([[-2.4, g1 + .1], [-.45, g1 + .1]]); a.fence([[.45, g1 + .1], [2.4, g1 + .1], [2.4, g0 - .6]]);
  a.bench(1.3, 1.1); a.bush(1.9, .1, .9, 0x3f8a3f, 0xff7aa2); a.bush(1.0, 1.9, .8, 0x3f8a3f, 0xffd15c);
  if (h.garden !== "orchard") { a.cylinder(1.55, -1.3, .25, 0, 12, M.granite.frontLeft, 0x3a8cc4); a.line(0x5c3b22, [[1.35, -1.3, 12], [1.35, -1.3, 30]], 2); a.line(0x5c3b22, [[1.75, -1.3, 12], [1.75, -1.3, 30]], 2); a.gable({ u0: 1.25, u1: 1.85, v0: -1.5, v1: -1.1, z0: 0, z1: 30 }, 10, h.roof, M.timber, true); }
}

function manor(a: Atelier, banner: number): void {
  a.pad(-2.5, -2.5, 2.5, 2.5, M.meadow.top);
  a.pad(-.4, .3, .4, 2.5, M.cobble.top, .2);
  const b: Box = { u0: -2.1, u1: 1.4, v0: -2.1, v1: .25, z0: 0, z1: 96 };
  a.tree(-2.15, 1.9, 1.1);
  a.shadow(b.u0, b.v0, b.u1, b.v1);
  a.box(b, M.limestone);
  a.storeys(b, 3, 6, 4, M.limestone, true);
  a.cornice(b, .08, 5);
  a.hip(b, 46, ROOF.slate);
  a.box({ u0: -.55, u1: .35, v0: .25, v1: .6, z0: 0, z1: 6 }, M.paving);
  for (const u of [-.45, .25]) a.cylinder(u, .45, .07, 6, 48, 0xfaf3e2, 0xffffff);
  a.box({ u0: -.6, u1: .4, v0: .2, v1: .62, z0: 48, z1: 56 }, M.limestone);
  a.line(0x4a3a2a, [[1.4, .25, 96], [1.4, .25, 150]], 2);
  a.face(banner, [[1.4, .25, 150], [1.95, .25, 144], [1.4, .25, 132]]);
  a.face(shade(banner, -25), [[1.4, .25, 132], [1.95, .25, 144], [1.75, .25, 128]]);
  a.hedge(-2.4, 2.3, -.5, 2.45, 9); a.hedge(.5, 2.3, 2.4, 2.45, 9); a.hedge(2.25, -1.8, 2.4, 2.45, 9);
  a.fountain(1.4, 1.4, .8);
  for (const [u, v] of [[-1.8, 1.2], [-1.1, 1.5]] as const) a.bush(u, v, .9, 0x3f8a3f, 0xff7aa2);
}

export const TOWN_BUILDERS: Record<TownKind, (a: Atelier) => void> = {
  bazaar, bountyStall, guild, port,
  homestead0: a => homestead(a, { wall: M.plaster, roof: ROOF.thatch, storeys: 1, timber: true, garden: "veg" }),
  homestead1: a => homestead(a, { wall: M.ochre, roof: ROOF.terracotta, storeys: 2, garden: "berries" }),
  homestead2: a => homestead(a, { wall: M.rose, roof: ROOF.terracotta, storeys: 2, hip: true, garden: "vines" }),
  homestead3: a => homestead(a, { wall: M.granite, roof: ROOF.slate, storeys: 2, garden: "orchard", door: 0x2f5fbe }),
  workshop0: a => homestead(a, { wall: M.plaster, roof: ROOF.terracotta, storeys: 2, timber: true, garden: "veg" }, { awning: 0x2f6fdc, goods: [0xd98a4a, 0xe8b02a, 0xa05ad0] }),
  workshop1: a => homestead(a, { wall: M.sandstone, roof: ROOF.verdigris, storeys: 2, garden: "berries" }, { awning: 0xc0392b, goods: [0x7fb84e, 0xd8333a, 0x3f5fd0] }),
  manorHeld: a => manor(a, GOLD),
  manorPaid: a => manor(a, 0x1f9e62),
  manorOpen: a => manor(a, 0x2f6fdc),
  galley: a => galley(a, -1.7, 1.7, 0),
};
export { GLOW };

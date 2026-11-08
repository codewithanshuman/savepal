/*
 * The royal palace: the client's seat, where the decree that frees the gold is sealed.
 * A walled estate of eight city blocks (23 x 11 tiles), painted back to front: grounds and moat,
 * the far towers and walls, the keep with its great tower and spire, the wings, the chapel,
 * barracks and stables, the gardens and fountain, then the near walls, the gatehouse and the
 * front towers. Flags are separate animated sprites (life.ts) placed at PALACE_FLAGS.
 */
import { Atelier, GLASS, GLOW, GOLD, M, ROOF, mat, shade, type Asset, type Box } from "./atelier";

export const PALACE: Asset = { key: "savepal:palace", width: 1700, height: 1190, anchorY: 440 };
/** Half-extents of the estate, in tiles, around its centre. */
export const PALACE_HALF = { u: 11.5, v: 5.5 } as const;

const WU = 10.3, WV = 4.3, WALL_H = 80, CORNER_R = .95, CORNER_H = 175, GATE_R = .72, GATE_H = 160;
const SPIRE = { u: 0, v: -2.75, z: 320, r: 1.15, rise: 150 } as const;
const BELL = { u: -4.95, v: 2.55, h: 150 } as const;
/** Towers wear tall, tiled cones; the flags fly from their finials. */
const CONE = 125;
const towerTop = (r: number, h: number) => h + 6 + (r + .14) * CONE + 10;
/** Pole tops for the animated flags, in estate tiles and pixels up. */
export const PALACE_FLAGS: ReadonlyArray<{ u: number; v: number; z: number; main?: boolean }> = [
  { u: SPIRE.u, v: SPIRE.v, z: SPIRE.z + 6 + SPIRE.rise + 10, main: true },
  ...([[-WU, -WV], [WU, -WV], [-WU, WV], [WU, WV]] as const).map(([u, v]) => ({ u, v, z: towerTop(CORNER_R, CORNER_H) })),
  ...([[-1.85, 4.5], [1.85, 4.5]] as const).map(([u, v]) => ({ u, v, z: towerTop(GATE_R, GATE_H) })),
  { u: BELL.u, v: BELL.v, z: BELL.h + 70 + 10 },
];
/** Where the gate guards stand, the archers keep watch on the front wall, and the knight patrols. */
export const PALACE_POSTS = {
  gate: [[-1.3, 5.65], [1.3, 5.65]] as const,
  walls: [[-4.6, WV, WALL_H], [4.6, WV, WALL_H], [-8.4, WV, WALL_H], [8.4, WV, WALL_H]] as const,
  patrol: [[-1.4, -.6], [1.4, -.6]] as const,
};
/** The palace fountain, for its spray. */
export const PALACE_FOUNTAIN = { u: 0, v: 1.35, z: 52 } as const;

const CRIMSON = 0xb8322a;

function squareTower(a: Atelier, u: number, v: number, half: number, h: number): void {
  const b: Box = { u0: u - half, u1: u + half, v0: v - half, v1: v + half, z0: 0, z1: h };
  a.box(b, M.granite);
  for (let z = 22; z < h - 12; z += 26) a.line(shade(M.granite.frontLeft, -12), [[b.u0, b.v1, z], [b.u1, b.v1, z]], .7, .5);
  for (let z = 34; z < h - 14; z += 32) {
    a.arches(b.v1 + .003, u - .16, u + .16, z, z + 18, 1, GLASS, shade(M.granite.frontLeft, 18));
    a.sideArches(b.u1 + .003, v - .16, v + .16, z, z + 18, 1, GLASS, shade(M.granite.frontRight, 18));
  }
  a.cornice(b, .07, 5, M.granite);
  a.merlons(b, M.granite, .14, 9);
  a.pyramid({ ...b, z1: h + 9 }, 54, ROOF.royal);
}

function wall(a: Atelier, b: Box, banners: number[] = []): void {
  a.box(b, M.granite);
  const front = b.u1 - b.u0 > b.v1 - b.v0;
  for (let z = 12, row = 0; z < WALL_H - 16; z += 14, row++) {
    if (front) {
      a.line(shade(M.granite.frontLeft, -9), [[b.u0, b.v1, z], [b.u1, b.v1, z]], .6, .45);
      for (let u = b.u0 + (row % 2 ? .25 : .5); u < b.u1; u += .5) a.line(shade(M.granite.frontLeft, -9), [[u, b.v1 + .002, z], [u, b.v1 + .002, z + 14]], .5, .35);
    } else {
      a.line(shade(M.granite.frontRight, -9), [[b.u1, b.v0, z], [b.u1, b.v1, z]], .6, .45);
      for (let v = b.v0 + (row % 2 ? .25 : .5); v < b.v1; v += .5) a.line(shade(M.granite.frontRight, -9), [[b.u1 + .002, v, z], [b.u1 + .002, v, z + 14]], .5, .35);
    }
  }
  if (front) for (let u = b.u0 + .55; u < b.u1 - .3; u += 1.05) a.face(GLASS, [[u - .025, b.v1 + .003, 44], [u + .025, b.v1 + .003, 44], [u + .025, b.v1 + .003, 58], [u - .025, b.v1 + .003, 58]]);
  else for (let v = b.v0 + .55; v < b.v1 - .3; v += 1.05) a.face(GLASS, [[b.u1 + .003, v - .025, 44], [b.u1 + .003, v + .025, 44], [b.u1 + .003, v + .025, 58], [b.u1 + .003, v - .025, 58]]);
  a.cornice(b, .05, 4, M.granite);
  a.merlons(b, M.granite, .14, 10);
  banners.forEach((u, i) => a.hanging(u, b.v1 + .004, WALL_H - 8, i % 2 ? CRIMSON : ROOF.royal[0], .38, 42));
}

function wing(a: Atelier, b: Box, turret: [number, number]): void {
  a.shadow(b.u0, b.v0, b.u1, b.v1);
  a.box(b, M.limestone);
  a.storeys(b, 3, Math.round((b.u1 - b.u0) * 1.7), Math.round((b.v1 - b.v0) * 1.7), M.limestone, true);
  a.cornice(b, .08, 6);
  a.merlons({ ...b, z1: b.z1 + 6 }, M.limestone, .1, 5);
  a.hip({ ...b, z1: b.z1 + 6 }, 50, ROOF.slate, GOLD);
  for (let u = b.u0 + .7; u < b.u1 - .4; u += 1.3) a.box({ u0: u, u1: u + .3, v0: (b.v0 + b.v1) / 2 + .2, v1: (b.v0 + b.v1) / 2 + .5, z0: b.z1 + 6, z1: b.z1 + 34 }, M.limestone);
  a.cylinder(turret[0], turret[1], .42, 0, b.z1 + 30, M.limestone.frontLeft, M.limestone.top);
  for (let z = 40; z < b.z1 + 20; z += 32) a.face(GLOW, [[turret[0] - .04, turret[1] + .42, z], [turret[0] + .04, turret[1] + .42, z], [turret[0] + .04, turret[1] + .42, z + 15], [turret[0] - .04, turret[1] + .42, z + 15]]);
  a.cone(turret[0], turret[1], .5, b.z1 + 30, 70, ROOF.royal[0]);
}

function keep(a: Atelier): void {
  const b: Box = { u0: -3.8, u1: 3.8, v0: -4.0, v1: -1.5, z0: 0, z1: 190 };
  a.shadow(b.u0, b.v0, b.u1, b.v1);
  a.box(b, M.limestone);
  a.storeys(b, 5, 11, 4, M.limestone, true);
  a.cornice(b, .09, 7);
  a.merlons(b, M.limestone, .12, 8);
  // two balconies across the keep's face, with gold rails, and long heraldic banners
  for (const z of [76, 114]) {
    a.box({ u0: -2.7, u1: 2.7, v0: b.v1, v1: b.v1 + .28, z0: z - 5, z1: z }, M.limestone);
    a.line(GOLD, [[-2.7, b.v1 + .28, z + 9], [2.7, b.v1 + .28, z + 9]], 1.6);
    for (let u = -2.6; u <= 2.65; u += .26) a.line(0xe8d9b4, [[u, b.v1 + .28, z], [u, b.v1 + .28, z + 9]], 1);
  }
  for (const [u, c] of [[-3.25, ROOF.royal[0]], [3.25, CRIMSON]] as const) {
    a.face(c, [[u - .3, b.v1 + .004, 184], [u + .3, b.v1 + .004, 184], [u + .3, b.v1 + .004, 112], [u, b.v1 + .004, 100], [u - .3, b.v1 + .004, 112]]);
    a.face(GOLD, [[u - .3, b.v1 + .005, 184], [u + .3, b.v1 + .005, 184], [u + .3, b.v1 + .005, 179], [u - .3, b.v1 + .005, 179]]);
    const em = a.at([u, b.v1 + .006, 150]); a.g.fillStyle(GOLD, 1).fillCircle(em.x, em.y, 7).fillStyle(0xfff3b0, 1).fillCircle(em.x - 2, em.y - 2, 2);
  }
  // the great tower, its clock and the spire
  const t: Box = { u0: -1.1, u1: 1.1, v0: -3.45, v1: -2.05, z0: 190, z1: SPIRE.z };
  a.box(t, M.limestone);
  a.storeys({ ...t, z1: 280 }, 3, 3, 2, M.limestone, true);
  a.cornice({ ...t, z1: 280 }, .04, 3);
  const clock = a.at([0, t.v1 + .004, 298]);
  a.g.fillStyle(GOLD, 1).fillEllipse(clock.x, clock.y, 36, 36).fillStyle(0xfdf6e3, 1).fillEllipse(clock.x, clock.y, 29, 29);
  a.g.fillStyle(0x3a3328, 1);
  for (let k = 0; k < 12; k++) { const t2 = k / 12 * Math.PI * 2; a.g.fillCircle(clock.x + Math.cos(t2) * 11, clock.y + Math.sin(t2) * 11, 1.1); }
  a.g.lineStyle(2.2, 0x3a3328, 1).beginPath().moveTo(clock.x, clock.y).lineTo(clock.x, clock.y - 11).moveTo(clock.x, clock.y).lineTo(clock.x + 8, clock.y + 3).strokePath();
  a.cornice(t, .09, 6); a.merlons(t, M.limestone, .12, 8);
  a.cone(SPIRE.u, SPIRE.v, SPIRE.r, SPIRE.z + 6, SPIRE.rise, ROOF.royal[0]);
  // corner turrets of the keep
  for (const [u, v] of [[3.8, -4.0], [-3.8, -1.5], [3.8, -1.5]] as const) {
    a.cylinder(u, v, .48, 130, 222, M.limestone.frontLeft, M.limestone.top);
    for (const z of [150, 186]) a.face(GLASS, [[u - .045, v + .48, z], [u + .045, v + .48, z], [u + .045, v + .48, z + 18], [u - .045, v + .48, z + 18]]);
    a.ringMerlons(u, v, .5, 222, M.limestone, 7);
    a.cone(u, v, .58, 229, 76, ROOF.royal[0]);
  }
  // the grand portico: steps, columns, entablature, pediment and the gold coin crest
  a.box({ u0: -2.2, u1: 2.2, v0: -1.5, v1: -.55, z0: 0, z1: 5 }, M.paving);
  a.box({ u0: -2.0, u1: 2.0, v0: -1.5, v1: -.85, z0: 5, z1: 11 }, M.limestone);
  a.arches(-1.496, -.55, .55, 11, 80, 1, 0x2a2018, shade(M.limestone.frontLeft, 16));
  for (const u of [-1.75, -1.05, 1.05, 1.75]) a.cylinder(u, -1.0, .12, 11, 92, 0xfaf3e2, 0xffffff);
  const ent: Box = { u0: -2.05, u1: 2.05, v0: -1.5, v1: -.86, z0: 92, z1: 106 };
  a.box(ent, M.limestone);
  a.face(M.limestone.frontLeft, [[-2.08, -.86, 106], [2.08, -.86, 106], [0, -.86, 140]]);
  a.line(shade(M.limestone.frontLeft, -28), [[-2.08, -.859, 106], [0, -.859, 140], [2.08, -.859, 106]], 1.6);
  const crest = a.at([0, -.855, 119]);
  a.g.fillStyle(0xc98a14, 1).fillEllipse(crest.x, crest.y + 1.5, 32, 25).fillStyle(GOLD, 1).fillEllipse(crest.x, crest.y, 30, 22).fillStyle(0xfff3b0, 1).fillEllipse(crest.x - 4, crest.y - 4, 9, 7);
  for (const u of [-2.0, 2.0]) { a.box({ u0: u - .16, u1: u + .16, v0: -.75, v1: -.43, z0: 0, z1: 18 }, M.limestone); a.cylinder(u, -.59, .1, 18, 44, GOLD, 0xffe48a); }
}

function chapel(a: Atelier): void {
  const b: Box = { u0: -7.4, u1: -4.95, v0: -.7, v1: 2.4, z0: 0, z1: 84 };
  a.shadow(b.u0, b.v0, b.u1, b.v1);
  a.box(b, M.limestone);
  a.sideArches(b.u1 + .004, b.v0 + .1, b.v1 - .1, 18, 66, 4, 0x4a6fb5, shade(M.limestone.frontRight, 16));
  const rose = a.at([(b.u0 + b.u1) / 2, b.v1 + .004, 58]);
  a.g.fillStyle(shade(M.limestone.frontLeft, 16), 1).fillCircle(rose.x, rose.y, 17).fillStyle(0x4a6fb5, 1).fillCircle(rose.x, rose.y, 14);
  a.g.lineStyle(1.4, 0xf2b134, 1);
  for (let k = 0; k < 8; k++) { const t = k / 8 * Math.PI; a.g.beginPath().moveTo(rose.x - Math.cos(t) * 13, rose.y - Math.sin(t) * 13).lineTo(rose.x + Math.cos(t) * 13, rose.y + Math.sin(t) * 13).strokePath(); }
  a.arches(b.v1 + .004, b.u0 + .8, b.u1 - .8, 0, 34, 1, 0x2a2018, shade(M.limestone.frontLeft, 16));
  a.gable(b, 56, ROOF.slate, M.limestone, false);
  // the bell tower and its spire
  const t: Box = { u0: BELL.u - .45, u1: BELL.u + .45, v0: BELL.v - .45, v1: BELL.v + .45, z0: 0, z1: BELL.h };
  a.box(t, M.limestone);
  a.arches(t.v1 + .004, t.u0 + .1, t.u1 - .1, 108, 140, 1, 0x2a2018); a.sideArches(t.u1 + .004, t.v0 + .1, t.v1 - .1, 108, 140, 1, 0x2a2018);
  const bell = a.at([BELL.u, t.v1, 120]); a.g.fillStyle(GOLD, 1).fillEllipse(bell.x - 5, bell.y, 12, 14);
  a.cornice(t, .07, 5);
  a.pyramid(t, 70, ROOF.slate);
}

function barracks(a: Atelier): void {
  const b: Box = { u0: -9.9, u1: -8.0, v0: -1.3, v1: 3.8, z0: 0, z1: 62 };
  a.shadow(b.u0, b.v0, b.u1, b.v1);
  a.box(b, M.sandstone);
  a.arches(b.v1 + .004, b.u0 + .15, b.u1 - .15, 0, 36, 2, 0x2a2018);
  a.sideArches(b.u1 + .004, b.v0 + .1, b.v1 - .1, 24, 52, 7, GLASS, shade(M.sandstone.frontRight, 14));
  a.gable(b, 36, ROOF.terracotta, M.sandstone, false);
  // the training yard: targets and weapon racks
  for (const v of [.4, 1.6]) { a.line(0x6b4527, [[-7.6, v, 0], [-7.6, v, 26]], 2.4); const t = a.at([-7.6, v + .02, 30]); a.g.fillStyle(0xf4ead6, 1).fillCircle(t.x, t.y, 9).fillStyle(CRIMSON, 1).fillCircle(t.x, t.y, 6).fillStyle(0xf4ead6, 1).fillCircle(t.x, t.y, 3); }
  for (const [u, v] of [[-7.7, 3.2], [-7.4, 3.5]] as const) a.barrel(u, v);
}

function stables(a: Atelier): void {
  const b: Box = { u0: 5.0, u1: 7.0, v0: -.9, v1: 3.3, z0: 0, z1: 54 };
  a.shadow(b.u0, b.v0, b.u1, b.v1);
  a.box(b, M.timber);
  for (let v = b.v0 + .35; v < b.v1 - .2; v += .7) a.face(0x3b2a1c, [[b.u1 + .004, v, 0], [b.u1 + .004, v + .45, 0], [b.u1 + .004, v + .45, 30], [b.u1 + .004, v, 30]]);
  a.gable(b, 32, ROOF.terracotta, M.timber, false);
  for (const [u, v] of [[7.5, 2.6], [7.8, 2.9]] as const) a.box({ u0: u - .2, u1: u + .2, v0: v - .14, v1: v + .14, z0: 0, z1: 14 }, M.hay);
}

function gardens(a: Atelier): void {
  for (const [u0, u1] of [[-4.4, -1.6], [1.6, 4.4]] as const) {
    a.pad(u0, .25, u1, 3.75, M.lawn.top, .5);
    for (const [fu, fv, c] of [[u0 + .55, .8, 0xff7aa2], [u1 - .55, .8, 0xffd15c], [u0 + .55, 3.15, 0xffffff], [u1 - .55, 3.15, 0xb07cff]] as const) {
      a.pad(fu - .36, fv - .24, fu + .36, fv + .24, 0x6a4a2c, .6);
      for (let k = 0; k < 8; k++) { const p = a.at([fu - .26 + (k % 4) * .17, fv - .12 + Math.floor(k / 4) * .22, 2]); a.g.fillStyle(c, 1).fillCircle(p.x, p.y, 2.4); }
    }
    a.hedge(u0, 3.6, u1, 3.8, 10); a.hedge(u1 - .2, .25, u1, 3.8, 10);
    a.tree((u0 + u1) / 2, 2, 1.15, 0x3f8f3c);
  }
}

function rotunda(a: Atelier, u: number, v: number): void {
  a.cylinder(u, v, 1.05, 0, 7, M.paving.frontLeft, M.paving.top);
  a.cylinder(u, v, .82, 7, 62, M.limestone.frontLeft, M.limestone.top);
  for (let i = 0; i < 6; i++) { const ang = Math.PI * .1 + i * Math.PI * .16; const cu = u + Math.cos(ang) * .84, cv = v + Math.sin(ang) * .84; a.face(GLASS, [[cu, cv, 18], [cu + .02, cv + .02, 18], [cu + .02, cv + .02, 50], [cu, cv, 50]]); }
  for (let k = 0; k < 7; k++) a.cylinder(u, v, .88 - k * .12, 62 + k * 6, 68 + k * 6, shade(ROOF.verdigris[0], k * 4), shade(ROOF.verdigris[0], 10 + k * 4));
  a.line(GOLD, [[u, v, 104], [u, v, 118]], 2.6);
}

function grounds(a: Atelier): void {
  const { u: hu, v: hv } = PALACE_HALF;
  a.pad(-hu, -hv, hu, hv, M.meadow.top);
  const mo = WU + .75, mi = WU + .4, vo = WV + .75, vi = WV + .4;
  for (const [u0, v0, u1, v1] of [[-mo, -vo, mo, -vi], [-mo, vi, mo, vo], [-mo, -vi, -mi, vi], [mi, -vi, mo, vi]] as const) a.pad(u0, v0, u1, v1, M.water.top, .2);
  a.line(M.granite.top, [[-mo, vo, .4], [mo, vo, .4], [mo, -vo, .4]], 2.2);
  a.line(M.granite.top, [[-mi, vi, .4], [mi, vi, .4], [mi, -vi, .4]], 1.6);
  for (const [u, v] of [[-8, WV + .58], [4, WV + .55], [WU + .58, -2], [WU + .6, 2.4], [-4.5, WV + .6], [8.5, WV + .55]] as const) { const p = a.at([u, v, .5]); a.g.fillStyle(0xd8f0ff, .7).fillRect(p.x - 6, p.y, 11, 1.2); }
  for (let u = -10.6; u <= 10.7; u += 2.65) if (Math.abs(u) > 1.6) a.tree(u, hv - .2, .85, 0x3f8f3c);
  a.pad(-(WU - .17), -(WV - .17), WU - .17, WV - .17, M.paving.top, .8);
  for (let u = -WU + .2; u < WU - .2; u += .6) for (let v = -WV + .2; v < WV - .2; v += .6) if ((Math.round(u / .6) + Math.round(v / .6)) % 2) a.pad(u, v, Math.min(u + .6, WU - .17), Math.min(v + .6, WV - .17), shade(M.paving.top, -6), .85);
  a.pad(-.85, -1.5, .85, WV - .17, M.cobble.top, 1);
}

function palace(a: Atelier): void {
  grounds(a);
  a.tower(-WU, -WV, CORNER_R, CORNER_H, M.granite, ROOF.royal, (CORNER_R + .14) * CONE);
  wall(a, { u0: -WU, u1: WU, v0: -WV - .17, v1: -WV + .17, z0: 0, z1: WALL_H });
  wall(a, { u0: -WU - .17, u1: -WU + .17, v0: -WV, v1: WV, z0: 0, z1: WALL_H });
  for (const u of [-6.9, -3.45, 3.45, 6.9]) squareTower(a, u, -WV, .6, 124);
  squareTower(a, -WU, 0, .6, 124);
  a.tower(-WU, WV, CORNER_R, CORNER_H, M.granite, ROOF.royal, (CORNER_R + .14) * CONE);
  a.tower(WU, -WV, CORNER_R, CORNER_H, M.granite, ROOF.royal, (CORNER_R + .14) * CONE);
  wing(a, { u0: -9.6, u1: -4.2, v0: -4.0, v1: -1.9, z0: 0, z1: 124 }, [-9.6, -1.9]);
  barracks(a);
  chapel(a);
  keep(a);
  wing(a, { u0: 4.2, u1: 9.6, v0: -4.0, v1: -1.9, z0: 0, z1: 124 }, [9.6, -1.9]);
  gardens(a);
  stables(a);
  rotunda(a, 8.6, 2.2);
  a.fountain(PALACE_FOUNTAIN.u, PALACE_FOUNTAIN.v, 1.55);
  for (const v of [.0, 2.65, 3.7]) for (const u of [-1.15, 1.15]) a.cypress(u, v, 1.1);
  for (const v of [-1.1, 3.2]) for (const u of [-.95, .95]) a.lamp(u, v, 30);
  // near walls, gatehouse and the near corner
  wall(a, { u0: WU - .17, u1: WU + .17, v0: -WV, v1: WV, z0: 0, z1: WALL_H });
  squareTower(a, WU, 0, .6, 124);
  wall(a, { u0: -WU, u1: -2.4, v0: WV - .17, v1: WV + .17, z0: 0, z1: WALL_H }, [-9.2, -5.7, -3.3]);
  wall(a, { u0: 2.4, u1: WU, v0: WV - .17, v1: WV + .17, z0: 0, z1: WALL_H }, [3.3, 5.7, 9.2]);
  for (const u of [-8.2, -4.6, 4.6, 8.2]) a.ivy(u, WV + .17, .7, 56);
  squareTower(a, -6.9, WV, .55, 120); squareTower(a, 6.9, WV, .55, 120);
  a.box({ u0: -1, u1: 1, v0: WV + .3, v1: WV + 1.6, z0: 0, z1: 3 }, M.timber);
  for (let u = -.95; u < 1; u += .2) a.line(0x5c3b22, [[u, WV + .3, 3.1], [u, WV + 1.6, 3.1]], .8);
  a.line(0x3a2a1a, [[-1, WV + 1.6, 3], [-1.1, WV + .5, 64]], 1.2); a.line(0x3a2a1a, [[1, WV + 1.6, 3], [1.1, WV + .5, 64]], 1.2);
  const gate: Box = { u0: -1.5, u1: 1.5, v0: WV - .35, v1: WV + .55, z0: 0, z1: 118 };
  a.box(gate, M.granite);
  a.arches(gate.v1 + .004, -1.15, 1.15, 0, 82, 1, 0x1e1712, shade(M.granite.frontLeft, 20));
  for (let u = -.7; u <= .7; u += .175) a.line(0x8a7a5c, [[u, gate.v1 + .006, 20], [u, gate.v1 + .006, 76]], 1.6);
  for (let z = 28; z < 76; z += 15) a.line(0x8a7a5c, [[-.74, gate.v1 + .006, z], [.74, gate.v1 + .006, z]], 1.3);
  const shield = a.at([0, gate.v1 + .006, 100]);
  a.g.fillStyle(0x7a1f18, 1).fillRoundedRect(shield.x - 17, shield.y - 17, 34, 36, 7).fillStyle(GOLD, 1).fillCircle(shield.x, shield.y, 11.5).fillStyle(0xfff3b0, 1).fillCircle(shield.x - 3.5, shield.y - 3.5, 3.4);
  a.cornice(gate, .07, 5, M.granite); a.merlons(gate, M.granite, .14, 10);
  a.tower(-1.85, 4.5, GATE_R, GATE_H, M.granite, ROOF.royal, (GATE_R + .14) * CONE);
  a.tower(1.85, 4.5, GATE_R, GATE_H, M.granite, ROOF.royal, (GATE_R + .14) * CONE);
  a.lamp(-1.3, 6.15, 28); a.lamp(1.3, 6.15, 28);
  a.tower(WU, WV, CORNER_R, CORNER_H, M.granite, ROOF.royal, (CORNER_R + .14) * CONE);
  a.ivy(WU - .5, WV + .7, .4, 70);
}

export const PALACE_BUILDER = palace;
export const GLOWING = mat(0x5a4a32, GLOW, 0xd9a64a);

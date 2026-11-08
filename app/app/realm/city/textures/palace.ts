/*
 * The royal palace: the client's seat, where the decree that frees the gold is sealed.
 * A walled estate of six city blocks (17 x 11 tiles), painted back to front: moat and grounds,
 * the far walls and towers, the keep with its great tower and wings, the gardens, then the near
 * walls, the gatehouse and the front towers. Flags are separate animated sprites (see life.ts),
 * placed at the finials listed in PALACE_FLAGS.
 */
import { Atelier, GLASS, GLOW, GOLD, M, ROOF, mat, shade, type Asset, type Box } from "./atelier";

export const PALACE: Asset = { key: "savepal:palace", width: 1400, height: 940, anchorY: 360 };

/** Half-extents of the estate, in tiles, around its centre. */
export const PALACE_HALF = { u: 8.5, v: 5.5 } as const;

const WALL_H = 74, CORNER_R = .8, CORNER_H = 150, GATE_R = .62, GATE_H = 140;
const SPIRE = { u: 0, v: -2.75, z: 262, r: 1, rise: 125 } as const;
/** Pole tops for the animated flags, in estate tiles and pixels up. */
export const PALACE_FLAGS: ReadonlyArray<{ u: number; v: number; z: number; main?: boolean }> = [
  { u: SPIRE.u, v: SPIRE.v, z: SPIRE.z + SPIRE.rise + 10, main: true },
  ...([[-7.43, -4.43], [7.43, -4.43], [-7.43, 4.43], [7.43, 4.43]] as const).map(([u, v]) => ({ u, v, z: CORNER_H + 6 + CORNER_R * 95 + 10 })),
  ...([[-1.65, 4.55], [1.65, 4.55]] as const).map(([u, v]) => ({ u, v, z: GATE_H + 6 + GATE_R * 95 + 10 })),
];
/** Where the gate guards stand and the archers keep watch on the front wall. */
export const PALACE_POSTS = {
  gate: [[-1.05, 5.25], [1.05, 5.25]] as const,
  walls: [[-4.0, 4.43, WALL_H], [3.9, 4.43, WALL_H], [-6.4, 4.43, WALL_H], [6.3, 4.43, WALL_H]] as const,
  court: [[-.75, 3.6], [.75, -.6]] as const,
};

const CRIMSON = 0xb8322a;

function squareTower(a: Atelier, u: number, v: number, half: number, h: number): void {
  const b: Box = { u0: u - half, u1: u + half, v0: v - half, v1: v + half, z0: 0, z1: h };
  a.box(b, M.granite);
  for (let z = 30; z < h - 10; z += 30) {
    a.face(GLASS, [[u - .04, b.v1 + .003, z], [u + .04, b.v1 + .003, z], [u + .04, b.v1 + .003, z + 14], [u - .04, b.v1 + .003, z + 14]]);
    a.face(GLASS, [[b.u1 + .003, v - .04, z], [b.u1 + .003, v + .04, z], [b.u1 + .003, v + .04, z + 14], [b.u1 + .003, v - .04, z + 14]]);
  }
  a.cornice(b, .06, 4, M.granite);
  a.merlons(b, M.granite, .14, 8);
  a.pyramid({ ...b, z1: h + 8 }, 46, ROOF.royal);
}

function wall(a: Atelier, b: Box, banners: number[] = []): void {
  a.box(b, M.granite);
  a.line(shade(M.granite.frontLeft, -16), [[b.u0, b.v1, WALL_H - 14], [b.u1, b.v1, WALL_H - 14]], 1, .7);
  a.line(shade(M.granite.frontRight, -16), [[b.u1, b.v0, WALL_H - 14], [b.u1, b.v1, WALL_H - 14]], 1, .7);
  for (let z = 14; z < WALL_H - 18; z += 16) a.line(shade(M.granite.frontLeft, -8), [[b.u0, b.v1, z], [b.u1, b.v1, z]], .6, .45);
  if (b.u1 - b.u0 > b.v1 - b.v0) for (let u = b.u0 + .5; u < b.u1 - .3; u += 1.1) a.face(GLASS, [[u - .025, b.v1 + .003, 40], [u + .025, b.v1 + .003, 40], [u + .025, b.v1 + .003, 52], [u - .025, b.v1 + .003, 52]]);
  else for (let v = b.v0 + .5; v < b.v1 - .3; v += 1.1) a.face(GLASS, [[b.u1 + .003, v - .025, 40], [b.u1 + .003, v + .025, 40], [b.u1 + .003, v + .025, 52], [b.u1 + .003, v - .025, 52]]);
  a.cornice(b, .05, 4, M.granite);
  a.merlons(b, M.granite, .14, 9);
  banners.forEach((u, i) => a.hanging(u, b.v1 + .004, WALL_H - 6, i % 2 ? CRIMSON : ROOF.royal[0], .34, 38));
}

function wing(a: Atelier, b: Box, turret: [number, number]): void {
  a.shadow(b.u0, b.v0, b.u1, b.v1);
  a.box(b, M.limestone);
  a.storeys(b, 3, Math.round((b.u1 - b.u0) * 1.6), Math.round((b.v1 - b.v0) * 1.6), M.limestone, true);
  a.cornice(b, .07, 5);
  a.hip(b, 44, ROOF.slate);
  a.cylinder(turret[0], turret[1], .38, 0, 132, M.limestone.frontLeft, M.limestone.top);
  for (let z = 40; z < 130; z += 30) a.face(GLASS, [[turret[0] - .04, turret[1] + .38, z], [turret[0] + .04, turret[1] + .38, z], [turret[0] + .04, turret[1] + .38, z + 14], [turret[0] - .04, turret[1] + .38, z + 14]]);
  a.cone(turret[0], turret[1], .46, 132, 62, ROOF.royal[0]);
}

function keep(a: Atelier): void {
  const b: Box = { u0: -3, u1: 3, v0: -3.95, v1: -1.55, z0: 0, z1: 150 };
  a.shadow(b.u0, b.v0, b.u1, b.v1);
  a.box(b, M.limestone);
  a.storeys(b, 4, 9, 4, M.limestone, true);
  a.cornice(b, .08, 6);
  a.merlons(b, M.limestone, .12, 7);
  // the great tower rising from the keep, with a clock and the spire
  const t: Box = { u0: -.9, u1: .9, v0: -3.45, v1: -2.05, z0: 150, z1: SPIRE.z };
  a.box(t, M.limestone);
  a.storeys({ ...t, z0: 150, z1: 222 }, 2, 3, 2, M.limestone, true);
  a.cornice({ ...t, z1: 222 }, .04, 3);
  const clock = a.at([0, t.v1 + .004, 240]);
  a.g.fillStyle(GOLD, 1).fillEllipse(clock.x, clock.y, 30, 30).fillStyle(0xfdf6e3, 1).fillEllipse(clock.x, clock.y, 24, 24);
  a.g.lineStyle(2, 0x3a3328, 1).beginPath().moveTo(clock.x, clock.y).lineTo(clock.x, clock.y - 9).moveTo(clock.x, clock.y).lineTo(clock.x + 7, clock.y + 2).strokePath();
  a.cornice(t, .08, 5); a.merlons(t, M.limestone, .12, 7);
  a.cone(SPIRE.u, SPIRE.v, SPIRE.r, SPIRE.z + 6, SPIRE.rise, ROOF.royal[0]);
  // turrets on the keep's visible corners
  for (const [u, v] of [[3, -3.95], [-3, -1.55], [3, -1.55]] as const) {
    a.cylinder(u, v, .42, 106, 176, M.limestone.frontLeft, M.limestone.top);
    a.face(GLASS, [[u - .04, v + .42, 130], [u + .04, v + .42, 130], [u + .04, v + .42, 146], [u - .04, v + .42, 146]]);
    a.cone(u, v, .5, 176, 66, ROOF.royal[0]);
  }
  // the grand portico: steps, columns, entablature and a pediment bearing the gold coin crest
  a.box({ u0: -1.8, u1: 1.8, v0: -1.55, v1: -.75, z0: 0, z1: 4 }, M.paving);
  a.box({ u0: -1.65, u1: 1.65, v0: -1.55, v1: -.95, z0: 4, z1: 9 }, M.limestone);
  a.arches(-1.546, -.45, .45, 9, 62, 1, 0x2a2018, shade(M.limestone.frontLeft, 16));
  for (const u of [-1.45, -.85, .85, 1.45]) a.cylinder(u, -1.1, .1, 9, 74, 0xfaf3e2, 0xffffff);
  const ent: Box = { u0: -1.7, u1: 1.7, v0: -1.55, v1: -.98, z0: 74, z1: 86 };
  a.box(ent, M.limestone);
  a.face(M.limestone.frontLeft, [[-1.72, -.98, 86], [1.72, -.98, 86], [0, -.98, 114]]);
  a.line(shade(M.limestone.frontLeft, -25), [[-1.72, -.979, 86], [0, -.979, 114], [1.72, -.979, 86]], 1.5);
  const crest = a.at([0, -.975, 97]);
  a.g.fillStyle(0xc98a14, 1).fillEllipse(crest.x, crest.y + 1, 26, 20).fillStyle(GOLD, 1).fillEllipse(crest.x, crest.y, 24, 18).fillStyle(0xfff3b0, 1).fillEllipse(crest.x - 3, crest.y - 3, 8, 6);
}

function gardens(a: Atelier): void {
  // two walled parterres either side of the avenue, with flower beds and clipped hedges
  for (const [u0, u1] of [[-4.2, -1.3], [1.3, 4.2]] as const) {
    a.pad(u0, .3, u1, 3.7, M.lawn.top, .5);
    for (const [fu, fv, c] of [[u0 + .5, .8, 0xff7aa2], [u1 - .5, .8, 0xffd15c], [u0 + .5, 3.1, 0xffffff], [u1 - .5, 3.1, 0xb07cff]] as const) {
      a.pad(fu - .32, fv - .22, fu + .32, fv + .22, 0x6a4a2c, .6);
      for (let k = 0; k < 7; k++) { const p = a.at([fu - .24 + (k % 4) * .16, fv - .12 + Math.floor(k / 4) * .2, 2]); a.g.fillStyle(c, 1).fillCircle(p.x, p.y, 2.2); }
    }
    a.hedge(u0, 3.55, u1, 3.75, 9); a.hedge(u1 - .2, .3, u1, 3.75, 9);
    a.tree((u0 + u1) / 2, 2, 1.05, 0x3f8f3c);
  }
}

function rotunda(a: Atelier, u: number, v: number): void {
  a.cylinder(u, v, 1, 0, 6, M.paving.frontLeft, M.paving.top);
  a.cylinder(u, v, .78, 6, 56, M.limestone.frontLeft, M.limestone.top);
  for (let i = 0; i < 6; i++) { const ang = Math.PI * .1 + i * Math.PI * .16; const cu = u + Math.cos(ang) * .8, cv = v + Math.sin(ang) * .8; a.face(GLASS, [[cu, cv, 16], [cu + .02, cv + .02, 16], [cu + .02, cv + .02, 44], [cu, cv, 44]]); }
  for (let k = 0; k < 6; k++) a.cylinder(u, v, .84 - k * .13, 56 + k * 6, 62 + k * 6, shade(ROOF.verdigris[0], k * 4), shade(ROOF.verdigris[0], 10 + k * 4));
  a.line(GOLD, [[u, v, 92], [u, v, 104]], 2.4);
}

function grounds(a: Atelier): void {
  const { u: hu, v: hv } = PALACE_HALF;
  a.pad(-hu, -hv, hu, hv, M.meadow.top);
  a.pad(-hu, hv - .06, hu, hv, M.meadow.frontLeft); a.pad(hu - .06, -hv, hu, hv, M.meadow.frontRight);
  // the moat, edged in stone
  const mo = 8.05, mi = 7.7, vo = 5.05, vi = 4.7;
  for (const [u0, v0, u1, v1] of [[-mo, -vo, mo, -vi], [-mo, vi, mo, vo], [-mo, -vi, -mi, vi], [mi, -vi, mo, vi]] as const) a.pad(u0, v0, u1, v1, M.water.top, .2);
  a.line(M.granite.top, [[-mo, vo, .4], [mo, vo, .4], [mo, -vo, .4]], 2);
  a.line(M.granite.top, [[-mi, vi, .4], [mi, vi, .4], [mi, -vi, .4]], 1.5);
  for (const [u, v] of [[-6, 4.88], [3, 4.85], [7.85, -2], [7.9, 2.4], [-3.5, 4.9]] as const) { const p = a.at([u, v, .5]); a.g.fillStyle(0xd8f0ff, .7).fillRect(p.x - 5, p.y, 9, 1); }
  // trees along the outer lawn
  for (let u = -7.6; u <= 7.6; u += 2.6) a.tree(u, 5.35, .8, 0x3f8f3c);
  // the courtyard and the avenue from the gate to the keep
  a.pad(-7.26, -4.26, 7.26, 4.26, M.paving.top, .8);
  for (let u = -7; u < 7.2; u += .5) a.line(shade(M.paving.top, -8), [[u, -4.26, .9], [u, 4.26, .9]], .5, .6);
  a.pad(-.75, -1.55, .75, 4.26, M.cobble.top, 1);
}

function palace(a: Atelier): void {
  grounds(a);
  // far corner and far walls
  a.tower(-7.43, -4.43, CORNER_R, CORNER_H, M.granite, ROOF.royal);
  wall(a, { u0: -7.43, u1: 7.43, v0: -4.6, v1: -4.26, z0: 0, z1: WALL_H });
  wall(a, { u0: -7.6, u1: -7.26, v0: -4.43, v1: 4.43, z0: 0, z1: WALL_H });
  squareTower(a, -3.7, -4.43, .55, 112); squareTower(a, 3.7, -4.43, .55, 112); squareTower(a, -7.43, 0, .55, 112);
  a.tower(-7.43, 4.43, CORNER_R, CORNER_H, M.granite, ROOF.royal);
  a.tower(7.43, -4.43, CORNER_R, CORNER_H, M.granite, ROOF.royal);
  // the inner ward, back to front
  wing(a, { u0: -6.8, u1: -3.3, v0: -3.95, v1: -1.9, z0: 0, z1: 104 }, [-6.8, -1.9]);
  const barracks: Box = { u0: -6.95, u1: -5.25, v0: -1.2, v1: 3.5, z0: 0, z1: 58 };
  a.shadow(barracks.u0, barracks.v0, barracks.u1, barracks.v1);
  a.box(barracks, M.sandstone);
  a.arches(barracks.v1 + .004, barracks.u0 + .15, barracks.u1 - .15, 0, 34, 2, 0x2a2018);
  a.sideArches(barracks.u1 + .004, barracks.v0 + .1, barracks.v1 - .1, 22, 48, 6, GLASS, shade(M.sandstone.frontRight, 14));
  a.gable(barracks, 34, ROOF.terracotta, M.sandstone, false);
  for (const [u, v] of [[-4.95, 2.9], [-4.95, 3.3], [-4.6, 3.3]] as const) a.barrel(u, v);
  keep(a);
  wing(a, { u0: 3.3, u1: 6.8, v0: -3.95, v1: -1.9, z0: 0, z1: 104 }, [6.8, -1.9]);
  gardens(a);
  for (const u of [-1.55, 1.55]) { a.box({ u0: u - .18, u1: u + .18, v0: -.75, v1: -.39, z0: 0, z1: 16 }, M.limestone); a.cylinder(u, -.57, .1, 16, 40, GOLD, 0xffe48a); }
  rotunda(a, 5.4, 1.9);
  a.fountain(0, 1.5, 1.35);
  for (const v of [.1, 2.6, 3.6]) for (const u of [-1.05, 1.05]) a.cypress(u, v, 1);
  // near walls, the gatehouse and the near corner
  wall(a, { u0: 7.26, u1: 7.6, v0: -4.43, v1: 4.43, z0: 0, z1: WALL_H });
  squareTower(a, 7.43, 0, .55, 112);
  wall(a, { u0: -7.43, u1: -2.2, v0: 4.26, v1: 4.6, z0: 0, z1: WALL_H }, [-6.3, -3.4]);
  wall(a, { u0: 2.2, u1: 7.43, v0: 4.26, v1: 4.6, z0: 0, z1: WALL_H }, [3.4, 6.3]);
  squareTower(a, -4.8, 4.43, .5, 108); squareTower(a, 4.8, 4.43, .5, 108);
  // the drawbridge, the gate and its towers
  a.box({ u0: -.85, u1: .85, v0: 4.6, v1: 5.6, z0: 0, z1: 3 }, M.timber);
  for (let u = -.8; u < .85; u += .2) a.line(0x5c3b22, [[u, 4.6, 3.1], [u, 5.6, 3.1]], .8);
  const gate: Box = { u0: -1.35, u1: 1.35, v0: 4.05, v1: 4.85, z0: 0, z1: 104 };
  a.box(gate, M.granite);
  a.arches(gate.v1 + .004, -1.05, 1.05, 0, 72, 1, 0x1e1712, shade(M.granite.frontLeft, 18));
  for (let u = -.62; u <= .62; u += .155) a.line(0x8a7a5c, [[u, gate.v1 + .006, 18], [u, gate.v1 + .006, 66]], 1.4);
  for (let z = 26; z < 66; z += 14) a.line(0x8a7a5c, [[-.66, gate.v1 + .006, z], [.66, gate.v1 + .006, z]], 1.2);
  const shield = a.at([0, gate.v1 + .006, 88]);
  a.g.fillStyle(0x7a1f18, 1).fillRoundedRect(shield.x - 15, shield.y - 15, 30, 32, 6).fillStyle(GOLD, 1).fillCircle(shield.x, shield.y, 10).fillStyle(0xfff3b0, 1).fillCircle(shield.x - 3, shield.y - 3, 3);
  a.cornice(gate, .06, 5, M.granite); a.merlons(gate, M.granite, .14, 9);
  a.tower(-1.65, 4.55, GATE_R, GATE_H, M.granite, ROOF.royal);
  a.tower(1.65, 4.55, GATE_R, GATE_H, M.granite, ROOF.royal);
  a.lamp(-1.05, 5.75, 26); a.lamp(1.05, 5.75, 26);
  a.tower(7.43, 4.43, CORNER_R, CORNER_H, M.granite, ROOF.royal);
}

export const PALACE_BUILDER = palace;
export const GLOWING = mat(0x5a4a32, GLOW, 0xd9a64a);

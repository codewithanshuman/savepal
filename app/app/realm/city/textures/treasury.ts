/*
 * The Royal Treasury: where PayPal holds the gold. It stands on the capitol's reserve at the heart
 * of the kingdom (15 x 8 tiles) and replaces the archive's capitol sprite under the same click.
 * A marble temple on a podium: a grand stair, an eight-column portico with a coin crest, a ribbed
 * golden dome on a windowed drum, domed side pavilions, gold lions, obelisks and braziers.
 */
import { Atelier, GLASS, GLOW, GOLD, M, ROOF, shade, type Asset, type Box } from "./atelier";

export const TREASURY: Asset = { key: "savepal:treasury", width: 1180, height: 680, anchorY: 320 };
/** Where the brazier fires burn and the dome's finial stands, in treasury tiles and pixels up. */
export const TREASURY_FIRES = [[-1.55, 3.05, 34], [1.55, 3.05, 34]] as const;
export const TREASURY_FLAG = { u: 0, v: -1.4, z: 276 } as const;

const MARBLE = M.limestone, PAYPAL = 0x003087, PAYPAL_LIGHT = 0x009cde;

function dome(a: Atelier, u: number, v: number, r: number, z: number, rise: number): void {
  const steps = 9;
  for (let k = 0; k < steps; k++) {
    const t0 = k / steps, t1 = (k + 1) / steps;
    const r0 = r * Math.cos(t0 * Math.PI / 2), z0 = z + rise * Math.sin(t0 * Math.PI / 2), z1 = z + rise * Math.sin(t1 * Math.PI / 2);
    a.cylinder(u, v, Math.max(.05, r0), z0, z1, shade(0xf2b134, -6 + k * 3), shade(0xffd35c, k * 2));
  }
  // gilded ribs running up the dome's lit side
  for (let i = 0; i < 9; i++) {
    const ang = Math.PI * .05 + i * Math.PI * .11, pts: Array<[number, number, number]> = [];
    for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push([u + Math.cos(ang) * r * Math.cos(t * Math.PI / 2), v + Math.sin(ang) * r * Math.cos(t * Math.PI / 2), z + rise * Math.sin(t * Math.PI / 2)]); }
    a.line(0xc98a14, pts, 1.6, .9);
  }
}

function pavilion(a: Atelier, u0: number, u1: number): void {
  const b: Box = { u0, u1, v0: -3.1, v1: -.2, z0: 8, z1: 82 };
  a.box(b, MARBLE);
  a.storeys({ ...b, z0: 8 }, 2, 3, 4, MARBLE, true);
  a.cornice(b, .07, 5);
  a.merlons({ ...b, z1: b.z1 + 4 }, MARBLE, .09, 5);
  const cu = (u0 + u1) / 2, cv = (b.v0 + b.v1) / 2;
  a.cylinder(cu, cv, .78, 86, 102, MARBLE.frontLeft, MARBLE.top);
  dome(a, cu, cv, .8, 102, 46);
  a.line(GOLD, [[cu, cv, 148], [cu, cv, 162]], 2.4);
}

function treasury(a: Atelier): void {
  // the podium, stepped up from the plaza
  a.shadow(-7.2, -3.8, 7.2, 3.8, 0, .14);
  a.box({ u0: -7.3, u1: 7.3, v0: -3.7, v1: .9, z0: 0, z1: 8 }, M.granite);
  for (const [u, v] of [[-6.6, 3.1], [6.6, 3.1]] as const) {
    // obelisks with gilded tips at the front corners
    a.box({ u0: u - .32, u1: u + .32, v0: v - .32, v1: v + .32, z0: 0, z1: 12 }, M.granite);
    a.box({ u0: u - .18, u1: u + .18, v0: v - .18, v1: v + .18, z0: 12, z1: 120 }, MARBLE);
    a.pyramid({ u0: u - .18, u1: u + .18, v0: v - .18, v1: v + .18, z0: 0, z1: 120 }, 22, [0xffd35c, 0xc98a14]);
  }
  pavilion(a, -7.0, -4.6);
  // the drum and the golden dome over the main hall
  const hall: Box = { u0: -4.6, u1: 4.6, v0: -3.4, v1: .5, z0: 8, z1: 104 };
  a.box(hall, MARBLE);
  a.storeys({ ...hall, z0: 8 }, 2, 10, 5, MARBLE, true);
  a.cornice(hall, .09, 7);
  a.merlons({ ...hall, z1: hall.z1 + 6 }, MARBLE, .1, 6);
  a.cylinder(0, -1.4, 1.85, 110, 146, MARBLE.frontLeft, MARBLE.top);
  for (let i = 0; i < 10; i++) {
    const ang = Math.PI * .02 + i * Math.PI * .1, cu = Math.cos(ang) * 1.86, cv = -1.4 + Math.sin(ang) * 1.86;
    a.face(GLOW, [[cu - .05, cv + .05, 118], [cu + .05, cv - .05, 118], [cu + .05, cv - .05, 136], [cu - .05, cv + .05, 136]]);
  }
  a.cylinder(0, -1.4, 1.95, 146, 152, MARBLE.frontLeft, MARBLE.top);
  dome(a, 0, -1.4, 1.9, 152, 80);
  a.cylinder(0, -1.4, .3, 230, 248, MARBLE.frontLeft, MARBLE.top);
  a.cone(0, -1.4, .36, 248, 20, 0xf2b134, 0xffe48a);
  pavilion(a, 4.6, 7.0);
  // the grand stair and the portico
  for (let k = 0; k < 6; k++) a.box({ u0: -3.6 + k * .05, u1: 3.6 - k * .05, v0: .5, v1: 2.6 - k * .3, z0: 0, z1: 1.4 * (k + 1) }, k % 2 ? M.limestone : M.paving);
  a.box({ u0: -3.7, u1: 3.7, v0: .5, v1: 1.35, z0: 8, z1: 14 }, MARBLE);
  for (let i = 0; i < 8; i++) a.cylinder(-3.3 + i * .94, 1.0, .15, 14, 96, 0xfaf3e2, 0xffffff);
  for (let i = 0; i < 8; i++) { const u = -3.3 + i * .94; a.box({ u0: u - .2, u1: u + .2, v0: .8, v1: 1.2, z0: 92, z1: 98 }, { top: 0xffe48a, frontLeft: GOLD, frontRight: 0xc98a14 }); }
  const ent: Box = { u0: -3.75, u1: 3.75, v0: .5, v1: 1.35, z0: 98, z1: 114 };
  a.box(ent, MARBLE);
  a.face(GOLD, [[ent.u0, ent.v1 + .002, 104], [ent.u1, ent.v1 + .002, 104], [ent.u1, ent.v1 + .002, 108], [ent.u0, ent.v1 + .002, 108]]);
  a.face(MARBLE.frontLeft, [[-3.8, 1.35, 114], [3.8, 1.35, 114], [0, 1.35, 156]]);
  a.line(shade(MARBLE.frontLeft, -28), [[-3.8, 1.351, 114], [0, 1.351, 156], [3.8, 1.351, 114]], 1.8);
  const crest = a.at([0, 1.356, 130]);
  a.g.fillStyle(0xc98a14, 1).fillEllipse(crest.x, crest.y + 2, 46, 30).fillStyle(GOLD, 1).fillEllipse(crest.x, crest.y, 43, 27).fillStyle(0xfff3b0, 1).fillEllipse(crest.x - 6, crest.y - 5, 12, 8);
  // the vault doors behind the columns, banded in bronze
  a.arches(.504, -.9, .9, 14, 84, 1, 0x5a3a1a, shade(MARBLE.frontLeft, 18));
  for (const z of [30, 50, 70]) a.line(0xc98a14, [[-.55, .506, z], [.55, .506, z]], 2.2);
  // PayPal banners on the facade
  for (const u of [-4.2, 4.2]) {
    a.face(PAYPAL, [[u - .28, .505, 96], [u + .28, .505, 96], [u + .28, .505, 46], [u, .505, 36], [u - .28, .505, 46]]);
    a.face(PAYPAL_LIGHT, [[u - .12, .506, 86], [u + .12, .506, 86], [u + .12, .506, 56], [u - .12, .506, 56]]);
  }
  // gold lions on pedestals, and the braziers
  for (const s of [-1, 1]) {
    const u = s * 2.9, v = 2.9;
    a.box({ u0: u - .32, u1: u + .32, v0: v - .32, v1: v + .32, z0: 0, z1: 20 }, MARBLE);
    a.box({ u0: u - .24, u1: u + .24, v0: v - .14, v1: v + .14, z0: 20, z1: 34 }, { top: 0xffe48a, frontLeft: GOLD, frontRight: 0xc98a14 });
    const head = a.at([u + s * .18, v + .04, 40]);
    a.g.fillStyle(0xc98a14, 1).fillCircle(head.x, head.y, 9).fillStyle(GOLD, 1).fillCircle(head.x, head.y, 7);
  }
  for (const [u, v, z] of TREASURY_FIRES) {
    a.cylinder(u, v, .12, 0, z - 6, 0x6b4527, 0x8a5a32);
    a.cylinder(u, v, .26, z - 6, z, GOLD, 0x3a2a1a);
    const f = a.at([u, v, z + 4]); a.g.fillStyle(0xffd36a, .5).fillCircle(f.x, f.y, 12).fillStyle(0xff8a2a, .9).fillCircle(f.x, f.y, 6).fillStyle(0xfff3c4, 1).fillCircle(f.x, f.y - 2, 3);
  }
  void ROOF;
  void GLASS;
}

export const TREASURY_BUILDER = treasury;

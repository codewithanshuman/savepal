/*
 * Traffic for an ancient kingdom: the engine's road vehicles are re-baked as horse-drawn carts
 * under the same texture keys, so the archive's own traffic system drives them unchanged. Each is
 * baked at RES in two trot frames -- the horse's diagonal leg pairs swapping, the wheel spokes a
 * step further round -- which the scene alternates as the carts roll (see SavePalScene).
 */
import type { Scene } from "phaser";
import { createBaker, fillFace, shade, TILE_ANCHOR_Y, TILE_WIDTH, type Baker, type Point3 } from "../../reference-city/textures/core";
import { BUS_KEYS, CAR_KEYS, CAR_TEXTURE_HEIGHT } from "../../reference-city/textures/vehicles";
import { RES } from "./atelier";

const CART_PAINT = [0xc0392b, 0x2f6fdc, 0x1f9e62, 0xe8b02a, 0x7a5aa8, 0xd08a2b];
const COATS = [0x8a5a32, 0x5a3a24, 0xc8b8a0, 0x3a2a20, 0xa06a3a, 0x6b4a32];
const SHIRTS = [0x2f6fdc, 0xc0392b, 0x1f9e62, 0x7a5aa8, 0xe8b02a, 0xf4ead6];
/** The second trot frame's key for any cart texture key. */
export const trotKey = (key: string) => `${key}:trot`;

/** One cart at one heading (the nose is local -v, rotated a quarter turn per heading) in one trot frame. */
function cart(source: Baker, index: number, heading: number, frame: number): void {
  const ox = TILE_WIDTH / 2, oy = CAR_TEXTURE_HEIGHT - TILE_ANCHOR_Y;
  const angle = heading * Math.PI / 2, cos = Math.round(Math.cos(angle)), sin = Math.round(Math.sin(angle));
  const R = ([u, v, z]: Point3): Point3 => [u * cos - v * sin, u * sin + v * cos, z];
  const baker: Baker = { ...source, at: (p, x, y) => source.at(R(p), x, y) };
  const P = (p: Point3) => baker.at(p, ox, oy);
  const g = source.graphics;
  const face = (color: number, pts: Point3[]) => fillFace(baker, color, 1, pts, ox, oy);
  const line = (color: number, pts: Point3[], w: number) => { g.lineStyle(w, color, 1); g.strokePoints(pts.map(P), false); };
  /** Does a local face normal (u, v) turn toward the camera at this heading? */
  const visible = (u: number, v: number) => u * (cos + sin) + v * (cos - sin) > 0;
  const box = (u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, color: number) => {
    for (const side of [-1, 1]) {
      if (visible(side, 0)) { const u = side < 0 ? u0 : u1; face(shade(color, side * (cos + sin) > 0 ? -14 : -30), [[u, v0, z0], [u, v1, z0], [u, v1, z1], [u, v0, z1]]); }
      if (visible(0, side)) { const v = side < 0 ? v0 : v1; face(shade(color, -22), [[u0, v, z0], [u1, v, z0], [u1, v, z1], [u0, v, z1]]); }
    }
    face(color, [[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]]);
  };
  const big = index >= CAR_KEYS.length, paint = CART_PAINT[index % CART_PAINT.length]!, coat = COATS[index % COATS.length]!;
  const L = big ? .5 : .36;
  const near = (u: number) => visible(Math.sign(u), 0);

  const horse = () => {
    // legs in diagonal pairs: one pair reaching forward while the other pushes back
    const legs: Array<[number, number, number]> = [[-.036, -.38, 0], [.036, -.38, 1], [-.036, -.17, 1], [.036, -.17, 0]];
    const leg = ([u, v, pair]: [number, number, number]) => {
      const swing = (pair === frame ? -1 : 1) * .045, lift = pair === frame ? 1.6 : 0;
      line(shade(coat, -26), [[u, v, 8], [u, v + swing * .6, 4 + lift], [u, v + swing, lift]], 2.3);
      line(0x2a1c12, [[u, v + swing, lift], [u, v + swing, lift + 1.2]], 2.6);
    };
    legs.filter(l => !near(l[0])).forEach(leg);
    line(0x2f1d12, [[0, -.12, 12], [0, -.07, 8], [0, -.06, 4]], 2.6); // tail
    box(-.056, -.42, .056, -.13, 7, 13, coat);
    box(-.05, -.4, .05, -.15, 13, 14, shade(coat, 8));
    box(-.06, -.41, .06, -.36, 9, 13.5, 0x3a2616); // collar
    box(-.034, -.48, .034, -.39, 11, 17.5, coat); // neck
    box(-.012, -.47, .012, -.38, 17.5, 19, 0x2f1d12); // mane
    box(-.03, -.57, .03, -.46, 15, 19.5, coat); // head
    box(-.024, -.59, .024, -.55, 14.5, 17, shade(coat, -18)); // muzzle
    const eye = P([0, -.53, 18.2]); g.fillStyle(0x111111, 1).fillCircle(eye.x, eye.y, .9);
    legs.filter(l => near(l[0])).forEach(leg);
    // shafts from the cart to the horse's flanks
    for (const u of [-.078, .078]) line(0x5c3b22, [[u, .02, 9], [u, -.36, 10]], 1.8);
  };

  const wheel = (u: number) => {
    const vc = L * .55, r = .12, zc = 7.5, rz = 7.5, pts: Point3[] = [];
    for (let i = 0; i < 18; i++) { const t = i / 18 * Math.PI * 2; pts.push([u, vc + Math.cos(t) * r, zc + Math.sin(t) * rz]); }
    face(0x3b2a1c, pts);
    const inner: Point3[] = pts.map(([pu, pv, pz]) => [pu, vc + (pv - vc) * .78, zc + (pz - zc) * .78]);
    face(0x7a5232, inner);
    for (let k = 0; k < 4; k++) {
      const t = k * Math.PI / 4 + frame * Math.PI / 8;
      line(0x3b2a1c, [[u, vc + Math.cos(t) * r * .78, zc + Math.sin(t) * rz * .78], [u, vc - Math.cos(t) * r * .78, zc - Math.sin(t) * rz * .78]], 1);
    }
    const hub = P([u, vc, zc]); g.fillStyle(0x2a1c12, 1).fillCircle(hub.x, hub.y, 1.6);
  };

  const wagon = () => {
    for (const u of [-.15, .15]) if (!near(u)) wheel(u);
    box(-.13, 0, .13, L, 6, 9.5, 0x9a6a40);
    // side boards in the cart's colour, with a gilt rail
    box(-.13, 0, -.11, L, 9.5, 14, paint); box(.11, 0, .13, L, 9.5, 14, paint);
    box(-.13, L - .02, .13, L, 9.5, 14, paint); box(-.13, 0, .13, .02, 9.5, 14, shade(paint, -10));
    for (const v of [L * .33, L * .66]) line(shade(paint, -30), [[-.13, v, 9.5], [-.13, v, 14]], .8);
    // the load
    if (big) {
      box(-.12, .06, .12, L - .04, 14, 22, 0xf3ead6);
      box(-.1, .08, .1, L - .06, 22, 25, 0xe2d6bc);
      for (const v of [.14, L * .5, L - .12]) line(0xb8a888, [[-.12, v, 14], [-.12, v, 22]], 1);
    } else if (index % 3 === 0) {
      for (const v of [.12, .24]) { box(-.08, v - .05, .0, v + .05, 9.5, 18, 0x8a5a32); line(0x3b2a1c, [[-.08, v + .05, 13], [0, v + .05, 13]], 1); }
      box(.02, .08, .1, .3, 9.5, 15, 0xe8d6a8);
    } else if (index % 3 === 1) {
      box(-.1, .08, .1, .32, 9.5, 18, 0xf0d27a); box(-.08, .1, .08, .3, 18, 20, 0xd9b55a);
    } else {
      for (const [u, v] of [[-.06, .12], [.05, .14], [0, .26]] as const) box(u - .045, v - .045, u + .045, v + .045, 9.5, 16, 0xc89a5a);
    }
    // the driver up front, in a straw hat
    box(-.045, .03, .045, .1, 13, 22, SHIRTS[index % SHIRTS.length]!);
    const head = P([0, .065, 25.5]);
    g.fillStyle(0xe8b48a, 1).fillCircle(head.x, head.y, 3.2);
    g.fillStyle(0xd9b25a, 1).fillEllipse(head.x, head.y - 2.4, 10, 3.2).fillStyle(0xc49a3e, 1).fillEllipse(head.x, head.y - 3.6, 5, 2.6);
    line(0x5a3a22, [[0, .03, 18], [0, -.3, 12]], .8); // the reins
    for (const u of [-.15, .15]) if (near(u)) wheel(u);
  };

  // draw whichever of the horse and the cart stands further from the camera first
  if (sin - cos > 0) { wagon(); horse(); } else { horse(); wagon(); }
}

export function bakeCarts(scene: Scene): void {
  const baker = createBaker(scene);
  baker.graphics.setScale(RES);
  [...CAR_KEYS, ...BUS_KEYS].forEach((key, index) => {
    for (let heading = 0; heading < 4; heading++) {
      const k = heading === 0 ? key : `${key}:heading:${heading}`;
      for (let frame = 0; frame < 2; frame++) {
        cart(baker, index, heading, frame);
        baker.finish(frame ? trotKey(k) : k, Math.ceil(TILE_WIDTH * RES), Math.ceil(CAR_TEXTURE_HEIGHT * RES));
        scene.textures.get(frame ? trotKey(k) : k).setFilter(1 /* LINEAR */);
      }
    }
  });
  baker.destroy();
}

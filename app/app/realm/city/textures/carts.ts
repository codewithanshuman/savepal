/*
 * Traffic for an ancient kingdom: the engine's road vehicles are re-baked as horse-drawn carts
 * under the same texture keys, so the archive's own traffic system drives them unchanged.
 */
import type { Scene } from "phaser";
import { createBaker, fillFace, shade, TILE_ANCHOR_Y, TILE_WIDTH, type Baker, type Point3 } from "../../reference-city/textures/core";
import { BUS_KEYS, CAR_KEYS, CAR_TEXTURE_HEIGHT } from "../../reference-city/textures/vehicles";

/* ── traffic: the engine's road vehicles become horse-drawn carts ── */
const CART_PAINT = [0xc0392b, 0x2f6fdc, 0x1f9e62, 0xe8b02a, 0x7a5aa8, 0xd08a2b];
/** Same heading-baked technique as the archive's vehicles: the cart's nose is -v at frame zero. */
function cart(source: Baker, index: number, heading: number): void {
  const ox = TILE_WIDTH / 2, oy = CAR_TEXTURE_HEIGHT - TILE_ANCHOR_Y;
  const angle = heading * Math.PI / 2, cos = Math.round(Math.cos(angle)), sin = Math.round(Math.sin(angle));
  const baker: Baker = { ...source, at: ([u, v, z], x, y) => source.at([u * cos - v * sin, u * sin + v * cos, z], x, y) };
  const face = (color: number, pts: Point3[]) => fillFace(baker, color, 1, pts, ox, oy);
  const visible = (u: number, v: number) => u * (cos + sin) + v * (cos - sin) > 0;
  const box = (u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, color: number) => {
    for (const side of [-1, 1]) {
      if (visible(side, 0)) { const u = side < 0 ? u0 : u1; face(shade(color, side * (cos + sin) > 0 ? -14 : -30), [[u, v0, z0], [u, v1, z0], [u, v1, z1], [u, v0, z1]]); }
      if (visible(0, side)) { const v = side < 0 ? v0 : v1; face(shade(color, -22), [[u0, v, z0], [u1, v, z0], [u1, v, z1], [u0, v, z1]]); }
    }
    face(color, [[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]]);
  };
  const big = index >= CAR_KEYS.length, paint = CART_PAINT[index % CART_PAINT.length]!;
  // the horse, ahead of the cart
  box(-.05, -.42, .05, -.14, 5, 11, 0x7a4e2c);
  box(-.04, -.46, .04, -.38, 10, 15, 0x6b4527);
  for (const [u, v] of [[-.04, -.38], [.03, -.38], [-.04, -.18], [.03, -.18]] as const) box(u, v, u + .02, v + .02, 0, 5, 0x4a2f1c);
  // shafts, bed, wheels and (for the big wagons) a canvas cover
  box(-.09, -.16, -.07, .02, 6, 7, 0x5c3b22); box(.07, -.16, .09, .02, 6, 7, 0x5c3b22);
  box(-.12, 0, .12, big ? .5 : .32, 5, 10, 0x9a6a40);
  box(-.12, 0, .12, big ? .5 : .32, 10, 13, paint);
  for (const s of [-1, 1]) box(s < 0 ? -.15 : .12, .08, s < 0 ? -.12 : .15, .22, 0, 8, 0x3b2a1c);
  if (big) { box(-.11, .04, .11, .46, 13, 22, 0xf3ead6); box(-.11, .04, .11, .46, 22, 24, 0xe2d6bc); }
  else box(-.09, .06, .09, .26, 13, 16, 0xe8b02a);
}
export function bakeCarts(scene: Scene): void {
  const baker = createBaker(scene);
  [...CAR_KEYS, ...BUS_KEYS].forEach((key, index) => {
    for (let heading = 0; heading < 4; heading++) { cart(baker, index, heading); baker.finish(heading === 0 ? key : `${key}:heading:${heading}`, TILE_WIDTH, CAR_TEXTURE_HEIGHT); }
  });
  baker.destroy();
}

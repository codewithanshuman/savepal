/*
 * The island itself: a raised, box-shaped kingdom standing in the sea. The terrain pass lays the
 * top (grass, streets, plazas) with a square coast; this module adds what makes it a landmass --
 * layered earth cliffs on the near sides, sandy beaches on the far shores, surf breaking along the
 * cliff foot, a forest ring, drifting clouds, and two waterfalls.
 *
 * Each waterfall is a small piece of scenery in its own right: a spring wells up among boulders on
 * the grass ring and runs as a meandering stream to the cliff edge, where it pours between rocks
 * as a curved sheet that bows outward and widens as it falls. Streaks race down it (accelerating,
 * as falling water does), droplets peel off its edges, and the wet rock behind it darkens. At the
 * foot it churns into a foam cloud, throws spray, raises mist with a faint rainbow in it, and sends
 * ripple rings and foam drifting out across the sea. The moving parts are redrawn every frame
 * (only while in view).
 */
import Phaser from "phaser";
import { GROUND_DEPTH, SKY_DEPTH, projection } from "../reference-city/world/core/worldConstants";
import { setCoast } from "../reference-city/layouts/terrain";
import { CITY_SIZE } from "./layout";
import { bakeAll, RES, type Asset } from "./textures/atelier";

/** A grass ring around the field, then the cliff edge. */
export const RINGS = 2;
setCoast({ countryside: RINGS, sand: 0, jitter: 0, square: true });

const U0 = -RINGS - .5, V0 = -RINGS - .5, U1 = CITY_SIZE.width - 1 + RINGS + .5, V1 = CITY_SIZE.height - 1 + RINGS + .5;
const CLIFF = 130;
/** Waterfalls: one on each near face, fed by a short stream from a spring on the grass ring. */
const FALLS: Array<{ face: "v" | "u"; at: number; spring: number; half: number }> = [
  { face: "v", at: 4.2, spring: 1.55, half: .62 },
  { face: "u", at: 30.4, spring: 1.5, half: .62 },
];
/** Where each spring wells up (grid), for the ducks that paddle on it. */
export const POOLS: ReadonlyArray<{ u: number; v: number }> = FALLS.map(f => f.face === "v" ? { u: f.at, v: V1 - f.spring } : { u: U1 - f.spring, v: f.at });

const TREES: Record<string, Asset> = {
  oak: { key: "savepal:tree:oak", width: 90, height: 120, anchorY: 14 },
  pine: { key: "savepal:tree:pine", width: 80, height: 130, anchorY: 12 },
  birch: { key: "savepal:tree:birch", width: 80, height: 120, anchorY: 12 },
  cloud: { key: "savepal:cloud", width: 260, height: 120, anchorY: 60 },
};

type P = { x: number; y: number };
const at = (gx: number, gy: number, z = 0): P => { const p = projection.project(gx, gy); return { x: p.x, y: p.y - z }; };
const hash = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
const frac = (x: number) => x - Math.floor(x);
export const mixColor = (a: number, b: number, t: number) => {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

function bakeIsland(scene: Phaser.Scene): void {
  bakeAll(scene, TREES, {
    oak: a => a.tree(0, 0, 1.25, 0x3a8a3c),
    pine: a => { const g = a.g, foot = a.at([0, 0, 0]); g.fillStyle(0x1c2e14, .22).fillEllipse(foot.x + 6, foot.y + 2, 30, 12); a.line(0x5a3a22, [[0, 0, 0], [0, 0, 14]], 4); for (let k = 0; k < 5; k++) { const p = a.at([0, 0, 14 + k * 16]); const w = 30 - k * 5; g.fillStyle(0x2c6b3a - k * 0x020202, 1).fillTriangle(p.x - w / 2, p.y + 6, p.x + w / 2, p.y + 6, p.x, p.y - 18); g.fillStyle(0x3f8a4a, .55).fillTriangle(p.x - w / 2, p.y + 6, p.x, p.y + 6, p.x, p.y - 18); } },
    birch: a => { const g = a.g, foot = a.at([0, 0, 0]); g.fillStyle(0x1c2e14, .2).fillEllipse(foot.x + 5, foot.y + 2, 24, 10); a.line(0xf4f1ea, [[0, 0, 0], [0, 0, 40]], 3.4); for (const z of [10, 22, 32]) { const p = a.at([0, 0, z]); g.fillStyle(0x3a3328, 1).fillRect(p.x - 1.6, p.y, 3.2, 1.6); } for (const [dx, dz, r, c] of [[-8, 44, 12, 0x7fbf4a], [8, 46, 11, 0x8fd060], [0, 56, 13, 0x9bd86a]] as const) { const p = a.at([0, 0, dz]); g.fillStyle(c, 1).fillCircle(p.x + dx, p.y, r); } },
    cloud: a => { const g = a.g, o = a.at([0, 0, 0]); for (const [dx, dy, r, alpha] of [[-60, 8, 34, .9], [-20, -8, 44, .95], [30, 0, 40, .95], [70, 10, 28, .9], [0, 16, 46, .9]] as const) { g.fillStyle(0xffffff, alpha).fillCircle(o.x + dx, o.y + dy, r); } g.fillStyle(0xdfe9f3, .7).fillEllipse(o.x + 4, o.y + 34, 200, 26); },
  });
}

/** A boulder: an irregular, lit stone with a shaded underside, a highlight and (if dry) a cap of moss. */
function boulder(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, seed: number, wet = false, moss = true): void {
  const base = wet ? 0x5d5750 : 0x8b8276, light = wet ? 0x7d776e : 0xb6ad9d, dark = wet ? 0x3e3a35 : 0x635b50;
  const pts: P[] = [];
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2, k = .78 + hash(seed, i) * .32; pts.push({ x: x + Math.cos(a) * r * k, y: y + Math.sin(a) * r * k * .72 - (Math.sin(a) < 0 ? r * .18 : 0) }); }
  g.fillStyle(0x1d2b16, .25).fillEllipse(x + r * .25, y + r * .55, r * 2.1, r * .8, 12);
  g.fillStyle(dark, 1).fillPoints(pts, true);
  g.fillStyle(base, 1).fillPoints(pts.map(p => ({ x: x + (p.x - x) * .92 - r * .06, y: y + (p.y - y) * .86 - r * .1 })), true);
  g.fillStyle(light, 1).fillPoints(pts.slice(4, 9).map(p => ({ x: x + (p.x - x) * .62 - r * .16, y: y + (p.y - y) * .55 - r * .22 })).concat([{ x: x - r * .1, y: y - r * .05 }]), true);
  g.fillStyle(0xffffff, wet ? .5 : .28).fillEllipse(x - r * .3, y - r * .42, r * .5, r * .18, 8);
  if (moss && !wet) g.fillStyle(0x5f9a3e, .9).fillEllipse(x - r * .15, y - r * .52, r * .9, r * .3, 10).fillStyle(0x7fbf4a, .8).fillEllipse(x - r * .25, y - r * .6, r * .45, r * .14, 8);
}

type Fall = {
  back: Phaser.GameObjects.Graphics; front: Phaser.GameObjects.Graphics;
  a: P; b: P; out: P; H: number; seed: number;
  along: (t: number, w: number) => P; width: (t: number) => number; bend: (t: number) => number; pool: P;
  /** The front half of a ripple ring (the half in front of the cliff), as a range of screen angles. */
  arc: [number, number];
  view: Phaser.Geom.Rectangle;
  /** Everything of this fall that can be skipped while it is off screen. */
  parts: Phaser.GameObjects.GameObject[];
};

export class Island {
  private objects: Phaser.GameObjects.GameObject[] = [];
  private falls: Fall[] = [];
  private rainbows: Phaser.GameObjects.Graphics[] = [];
  private built = false;
  private readonly still = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  constructor(private readonly scene: Phaser.Scene) {}

  build(skip: (gx: number, gy: number) => boolean): void {
    if (this.built) return;
    this.built = true;
    bakeIsland(this.scene);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => { this.objects.push(o); return o; };
    // beaches along the far shores
    const beach = add(this.scene.add.graphics().setDepth(GROUND_DEPTH + 3));
    const sand = (pts: P[], c: number) => beach.fillStyle(c, 1).fillPoints(pts, true);
    const B = .55;
    sand([at(U0, V0), at(U1, V0), at(U1, V0 + B), at(U0 + B, V0 + B), at(U0 + B, V1), at(U0, V1)], 0xeedca9);
    sand([at(U0, V0), at(U1, V0), at(U1, V0 + .14), at(U0 + .14, V0 + .14), at(U0 + .14, V1), at(U0, V1)], 0xf6e8c2);
    // the near cliffs: turf lip, soil, then bands of rock down to the sea
    const cliff = add(this.scene.add.graphics().setDepth(GROUND_DEPTH + 4));
    const face = (a: P, b: P, lit: boolean) => {
      const bands: Array<[number, number, number]> = [[0, 10, lit ? 0x5fa840 : 0x4f8f36], [10, 46, lit ? 0x8a6340 : 0x6e4c30], [46, 78, lit ? 0x9b8a72 : 0x7a6c58], [78, 104, lit ? 0x887965 : 0x6b5f4e], [104, CLIFF, lit ? 0x6f6353 : 0x574d41]];
      for (const [z0, z1, c] of bands) cliff.fillStyle(c, 1).fillPoints([{ x: a.x, y: a.y + z0 }, { x: b.x, y: b.y + z0 }, { x: b.x, y: b.y + z1 }, { x: a.x, y: a.y + z1 }], true);
      const n = Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 26);
      for (let i = 0; i < n; i++) {
        const t = (i + hash(i, lit ? 3 : 7)) / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        cliff.lineStyle(1.2, 0x3e352c, .55).beginPath().moveTo(x, y + 50 + hash(i, 1) * 14).lineTo(x + 3, y + 70 + hash(i, 2) * 20).lineTo(x - 2, y + 92 + hash(i, 4) * 18).strokePath();
        cliff.fillStyle(0xb8a88e, .7).fillEllipse(x + 8, y + 58 + hash(i, 5) * 40, 7, 4, 8);
        if (hash(i, 9) > .6) cliff.lineStyle(1, 0x4a3424, .7).beginPath().moveTo(x - 4, y + 12).lineTo(x - 6, y + 26).strokePath();
      }
      cliff.lineStyle(2, lit ? 0x8fd060 : 0x6fae49, 1).beginPath().moveTo(a.x, a.y + 1).lineTo(b.x, b.y + 1).strokePath();
    };
    face(at(U0, V1), at(U1, V1), true);
    face(at(U1, V1), at(U1, V0), false);
    // surf breaking along the cliff foot
    const surf = add(this.scene.add.graphics().setDepth(GROUND_DEPTH + 3.5));
    const surfLine = (a: P, b: P) => {
      const n = 60;
      for (let w = 0; w < 2; w++) {
        surf.lineStyle(w ? 2 : 4, 0xffffff, w ? .5 : .75).beginPath();
        for (let i = 0; i <= n; i++) { const t = i / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t + CLIFF + 4 + w * 9 + Math.sin(i * 1.3 + w) * 2.5; if (i === 0) surf.moveTo(x, y); else surf.lineTo(x, y); }
        surf.strokePath();
      }
    };
    surfLine(at(U0, V1), at(U1, V1)); surfLine(at(U1, V1), at(U1, V0));
    if (!this.still) this.scene.tweens.add({ targets: surf, alpha: .45, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    FALLS.forEach((spec, i) => this.buildFall(spec, i, add));
    // the forest ring: our trees on the grass ring, clear of the port's quay and the springs
    for (let gy = Math.ceil(V0); gy <= Math.floor(V1); gy++) for (let gx = Math.ceil(U0); gx <= Math.floor(U1); gx++) {
      const inRing = gx < 0 || gy < 0 || gx > CITY_SIZE.width - 1 || gy > CITY_SIZE.height - 1;
      if (!inRing || skip(gx, gy) || hash(gx, gy) < .42) continue;
      if (FALLS.some(f => (f.face === "v" ? Math.abs(gx - f.at) < 1.7 && gy > CITY_SIZE.height - 1 : Math.abs(gy - f.at) < 1.7 && gx > CITY_SIZE.width - 1))) continue;
      const u = gx + (hash(gy, gx) - .5) * .5, v = gy + (hash(gx + 3, gy) - .5) * .5, kind = hash(gx * 2, gy * 3);
      const tree = kind < .45 ? TREES.oak! : kind < .75 ? TREES.pine! : TREES.birch!;
      const p = at(u, v);
      add(this.scene.add.image(p.x, p.y + tree.anchorY, tree.key).setOrigin(.5, 1).setScale((.8 + hash(gx, gy + 9) * .35) / RES).setDepth(projection.depth(u, v)));
    }
    // drifting clouds with their shadows
    if (!this.still) {
      const left = at(U0 - 10, V1).x, right = at(U1 + 10, V0).x, top = at(U0, V0).y - 300, bottom = at(U1, V1).y;
      for (let i = 0; i < 6; i++) {
        const y = top + hash(i, 4) * (bottom - top), x = left + hash(i, 8) * (right - left), sc = (1.1 + hash(i, 2) * .9) / RES;
        const cloud = add(this.scene.add.image(x, y, TREES.cloud!.key).setScale(sc).setAlpha(.92).setDepth(SKY_DEPTH + 2));
        cloud.setData("cloud", true);
        const shadow = add(this.scene.add.ellipse(x + 40, y + 300, 220 * sc * RES, 50 * sc * RES, 0x14260f, .1).setDepth(SKY_DEPTH - 60));
        const drift = () => this.scene.tweens.add({ targets: [cloud, shadow], x: `+=${right - left}`, duration: 220000 + hash(i, 6) * 120000, onComplete: () => { cloud.x -= right - left + 600; shadow.x = cloud.x + 40; drift(); } });
        drift();
      }
    }
  }

  /** One waterfall: its spring, stream, rocks, the falling sheet, the plunge and the mist. */
  private buildFall(spec: (typeof FALLS)[number], index: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const seed = index * 17 + 3, H = CLIFF + 4;
    const along = (t: number, w: number) => spec.face === "v" ? at(spec.at + w, V1 - spec.spring * (1 - t)) : at(U1 - spec.spring * (1 - t), spec.at + w);
    const width = (t: number) => .27 + t * (spec.half - .27);
    const bend = (t: number) => Math.sin(t * 4.2 + seed) * .09 * (1 - t);
    const a = spec.face === "v" ? at(spec.at - spec.half, V1) : at(U1, spec.at - spec.half);
    const b = spec.face === "v" ? at(spec.at + spec.half, V1) : at(U1, spec.at + spec.half);
    const out = spec.face === "v" ? { x: -48, y: 24 } : { x: 48, y: 24 };
    const pool = along(0, bend(0));
    const f: Fall = {
      back: add(this.scene.add.graphics().setDepth(GROUND_DEPTH + 6)),
      front: add(this.scene.add.graphics().setDepth(GROUND_DEPTH + 6.4)),
      a, b, out, H, seed, along, width, bend, pool,
      arc: spec.face === "v" ? [Math.PI * .25, Math.PI * 1.25] : [-Math.PI * .25, Math.PI * .75],
      parts: [],
      view: new Phaser.Geom.Rectangle(Math.min(a.x, b.x, pool.x) - 180, Math.min(a.y, b.y, pool.y) - 70, Math.abs(b.x - a.x) + Math.abs(pool.x - a.x) + 360, Math.abs(pool.y - a.y) + H + 280),
    };
    // the bed: wet earth banks, deep water, a lighter channel down the middle, pebbles along the edges
    const bed = add(this.scene.add.graphics().setDepth(GROUND_DEPTH + 4.6));
    const strip = (k: number, extra: number) => {
      const l: P[] = [], r: P[] = [];
      for (let i = 0; i <= 16; i++) { const t = i / 16, w = width(t) * k + extra; l.push(along(t, bend(t) - w)); r.push(along(t, bend(t) + w)); }
      return l.concat(r.reverse());
    };
    bed.fillStyle(0x6a553b, 1).fillPoints(strip(1, .12), true);
    bed.fillStyle(0x7d6646, 1).fillPoints(strip(1, .06), true);
    bed.fillStyle(0x2b7fbd, 1).fillPoints(strip(1, 0), true);
    bed.fillStyle(0x3f97d2, 1).fillPoints(strip(.62, 0), true);
    bed.fillStyle(0x5fb0e2, .8).fillPoints(strip(.25, 0), true);
    for (let i = 0; i < 14; i++) {
      const t = (i + hash(i, seed)) / 14, side = i % 2 ? 1 : -1, p = along(t, bend(t) + side * (width(t) + .07));
      bed.fillStyle(i % 3 ? 0xa59c8c : 0x8b8276, 1).fillEllipse(p.x, p.y, 5 + hash(i, 2) * 4, 3, 8);
    }
    // the spring's pool among its boulders
    bed.fillStyle(0x6a553b, 1).fillEllipse(pool.x, pool.y + 2, 92, 44);
    bed.fillStyle(0x2b7fbd, 1).fillEllipse(pool.x, pool.y, 78, 36);
    bed.fillStyle(0x4aa3dc, 1).fillEllipse(pool.x - 4, pool.y - 2, 56, 24);
    bed.fillStyle(0x8fd0f5, .7).fillEllipse(pool.x - 12, pool.y - 6, 26, 7);
    // the wet, dark rock behind the falling water, with moss down its sides
    const sheetAt = (s: number, d: number) => this.sheet(f, s, d);
    const wet: P[] = [];
    // (ragged at the edges and spreading lower down, where the spray wets more of the rock)
    for (let k = 0; k <= 12; k++) { const t = k / 12; wet.push(sheetAt(-.07 - t * .13 - hash(k, seed) * .07, H * t)); }
    for (let k = 12; k >= 0; k--) { const t = k / 12; wet.push(sheetAt(1.07 + t * .13 + hash(k, seed + 5) * .07, H * t)); }
    bed.fillStyle(0x3d3832, .42).fillPoints(wet, true);
    for (const side of [0, 1]) for (let k = 0; k < 7; k++) {
      const t = (k + hash(k, side + seed)) / 7, p = sheetAt(side ? 1.08 + t * .1 : -.08 - t * .1, H * t);
      bed.fillStyle(k % 2 ? 0x4f8a3a : 0x6aa64a, .7).fillEllipse(p.x + (hash(k, 3) - .5) * 6, p.y, 3 + hash(k, side) * 4, 4 + hash(side, k) * 5, 8);
    }
    // boulders: round the spring, framing the lip, ledges down the sides and wet stones at the foot
    const rocks = add(this.scene.add.graphics().setDepth(GROUND_DEPTH + 6.2));
    const rim = [[-.55, -.32, 13], [.5, -.36, 11], [-.66, .1, 9], [.66, .14, 10]] as const;
    rim.forEach(([w, t, r], k) => { const p = along(Math.max(0, t), bend(0) + w * 1.25); boulder(rocks, p.x, p.y - (t < 0 ? 8 : 0), r, seed + k); });
    for (const [s, r] of [[-.1, 13], [1.1, 14], [-.24, 8], [1.25, 9]] as const) { const p = sheetAt(s, 2); boulder(rocks, p.x, p.y, r, seed + s * 7); }
    for (const [s, d, r] of [[-.07, 46, 7], [1.08, 64, 8], [-.09, 92, 6], [1.06, 104, 7]] as const) { const p = sheetAt(s, d); boulder(rocks, p.x, p.y, r, seed + d, true); }
    for (const [s, r] of [[.12, 11], [.86, 12], [.5, 8]] as const) { const p = sheetAt(s, H + 4); boulder(rocks, p.x, p.y, r, seed + s * 13, true); }
    f.parts.push(f.back, f.front, bed, rocks);
    this.falls.push(f);
    this.drawFall(f, 0);
    // spray and mist off the foot, and a faint rainbow in the mist
    const L = sheetAt(-.05, H), R = sheetAt(1.05, H), foot = sheetAt(.5, H);
    if (!this.still) {
      const line = new Phaser.Geom.Line(L.x - foot.x, L.y - foot.y, R.x - foot.x, R.y - foot.y);
      const zone = { type: "random" as const, source: line as unknown as Phaser.Types.GameObjects.Particles.RandomZoneSource };
      f.parts.push(add(this.scene.add.particles(foot.x, foot.y, "savepal:spark", {
        emitZone: zone, speed: { min: 40, max: 120 }, angle: { min: 232, max: 308 }, gravityY: 240, lifespan: 950,
        scale: { start: .24, end: .04 }, alpha: { start: .95, end: 0 }, tint: [0xffffff, 0xd8f0ff, 0xa9dcf7], quantity: 2, frequency: 40,
      }).setDepth(GROUND_DEPTH + 6.6)));
      f.parts.push(add(this.scene.add.particles(foot.x, foot.y - 6, "savepal:puff", {
        emitZone: zone, speedY: { min: -30, max: -10 }, speedX: { min: -12, max: 12 }, lifespan: 2800,
        scale: { start: .35, end: 1.3 }, alpha: { start: .32, end: 0 }, tint: 0xf1f9ff, quantity: 1, frequency: 110,
      }).setDepth(GROUND_DEPTH + 6.8)));
    }
    const bow = add(this.scene.add.graphics().setDepth(GROUND_DEPTH + 6.7));
    // out over the plunge pool, in front of the cliff
    const bx = foot.x + out.x / Math.hypot(out.x, out.y) * 46, by = foot.y + out.y / Math.hypot(out.x, out.y) * 46 + 6;
    [0xff5a5a, 0xffa94a, 0xffe25a, 0x6fdc7a, 0x5aa8ff, 0x9a7aff].forEach((c, k) => bow.lineStyle(2.2, c, .2).beginPath().arc(bx, by, 44 - k * 2.2, Math.PI * 1.1, Math.PI * 1.9).strokePath());
    if (!this.still) this.scene.tweens.add({ targets: bow, alpha: .45, duration: 3600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.rainbows.push(bow);
  }

  /** A point on the falling sheet: across it (s, 0..1 from a to b) and d pixels down from the lip.
   *  The water bows outward from the rock and spreads a little as it falls. */
  private sheet(f: Fall, s: number, d: number): P {
    const k = Math.max(0, Math.min(1, d / f.H)), bulge = .24 * (1 - (1 - k) * (1 - k)), spread = .08 * k;
    const ss = -spread + s * (1 + 2 * spread);
    return { x: f.a.x + (f.b.x - f.a.x) * ss + f.out.x * bulge, y: f.a.y + (f.b.y - f.a.y) * ss + d + f.out.y * bulge };
  }

  /** The moving water: the stream racing to the lip, the sheet and its streaks, and the plunge at the foot. */
  private drawFall(f: Fall, time: number): void {
    const g = f.back, fr = f.front, H = f.H, S = (s: number, d: number) => this.sheet(f, s, d);
    g.clear(); fr.clear();
    // the spring wells up in rings
    for (let k = 0; k < 3; k++) { const ph = frac(time / 1700 + k / 3), r = 5 + ph * 26; g.lineStyle(1.2, 0xffffff, .55 * (1 - ph)).strokeEllipse(f.pool.x - 4, f.pool.y - 1, r * 2, r); }
    // glints racing down the stream, quickening toward the edge
    for (let k = 0; k < 12; k++) {
      const t = Math.pow(frac(time * .00022 * (1 + (k % 3) * .35) + k / 12), 1.4), w = f.width(t) * (hash(k, f.seed) - .5) * 1.3;
      const p = f.along(t, f.bend(t) + w);
      g.fillStyle(0xeaf7ff, .8 * Math.min(1, t * 6)).fillEllipse(p.x, p.y, 6 + t * 9, 1.6 + t, 8);
    }
    // the sheet: deep blue, lightening and aerating toward the foot
    const sheet: P[] = [];
    for (let k = 0; k <= 10; k++) sheet.push(S(0, H * k / 10));
    for (let k = 10; k >= 0; k--) sheet.push(S(1, H * k / 10));
    g.fillStyle(0x2f86c4, .96).fillPoints(sheet, true);
    for (let j = 0; j < 6; j++) {
      const d0 = H * j / 6, d1 = H * (j + 1) / 6;
      g.fillStyle(mixColor(0x4aa6e0, 0xe2f3fc, j / 5), .32 + j * .08).fillPoints([S(.03, d0), S(.97, d0), S(.97, d1), S(.03, d1)], true);
    }
    // strands: darker channels, then white water racing down, short at the lip and long below
    const N = 22;
    for (let i = 0; i < N; i++) {
      const s = (i + .5 + Math.sin(i * 7.1) * .3) / N, speed = .00045 * (1 + .25 * Math.sin(i * 3.3 + f.seed)), edge = Math.min(1, s * 6, (1 - s) * 6);
      if (i % 4 === 1) { const p0 = S(s, 4), p1 = S(s, H - 6); g.lineStyle(2.2, 0x2470ad, .32 * edge).lineBetween(p0.x, p0.y, p1.x, p1.y); }
      for (let k = 0; k < 4; k++) {
        const ph = frac(time * speed + k / 4 + i * .37), d = H * Math.pow(ph, 1.7), len = 5 + 34 * ph;
        const p0 = S(s, d), p1 = S(s, Math.min(H, d + len));
        g.lineStyle(i % 3 === 0 ? 2.3 : 1.4, (i + k) % 3 ? 0xffffff : 0xcdeefc, (.22 + .6 * ph) * edge).lineBetween(p0.x, p0.y, p1.x, p1.y);
      }
    }
    // droplets peeling off both edges
    for (const side of [0, 1]) for (let k = 0; k < 6; k++) {
      const ph = frac(time * .0005 + k / 6 + side * .5), d = H * Math.pow(ph, 1.6), s = side ? 1.03 + .07 * ph : -.03 - .07 * ph, p = S(s, d);
      g.fillStyle(0xffffff, .6 * (1 - ph * .5)).fillCircle(p.x + Math.sin(k + time * .01) * 1.5, p.y, 1.1 + ph * 1.3);
    }
    // the lip: the water swells pale as it tips over, with a wavering line of white
    g.fillStyle(0x9fdcff, .75).fillPoints([S(0, 0), S(1, 0), S(1, 9), S(0, 9)], true);
    const lip: P[] = [];
    for (let k = 0; k <= 18; k++) { const s = -.02 + k / 18 * 1.04, p = S(s, 0); lip.push({ x: p.x, y: p.y - 1 + Math.sin(s * 15 + time * .007) * 1.1 }); }
    g.lineStyle(4.6, 0xffffff, .95).strokePoints(lip, false);
    g.lineStyle(2, 0xd6f0ff, .9).strokePoints(lip.map(p => ({ x: p.x, y: p.y + 4.5 })), false);
    // the plunge: aerated water, ripple rings spreading out (only their halves in front of the cliff), drifting foam
    const foot = S(.5, H), base0 = S(0, H), base1 = S(1, H), wBase = Math.hypot(base1.x - base0.x, base1.y - base0.y);
    fr.fillStyle(0xd6eefa, .8).fillEllipse(foot.x, foot.y + 4, wBase * 1.7, 22);
    for (let k = 0; k < 4; k++) {
      const ph = frac(time / 2600 + k / 4), R = .35 + ph * 1.9, rx = R * 67.9, ry = R * 33.9;
      fr.lineStyle(1.7, 0xffffff, .6 * (1 - ph)).beginPath();
      for (let j = 0; j <= 18; j++) { const th = f.arc[0] + (f.arc[1] - f.arc[0]) * j / 18, x = foot.x + Math.cos(th) * rx, y = foot.y + 4 + Math.sin(th) * ry; if (j) fr.lineTo(x, y); else fr.moveTo(x, y); }
      fr.strokePath();
    }
    const across = { x: (base1.x - base0.x) / wBase, y: (base1.y - base0.y) / wBase }, outLen = Math.hypot(f.out.x, f.out.y), ox = f.out.x / outLen, oy = f.out.y / outLen;
    for (let k = 0; k < 6; k++) {
      const ph = frac(time / 3400 + k / 6), dist = 20 + ph * 90, lat = (k - 2.5) * 16 * (1 + ph);
      fr.fillStyle(0xffffff, .55 * (1 - ph)).fillEllipse(foot.x + ox * dist + across.x * lat, foot.y + 4 + oy * dist + across.y * lat, 12 * (1 - ph * .4), 3.6, 10);
    }
    for (let k = 0; k < 10; k++) {
      const s = (k + .5) / 10, p = S(s, H), r = 7 + 5 * Math.sin(time * .006 + k * 1.7) + (k % 3) * 1.5;
      fr.fillStyle(0xffffff, .92).fillCircle(p.x + Math.sin(time * .004 + k) * 2, p.y + 2 - Math.abs(Math.sin(time * .005 + k * 2.1)) * 5, r);
    }
    for (let k = 0; k < 6; k++) { const s = hash(k, f.seed + 1), p = S(s, H); fr.fillStyle(0xeaf6ff, .85).fillCircle(p.x + (k - 2.5) * 6, p.y - 8 - Math.abs(Math.sin(time * .007 + k)) * 9, 3 + (k % 2) * 2); }
  }

  /** Redraws the falling water each frame, while it is in view. */
  update(time: number): void {
    if (this.still || !this.falls.length) return;
    const view = this.scene.cameras.main.worldView;
    for (const f of this.falls) {
      const seen = Phaser.Geom.Rectangle.Overlaps(view, f.view);
      for (const o of f.parts) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(seen);
      if (seen) this.drawFall(f, time);
    }
  }

  /** At night the rainbow fades and the clouds dim. */
  setNight(k: number): void {
    for (const r of this.rainbows) r.setVisible(k < .5);
    const tint = mixColor(0xffffff, 0x8890b8, k);
    for (const o of this.objects) if ((o as Phaser.GameObjects.Image).getData?.("cloud")) (o as Phaser.GameObjects.Image).setTint(tint);
  }

  destroy(): void {
    for (const o of this.objects) { this.scene.tweens.killTweensOf(o); o.destroy(); }
    this.objects = []; this.falls = []; this.rainbows = []; this.built = false;
  }
}

export const ISLAND_BOUNDS = { U0, V0, U1, V1, CLIFF } as const;

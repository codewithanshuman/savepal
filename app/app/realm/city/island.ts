/*
 * The island itself: a raised, box-shaped kingdom standing in the sea. The terrain pass lays the
 * top (grass, streets, plazas) with a square coast; this module adds what makes it a landmass --
 * layered earth cliffs on the near sides, sandy beaches on the far shores, two waterfalls with their
 * streams, foam and mist, surf breaking along the cliff foot, a forest ring and drifting clouds.
 */
import Phaser from "phaser";
import { GROUND_DEPTH, SKY_DEPTH, projection } from "../reference-city/world/core/worldConstants";
import { setCoast } from "../reference-city/layouts/terrain";
import { CITY_SIZE } from "./layout";
import { Atelier, bakeAll, RES, type Asset } from "./textures/atelier";

/** A grass ring around the field, then the cliff edge. */
export const RINGS = 2;
setCoast({ countryside: RINGS, sand: 0, jitter: 0, square: true });

const U0 = -RINGS - .5, V0 = -RINGS - .5, U1 = CITY_SIZE.width - 1 + RINGS + .5, V1 = CITY_SIZE.height - 1 + RINGS + .5;
const CLIFF = 130;
/** Waterfalls: one on each near face, fed by a stream from a spring on the land. */
const FALLS: Array<{ face: "v" | "u"; at: number; spring: number }> = [{ face: "v", at: 4.2, spring: 2.6 }, { face: "u", at: 30.4, spring: 2.4 }];

const TREES: Record<string, Asset> = {
  oak: { key: "savepal:tree:oak", width: 90, height: 120, anchorY: 14 },
  pine: { key: "savepal:tree:pine", width: 80, height: 130, anchorY: 12 },
  birch: { key: "savepal:tree:birch", width: 80, height: 120, anchorY: 12 },
  cloud: { key: "savepal:cloud", width: 260, height: 120, anchorY: 60 },
};

const at = (gx: number, gy: number, z = 0) => { const p = projection.project(gx, gy); return { x: p.x, y: p.y - z }; };
const hash = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

function bakeIsland(scene: Phaser.Scene): void {
  bakeAll(scene, TREES, {
    oak: a => a.tree(0, 0, 1.25, 0x3a8a3c),
    pine: a => { const g = a.g, foot = a.at([0, 0, 0]); g.fillStyle(0x1c2e14, .22).fillEllipse(foot.x + 6, foot.y + 2, 30, 12); a.line(0x5a3a22, [[0, 0, 0], [0, 0, 14]], 4); for (let k = 0; k < 5; k++) { const p = a.at([0, 0, 14 + k * 16]); const w = 30 - k * 5; g.fillStyle(0x2c6b3a - k * 0x020202, 1).fillTriangle(p.x - w / 2, p.y + 6, p.x + w / 2, p.y + 6, p.x, p.y - 18); g.fillStyle(0x3f8a4a, .55).fillTriangle(p.x - w / 2, p.y + 6, p.x, p.y + 6, p.x, p.y - 18); } },
    birch: a => { const g = a.g, foot = a.at([0, 0, 0]); g.fillStyle(0x1c2e14, .2).fillEllipse(foot.x + 5, foot.y + 2, 24, 10); a.line(0xf4f1ea, [[0, 0, 0], [0, 0, 40]], 3.4); for (const z of [10, 22, 32]) { const p = a.at([0, 0, z]); g.fillStyle(0x3a3328, 1).fillRect(p.x - 1.6, p.y, 3.2, 1.6); } for (const [dx, dz, r, c] of [[-8, 44, 12, 0x7fbf4a], [8, 46, 11, 0x8fd060], [0, 56, 13, 0x9bd86a]] as const) { const p = a.at([0, 0, dz]); g.fillStyle(c, 1).fillCircle(p.x + dx, p.y, r); } },
    cloud: a => { const g = a.g, o = a.at([0, 0, 0]); for (const [dx, dy, r, alpha] of [[-60, 8, 34, .9], [-20, -8, 44, .95], [30, 0, 40, .95], [70, 10, 28, .9], [0, 16, 46, .9]] as const) { g.fillStyle(0xffffff, alpha).fillCircle(o.x + dx, o.y + dy, r); } g.fillStyle(0xdfe9f3, .7).fillEllipse(o.x + 4, o.y + 34, 200, 26); },
  });
  if (!scene.textures.exists("savepal:mote")) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1).fillCircle(8, 8, 8); g.generateTexture("savepal:mote", 16, 16); g.destroy();
  }
}

type Fall = { g: Phaser.GameObjects.Graphics; a: { x: number; y: number }; b: { x: number; y: number }; seed: number };

export class Island {
  private objects: Phaser.GameObjects.GameObject[] = [];
  private falls: Fall[] = [];
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
    const sand = (pts: Array<{ x: number; y: number }>, c: number) => beach.fillStyle(c, 1).fillPoints(pts, true);
    const B = .55;
    sand([at(U0, V0), at(U1, V0), at(U1, V0 + B), at(U0 + B, V0 + B), at(U0 + B, V1), at(U0, V1)], 0xeedca9);
    sand([at(U0, V0), at(U1, V0), at(U1, V0 + .14), at(U0 + .14, V0 + .14), at(U0 + .14, V1), at(U0, V1)], 0xf6e8c2);
    // the near cliffs: turf lip, soil, then bands of rock down to the sea
    const cliff = add(this.scene.add.graphics().setDepth(GROUND_DEPTH + 4));
    const face = (a: { x: number; y: number }, b: { x: number; y: number }, lit: boolean) => {
      const bands: Array<[number, number, number]> = [[0, 10, lit ? 0x5fa840 : 0x4f8f36], [10, 46, lit ? 0x8a6340 : 0x6e4c30], [46, 78, lit ? 0x9b8a72 : 0x7a6c58], [78, 104, lit ? 0x887965 : 0x6b5f4e], [104, CLIFF, lit ? 0x6f6353 : 0x574d41]];
      for (const [z0, z1, c] of bands) cliff.fillStyle(c, 1).fillPoints([{ x: a.x, y: a.y + z0 }, { x: b.x, y: b.y + z0 }, { x: b.x, y: b.y + z1 }, { x: a.x, y: a.y + z1 }], true);
      // cracks, stones and roots for texture
      const n = Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 26);
      for (let i = 0; i < n; i++) {
        const t = (i + hash(i, lit ? 3 : 7)) / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        cliff.lineStyle(1.2, 0x3e352c, .55).beginPath().moveTo(x, y + 50 + hash(i, 1) * 14).lineTo(x + 3, y + 70 + hash(i, 2) * 20).lineTo(x - 2, y + 92 + hash(i, 4) * 18).strokePath();
        cliff.fillStyle(0xb8a88e, .7).fillEllipse(x + 8, y + 58 + hash(i, 5) * 40, 7, 4);
        if (hash(i, 9) > .6) cliff.lineStyle(1, 0x4a3424, .7).beginPath().moveTo(x - 4, y + 12).lineTo(x - 6, y + 26).strokePath();
      }
      cliff.lineStyle(2, lit ? 0x8fd060 : 0x6fae49, 1).beginPath().moveTo(a.x, a.y + 1).lineTo(b.x, b.y + 1).strokePath();
    };
    face(at(U0, V1), at(U1, V1), true);
    face(at(U1, V1), at(U1, V0), false);
    // surf breaking along the cliff foot
    const surf = add(this.scene.add.graphics().setDepth(GROUND_DEPTH + 3.5));
    const surfLine = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const n = 60;
      for (let w = 0; w < 2; w++) {
        surf.lineStyle(w ? 2 : 4, 0xffffff, w ? .5 : .75).beginPath();
        for (let i = 0; i <= n; i++) { const t = i / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t + CLIFF + 4 + w * 9 + Math.sin(i * 1.3 + w) * 2.5; if (i === 0) surf.moveTo(x, y); else surf.lineTo(x, y); }
        surf.strokePath();
      }
    };
    surfLine(at(U0, V1), at(U1, V1)); surfLine(at(U1, V1), at(U1, V0));
    if (!this.still) this.scene.tweens.add({ targets: surf, alpha: .45, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    // the waterfalls and their streams: a channel across the land that widens to the cliff edge,
    // then falling water drawn on the cliff face itself (redrawn each frame in update())
    for (const f of FALLS) {
      const along = (t: number, w: number) => f.face === "v" ? at(f.at + w, V1 - f.spring * (1 - t)) : at(U1 - f.spring * (1 - t), f.at + w);
      const stream = add(this.scene.add.graphics().setDepth(GROUND_DEPTH + 5));
      const steps = 10, bank: Array<{ x: number; y: number }> = [], water: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= steps; i++) { const t = i / steps, w = .26 + t * .26; bank.push(along(t, -w - .08)); water.push(along(t, -w)); }
      for (let i = steps; i >= 0; i--) { const t = i / steps, w = .26 + t * .26; bank.push(along(t, w + .08)); water.push(along(t, w)); }
      stream.fillStyle(0x7b6a4e, 1).fillPoints(bank, true).fillStyle(0x3f9fd8, 1).fillPoints(water, true);
      for (let i = 1; i < steps; i++) { const t = i / steps, p = along(t, Math.sin(i * 1.7) * .12); stream.fillStyle(0xd8f0ff, .7).fillEllipse(p.x, p.y, 10, 2.2); }
      const pool = along(0, 0);
      stream.fillStyle(0x7b6a4e, 1).fillEllipse(pool.x, pool.y + 2, 84, 38).fillStyle(0x3f9fd8, 1).fillEllipse(pool.x, pool.y, 74, 31).fillStyle(0x6fc0ef, .8).fillEllipse(pool.x - 8, pool.y - 4, 34, 10);
      for (const [du, dv] of [[-.62, -.32], [.6, -.24], [-.5, .42], [.45, .4]] as const) { const r = f.face === "v" ? at(f.at + du, V1 - f.spring + dv) : at(U1 - f.spring + dv, f.at + du); stream.fillStyle(0x8f877a, 1).fillEllipse(r.x, r.y + 1, 18, 10).fillStyle(0xb8b0a2, 1).fillEllipse(r.x - 2, r.y - 2, 12, 6); }
      const a = f.face === "v" ? at(f.at - .52, V1) : at(U1, f.at - .52), b = f.face === "v" ? at(f.at + .52, V1) : at(U1, f.at + .52);
      const g = add(this.scene.add.graphics().setDepth(GROUND_DEPTH + 6));
      this.falls.push({ g, a, b, seed: this.falls.length * 17 });
      this.drawFall(this.falls[this.falls.length - 1]!, 0);
      const foot = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + CLIFF + 8 };
      if (!this.still) {
        add(this.scene.add.particles(foot.x, foot.y, "savepal:mote", {
          x: { min: -34, max: 34 }, speedY: { min: -46, max: -16 }, speedX: { min: -14, max: 14 }, lifespan: 1700, scale: { start: .55, end: 1.5 }, alpha: { start: .55, end: 0 }, quantity: 2, frequency: 80, tint: 0xeaf6ff,
        }).setDepth(GROUND_DEPTH + 7));
      }
    }
    // the forest ring: our trees on the grass ring, thinning where the port's pier runs out
    for (let gy = Math.ceil(V0); gy <= Math.floor(V1); gy++) for (let gx = Math.ceil(U0); gx <= Math.floor(U1); gx++) {
      const inRing = gx < 0 || gy < 0 || gx > CITY_SIZE.width - 1 || gy > CITY_SIZE.height - 1;
      if (!inRing || skip(gx, gy) || hash(gx, gy) < .42) continue;
      if (FALLS.some(f => (f.face === "v" ? Math.abs(gx - f.at) < 1.2 && gy > CITY_SIZE.height - 1 : Math.abs(gy - f.at) < 1.2 && gx > CITY_SIZE.width - 1))) continue;
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
        const shadow = add(this.scene.add.ellipse(x + 40, y + 300, 220 * sc * RES, 50 * sc * RES, 0x14260f, .1).setDepth(SKY_DEPTH - 60));
        const drift = () => this.scene.tweens.add({ targets: [cloud, shadow], x: `+=${right - left}`, duration: 220000 + hash(i, 6) * 120000, onComplete: () => { cloud.x -= right - left + 600; shadow.x = cloud.x + 40; drift(); } });
        drift();
      }
    }
  }

  /** Falling water: a sheet on the cliff face with streaks sliding down, foam at the lip and a churning pool. */
  private drawFall(f: Fall, time: number): void {
    const { g, a, b } = f, H = CLIFF + 6, flow = time * .16;
    g.clear();
    g.fillStyle(0x2f86c4, .96).fillPoints([a, b, { x: b.x, y: b.y + H }, { x: a.x, y: a.y + H }], true);
    g.fillStyle(0x5fb6ea, .9).fillPoints([a, { x: a.x + (b.x - a.x) * .55, y: a.y + (b.y - a.y) * .55 }, { x: a.x + (b.x - a.x) * .55, y: a.y + (b.y - a.y) * .55 + H }, { x: a.x, y: a.y + H }], true);
    for (let k = 0; k < 11; k++) {
      const t = (k + .5) / 11, x = a.x + (b.x - a.x) * t, y0 = a.y + (b.y - a.y) * t, len = 12 + (k % 3) * 5;
      for (let off = ((flow + k * 23 + f.seed) % 34) - 34; off < H; off += 34) {
        const y = y0 + Math.max(0, off), y2 = Math.min(y0 + H, y0 + off + len);
        if (y2 > y) g.lineStyle(k % 2 ? 1.6 : 2.4, 0xffffff, k % 2 ? .45 : .7).beginPath().moveTo(x, y).lineTo(x, y2).strokePath();
      }
    }
    // foam curling over the lip, and the churning pool at the foot
    g.lineStyle(5, 0xffffff, .9).beginPath().moveTo(a.x, a.y + 2).lineTo(b.x, b.y + 2).strokePath();
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + H, w = Math.abs(b.x - a.x) + 30, pulse = Math.sin(time / 180) * 3;
    g.fillStyle(0xffffff, .85).fillEllipse(mx, my + 4, w + pulse * 2, 18 + pulse);
    g.fillStyle(0xd8f0ff, .7).fillEllipse(mx - 10, my + 10, w * .6, 10).fillEllipse(mx + 14, my + 12, w * .45, 8);
  }

  update(time: number): void {
    if (this.still) return;
    for (const f of this.falls) this.drawFall(f, time);
  }

  destroy(): void {
    for (const o of this.objects) { this.scene.tweens.killTweensOf(o); o.destroy(); }
    this.objects = []; this.falls = []; this.built = false;
  }
}

export const ISLAND_BOUNDS = { U0, V0, U1, V1, CLIFF } as const;
void Atelier;

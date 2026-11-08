/*
 * Characters that move like game characters. Each person sprite is cut into a torso and two legs
 * (the cuts are measured by hand, so tools, capes and blades stay with the torso), then posed
 * every frame:
 *
 *   walk / march / carry   stepping legs driven by the distance walked (no sliding feet), with
 *                          the body's bob, sway and lean; soldiers march upright with a high knee
 *   hammer / mine / tend   work cycles that strike on a beat and throw chips, dust or leaves
 *   serve / guard / watch  the chef presents with steam off the cloche, guards stamp, archers scan
 *   sit / chat / cheer     the fisherman swings his legs off the dock, neighbours nod, and the
 *                          whole town jumps for joy when PayPal moves the money
 *
 * Turning is a quick squash through the middle, and every channel eases toward its pose so the
 * motion stays soft rather than snapping between keys.
 */
import Phaser from "phaser";
import { projection } from "../reference-city/world/core/worldConstants";

export const PEOPLE = ["architect", "miner", "carpenter", "gardener", "chef", "spearman", "swordsman", "archer"] as const;
export type Person = (typeof PEOPLE)[number];
export const personKey = (p: Person) => `savepal:person:${p}`;
export const personUrl = (p: Person) => `/realm/people/${p}.png`;
export const PERSON_SCALE = .27;

/** Where each sprite's legs are cut: the hip row, the column between the legs, the legs' outer
 *  bounds, and any box (the carpenter's hanging saw) that stays with the torso. Sprite pixels. */
type Cut = { cut: number; split: number; x0: number; x1: number; keep?: readonly [number, number, number, number] };
const CUTS: Record<Person, Cut> = {
  architect: { cut: 124, split: 39, x0: 13, x1: 72 },
  miner: { cut: 142, split: 45, x0: 19, x1: 83 },
  carpenter: { cut: 142, split: 41, x0: 21, x1: 74, keep: [0, 142, 26, 154] },
  gardener: { cut: 142, split: 36, x0: 10, x1: 71 },
  chef: { cut: 147, split: 41, x0: 13, x1: 73 },
  spearman: { cut: 139, split: 50, x0: 24, x1: 81 },
  swordsman: { cut: 154, split: 56, x0: 24, x1: 84 },
  archer: { cut: 147, split: 48, x0: 16, x1: 86 },
};
/** Rows of thigh left on the torso, so the hip joint never opens as the legs swing. */
const OVERLAP = 6;
/** Tiles covered by one step. */
const STRIDE = .3;

export const STILL = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function put(scene: Phaser.Scene, key: string, data: ImageData): void {
  const tex = scene.textures.createCanvas(key, data.width, data.height);
  if (!tex) return;
  tex.context.putImageData(data, 0, 0);
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
}

/** Cuts one person's sprite into torso and legs (once per game). False if the sprite is missing. */
function slice(scene: Phaser.Scene, who: Person): boolean {
  const key = personKey(who);
  if (scene.textures.exists(`${key}:torso`)) return true;
  if (!scene.textures.exists(key) || typeof document === "undefined") return false;
  const img = scene.textures.get(key).getSourceImage() as HTMLImageElement;
  const w = img.width, h = img.height, c = CUTS[who];
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0);
  const src = ctx.getImageData(0, 0, w, h);
  const torso = new ImageData(new Uint8ClampedArray(src.data), w, h);
  const kept = (x: number, y: number) => !!c.keep && x >= c.keep[0] && y >= c.keep[1] && x < c.keep[2] && y < c.keep[3];
  const leg = (a: number, b: number, name: string) => {
    const lw = b - a, lh = h - c.cut, out = new ImageData(lw, lh);
    for (let y = c.cut; y < h; y++) for (let x = a; x < b; x++) {
      if (kept(x, y)) continue;
      const i = (y * w + x) * 4, o = ((y - c.cut) * lw + (x - a)) * 4;
      out.data[o] = src.data[i]!; out.data[o + 1] = src.data[i + 1]!; out.data[o + 2] = src.data[i + 2]!; out.data[o + 3] = src.data[i + 3]!;
      if (y >= c.cut + OVERLAP) torso.data[i + 3] = 0;
    }
    put(scene, `${key}:${name}`, out);
  };
  // each leg reaches one column past the split, so no sliver opens between them mid-stride
  leg(c.x0, c.split + 1, "legL");
  leg(c.split - 1, c.x1, "legR");
  put(scene, `${key}:torso`, torso);
  return true;
}

/** Soft and hard particles shared by the whole kingdom: puffs (dust, smoke, steam, mist), chips and glints. */
export function bakeFx(scene: Phaser.Scene): void {
  const make = (key: string, size: number, draw: (g: CanvasRenderingContext2D) => void) => {
    if (scene.textures.exists(key)) return;
    const t = scene.textures.createCanvas(key, size, size);
    if (!t) return;
    draw(t.context); t.refresh(); t.setFilter(Phaser.Textures.FilterMode.LINEAR);
  };
  make("savepal:puff", 64, g => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(.4, "rgba(255,255,255,.6)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  });
  // a soft ground shadow for people and creatures: a texture, so it batches with the sprites
  make("savepal:shadow", 64, g => {
    g.save(); g.translate(32, 32); g.scale(1, .32);
    const r = g.createRadialGradient(0, 0, 0, 0, 0, 30);
    r.addColorStop(0, "rgba(29,43,22,.95)"); r.addColorStop(.6, "rgba(29,43,22,.75)"); r.addColorStop(1, "rgba(29,43,22,0)");
    g.fillStyle = r; g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.fill(); g.restore();
  });
  make("savepal:chip", 12, g => { g.fillStyle = "#fff"; g.beginPath(); g.moveTo(2, 3); g.lineTo(10, 1); g.lineTo(11, 8); g.lineTo(4, 11); g.closePath(); g.fill(); });
  make("savepal:glint", 32, g => {
    const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(.25, "rgba(255,255,255,.5)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 32, 32);
    g.fillStyle = "rgba(255,255,255,.95)";
    g.beginPath(); g.moveTo(16, 1); g.lineTo(18, 14); g.lineTo(31, 16); g.lineTo(18, 18); g.lineTo(16, 31); g.lineTo(14, 18); g.lineTo(1, 16); g.lineTo(14, 14); g.closePath(); g.fill();
  });
}

export type FxKind = "chips" | "stone" | "dust" | "leaf" | "steam" | "sparks" | "splash";
type EmitterConfig = Phaser.Types.GameObjects.Particles.ParticleEmitterConfig;
const FX: Record<FxKind, { texture: string; count: number; config: EmitterConfig }> = {
  chips: { texture: "savepal:chip", count: 6, config: { speed: { min: 30, max: 90 }, angle: { min: 205, max: 335 }, gravityY: 320, lifespan: 650, scale: { start: .55, end: .25 }, rotate: { min: 0, max: 360 }, tint: [0xd8b07a, 0xb07a44, 0xf0d6a4] } },
  stone: { texture: "savepal:chip", count: 6, config: { speed: { min: 35, max: 95 }, angle: { min: 210, max: 330 }, gravityY: 340, lifespan: 600, scale: { start: .5, end: .2 }, rotate: { min: 0, max: 360 }, tint: [0x9b958a, 0xc9c2b4, 0x7d776c] } },
  dust: { texture: "savepal:puff", count: 4, config: { speed: { min: 6, max: 26 }, angle: { min: 190, max: 350 }, lifespan: 800, scale: { start: .12, end: .42 }, alpha: { start: .55, end: 0 }, tint: 0xe2d4b4 } },
  leaf: { texture: "savepal:chip", count: 3, config: { speed: { min: 20, max: 55 }, angle: { min: 220, max: 320 }, gravityY: 160, lifespan: 750, scale: { start: .5, end: .3 }, rotate: { min: 0, max: 360 }, tint: [0x5fae4a, 0x3f8a3f, 0xd94a5a] } },
  steam: { texture: "savepal:puff", count: 1, config: { speedY: { min: -26, max: -16 }, speedX: { min: -5, max: 5 }, lifespan: 1500, scale: { start: .1, end: .38 }, alpha: { start: .65, end: 0 }, tint: 0xffffff } },
  sparks: { texture: "savepal:spark", count: 7, config: { speed: { min: 50, max: 130 }, angle: { min: 200, max: 340 }, gravityY: 260, lifespan: 420, scale: { start: .26, end: 0 }, tint: [0xffe08a, 0xff9a3c], blendMode: "ADD" } },
  splash: { texture: "savepal:spark", count: 8, config: { speed: { min: 30, max: 80 }, angle: { min: 220, max: 320 }, gravityY: 260, lifespan: 650, scale: { start: .22, end: .05 }, alpha: { start: .95, end: 0 }, tint: [0xffffff, 0xd8f0ff, 0x9fd4f5] } },
};

/** One emitter per kind of effect, borrowed by whoever strikes, digs, steams or splashes. */
export class Effects {
  private readonly emitters = new Map<FxKind, Phaser.GameObjects.Particles.ParticleEmitter>();
  constructor(private readonly scene: Phaser.Scene) {}
  emit(kind: FxKind, x: number, y: number, depth: number, count?: number): void {
    if (STILL) return;
    let e = this.emitters.get(kind);
    if (!e) {
      const f = FX[kind];
      e = this.scene.add.particles(0, 0, f.texture, { ...f.config, emitting: false });
      this.emitters.set(kind, e);
    }
    e.setDepth(depth).emitParticleAt(x, y, count ?? FX[kind].count);
  }
  destroy(): void { for (const e of this.emitters.values()) e.destroy(); this.emitters.clear(); }
}

export type Pose = "idle" | "walk" | "march" | "carry" | "hammer" | "mine" | "tend" | "serve" | "guard" | "watch" | "sit" | "chat" | "cheer";
const ease = (t: number) => t * t * (3 - 2 * t);

/** A posable person in the world, standing at grid (u, v), z pixels up. */
export class Figure {
  readonly root: Phaser.GameObjects.Container;
  private readonly torso: Phaser.GameObjects.Image;
  private readonly legL: Phaser.GameObjects.Image;
  private readonly legR: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Image;
  private prop?: Phaser.GameObjects.Image;
  private readonly hipX: number;
  private readonly hipY: number;
  private readonly h: number;
  private readonly shadowW: number;
  u = 0; v = 0; z = 0;
  depthBias = 2;
  pose: Pose = "idle";
  /** Idle figures now and then turn to look the other way. */
  fidget = false;
  /** What a work beat throws: wood chips for the carpenter, stone and dust for the miner... */
  workFx: FxKind | null = null;
  private facing = 1;
  private turn = 1;
  private placed = false;
  private phase = Math.random() * Math.PI * 2;
  private clock = Math.random() * 9000;
  private beat = -1;
  private fidgetAt = 2000 + Math.random() * 6000;
  private cheerUntil = 0;
  private readonly cur = { tr: 0, ty: 0, tsy: 1, lr: 0, rr: 0, ly: 0, ry: 0, lsy: 1, jump: 0 };

  constructor(private readonly scene: Phaser.Scene, readonly who: Person, private readonly fx?: Effects, readonly scale = PERSON_SCALE) {
    const key = personKey(who), sliced = slice(scene, who), c = CUTS[who];
    const src = scene.textures.get(key).getSourceImage() as { width: number; height: number };
    const w = src.width || 96, h = src.height || 176;
    this.h = h;
    this.shadowW = w * .74;
    this.hipX = c.split - w / 2; this.hipY = c.cut - h;
    this.shadow = scene.add.image(this.hipX, -1, "savepal:shadow").setDisplaySize(w * .74, w * .74).setAlpha(.34);
    if (sliced) {
      const lw = c.split + 1 - c.x0, rw = c.x1 - (c.split - 1);
      this.legL = scene.add.image(c.x0 + lw / 2 - w / 2, this.hipY, `${key}:legL`).setOrigin(.5, 0);
      this.legR = scene.add.image(c.split - 1 + rw / 2 - w / 2, this.hipY, `${key}:legR`).setOrigin(.5, 0);
      this.torso = scene.add.image(this.hipX, this.hipY, `${key}:torso`).setOrigin(c.split / w, c.cut / h);
    } else {
      // no sprite to cut: show the whole figure and let it bob
      this.legL = scene.add.image(0, 0, key).setVisible(false);
      this.legR = scene.add.image(0, 0, key).setVisible(false);
      this.torso = scene.add.image(this.hipX, this.hipY, key).setOrigin(c.split / w, c.cut / h);
    }
    this.root = scene.add.container(0, 0, [this.shadow, this.legL, this.legR, this.torso]).setScale(scale);
  }

  /** Stands the figure at (u, v, z). Moving it advances the stride and turns it the way it walks. */
  place(u: number, v: number, z = 0): this {
    if (this.placed) {
      const du = u - this.u, dv = v - this.v, moved = Math.hypot(du, dv);
      if (moved > 0 && moved < 1.5) {
        // a bigger figure takes longer strides
        this.phase += moved / (STRIDE * this.scale / PERSON_SCALE) * Math.PI;
        const sx = du - dv;
        if (Math.abs(sx) > moved * .2) this.facing = sx > 0 ? 1 : -1;
      }
    }
    this.placed = true;
    this.u = u; this.v = v; this.z = z;
    const p = projection.project(u, v);
    this.root.setPosition(p.x, p.y - z).setDepth(projection.depth(u, v) + this.depthBias);
    return this;
  }

  /** Faces right (1) or left (-1) on screen. */
  look(dir: number): this { if (dir) this.facing = dir > 0 ? 1 : -1; return this; }
  get facingDir(): number { return this.facing; }
  setPose(pose: Pose): this { this.pose = pose; return this; }
  cheer(ms = 3200): void { this.cheerUntil = this.scene.time.now + ms * (.8 + Math.random() * .4); }
  /** Something carried overhead (a crate, a sack), or nothing. */
  carry(texture: string | null, size = 54): void {
    if (!texture) { this.prop?.setVisible(false); return; }
    if (!this.prop) { this.prop = this.scene.add.image(this.hipX, -this.h - 2, texture).setOrigin(.5, 1); this.root.add(this.prop); }
    const src = this.scene.textures.get(texture).getSourceImage() as { width: number };
    this.prop.setTexture(texture).setVisible(true).setScale(size / (src.width || size));
  }
  get carrying(): boolean { return !!this.prop?.visible; }
  /** Top of the head in world pixels, for bubbles and tags. */
  get headY(): number { return this.root.y - this.h * this.scale; }
  setVisible(on: boolean): this { this.root.setVisible(on); return this; }

  /** Poses the figure for this frame. */
  update(dt: number): void {
    if (STILL) { this.root.setScale(this.scale * this.facing, this.scale); return; }
    this.clock += dt;
    const now = this.scene.time.now, pose: Pose = now < this.cheerUntil ? "cheer" : this.pose;
    // a turn is a quick squash through the middle
    if (this.turn !== this.facing) this.turn = Phaser.Math.Clamp(this.turn + Math.sign(this.facing - this.turn) * dt / 65, -1, 1);
    const flip = Math.abs(this.turn) < .25 ? .25 * (Math.sign(this.turn) || this.facing) : this.turn;
    this.root.setScale(this.scale * flip, this.scale);
    let tr = 0, ty = 0, tsy = 1, lr = 0, rr = 0, ly = 0, ry = 0, lsy = 1, jump = 0, snap = false;
    const cycle = (ms: number) => { const n = Math.floor(this.clock / ms); return { t: (this.clock % ms) / ms, n }; };
    /** Fires a work beat's effects once per cycle, dx/dy from the hips in sprite pixels. */
    const strike = (n: number, kinds: Array<FxKind | null>, dx: number, dy: number) => {
      if (this.beat === n || !this.fx) return;
      this.beat = n;
      const s = this.scale, f = this.facing;
      for (const kind of kinds) if (kind) this.fx.emit(kind, this.root.x + (this.hipX + dx) * s * f, this.root.y + dy * s, this.root.depth + 1);
    };
    switch (pose) {
      case "walk": case "march": case "carry": {
        const s = Math.sin(this.phase), c = Math.cos(this.phase);
        const A = pose === "march" ? .34 : pose === "carry" ? .2 : .26, lift = pose === "march" ? 5 : 3.2;
        const bob = pose === "march" ? 1.4 : pose === "carry" ? 1.1 : 2.1;
        lr = -A * s; rr = A * s;
        ly = -lift * Math.max(0, c) - bob * Math.abs(c) * .5;
        ry = -lift * Math.max(0, -c) - bob * Math.abs(c) * .5;
        ty = -bob * Math.abs(c);
        tr = (pose === "march" ? 0 : pose === "carry" ? .02 : .05) + .028 * s;
        snap = true;
        break;
      }
      case "hammer": {
        const { t, n } = cycle(760);
        tr = t < .12 ? ease(t / .12) * .2 : t < .25 ? .2 : t < .7 ? .2 * (1 - ease((t - .25) / .45)) : 0;
        tsy = t > .1 && t < .22 ? .96 : 1;
        if (t >= .12) strike(n, [this.workFx ?? "chips"], 30, -58);
        break;
      }
      case "mine": {
        const { t, n } = cycle(1150);
        tr = t < .42 ? -.13 * ease(t / .42) : t < .5 ? -.13 + .4 * ((t - .42) / .08) : t < .9 ? .27 * (1 - ease((t - .5) / .4)) : 0;
        tsy = t > .48 && t < .58 ? .95 : 1;
        if (t >= .5) strike(n, [this.workFx ?? "stone", "dust"], 40, -4);
        break;
      }
      case "tend": {
        const { t, n } = cycle(700);
        const long = (this.clock % 4200) / 4200;
        const bend = long < .12 ? ease(long / .12) : long < .74 ? 1 : long < .86 ? 1 - ease((long - .74) / .12) : 0;
        tr = bend * (.24 + .04 * Math.sin(this.clock * .011)); tsy = 1 - bend * .05;
        if (bend > .9 && t > .5) strike(n, [this.workFx ?? "leaf"], 34, -10);
        break;
      }
      case "serve": {
        const { t, n } = cycle(2600);
        const lift = t < .15 ? ease(t / .15) : t < .4 ? 1 - ease((t - .15) / .25) : 0;
        ty = -2.5 * lift; tr = -.04 * lift; tsy = 1 + .012 * Math.sin(this.clock * .0024);
        // steam rises off the cloche in the chef's raised hand
        if (t >= .05) strike(n, ["steam"], 31 - this.hipX, -128);
        break;
      }
      case "guard": {
        const { t, n } = cycle(7000);
        ty = t < .03 ? 1.6 : 0; tsy = 1 + .01 * Math.sin(this.clock * .002);
        if (t < .03) strike(n, ["dust"], -32, -1);
        break;
      }
      case "watch": {
        const { t } = cycle(6200);
        tr = t > .5 && t < .7 ? -.08 * Math.sin((t - .5) / .2 * Math.PI) : 0; tsy = 1 + .01 * Math.sin(this.clock * .0021);
        if (now > this.fidgetAt) { this.fidgetAt = now + 4000 + Math.random() * 5000; this.facing = -this.facing; }
        break;
      }
      case "sit": {
        // the hips rest on the seat (the figure's own point); the legs, foreshortened as they come
        // toward us over the edge, hang down and swing
        ty = -this.hipY; ly = -this.hipY - 2; ry = -this.hipY - 2; lsy = .62;
        lr = .2 * Math.sin(this.clock * .0028); rr = .2 * Math.sin(this.clock * .0028 + 1.7);
        tsy = 1 + .01 * Math.sin(this.clock * .002);
        break;
      }
      case "chat": {
        const { t } = cycle(1100);
        tr = t < .15 ? .05 * Math.sin(t / .15 * Math.PI) : 0; tsy = 1 + .012 * Math.sin(this.clock * .0024);
        break;
      }
      case "cheer": {
        const { t } = cycle(520);
        const air = Math.sin(Math.PI * t);
        jump = -12 * air; lr = -.16 * air; rr = .16 * air; tr = .06 * Math.sin(this.clock * .02);
        tsy = t < .08 || t > .92 ? .93 : 1.03; snap = true;
        break;
      }
      default: {
        tsy = 1 + .014 * Math.sin(this.clock * .0024);
        if (this.fidget && now > this.fidgetAt) { this.fidgetAt = now + 3500 + Math.random() * 6500; this.facing = -this.facing; }
      }
    }
    // ease every channel toward its pose (strides follow closely, everything else softly)
    const k = 1 - Math.exp(-dt / (snap ? 28 : 55)), c = this.cur;
    c.tr += (tr - c.tr) * k; c.ty += (ty - c.ty) * k; c.tsy += (tsy - c.tsy) * k;
    c.lr += (lr - c.lr) * k; c.rr += (rr - c.rr) * k; c.ly += (ly - c.ly) * k; c.ry += (ry - c.ry) * k; c.lsy += (lsy - c.lsy) * k; c.jump += (jump - c.jump) * k;
    this.torso.setRotation(c.tr).setY(this.hipY + c.ty + c.jump).setScale(1, c.tsy);
    this.legL.setRotation(c.lr).setY(this.hipY + c.ly + c.jump).setScale(1, c.lsy);
    this.legR.setRotation(c.rr).setY(this.hipY + c.ry + c.jump).setScale(1, c.lsy);
    this.prop?.setY(-this.h - 2 + c.ty + c.jump);
    this.shadow.setVisible(pose !== "sit").setDisplaySize(this.shadowW * (1 + c.jump / 40), this.shadowW * (1 + c.jump / 40));
  }

  /** A flat, see-through silhouette of the figure (the walker's outline seen through buildings). */
  silhouette(color: number, alpha: number): this {
    for (const img of [this.torso, this.legL, this.legR]) img.setTintFill(color);
    this.shadow.setVisible(false);
    this.root.setAlpha(alpha);
    return this;
  }
  /** Strikes exactly the pose another figure of the same person is in. */
  copyPose(src: Figure): void {
    this.root.setPosition(src.root.x, src.root.y).setScale(src.root.scaleX, src.root.scaleY);
    const pairs: Array<[Phaser.GameObjects.Image, Phaser.GameObjects.Image]> = [[this.torso, src.torso], [this.legL, src.legL], [this.legR, src.legR]];
    for (const [a, b] of pairs) a.setPosition(b.x, b.y).setRotation(b.rotation).setScale(b.scaleX, b.scaleY);
  }

  destroy(): void { this.scene.tweens.killTweensOf(this.root); this.root.destroy(); }
}

/** A troupe of figures, some standing at their posts and some on their rounds, updated together. */
export class Cast {
  figs: Figure[] = [];
  private roamers: Roamer[] = [];
  private loose: Figure[] = [];
  add(f: Figure, plan?: RoamPlan): Figure {
    this.figs.push(f);
    if (plan) this.roamers.push(new Roamer(f, plan)); else this.loose.push(f);
    return f;
  }
  update(dt: number): void { for (const r of this.roamers) r.update(dt); for (const f of this.loose) f.update(dt); }
  cheer(): void { for (const f of this.figs) f.cheer(); }
  clear(): void { for (const f of this.figs) f.destroy(); this.figs = []; this.roamers = []; this.loose = []; }
}

/** A stop on a figure's round: where to stand, how, for how long, facing which way, carrying what. */
export type Spot = { u: number; v: number; z?: number; pose?: Pose; ms?: number; look?: number; carry?: string | null };
export type RoamPlan = {
  /** Visited in order, round and round. */
  spots?: Spot[];
  /** Or anywhere inside this rectangle. */
  area?: { u0: number; v0: number; u1: number; v1: number; z?: number };
  speed?: number; walk?: Pose; work?: Pose; wait?: [number, number];
};

/** Walks a figure from stop to stop, striking a pose at each: a gardener down the berry rows, the
 *  knight on his rounds, shoppers along the stalls, the dockhand with his crates. */
export class Roamer {
  private i = -1;
  private target: Spot | null = null;
  private wait: number;
  constructor(readonly fig: Figure, private readonly plan: RoamPlan) {
    this.wait = 300 + Math.random() * 2600;
    fig.setPose(plan.work ?? "idle");
  }
  update(dt: number): void {
    const f = this.fig;
    if (!STILL) {
      if (this.wait > 0) { this.wait -= dt; if (this.wait <= 0) this.depart(); }
      else if (this.target) {
        const t = this.target, du = t.u - f.u, dv = t.v - f.v, d = Math.hypot(du, dv), step = (this.plan.speed ?? .7) * dt / 1000;
        if (d <= step) { f.place(t.u, t.v, t.z ?? f.z); this.arrive(t); }
        else f.place(f.u + du / d * step, f.v + dv / d * step, t.z ?? f.z);
      }
    }
    f.update(dt);
  }
  private depart(): void {
    const p = this.plan;
    if (p.spots?.length) { this.i = (this.i + 1) % p.spots.length; this.target = p.spots[this.i]!; }
    else if (p.area) { const a = p.area; this.target = { u: a.u0 + Math.random() * (a.u1 - a.u0), v: a.v0 + Math.random() * (a.v1 - a.v0), z: a.z }; }
    else { this.wait = Number.POSITIVE_INFINITY; return; }
    this.fig.setPose(this.fig.carrying ? "carry" : (p.walk ?? "walk"));
  }
  private arrive(t: Spot): void {
    const p = this.plan;
    if (t.carry !== undefined) this.fig.carry(t.carry);
    this.fig.setPose(t.pose ?? p.work ?? "idle");
    if (t.look) this.fig.look(t.look);
    const [a, b] = p.wait ?? [1500, 4000];
    this.wait = t.ms ?? a + Math.random() * (b - a);
    this.target = null;
  }
}

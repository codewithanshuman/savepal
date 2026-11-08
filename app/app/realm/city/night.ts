/*
 * Day and night. In "auto" the kingdom keeps the viewer's own clock: a golden dusk from six, night
 * from half past seven, dawn from half past five. As night falls a moonlit blue settles over
 * everything; every window with a room behind it lights up (each structure's own light map, see
 * bakeLights), lamps throw pools of light on the paving, townsfolk carry lanterns, the lighthouse
 * sweeps its beam across the sea, fireflies drift over the gardens and starlight glints on the
 * water (folk.ts). The viewer can also hold it at day or night.
 *
 * The darkness is one multiplied layer over the whole view; the lights draw above it, added.
 * Name plates, reward bubbles and fireworks sit above both, so they read the same at any hour.
 */
import Phaser from "phaser";
import { SKY_DEPTH, projection } from "../reference-city/world/core/worldConstants";
import { LAMPS, LIGHTS, LIGHT_RES, RES, bakeLights, type Asset, type Atelier } from "./textures/atelier";
import { mixColor } from "./island";
import type { Figure } from "./rig";

export type SkyMode = "auto" | "day" | "night";
/** The darkness; the lights draw just above it. */
export const NIGHT_DEPTH = SKY_DEPTH + 30;
const DUSK = 0xffc49a, MOON = 0x5e6cb0;

/** A structure that lights up: its day sprite, how it was drawn, and its centre on the grid. */
export type Lit = { sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image; asset: Asset; builder: (a: Atelier) => void; u: number; v: number };

/** How dark it is by the clock: 0 by day, 1 at night, easing through dusk and dawn. */
export function clockNight(d = new Date()): number {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 7 && h < 18) return 0;
  if (h >= 18 && h < 19.5) return (h - 18) / 1.5;
  if (h >= 5.5 && h < 7) return 1 - (h - 5.5) / 1.5;
  return 1;
}

const at = (u: number, v: number, z = 0) => { const p = projection.project(u, v); return { x: p.x, y: p.y - z }; };

export class Nightfall {
  mode: SkyMode = "auto";
  /** How dark it is now: 0 day, 1 night. */
  k = 0;
  private target = 0;
  private clockAt = 0;
  /** The first frame takes the sky as it is; later changes ease in. */
  private settled = false;
  private overlay: Phaser.GameObjects.Rectangle;
  private lit: Lit[] = [];
  private queue: Lit[] = [];
  private windows = new Map<Lit, Phaser.GameObjects.Image>();
  private halos: Array<{ img: Phaser.GameObjects.Image; base: number; seed: number }> = [];
  private lanterns: Array<{ fig: Figure; glow: Phaser.GameObjects.Image; core: Phaser.GameObjects.Image }> = [];
  private flies: Array<{ img: Phaser.GameObjects.Image; u: number; v: number; z: number; tu: number; tv: number; area: { u0: number; v0: number; u1: number; v1: number }; seed: number }> = [];
  private beam?: { g: Phaser.GameObjects.Graphics; glow: Phaser.GameObjects.Image; u: number; v: number; z: number };
  private readonly still = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private readonly scene: Phaser.Scene) {
    this.overlay = scene.add.rectangle(0, 0, 100, 100, 0xffffff).setScrollFactor(0).setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(NIGHT_DEPTH).setVisible(false);
  }

  setMode(mode: SkyMode): void { this.mode = mode; this.clockAt = 0; }

  /** The structures whose windows and lamps light up after dark. Light maps bake when first needed. */
  setLit(list: Lit[]): void {
    for (const [l, img] of this.windows) if (!list.some(x => x.sprite === l.sprite && x.asset.key === l.asset.key)) { img.destroy(); this.windows.delete(l); }
    this.lit = list;
    this.queue = list.filter(l => ![...this.windows.keys()].some(w => w.sprite === l.sprite && w.asset.key === l.asset.key));
    for (const h of this.halos) h.img.destroy();
    this.halos = [];
    for (const l of list) for (const [u, v, h] of LAMPS[l.asset.key] ?? []) {
      const lamp = at(l.u + u, l.v + v, h + 4), foot = at(l.u + u, l.v + v);
      this.halo(lamp.x, lamp.y, .5, 0xffd27a, .9);
      this.halo(foot.x, foot.y, 1, 0xffb060, .45).setScale(1.25, .6);
    }
  }
  private halo(x: number, y: number, scale: number, tint: number, base: number): Phaser.GameObjects.Image {
    const img = this.scene.add.image(x, y, "savepal:puff").setScale(scale).setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(NIGHT_DEPTH + 1).setVisible(false);
    this.halos.push({ img, base, seed: Math.random() * 10 });
    return img;
  }

  /** Townsfolk who carry a lantern after dark. */
  setLanterns(figs: Figure[]): void {
    for (const l of this.lanterns) { l.glow.destroy(); l.core.destroy(); }
    this.lanterns = figs.map(fig => ({
      fig,
      glow: this.scene.add.image(0, 0, "savepal:puff").setTint(0xffc870).setScale(.42).setBlendMode(Phaser.BlendModes.ADD).setDepth(NIGHT_DEPTH + 1).setVisible(false),
      core: this.scene.add.image(0, 0, "savepal:glint").setTint(0xfff0c0).setScale(.14).setBlendMode(Phaser.BlendModes.ADD).setDepth(NIGHT_DEPTH + 1.1).setVisible(false),
    }));
  }

  /** Gardens where fireflies come out. */
  setGardens(areas: Array<{ u0: number; v0: number; u1: number; v1: number }>): void {
    for (const f of this.flies) f.img.destroy();
    this.flies = [];
    if (this.still) return;
    areas.forEach((area, i) => {
      for (let k = 0; k < 3; k++) {
        const u = area.u0 + Math.random() * (area.u1 - area.u0), v = area.v0 + Math.random() * (area.v1 - area.v0);
        const img = this.scene.add.image(0, 0, "savepal:glint").setTint(0xd8ff8a).setScale(.13).setBlendMode(Phaser.BlendModes.ADD).setDepth(NIGHT_DEPTH + 1).setVisible(false);
        this.flies.push({ img, u, v, z: 8, tu: u, tv: v, area, seed: i * 7 + k * 3.1 });
      }
    });
  }

  /** The lighthouse lamp, on the grid and pixels up. */
  setLighthouse(spot: { u: number; v: number; z: number } | null): void {
    if (this.beam) { this.beam.g.destroy(); this.beam.glow.destroy(); this.beam = undefined; }
    if (!spot) return;
    const p = at(spot.u, spot.v, spot.z);
    this.beam = {
      ...spot,
      g: this.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setDepth(NIGHT_DEPTH + 1),
      glow: this.scene.add.image(p.x, p.y, "savepal:puff").setTint(0xffe090).setScale(1.1).setBlendMode(Phaser.BlendModes.ADD).setDepth(NIGHT_DEPTH + 1.2).setVisible(false),
    };
  }

  update(time: number, dt: number): void {
    if (time > this.clockAt) { this.clockAt = time + 15000; this.target = this.mode === "day" ? 0 : this.mode === "night" ? 1 : clockNight(); }
    if (!this.settled) { this.settled = true; this.k = this.target; }
    const step = this.still ? 1 : Math.min(1, dt / 2400);
    this.k += Math.sign(this.target - this.k) * Math.min(Math.abs(this.target - this.k), step);
    const k = this.k, on = k > .01;
    // the darkness: golden at dusk, moonlit blue by night
    const cam = this.scene.cameras.main;
    this.overlay.setVisible(on);
    if (on) {
      this.overlay.setFillStyle(k < .5 ? mixColor(0xffffff, DUSK, k * 2) : mixColor(DUSK, MOON, (k - .5) * 2), 1)
        .setPosition(cam.width / 2, cam.height / 2).setScale(cam.width / 100 / cam.zoom * 1.04, cam.height / 100 / cam.zoom * 1.04);
      // bake one light map a frame until every lit structure has its windows
      const next = this.queue.shift();
      if (next) {
        bakeLights(this.scene, next.asset, next.builder);
        const s = next.sprite;
        this.windows.set(next, this.scene.add.image(s.x, s.y, next.asset.key + LIGHTS).setOrigin(s.originX, s.originY).setScale(s.scaleX * RES / LIGHT_RES).setBlendMode(Phaser.BlendModes.ADD).setDepth(NIGHT_DEPTH + 1));
      }
    }
    const lights = Math.max(0, (k - .35) / .65);
    for (const [l, img] of this.windows) img.setVisible(lights > 0).setAlpha(lights).setPosition(l.sprite.x, l.sprite.y);
    for (const h of this.halos) h.img.setVisible(lights > 0).setAlpha(lights * h.base * (.9 + .1 * Math.sin(time / 90 + h.seed * 3)));
    for (const l of this.lanterns) {
      const show = lights > 0 && l.fig.root.visible, f = l.fig, x = f.root.x + 7 * f.facingDir, y = f.root.y - 12;
      l.glow.setVisible(show).setPosition(x, y).setAlpha(lights * (.75 + .12 * Math.sin(time / 70 + x)));
      l.core.setVisible(show).setPosition(x, y).setAlpha(lights);
    }
    for (const fl of this.flies) {
      if (lights <= 0) { fl.img.setVisible(false); continue; }
      const du = fl.tu - fl.u, dv = fl.tv - fl.v, d = Math.hypot(du, dv), sp = .35 * dt / 1000;
      if (d <= sp) { fl.tu = fl.area.u0 + Math.random() * (fl.area.u1 - fl.area.u0); fl.tv = fl.area.v0 + Math.random() * (fl.area.v1 - fl.area.v0); }
      else { fl.u += du / d * sp; fl.v += dv / d * sp; }
      const p = at(fl.u, fl.v, 8 + Math.sin(time / 500 + fl.seed) * 5), blink = Math.max(0, Math.sin(time / 380 + fl.seed));
      fl.img.setVisible(true).setPosition(p.x, p.y).setAlpha(lights * blink * blink);
    }
    if (this.beam) {
      const b = this.beam, g = b.g;
      g.clear();
      b.glow.setVisible(lights > 0).setAlpha(lights * (.85 + .15 * Math.sin(time / 120)));
      if (lights > 0) {
        // the beam sweeps to and fro across the open sea
        const th = Math.sin(time * .00045) * 1.25, L = 9, spread = .085;
        const tip = at(b.u, b.v, b.z);
        const reach = (w: number) => {
          const a = th + w, e = at(b.u + Math.cos(a) * L, b.v + Math.sin(a) * L, b.z);
          return e;
        };
        for (const [w, alpha] of [[spread * 1.8, .07], [spread, .12], [spread * .45, .2]] as const) {
          const l = reach(-w), r = reach(w);
          g.fillStyle(0xfff2c0, alpha * lights).fillTriangle(tip.x, tip.y, l.x, l.y, r.x, r.y);
        }
      }
    }
  }

  destroy(): void {
    this.overlay.destroy();
    for (const img of this.windows.values()) img.destroy();
    this.windows.clear();
    for (const h of this.halos) h.img.destroy();
    for (const l of this.lanterns) { l.glow.destroy(); l.core.destroy(); }
    for (const f of this.flies) f.img.destroy();
    if (this.beam) { this.beam.g.destroy(); this.beam.glow.destroy(); }
    this.halos = []; this.lanterns = []; this.flies = []; this.beam = undefined; this.lit = []; this.queue = [];
  }
}

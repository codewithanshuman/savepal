/*
 * Walk mode: enter the kingdom as your own character. The camera follows you down the streets;
 * arrow keys / WASD (or the on-screen pad) steer, buildings and the sea block the way, and
 * standing at a landmark's door offers to step inside -- which opens that place's court. Your
 * character is posed by the same rig as the townsfolk: real steps, kicked-up dust, a turn when
 * you change direction, and a cheer when PayPal moves the money.
 */
import Phaser from "phaser";
import { SKY_DEPTH, projection } from "../reference-city/world/core/worldConstants";
import { Figure, type Effects, type Person } from "./rig";

export type Entrance = { id: string; label: string; u: number; v: number };
type Options = {
  blocked(u: number, v: number): boolean;
  entrances(): Entrance[];
  onNear(entrance: Entrance | null): void;
  /** Buildings that can stand between the camera and the walker. */
  occluders(): Array<Phaser.GameObjects.Sprite | Phaser.GameObjects.Image>;
  depthBias: number;
};

const SPEED = 2.2; // tiles per second
const SCALE = .36;

export class WalkMode {
  active = false;
  private fig?: Figure;
  /** The walker's gold outline, shown through any building that hides them. */
  private ghost?: Figure;
  private hiddenAt = 0;
  private ring?: Phaser.GameObjects.Ellipse;
  private tag?: Phaser.GameObjects.Text;
  private u = 0; private v = 0; private t = 0;
  private pad = { x: 0, y: 0 };
  private keys?: Record<string, Phaser.Input.Keyboard.Key>;
  private near: Entrance | null = null;
  private dustAt = 0;

  constructor(private readonly scene: Phaser.Scene, private readonly opts: Options, private readonly fx?: Effects) {}

  start(person: Person, u: number, v: number, zoom: number): void {
    this.stop();
    this.active = true; this.u = u; this.v = v;
    const p = projection.project(u, v);
    // a gold ring at your feet and a YOU tag, so you can always find yourself in the crowd
    this.ring = this.scene.add.ellipse(p.x, p.y, 46, 16, 0xffc439, .22).setStrokeStyle(3, 0xffc439, 1);
    this.tag = this.scene.add.text(p.x, p.y, "YOU", { fontFamily: "Silkscreen, monospace", fontSize: "16px", color: "#1b2333", backgroundColor: "#ffc439", padding: { x: 6, y: 2 } }).setOrigin(.5, 1).setResolution(3);
    this.fig = new Figure(this.scene, person, this.fx, SCALE);
    this.fig.depthBias = this.opts.depthBias;
    this.fig.place(u, v);
    this.ghost = new Figure(this.scene, person, undefined, SCALE).silhouette(0xffd15c, .5);
    this.ghost.root.setDepth(SKY_DEPTH + 39).setVisible(false);
    this.place();
    const kb = this.scene.input.keyboard;
    if (kb) this.keys = kb.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT", false) as Record<string, Phaser.Input.Keyboard.Key>;
    const cam = this.scene.cameras.main;
    this.scene.tweens.add({ targets: cam, zoom, duration: 900, ease: "Cubic.easeInOut" });
    cam.startFollow(this.fig.root, false, .14, .14, 0, 40);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.scene.cameras.main.stopFollow();
    this.fig?.destroy(); this.ghost?.destroy(); this.ring?.destroy(); this.tag?.destroy();
    this.fig = undefined; this.ghost = undefined; this.ring = undefined; this.tag = undefined;
    if (this.keys && this.scene.input.keyboard) for (const k of Object.values(this.keys)) this.scene.input.keyboard.removeKey(k, false);
    this.keys = undefined;
    if (this.near) { this.near = null; this.opts.onNear(null); }
  }

  /** The on-screen pad: a direction in screen space, each axis -1..1. */
  setPad(x: number, y: number): void { this.pad = { x, y }; }

  /** Where the walker stands, for entering the nearest door. */
  nearest(): Entrance | null { return this.near; }

  /** Where the walker stands in the world, for the radar. */
  get spot(): { x: number; y: number } | null { return this.active && this.fig ? { x: this.fig.root.x, y: this.fig.root.y } : null; }

  /** The town cheers: so do you. */
  cheer(): void { this.fig?.cheer(); }

  update(deltaMs: number): void {
    if (!this.active || !this.fig) return;
    const k = this.keys, down = (n: string) => !!k?.[n]?.isDown;
    let sx = this.pad.x + (down("D") || down("RIGHT") ? 1 : 0) - (down("A") || down("LEFT") ? 1 : 0);
    let sy = this.pad.y + (down("S") || down("DOWN") ? 1 : 0) - (down("W") || down("UP") ? 1 : 0);
    const len = Math.hypot(sx, sy);
    let moved = false;
    if (len > .05) {
      sx /= Math.max(1, len); sy /= Math.max(1, len);
      // screen direction -> tile direction: screen x = (u - v) * 48, screen y = (u + v) * 24
      let du = sx / 48 + sy / 24, dv = sy / 24 - sx / 48;
      const n = Math.hypot(du, dv) || 1; du /= n; dv /= n;
      const step = SPEED * Math.min(.05, deltaMs / 1000) * Math.min(1, len);
      const nu = this.u + du * step, nv = this.v + dv * step;
      if (!this.opts.blocked(nu, nv)) { this.u = nu; this.v = nv; moved = true; }
      else if (!this.opts.blocked(nu, this.v)) { this.u = nu; moved = true; }
      else if (!this.opts.blocked(this.u, nv)) { this.v = nv; moved = true; }
      if (Math.abs(sx) > .05) this.fig.look(sx);
      this.t += deltaMs;
      if (moved && this.t - this.dustAt > 300) { this.dustAt = this.t; this.fx?.emit("dust", this.fig.root.x, this.fig.root.y, this.fig.root.depth - 1, 2); }
    }
    this.fig.setPose(moved ? "walk" : "idle");
    this.fig.place(this.u, this.v);
    if (Math.abs(sx) > .05) this.fig.look(sx);
    this.fig.update(deltaMs);
    this.place();
    if (this.ghost) {
      this.hiddenAt -= deltaMs;
      if (this.hiddenAt <= 0) { this.hiddenAt = 120; this.ghost.root.setVisible(this.hidden()); }
      if (this.ghost.root.visible) this.ghost.copyPose(this.fig);
    }
    const doors = this.opts.entrances();
    let best: Entrance | null = null, bestD = 1.6;
    for (const e of doors) { const d = Math.hypot(e.u - this.u, e.v - this.v); if (d < bestD) { best = e; bestD = d; } }
    if (best?.id !== this.near?.id) { this.near = best; this.opts.onNear(best); }
  }

  /** Is a building standing in front of the walker, by its actual pixels (not just its box)? */
  private hidden(): boolean {
    const f = this.fig;
    if (!f) return false;
    const pts = [{ x: f.root.x, y: f.root.y - 12 }, { x: f.root.x, y: f.headY + 8 }];
    for (const s of this.opts.occluders()) {
      if (!s.visible || s.depth <= f.root.depth) continue;
      for (const p of pts) {
        const tx = (p.x - s.x) / s.scaleX + s.originX * s.width, ty = (p.y - s.y) / s.scaleY + s.originY * s.height;
        if (tx < 0 || ty < 0 || tx >= s.width || ty >= s.height) continue;
        if ((this.scene.textures.getPixelAlpha(Math.floor(tx), Math.floor(ty), s.texture.key, s.frame.name) ?? 0) > 90) return true;
      }
    }
    return false;
  }

  private place(): void {
    if (!this.fig || !this.ring) return;
    const p = projection.project(this.u, this.v);
    this.ring.setPosition(p.x, p.y).setDepth(this.fig.root.depth - .5);
    // the tag reads above everything, day or night
    this.tag?.setPosition(p.x, this.fig.headY - 10).setDepth(SKY_DEPTH + 41);
  }
}

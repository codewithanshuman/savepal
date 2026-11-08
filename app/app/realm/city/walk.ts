/*
 * Walk mode: enter the kingdom as your own character. The camera follows you down the streets;
 * arrow keys / WASD (or the on-screen pad) steer, buildings and the sea block the way, and
 * standing at a landmark's door offers to step inside -- which opens that place's court.
 */
import Phaser from "phaser";
import { projection } from "../reference-city/world/core/worldConstants";

export type Entrance = { id: string; label: string; u: number; v: number };
type Options = {
  blocked(u: number, v: number): boolean;
  entrances(): Entrance[];
  onNear(entrance: Entrance | null): void;
  depthBias: number;
};

const SPEED = 3.6; // tiles per second
const SCALE = .36;

export class WalkMode {
  active = false;
  private avatar?: Phaser.GameObjects.Image;
  private shadow?: Phaser.GameObjects.Ellipse;
  private tag?: Phaser.GameObjects.Text;
  private u = 0; private v = 0; private t = 0;
  private pad = { x: 0, y: 0 };
  private keys?: Record<string, Phaser.Input.Keyboard.Key>;
  private near: Entrance | null = null;
  private dustAt = 0;

  constructor(private readonly scene: Phaser.Scene, private readonly opts: Options) {}

  start(textureKey: string, u: number, v: number, zoom: number): void {
    this.stop();
    this.active = true; this.u = u; this.v = v;
    const p = projection.project(u, v);
    // a gold ring at your feet and a YOU tag, so you can always find yourself in the crowd
    this.shadow = this.scene.add.ellipse(p.x, p.y, 46, 16, 0xffc439, .22).setStrokeStyle(3, 0xffc439, 1);
    this.tag = this.scene.add.text(p.x, p.y, "YOU", { fontFamily: "Silkscreen, monospace", fontSize: "16px", color: "#1b2333", backgroundColor: "#ffc439", padding: { x: 6, y: 2 } }).setOrigin(.5, 1).setResolution(3);
    this.avatar = this.scene.add.image(p.x, p.y, textureKey).setOrigin(.5, 1).setScale(SCALE);
    this.place();
    const kb = this.scene.input.keyboard;
    if (kb) this.keys = kb.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT", false) as Record<string, Phaser.Input.Keyboard.Key>;
    const cam = this.scene.cameras.main;
    this.scene.tweens.add({ targets: cam, zoom, duration: 900, ease: "Cubic.easeInOut" });
    cam.startFollow(this.avatar, false, .14, .14, 0, 40);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.scene.cameras.main.stopFollow();
    this.avatar?.destroy(); this.shadow?.destroy(); this.tag?.destroy();
    this.avatar = undefined; this.shadow = undefined; this.tag = undefined;
    if (this.keys && this.scene.input.keyboard) for (const k of Object.values(this.keys)) this.scene.input.keyboard.removeKey(k, false);
    this.keys = undefined;
    if (this.near) { this.near = null; this.opts.onNear(null); }
  }

  /** The on-screen pad: a direction in screen space, each axis -1..1. */
  setPad(x: number, y: number): void { this.pad = { x, y }; }

  /** Where the walker stands, for entering the nearest door. */
  nearest(): Entrance | null { return this.near; }

  update(deltaMs: number): void {
    if (!this.active || !this.avatar) return;
    const k = this.keys, down = (n: string) => !!k?.[n]?.isDown;
    let sx = this.pad.x + (down("D") || down("RIGHT") ? 1 : 0) - (down("A") || down("LEFT") ? 1 : 0);
    let sy = this.pad.y + (down("S") || down("DOWN") ? 1 : 0) - (down("W") || down("UP") ? 1 : 0);
    const len = Math.hypot(sx, sy);
    if (len > .05) {
      sx /= Math.max(1, len); sy /= Math.max(1, len);
      // screen direction -> tile direction: screen x = (u - v) * 48, screen y = (u + v) * 24
      let du = sx / 48 + sy / 24, dv = sy / 24 - sx / 48;
      const n = Math.hypot(du, dv) || 1; du /= n; dv /= n;
      const step = SPEED * Math.min(.05, deltaMs / 1000) * Math.min(1, len);
      const nu = this.u + du * step, nv = this.v + dv * step;
      if (!this.opts.blocked(nu, nv)) { this.u = nu; this.v = nv; }
      else if (!this.opts.blocked(nu, this.v)) this.u = nu;
      else if (!this.opts.blocked(this.u, nv)) this.v = nv;
      this.avatar.setFlipX(sx < -.05 ? true : sx > .05 ? false : this.avatar.flipX);
      this.t += deltaMs;
      if (this.t - this.dustAt > 260) { this.dustAt = this.t; this.dust(); }
    }
    this.place(len > .05);
    const doors = this.opts.entrances();
    let best: Entrance | null = null, bestD = 1.6;
    for (const e of doors) { const d = Math.hypot(e.u - this.u, e.v - this.v); if (d < bestD) { best = e; bestD = d; } }
    if (best?.id !== this.near?.id) { this.near = best; this.opts.onNear(best); }
  }

  private place(moving = false): void {
    if (!this.avatar || !this.shadow) return;
    const p = projection.project(this.u, this.v), bob = moving ? Math.abs(Math.sin(this.t / 110)) * 4 : 0;
    this.avatar.setPosition(p.x, p.y - bob).setDepth(projection.depth(this.u, this.v) + this.opts.depthBias);
    this.shadow.setPosition(p.x, p.y).setDepth(this.avatar.depth - .5);
    this.tag?.setPosition(p.x, p.y - this.avatar.displayHeight - 8 - bob).setDepth(this.avatar.depth + .5);
  }

  private dust(): void {
    if (!this.avatar) return;
    const c = this.scene.add.circle(this.avatar.x + (Math.random() - .5) * 10, this.avatar.y, 4, 0xd8c9a8, .6).setDepth(this.avatar.depth - .6);
    this.scene.tweens.add({ targets: c, y: c.y - 10, scale: 2, alpha: 0, duration: 520, onComplete: () => c.destroy() });
  }
}

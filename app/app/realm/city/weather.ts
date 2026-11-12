/*
 * Weather that means something. Wherever the agreement is in trouble, a storm cell gathers over
 * the building where that trouble lives -- over the port while an appeal is open, over the guild
 * while work has been sent back or a required check has failed -- with dark cloud, driving rain,
 * a shadow on the ground and lightning. It clears the moment the trouble does. The rest of the
 * kingdom keeps its sunshine, so one glance shows both that something is wrong and where.
 */
import Phaser from "phaser";
import { SKY_DEPTH } from "../reference-city/world/core/worldConstants";
import { unit } from "./textures/atelier";
import { NIGHT_DEPTH } from "./night";

const CLOUD = "savepal:cloud", RAIN = "savepal:rain";
type Cell = { objects: Phaser.GameObjects.GameObject[]; clouds: Phaser.GameObjects.Image[]; bolt: Phaser.GameObjects.Graphics; flash: Phaser.GameObjects.Image; x: number; y: number; strikeAt: number };

export class Storms {
  private cells = new Map<string, Cell>();
  private readonly still = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  /** Called when lightning strikes within view, for the thunder. */
  onStrike?: () => void;

  constructor(private readonly scene: Phaser.Scene) {
    if (!scene.textures.exists(RAIN)) {
      const t = scene.textures.createCanvas(RAIN, 4, 24);
      if (t) {
        const g = t.context.createLinearGradient(0, 0, 0, 24);
        g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(255,255,255,.95)");
        t.context.fillStyle = g; t.context.fillRect(1, 0, 2, 24); t.refresh();
      }
    }
  }

  /** The storm cells that should exist now: one per troubled place, at its spot on the ground. */
  set(spots: Array<{ key: string; x: number; y: number }>): void {
    for (const [key, cell] of this.cells) if (!spots.some(s => s.key === key)) { this.clear(cell); this.cells.delete(key); }
    for (const s of spots) if (!this.cells.has(s.key) && this.scene.textures.exists(CLOUD)) this.cells.set(s.key, this.raise(s.x, s.y));
  }

  private raise(x: number, y: number): Cell {
    const scene = this.scene, objects: Phaser.GameObjects.GameObject[] = [], top = y - 340, k = unit(CLOUD);
    objects.push(scene.add.ellipse(x + 30, y + 10, 420, 150, 0x0d1422, .26).setDepth(SKY_DEPTH - 55));
    if (!this.still) objects.push(scene.add.particles(x, top + 40, RAIN, {
      x: { min: -150, max: 150 }, y: { min: -10, max: 30 }, speedY: { min: 560, max: 700 }, speedX: { min: -90, max: -60 }, lifespan: 500,
      scaleY: { min: .7, max: 1.2 }, alpha: { start: .6, end: .15 }, tint: 0xcfe2ff, rotate: 8, quantity: 4, frequency: 14,
    }).setDepth(SKY_DEPTH + 1));
    const clouds = ([[-110, 16, 1.5], [70, 22, 1.6], [-20, -10, 1.9], [150, 4, 1.2], [-170, 0, 1.1]] as const).map(([dx, dy, size], i) => {
      const img = scene.add.image(x + dx, top + dy, CLOUD).setScale(size * .8 * k, size * .62 * k).setTint(i % 2 ? 0x66708a : 0x7a849a).setAlpha(.88).setDepth(SKY_DEPTH + 3);
      if (!this.still) scene.tweens.add({ targets: img, x: img.x + 14, y: img.y + 4, duration: 3200 + i * 500, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      return img;
    });
    const bolt = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setDepth(NIGHT_DEPTH + 3);
    const flash = scene.add.image(x, top + 20, "savepal:puff").setScale(9, 3.4).setTint(0xdfe9ff).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setDepth(NIGHT_DEPTH + 3);
    objects.push(...clouds, bolt, flash);
    return { objects, clouds, bolt, flash, x, y, strikeAt: scene.time.now + 2500 + Math.random() * 4000 };
  }

  update(time: number): void {
    if (this.still) return;
    for (const cell of this.cells.values()) {
      if (time < cell.strikeAt) continue;
      cell.strikeAt = time + 5000 + Math.random() * 7000;
      // a forked bolt from the cloud base to the ground, then its afterglow
      const g = cell.bolt, x0 = cell.x - 90 + Math.random() * 180, y0 = cell.y - 300;
      let x = x0, y = y0;
      g.clear().setAlpha(1);
      const path: Array<[number, number]> = [[x, y]];
      while (y < cell.y - 8) { x += (Math.random() - .5) * 46; y += 22 + Math.random() * 26; path.push([x, Math.min(y, cell.y)]); }
      for (const [width, color, alpha] of [[9, 0x9fc0ff, .35], [3.4, 0xffffff, 1]] as const) {
        g.lineStyle(width, color, alpha).beginPath().moveTo(path[0]![0], path[0]![1]);
        for (const [px, py] of path.slice(1)) g.lineTo(px, py);
        g.strokePath();
      }
      const fork = path[Math.floor(path.length / 2)]!;
      g.lineStyle(2, 0xffffff, .8).lineBetween(fork[0], fork[1], fork[0] + 40, fork[1] + 46).lineBetween(fork[0] + 40, fork[1] + 46, fork[0] + 34, fork[1] + 84);
      cell.flash.setAlpha(.9);
      this.scene.tweens.add({ targets: [g, cell.flash], alpha: 0, duration: 420, ease: "Quad.easeOut" });
      if (this.scene.cameras.main.worldView.contains(cell.x, cell.y - 100)) this.onStrike?.();
    }
  }

  private clear(cell: Cell): void { for (const o of cell.objects) { this.scene.tweens.killTweensOf(o); o.destroy(); } }
  destroy(): void { for (const c of this.cells.values()) this.clear(c); this.cells.clear(); }
}

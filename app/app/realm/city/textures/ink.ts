/*
 * The Realm's drawing surface. It speaks the handful of Phaser Graphics calls the structure
 * builders use (fillStyle, fillPoints, fillCircle...), but draws straight onto a Canvas 2D
 * context, which is what gives the kit real gradients, soft shadows and clipping -- the things a
 * shaded, lit building needs and flat fills cannot do.
 *
 * Each structure is drawn `res` times larger than the world's pixel grid, into a canvas whose
 * sides are powers of two. That padding is what lets the GPU build mipmaps, so a texture shown at
 * a third of its size (the whole-kingdom view) is averaged cleanly instead of sparkling, and one
 * shown zoomed in is smooth instead of blocky. The spare room in the padded canvas is spent on
 * extra resolution for free.
 */
import type { Scene } from "phaser";

export type Vec = { x: number; y: number };

const pot = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));
/** Transparent margin round the drawing, so filtering never bleeds across the texture's edge. */
const PAD = 2;
/** No single structure may take more than this many texels (4096 x 2048). */
const MAX_AREA = 4096 * 2048;

/** How large each baked texture was drawn: texels per world pixel, by texture key. */
const BAKED = new Map<string, number>();
/** The scale that shows a baked texture at world size. */
export const unit = (key: string, fallback = 1): number => 1 / (BAKED.get(key) ?? fallback);

export class Ink {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Texels per world pixel. */
  readonly res: number;
  /** The drawn region inside the padded canvas, in texels. */
  readonly frame: { x: number; y: number; w: number; h: number };
  /** Light-map mode: every colour passes through `remap`, and no shading is drawn. */
  flat = false;
  remap: ((color: number) => number) | null = null;

  /** A surface for a `width` x `height` drawing (world pixels), at about `desired` texels per pixel. */
  constructor(width: number, height: number, desired: number, maxSide = 4096, grow = 1.4) {
    let res = Math.min(desired, (maxSide - PAD * 2) / width, (maxSide - PAD * 2) / height);
    let W = pot(width * res + PAD * 2), H = pot(height * res + PAD * 2);
    while (W * H > MAX_AREA) { if (W / width >= H / height) W /= 2; else H /= 2; }
    // spend the padding on sharpness: grow the drawing to fill the canvas it was going to get anyway
    res = Math.min((W - PAD * 2) / width, (H - PAD * 2) / height, desired * grow);
    this.res = res;
    this.canvas = document.createElement("canvas");
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.setTransform(res, 0, 0, res, PAD, PAD);
    this.ctx.lineJoin = "round";
    this.frame = { x: PAD, y: PAD, w: Math.ceil(width * res), h: Math.ceil(height * res) };
  }

  /** A CSS colour for a 0xRRGGBB number (through the light-map remap, when one is set). */
  css(color: number, alpha = 1): string {
    const c = this.remap ? this.remap(color) : color;
    return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${alpha})`;
  }

  fillStyle(color: number, alpha = 1): this { this.ctx.fillStyle = this.css(color, alpha); return this; }
  lineStyle(width: number, color: number, alpha = 1): this { this.ctx.lineWidth = width; this.ctx.strokeStyle = this.css(color, alpha); return this; }

  private trace(points: readonly Vec[], close: boolean): void {
    const c = this.ctx;
    c.beginPath();
    points.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    if (close) c.closePath();
  }
  fillPoints(points: readonly Vec[], closeShape = false): this { this.trace(points, closeShape); this.ctx.fill(); return this; }
  strokePoints(points: readonly Vec[], closeShape = false): this { this.trace(points, closeShape); this.ctx.stroke(); return this; }
  fillRect(x: number, y: number, w: number, h: number): this { this.ctx.fillRect(x, y, w, h); return this; }
  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): this {
    return this.fillPoints([{ x: x0, y: y0 }, { x: x1, y: y1 }, { x: x2, y: y2 }], true);
  }
  fillCircle(x: number, y: number, r: number): this { const c = this.ctx; c.beginPath(); c.arc(x, y, Math.max(0, r), 0, Math.PI * 2); c.fill(); return this; }
  strokeCircle(x: number, y: number, r: number): this { const c = this.ctx; c.beginPath(); c.arc(x, y, Math.max(0, r), 0, Math.PI * 2); c.stroke(); return this; }
  /** As Phaser: width and height are the ellipse's full extents. */
  fillEllipse(x: number, y: number, width: number, height: number): this {
    const c = this.ctx; c.beginPath(); c.ellipse(x, y, Math.abs(width) / 2, Math.abs(height) / 2, 0, 0, Math.PI * 2); c.fill(); return this;
  }
  strokeEllipse(x: number, y: number, width: number, height: number): this {
    const c = this.ctx; c.beginPath(); c.ellipse(x, y, Math.abs(width) / 2, Math.abs(height) / 2, 0, 0, Math.PI * 2); c.stroke(); return this;
  }
  fillRoundedRect(x: number, y: number, w: number, h: number, radius = 20): this {
    const c = this.ctx, r = Math.min(radius, w / 2, h / 2);
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); c.fill();
    return this;
  }
  lineBetween(x1: number, y1: number, x2: number, y2: number): this { const c = this.ctx; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); return this; }
  beginPath(): this { this.ctx.beginPath(); return this; }
  moveTo(x: number, y: number): this { this.ctx.moveTo(x, y); return this; }
  lineTo(x: number, y: number): this { this.ctx.lineTo(x, y); return this; }
  closePath(): this { this.ctx.closePath(); return this; }
  arc(x: number, y: number, radius: number, start: number, end: number, anticlockwise = false): this { this.ctx.arc(x, y, radius, start, end, anticlockwise); return this; }
  strokePath(): this { this.ctx.stroke(); return this; }
  fillPath(): this { this.ctx.fill(); return this; }

  /**
   * A soft shadow of a polygon, drawn without the polygon itself (it is drawn far off the canvas
   * and only its blurred shadow lands in view), so edges fall off the way real shade does.
   */
  softShadow(points: readonly Vec[], color: string, blur: number): void {
    if (this.flat) return;
    const c = this.ctx, far = 20000;
    c.save();
    c.shadowColor = color; c.shadowBlur = blur * this.res; c.shadowOffsetX = far; c.shadowOffsetY = 0;
    c.fillStyle = "#000";
    c.beginPath();
    points.forEach((p, i) => (i ? c.lineTo(p.x - far / this.res, p.y) : c.moveTo(p.x - far / this.res, p.y)));
    c.closePath(); c.fill();
    c.restore();
  }

  /** A whisper of film grain over everything painted, so large flat fills read as material. */
  grain(strength = 1): void {
    if (this.flat) return;
    const c = this.ctx;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-atop";
    c.globalAlpha = strength;
    c.fillStyle = c.createPattern(noise(), "repeat")!;
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.restore();
  }

  /** Hands the drawing to Phaser as a texture whose frame is the drawn region. */
  publish(scene: Scene, key: string): void {
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const texture = scene.textures.addCanvas(key, this.canvas);
    texture?.get().setSize(this.frame.w, this.frame.h, this.frame.x, this.frame.y);
    BAKED.set(key, this.res);
  }
}

let noiseTile: HTMLCanvasElement | null = null;
/** A tile of fine light and dark specks, even on average, so grain never shifts a colour. */
function noise(): HTMLCanvasElement {
  if (noiseTile) return noiseTile;
  const size = 128, tile = document.createElement("canvas");
  tile.width = tile.height = size;
  const c = tile.getContext("2d")!, data = c.createImageData(size, size);
  let seed = 1234567;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < size * size; i++) {
    const v = rand() - .5, o = i * 4, tone = v < 0 ? 0 : 255;
    data.data[o] = tone; data.data[o + 1] = tone; data.data[o + 2] = tone; data.data[o + 3] = Math.abs(v) * 2 * 26;
  }
  c.putImageData(data, 0, 0);
  return (noiseTile = tile);
}

/** The largest texture side this device's GPU accepts (capped: nothing here needs more than 4096). */
export function maxTextureSide(scene: Scene): number {
  const renderer = scene.game.renderer as { getMaxTextureSize?: () => number };
  return Math.min(4096, renderer.getMaxTextureSize?.() ?? 4096);
}

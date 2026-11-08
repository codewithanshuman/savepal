/*
 * Things that move: waving flags, windmill sails, vintage biplanes and gulls. Each is baked as a
 * few frames in screen space (they face the camera, as sprites do in the archive's ambient life)
 * and animated by life.ts.
 */
import type { Scene } from "phaser";
import { createBaker } from "../../reference-city/textures/core";
import { RES } from "./atelier";

export const FLAG_COLORS = { royal: [0x2f55c0, 0xf2b134], crimson: [0xc0392b, 0xf2b134], gold: [0xf2b134, 0xfff3c4], green: [0x1f9e62, 0xf2e9c8], paypal: [0x003087, 0x009cde] } as const;
export type FlagColor = keyof typeof FLAG_COLORS;
export const FLAG_FRAMES = 6;
export const flagKey = (color: FlagColor, frame: number) => `savepal:flag:${color}:${frame}`;
export const SAILS = "savepal:windmill:sails";
export const PLANES = { red: ["savepal:plane:red:0", "savepal:plane:red:1"], blue: ["savepal:plane:blue:0", "savepal:plane:blue:1"] } as const;
export const GULL = ["savepal:gull:0", "savepal:gull:1"] as const;

type G = Phaser.GameObjects.Graphics;

function flag(g: G, [cloth, trim]: readonly [number, number], phase: number): void {
  const W = 34, H = 20, wave = (x: number) => Math.sin(phase + x * .32) * 2.2 * (x / W);
  const top: Array<[number, number]> = [], bottom: Array<[number, number]> = [];
  for (let x = 0; x <= W; x += 2) { top.push([2 + x, 2 + wave(x)]); bottom.push([2 + x, 2 + H + wave(x) - x * .12]); }
  const outline = [...top, ...bottom.reverse()];
  g.fillStyle(0x1b2333, .35).fillPoints(outline.map(([x, y]) => ({ x: x + 1, y: y + 2 })), true);
  g.fillStyle(cloth, 1).fillPoints(outline.map(([x, y]) => ({ x, y })), true);
  // a gold stripe and a shaded fold that travels with the wave
  g.fillStyle(trim, 1).fillPoints([...top.map(([x, y]) => ({ x, y: y + 6 })), ...top.slice().reverse().map(([x, y]) => ({ x, y: y + 9 }))], true);
  const fold = (phase / (Math.PI * 2)) * W;
  g.fillStyle(0x000000, .12).fillRect(2 + ((fold + 10) % W), 2, 4, H);
  g.fillStyle(0xffffff, .14).fillRect(2 + (fold % W), 2, 3, H);
}

function sails(g: G): void {
  const c = 64;
  g.fillStyle(0x4a3020, 1).fillCircle(c, c, 6);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca;
    const at = (d: number, w: number) => ({ x: c + ca * d + px * w, y: c + sa * d + py * w });
    g.lineStyle(3, 0x5c3b22, 1).beginPath().moveTo(c, c).lineTo(c + ca * 60, c + sa * 60).strokePath();
    g.fillStyle(0xf3ead6, .95).fillPoints([at(12, 1), at(58, 1), at(58, 13), at(12, 11)], true);
    g.lineStyle(1, 0x8a6239, 1);
    for (let d = 16; d <= 56; d += 8) g.beginPath().moveTo(at(d, 1).x, at(d, 1).y).lineTo(at(d, 12).x, at(d, 12).y).strokePath();
    g.beginPath().moveTo(at(12, 6).x, at(12, 6).y).lineTo(at(58, 7).x, at(58, 7).y).strokePath();
  }
  g.fillStyle(0xf2b134, 1).fillCircle(c, c, 3);
}

/** A 1920s biplane in three-quarter view, flying right. */
function plane(g: G, body: number, wing: number, frame: number): void {
  const shade = (c: number, k: number) => { const r = (c >> 16) & 255, gg = (c >> 8) & 255, b = c & 255, f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k))); return (f(r) << 16) | (f(gg) << 8) | f(b); };
  // lower wing, fuselage, tail, upper wing, struts, wheels, pilot, propeller
  g.fillStyle(shade(wing, .8), 1).fillPoints([{ x: 30, y: 40 }, { x: 78, y: 36 }, { x: 84, y: 40 }, { x: 36, y: 45 }], true);
  g.fillStyle(body, 1).fillPoints([{ x: 14, y: 26 }, { x: 80, y: 24 }, { x: 92, y: 30 }, { x: 80, y: 38 }, { x: 22, y: 34 }], true);
  g.fillStyle(shade(body, .72), 1).fillPoints([{ x: 22, y: 34 }, { x: 80, y: 38 }, { x: 92, y: 30 }, { x: 86, y: 37 }, { x: 24, y: 37 }], true);
  g.fillStyle(0xf2b134, 1).fillRect(46, 28, 26, 3);
  g.fillStyle(body, 1).fillPoints([{ x: 6, y: 14 }, { x: 16, y: 14 }, { x: 22, y: 27 }, { x: 12, y: 28 }], true);
  g.fillStyle(shade(wing, .9), 1).fillPoints([{ x: 4, y: 28 }, { x: 24, y: 27 }, { x: 22, y: 31 }, { x: 6, y: 31 }], true);
  g.lineStyle(1.5, 0x3a2a1a, 1);
  for (const x of [44, 70]) g.beginPath().moveTo(x, 14).lineTo(x + 2, 40).strokePath();
  g.fillStyle(wing, 1).fillPoints([{ x: 26, y: 10 }, { x: 82, y: 6 }, { x: 88, y: 11 }, { x: 32, y: 16 }], true);
  g.fillStyle(shade(wing, 1.12), 1).fillPoints([{ x: 28, y: 10 }, { x: 82, y: 6 }, { x: 84, y: 8 }, { x: 30, y: 12 }], true);
  g.lineStyle(1.5, 0x3a2a1a, 1).beginPath().moveTo(70, 38).lineTo(66, 47).moveTo(76, 37).lineTo(78, 47).strokePath();
  g.fillStyle(0x2a2a2a, 1).fillCircle(66, 48, 3.5).fillCircle(78, 48, 3.5);
  g.fillStyle(0x6b4527, 1).fillCircle(60, 23, 4.5);
  g.fillStyle(0x9fd8ff, 1).fillRect(61, 21, 4, 2);
  g.fillStyle(0x3a2a1a, 1).fillRect(91, 27, 4, 6);
  if (frame === 0) g.fillStyle(0x3a2a1a, 1).fillRect(94, 14, 3, 32);
  else g.fillStyle(0xd8d8d8, .45).fillEllipse(96, 30, 5, 34);
}

function gull(g: G, up: boolean): void {
  g.lineStyle(2, 0xf4f6f8, 1).beginPath();
  if (up) g.moveTo(1, 8).lineTo(6, 2).lineTo(9, 7).lineTo(12, 2).lineTo(17, 8);
  else g.moveTo(1, 4).lineTo(6, 7).lineTo(9, 6).lineTo(12, 7).lineTo(17, 4);
  g.strokePath();
  g.fillStyle(0xf2b134, 1).fillRect(8, 6, 2, 2);
}

export function bakeSky(scene: Scene): void {
  const baker = createBaker(scene), g = baker.graphics;
  g.setScale(RES);
  const make = (key: string, w: number, h: number, draw: () => void) => { if (scene.textures.exists(key)) return; draw(); baker.finish(key, Math.ceil(w * RES), Math.ceil(h * RES)); scene.textures.get(key).setFilter(1); };
  for (const color of Object.keys(FLAG_COLORS) as FlagColor[]) for (let f = 0; f < FLAG_FRAMES; f++) make(flagKey(color, f), 40, 28, () => flag(g, FLAG_COLORS[color], f / FLAG_FRAMES * Math.PI * 2));
  make(SAILS, 128, 128, () => sails(g));
  PLANES.red.forEach((key, f) => make(key, 100, 54, () => plane(g, 0xc0392b, 0xf3ead6, f)));
  PLANES.blue.forEach((key, f) => make(key, 100, 54, () => plane(g, 0x2f55c0, 0xf2d36a, f)));
  GULL.forEach((key, f) => make(key, 18, 10, () => gull(g, f === 0)));
  baker.destroy();
}

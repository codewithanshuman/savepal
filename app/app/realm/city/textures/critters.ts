/*
 * The kingdom's small life, baked at RES like everything else and shown at 1/RES: hens, doves,
 * butterflies, ducks and leaping fish, the dockhand's crate, and the townsfolk's chat bubble with
 * its icons. Each texture is drawn facing right with its feet (or waterline) at the bottom centre.
 */
import Phaser from "phaser";
import { RES, shade } from "./atelier";

export const CRITTER = {
  hen: ["savepal:hen:0", "savepal:hen:1"],
  brownHen: ["savepal:hen:brown:0", "savepal:hen:brown:1"],
  dove: ["savepal:dove:0", "savepal:dove:1"],
  butterflies: ["savepal:fly:yellow", "savepal:fly:white", "savepal:fly:blue", "savepal:fly:orange"],
  duck: "savepal:duck",
  fish: "savepal:fish",
  crate: "savepal:crate",
  bubble: "savepal:chat",
  icons: { heart: "savepal:icon:heart", note: "savepal:icon:note", bang: "savepal:icon:bang", wheat: "savepal:icon:wheat" },
} as const;

type G = Phaser.GameObjects.Graphics;
const pts = (...xy: number[]) => { const out: Phaser.Types.Math.Vector2Like[] = []; for (let i = 0; i < xy.length; i += 2) out.push({ x: xy[i]!, y: xy[i + 1]! }); return out; };

function hen(g: G, body: number, peck: boolean): void {
  g.fillStyle(0x1d2b16, .22).fillEllipse(12, 20.6, 14, 3.4);
  g.lineStyle(1.3, 0xe8a23a, 1).lineBetween(10, 16, 9.4, 20.6).lineBetween(13.2, 16, 13.8, 20.6);
  g.fillStyle(shade(body, -16), 1).fillPoints(pts(2.6, 5.4, 8.6, 11.6, 4.4, 14), true);
  g.fillStyle(body, 1).fillEllipse(11.4, 12.6, 14.2, 9.6);
  g.fillStyle(shade(body, -20), 1).fillEllipse(12, 15.4, 10.6, 3.8);
  g.fillStyle(shade(body, -10), 1).fillEllipse(10.2, 12, 7.6, 5);
  g.lineStyle(.7, shade(body, -34), .8).lineBetween(7.6, 12.4, 12.6, 12.6).lineBetween(8.2, 13.8, 12, 14);
  const hx = peck ? 19 : 17, hy = peck ? 15.2 : 6.8;
  g.fillStyle(body, 1).fillPoints(peck ? pts(14, 10, 17.4, 12.6, 19.4, 14.2, 17.4, 16.4, 13.6, 14.2) : pts(13.6, 9, 15.2, 5.6, 18.6, 6, 18.4, 9.6, 16, 12), true);
  g.fillStyle(body, 1).fillCircle(hx, hy, 3.1);
  g.fillStyle(0xd8392b, 1).fillCircle(hx - .9, hy - 2.9, 1.3).fillCircle(hx + .5, hy - 3.3, 1.3).fillCircle(hx + 1.7, hy - 2.6, 1);
  g.fillStyle(0xd8392b, 1).fillEllipse(hx + 1.6, hy + 2.7, 1.7, 2.6);
  g.fillStyle(0xf0a020, 1).fillTriangle(hx + 2.5, hy - .7, hx + 5.2, hy + .5, hx + 2.5, hy + 1.3);
  g.fillStyle(0x1b1b1b, 1).fillCircle(hx + .9, hy - .5, .75);
}

function dove(g: G, peck: boolean): void {
  g.fillStyle(0x1d2b16, .2).fillEllipse(8, 11.3, 9, 2.2);
  g.lineStyle(1, 0xd0605a, 1).lineBetween(7, 9, 6.8, 11.3).lineBetween(9, 9, 9.3, 11.3);
  g.fillStyle(0x8f96a2, 1).fillPoints(pts(.8, 5.4, 5.4, 7.4, 2, 9.2), true);
  g.fillStyle(0xbcc1cb, 1).fillEllipse(7.6, 7.4, 9.2, 5.6);
  g.fillStyle(0x9aa1ad, 1).fillEllipse(6.8, 6.9, 6.2, 3.4);
  g.lineStyle(.7, 0x4a4f5a, .8).lineBetween(5.4, 6.6, 7.4, 6.8).lineBetween(5.8, 7.8, 7.8, 8);
  const hx = peck ? 12.6 : 11.6, hy = peck ? 9.2 : 4.2;
  g.fillStyle(0x7fb59a, .9).fillEllipse((hx + 10.4) / 2, (hy + 7) / 2, 3.2, 3.4);
  g.fillStyle(0xa9aeb8, 1).fillCircle(hx, hy, 2.2);
  g.fillStyle(0x3a3a3a, 1).fillTriangle(hx + 1.7, hy - .3, hx + 3.4, hy + .4, hx + 1.7, hy + .9);
  g.fillStyle(0xe0703a, 1).fillCircle(hx + .5, hy - .4, .55);
}

function butterfly(g: G, c: number): void {
  const wing = (m: number) => {
    const x = (v: number) => m < 0 ? 12 - v : v;
    g.fillStyle(c, 1).fillPoints(pts(x(6), 4.6, x(2), .6, x(.3), 2.6, x(1.1), 5.6, x(5.6), 5.8), true);
    g.fillStyle(shade(c, -26), 1).fillPoints(pts(x(6), 5.3, x(2.6), 6.1, x(2), 8.8, x(4.4), 9.2, x(6), 6.6), true);
    g.fillStyle(0x2b2320, .85).fillCircle(x(1.5), 2.4, .8);
    g.fillStyle(0xffffff, .6).fillCircle(x(3.2), 3, .7);
  };
  wing(1); wing(-1);
  g.lineStyle(1.4, 0x2b2320, 1).lineBetween(6, 2.4, 6, 8.4);
  g.lineStyle(.6, 0x2b2320, 1).lineBetween(6, 2.6, 4.6, .4).lineBetween(6, 2.6, 7.4, .4);
}

function duck(g: G): void {
  g.lineStyle(.9, 0xffffff, .5).strokeEllipse(9, 10.2, 17, 3);
  g.fillStyle(0xcdbfa6, 1).fillPoints(pts(1, 5.6, 4.2, 6.2, 3, 8.8), true);
  g.fillStyle(0xd9cdb6, 1).fillEllipse(8.6, 8, 13.4, 6);
  g.fillStyle(0x8f7f68, 1).fillEllipse(8, 7.4, 7.8, 3.6);
  g.fillStyle(0x3a6fd0, 1).fillRect(9.4, 7, 2, 1.1);
  g.fillStyle(0xffffff, 1).fillRect(12.2, 5.7, 2.8, .9);
  g.fillStyle(0x2f7a4a, 1).fillEllipse(13.6, 3.6, 5, 4.6);
  g.fillStyle(0xf0b030, 1).fillEllipse(16.6, 4.2, 3.2, 1.6);
  g.fillStyle(0x111111, 1).fillCircle(14.5, 3, .55);
}

function fish(g: G): void {
  g.fillStyle(0x5f93b8, 1).fillTriangle(3, 4, 0, 1, 0, 7);
  g.fillStyle(0x7fb2d4, 1).fillEllipse(8.4, 4, 11.4, 4.6);
  g.fillStyle(0xe6f2f8, 1).fillEllipse(8.8, 5.1, 8, 1.9);
  g.fillStyle(0x6a9cc0, 1).fillTriangle(7, 2.1, 9.6, .5, 10.2, 2.3);
  g.fillStyle(0xffffff, .75).fillEllipse(9.4, 2.9, 3.2, .7);
  g.fillStyle(0x10202a, 1).fillCircle(12, 3.5, .65);
}

function crate(g: G): void {
  g.fillStyle(0xd8a868, 1).fillPoints(pts(9, 1, 17, 5, 9, 9, 1, 5), true);
  g.fillStyle(0xb07a44, 1).fillPoints(pts(1, 5, 9, 9, 9, 15.6, 1, 11.6), true);
  g.fillStyle(0x8a5c36, 1).fillPoints(pts(9, 9, 17, 5, 17, 11.6, 9, 15.6), true);
  g.lineStyle(.8, 0x5a3a22, .9).strokePoints(pts(1, 5, 9, 9, 17, 5), false).lineBetween(9, 9, 9, 15.6);
  g.lineBetween(1, 8.3, 9, 12.3).lineBetween(9, 12.3, 17, 8.3);
  g.lineStyle(.6, 0xf0d6a4, .7).lineBetween(3, 4, 11, 8).lineBetween(7, 2, 15, 6);
}

function bubble(g: G): void {
  g.fillStyle(0x0d1422, .25).fillRoundedRect(2.2, 2.4, 24, 18, 6);
  g.fillStyle(0xfffaf0, 1).fillRoundedRect(1, 1, 24, 18, 6).fillTriangle(9, 18, 15, 18, 10, 24);
  g.lineStyle(1.4, 0x1b2333, 1).strokeRoundedRect(1, 1, 24, 18, 6);
  g.beginPath().moveTo(9, 19).lineTo(10, 24).lineTo(15, 19).strokePath();
  g.fillStyle(0xfffaf0, 1).fillRect(9.6, 17.4, 5, 2.2);
}

function heart(g: G): void { g.fillStyle(0xe8476a, 1).fillCircle(5, 5.4, 3.4).fillCircle(11, 5.4, 3.4).fillTriangle(1.8, 6.6, 14.2, 6.6, 8, 13.6); g.fillStyle(0xffffff, .6).fillCircle(4, 4.4, 1); }
function note(g: G): void { g.fillStyle(0x1b2333, 1).fillEllipse(5, 12, 5.4, 4).fillRect(6.8, 2.4, 1.6, 9.6); g.fillPoints(pts(7.6, 2.4, 13, 4.2, 13, 7, 8.4, 5.4), true); }
function bang(g: G): void { g.fillStyle(0xd8392b, 1).fillRoundedRect(6.2, 1.4, 3.6, 9.4, 1.6).fillCircle(8, 13.6, 2); }
function wheat(g: G): void {
  g.lineStyle(1.2, 0xb08f3c, 1).lineBetween(8, 15, 8, 3);
  for (let k = 0; k < 4; k++) { const y = 4 + k * 2.6; g.fillStyle(0xf0c24a, 1).fillEllipse(6, y, 3.4, 2.2).fillEllipse(10, y + 1, 3.4, 2.2); }
  g.fillStyle(0xf0c24a, 1).fillEllipse(8, 2.6, 2.4, 3.4);
}

export function bakeCritters(scene: Phaser.Scene): void {
  const bake = (key: string, w: number, h: number, draw: (g: G) => void) => {
    if (scene.textures.exists(key)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.setScale(RES); draw(g);
    g.generateTexture(key, Math.ceil(w * RES), Math.ceil(h * RES)); g.destroy();
    scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
  };
  CRITTER.hen.forEach((k, i) => bake(k, 24, 22, g => hen(g, 0xf8f3ea, i === 1)));
  CRITTER.brownHen.forEach((k, i) => bake(k, 24, 22, g => hen(g, 0xc07a3c, i === 1)));
  CRITTER.dove.forEach((k, i) => bake(k, 16, 12, g => dove(g, i === 1)));
  const wings = [0xf5d04a, 0xf6f4ee, 0x5aa8e8, 0xf09a3a];
  CRITTER.butterflies.forEach((k, i) => bake(k, 12, 10, g => butterfly(g, wings[i]!)));
  bake(CRITTER.duck, 18, 12, duck);
  bake(CRITTER.fish, 14, 8, fish);
  bake(CRITTER.crate, 18, 16, crate);
  bake(CRITTER.bubble, 27, 25, bubble);
  bake(CRITTER.icons.heart, 16, 15, heart);
  bake(CRITTER.icons.note, 16, 16, note);
  bake(CRITTER.icons.bang, 16, 16, bang);
  bake(CRITTER.icons.wheat, 16, 16, wheat);
}

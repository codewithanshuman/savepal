/*
 * The town's own people and animals, going about their day whatever the agreement is doing.
 * Townsfolk wander the real streets -- turning at the crossings, keeping to their side of the
 * road and stopping to chat -- and two soldiers march their rounds. Shoppers browse the bazaar,
 * a dockhand carries crates off the galley, a fisherman tries his luck off the dock. Hens peck in
 * the barnyard, doves scatter from the plazas when someone walks through, butterflies dance over
 * the gardens, ducks paddle on the ponds, fish leap in the sea and the sun glints off the water.
 */
import Phaser from "phaser";
import { GROUND_DEPTH, SKY_DEPTH, projection } from "../reference-city/world/core/worldConstants";
import type { TerrainGrid } from "../reference-city/layouts/terrain";
import { capitolDistrict } from "@sudo-city/protocol";
import { CITY_SIZE, type Structure } from "./layout";
import { Cast, Figure, STILL, type Effects, type Person } from "./rig";
import { CRITTER } from "./textures/critters";
import { COIN_TEXTURES } from "./coins";
import { ISLAND_BOUNDS, POOLS } from "./island";
import { RES } from "./textures/atelier";

const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Phones get a lighter crowd: fewer walkers, glints and butterflies. */
const LIGHT = typeof window !== "undefined" && window.innerWidth < 900;
const CIVILIANS: Person[] = ["architect", "carpenter", "gardener", "miner", "chef", "gardener", "architect", "carpenter", "miner", "gardener", "architect", "carpenter", "chef", "archer"];
/** Depth of things on the open sea: over the cliffs and surf, under every ship and the port. */
const SEA_DEPTH = GROUND_DEPTH + 5.5;
const capitol = capitolDistrict(CITY_SIZE);
const at = (u: number, v: number, z = 0) => { const p = projection.project(u, v); return { x: p.x, y: p.y - z }; };
type Rect = { u0: number; v0: number; u1: number; v1: number };
const inside = (r: Rect) => ({ u: r.u0 + Math.random() * (r.u1 - r.u0), v: r.v0 + Math.random() * (r.v1 - r.v0) });

type Wanderer = { fig: Figure; x: number; y: number; dx: number; dy: number; tu: number; tv: number; speed: number; wait: number; cool: number; soldier: boolean };
type Hen = { img: Phaser.GameObjects.Image; frames: readonly string[]; u: number; v: number; tu: number; tv: number; mode: "walk" | "peck" | "rest"; until: number; area: Rect };
type Dove = { img: Phaser.GameObjects.Sprite; u: number; v: number; z: number; from: { u: number; v: number }; to: { u: number; v: number }; t: number; flying: boolean; until: number; calm: number; flock: number };
type Flutter = { img: Phaser.GameObjects.Image; u: number; v: number; z: number; tu: number; tv: number; area: Rect; rest: number; seed: number };
type Duck = { img: Phaser.GameObjects.Image; cu: number; cv: number; r: number; a: number; speed: number };
type Fisher = { fig: Figure; line: Phaser.GameObjects.Graphics; mode: "wait" | "bite" | "reel"; until: number; jerk: number };

export class Townsfolk {
  private sig = "";
  private road = new Set<string>();
  private readonly cast = new Cast();
  private wanderers: Wanderer[] = [];
  private hens: Hen[] = [];
  private doves: Dove[] = [];
  private flocks: Array<{ spots: Rect }> = [];
  private flutters: Flutter[] = [];
  private ducks: Duck[] = [];
  private fisher?: Fisher;
  private glints: Array<{ img: Phaser.GameObjects.Image; t: number; life: number }> = [];
  private objects: Phaser.GameObjects.GameObject[] = [];
  private chatAt = 0;
  private fishAt = 0;
  private dock?: { x: number; y: number };
  /** Night dims the glints into starlight and sends the doves to roost. */
  night = 0;

  constructor(private readonly scene: Phaser.Scene, private readonly fx: Effects) {}

  build(structures: Structure[], terrain?: TerrainGrid): void {
    const sig = structures.map(s => `${s.path}:${s.kind}`).join("|") + `#${terrain?.roads.length ?? 0}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.clear();
    this.road = new Set((terrain?.roads ?? []).map(c => `${c.x},${c.y}`));
    const find = (kind: string) => structures.filter(s => s.kind === kind);
    const one = (role: Structure["role"]) => structures.find(s => s.role === role);
    // townsfolk and two soldiers walking the streets
    const roads = terrain?.roads ?? [];
    if (roads.length) {
      const taken = new Set<string>();
      const spawn = (who: Person, soldier: boolean) => {
        let cell = roads[Math.floor(Math.random() * roads.length)]!;
        for (let k = 0; k < 10 && taken.has(`${cell.x},${cell.y}`); k++) cell = roads[Math.floor(Math.random() * roads.length)]!;
        taken.add(`${cell.x},${cell.y}`);
        const fig = new Figure(this.scene, who, this.fx).place(cell.x, cell.y).setPose(soldier ? "march" : "walk");
        const w: Wanderer = { fig, x: cell.x, y: cell.y, dx: 0, dy: 0, tu: cell.x, tv: cell.y, speed: soldier ? .55 : .5 + Math.random() * .3, wait: Math.random() * 1500, cool: 4000 + Math.random() * 8000, soldier };
        this.next(w);
        this.wanderers.push(w);
      };
      (LIGHT ? CIVILIANS.slice(0, 9) : CIVILIANS).forEach(p => spawn(p, false));
      spawn("swordsman", true); spawn("spearman", true);
    }
    // shoppers browsing along the bazaar's stalls
    const bazaar = one("bazaar");
    if (bazaar) (["architect", "carpenter", "gardener", "miner"] as Person[]).forEach((who, i) => {
      const f = new Figure(this.scene, who, this.fx).place(bazaar.x - 3.6 + i * 2.4, bazaar.y + 2.5).look(i % 2 ? -1 : 1);
      f.fidget = true;
      this.cast.add(f, { area: { u0: bazaar.x - 4.4, u1: bazaar.x + 4.4, v0: bazaar.y + 2.3, v1: bazaar.y + 2.95 }, work: i === 2 ? "chat" : "idle", speed: .42, wait: [2400, 6000] });
    });
    // the port: a dockhand unloading the galley, and a fisherman off the end of the dock
    const port = one("port");
    if (port) {
      const deck = -127;
      const hand = new Figure(this.scene, "carpenter", this.fx).place(port.x + 5.4, port.y + 3.1, deck - 1);
      this.cast.add(hand, { spots: [
        { u: port.x + 7.7, v: port.y + 2.7, z: deck, pose: "idle", ms: 1400, look: 1, carry: CRITTER.crate },
        { u: port.x + 5.3, v: port.y + 3.15, z: deck - 1, pose: "idle", ms: 1200, look: -1, carry: null },
      ], speed: .5 });
      const fig = new Figure(this.scene, "gardener", this.fx).place(port.x + 8.7, port.y + 3.5, deck).look(-1).setPose("sit");
      this.cast.add(fig);
      const line = this.scene.add.graphics().setDepth(fig.root.depth + 1);
      this.objects.push(line);
      this.fisher = { fig, line, mode: "wait", until: this.scene.time.now + 5000, jerk: 0 };
      this.dock = at(port.x + 8, port.y + 3, -130);
    }
    // hens in the barnyard
    for (const barn of find("barn")) {
      const area = { u0: barn.x + .9, u1: barn.x + 2.1, v0: barn.y + 1.0, v1: barn.y + 2.1 };
      for (let i = 0; i < 4; i++) {
        const p = inside(area), frames = i % 2 ? CRITTER.brownHen : CRITTER.hen;
        const img = this.add(this.scene.add.image(0, 0, frames[0]).setOrigin(.5, 1).setScale(.62 / RES));
        this.hens.push({ img, frames, u: p.u, v: p.v, tu: p.u, tv: p.v, mode: "peck", until: Math.random() * 2000, area });
      }
    }
    // doves on the plazas: before the treasury, the bazaar and the palace gate
    const palace = one("palace");
    const plazas: Rect[] = [{ u0: capitol.centerX - 1.6, u1: capitol.centerX + 1.6, v0: capitol.maxY + .6, v1: capitol.maxY + 1.1 }];
    if (bazaar) plazas.push({ u0: bazaar.x - 1.6, u1: bazaar.x + 1.6, v0: bazaar.y + 3.0, v1: bazaar.y + 3.4 });
    if (palace) plazas.push({ u0: palace.x - 1.4, u1: palace.x + 1.4, v0: palace.y + 6.25, v1: palace.y + 6.7 });
    this.flocks = plazas.map(spots => ({ spots }));
    plazas.forEach((r, flock) => {
      for (let i = 0; i < 5; i++) {
        const p = inside(r);
        const img = this.add(this.scene.add.sprite(0, 0, CRITTER.dove[0]).setOrigin(.5, 1).setScale(.8 / RES));
        this.doves.push({ img, u: p.u, v: p.v, z: 0, from: p, to: p, t: 0, flying: false, until: Math.random() * 1500, calm: 0, flock });
      }
    });
    // butterflies over the flowers, fruit and gardens
    const gardens = [...find("park"), ...find("orchard"), ...find("strawberries"), ...find("blueberries"), ...find("vineyard")];
    if (palace) gardens.push({ ...palace, x: palace.x - 6.5, y: palace.y + 5.4 }, { ...palace, x: palace.x + 6.5, y: palace.y + 5.4 });
    gardens.forEach((g, gi) => {
      const area = { u0: g.x - 1.8, u1: g.x + 1.8, v0: g.y - 1.8, v1: g.y + 1.8 };
      for (let i = 0; i < (LIGHT ? 1 : 2); i++) {
        const p = inside(area);
        const img = this.add(this.scene.add.image(0, 0, CRITTER.butterflies[(gi * 2 + i) % CRITTER.butterflies.length]!).setScale(.7 / RES));
        this.flutters.push({ img, u: p.u, v: p.v, z: 10, tu: p.u, tv: p.v, area, rest: 0, seed: Math.random() * 100 });
      }
    });
    // ducks on the park pond and on the waterfalls' spring pools
    const ponds: Array<{ u: number; v: number; r: number }> = [...find("park").map(p => ({ u: p.x - 1.2, v: p.y - 1.2, r: .32 })), ...POOLS.map(p => ({ ...p, r: .3 }))];
    for (const pond of ponds) for (let i = 0; i < 2; i++) {
      const img = this.add(this.scene.add.image(0, 0, CRITTER.duck).setOrigin(.5, .8).setScale(.62 / RES));
      this.ducks.push({ img, cu: pond.u, cv: pond.v, r: pond.r * (.55 + i * .4), a: Math.random() * Math.PI * 2, speed: (.35 + Math.random() * .25) * (i ? -1 : 1) });
    }
    // sun on the water
    if (!STILL) for (let i = 0; i < (LIGHT ? 18 : 34); i++) {
      const img = this.add(this.scene.add.image(0, 0, "savepal:glint").setBlendMode(Phaser.BlendModes.ADD).setDepth(SEA_DEPTH).setAlpha(0));
      this.glints.push({ img, t: -Math.random() * 3000, life: 900 + Math.random() * 900 });
    }
  }

  private add<T extends Phaser.GameObjects.GameObject>(o: T): T { this.objects.push(o); return o; }

  /** Picks the walker's next street cell: usually straight on, never back the way it came unless the street ends. */
  private next(w: Wanderer): void {
    const opts = DIRS.filter(([dx, dy]) => this.road.has(`${w.x + dx},${w.y + dy}`));
    let choices = opts.filter(([dx, dy]) => !(dx === -w.dx && dy === -w.dy));
    if (!choices.length) choices = opts;
    if (!choices.length) { w.wait = Number.POSITIVE_INFINITY; return; }
    const straight = choices.find(([dx, dy]) => dx === w.dx && dy === w.dy);
    const [dx, dy] = straight && Math.random() < .72 ? straight : choices[Math.floor(Math.random() * choices.length)]!;
    w.dx = dx; w.dy = dy; w.x += dx; w.y += dy;
    // everyone keeps to their own side of the street, so people pass rather than collide
    w.tu = w.x - dy * .32; w.tv = w.y + dx * .32;
  }

  update(dt: number, now: number): void {
    if (STILL) { for (const w of this.wanderers) w.fig.update(dt); this.cast.update(dt); this.still(); return; }
    // the streets
    for (const w of this.wanderers) {
      if (w.wait > 0) { w.wait -= dt; if (w.wait <= 0) { w.fig.setPose(w.soldier ? "march" : "walk"); w.fig.fidget = false; } }
      else {
        const du = w.tu - w.fig.u, dv = w.tv - w.fig.v, d = Math.hypot(du, dv), step = w.speed * dt / 1000;
        if (d <= step) {
          w.fig.place(w.tu, w.tv);
          if (!w.soldier && Math.random() < .05) { w.wait = 1400 + Math.random() * 2600; w.fig.setPose("idle"); w.fig.fidget = true; }
          this.next(w);
        } else w.fig.place(w.fig.u + du / d * step, w.fig.v + dv / d * step);
      }
      w.cool -= dt;
      w.fig.update(dt);
    }
    if (now > this.chatAt) { this.chatAt = now + 350; this.meet(); }
    this.cast.update(dt);
    this.fish(now);
    this.updateHens(dt, now);
    this.updateDoves(dt, now);
    this.updateFlutters(dt, now);
    this.updateDucks(dt, now);
    this.updateSea(dt, now);
  }

  /** Neighbours who meet on the street sometimes stop for a word. */
  private meet(): void {
    const ws = this.wanderers;
    for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
      const a = ws[i]!, b = ws[j]!;
      if (a.soldier || b.soldier || a.wait > 0 || b.wait > 0 || a.cool > 0 || b.cool > 0) continue;
      if (Math.abs(a.fig.u - b.fig.u) + Math.abs(a.fig.v - b.fig.v) > .95) continue;
      a.cool = b.cool = 22000 + Math.random() * 12000;
      if (Math.random() < .45) continue;
      const talk = 2600 + Math.random() * 1400, sx = (b.fig.u - b.fig.v) - (a.fig.u - a.fig.v);
      a.wait = b.wait = talk;
      a.fig.setPose("chat").look(sx >= 0 ? 1 : -1); b.fig.setPose("chat").look(sx >= 0 ? -1 : 1);
      const icons = [CRITTER.icons.heart, CRITTER.icons.note, CRITTER.icons.bang, CRITTER.icons.wheat, COIN_TEXTURES.coin];
      this.say(a.fig, icons[Math.floor(Math.random() * icons.length)]!, 0);
      this.say(b.fig, icons[Math.floor(Math.random() * icons.length)]!, 1100);
    }
  }

  /** A speech bubble with an icon over someone's head. */
  private say(fig: Figure, icon: string, delay: number): void {
    this.scene.time.delayedCall(delay, () => {
      if (!fig.root.active) return;
      const bg = this.scene.add.image(0, 0, CRITTER.bubble).setOrigin(.5, 1).setScale(1 / RES);
      const ic = this.scene.add.image(-.5, -15, icon).setDisplaySize(12, 12);
      const box = this.scene.add.container(fig.root.x, fig.headY - 2, [bg, ic]).setDepth(SKY_DEPTH - 70).setScale(0);
      this.objects.push(box);
      this.scene.tweens.add({ targets: box, scale: 1, duration: 220, ease: "Back.easeOut" });
      this.scene.tweens.add({ targets: box, alpha: 0, y: box.y - 6, delay: 2000, duration: 300, onComplete: () => { box.destroy(); const i = this.objects.indexOf(box); if (i >= 0) this.objects.splice(i, 1); } });
    });
  }

  /** The fisherman: a line in the water, a bite, a fish landed on the dock. */
  private fish(now: number): void {
    const f = this.fisher;
    if (!f) return;
    const fig = f.fig, dir = fig.facingDir, g = f.line;
    if (f.mode === "wait" && now > f.until) { f.mode = "bite"; f.until = now + 1500; }
    else if (f.mode === "bite" && now > f.until) {
      f.mode = "reel"; f.until = now + 900; f.jerk = 1;
      const float = this.floatAt(now), land = { x: fig.root.x - 14 * dir, y: fig.root.y - 4 };
      this.fx.emit("splash", float.x, float.y, fig.root.depth + 2, 10);
      const catchFish = this.scene.add.image(float.x, float.y, CRITTER.fish).setScale(.9 / RES).setDepth(fig.root.depth + 2).setFlipX(dir > 0);
      this.objects.push(catchFish);
      this.scene.tweens.addCounter({ from: 0, to: 1, duration: 760, ease: "Sine.easeInOut", onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        catchFish.setPosition(float.x + (land.x - float.x) * t, float.y + (land.y - float.y) * t - Math.sin(t * Math.PI) * 46).setAngle((t - .5) * 160 * -dir);
      }, onComplete: () => { this.scene.tweens.add({ targets: catchFish, alpha: 0, duration: 400, delay: 300, onComplete: () => catchFish.destroy() }); fig.cheer(1300); } });
    } else if (f.mode === "reel" && now > f.until) { f.mode = "wait"; f.until = now + 8000 + Math.random() * 9000; }
    f.jerk = Math.max(0, f.jerk - .045);
    // the rod, the line sagging to a float bobbing on the swell
    const hand = { x: fig.root.x + 8 * dir, y: fig.root.y - 9 };
    const tip = { x: hand.x + (23 - f.jerk * 8) * dir, y: hand.y - 20 - f.jerk * 14 };
    const float = this.floatAt(now);
    g.clear().setDepth(fig.root.depth + 1);
    g.lineStyle(1.7, 0x6b4527, 1).lineBetween(hand.x, hand.y, tip.x, tip.y);
    g.lineStyle(.7, 0xf4f1ea, .9).beginPath().moveTo(tip.x, tip.y);
    for (let k = 1; k <= 8; k++) { const t = k / 8; g.lineTo(tip.x + (float.x - tip.x) * t, tip.y + (float.y - tip.y) * t + Math.sin(t * Math.PI) * (6 - f.jerk * 6)); }
    g.strokePath();
    if (f.mode !== "reel") {
      g.lineStyle(.7, 0xffffff, .55).strokeEllipse(float.x, float.y + .5, 9 + Math.sin(now / 260) * 2, 3.2);
      g.fillStyle(0xd8392b, 1).fillCircle(float.x, float.y - 1.4, 1.8).fillStyle(0xffffff, 1).fillCircle(float.x, float.y - 2.8, 1.2);
    }
  }
  private floatAt(now: number): { x: number; y: number } {
    const fig = this.fisher!.fig, p = at(fig.u - .1, fig.v + 1.15, -130);
    const bite = this.fisher!.mode === "bite" ? Math.abs(Math.sin(now / 70)) * 2.6 : 0;
    return { x: p.x, y: p.y + Math.sin(now / 320) * 1.1 + bite };
  }

  private updateHens(dt: number, now: number): void {
    for (const h of this.hens) {
      if (h.mode === "walk") {
        const du = h.tu - h.u, dv = h.tv - h.v, d = Math.hypot(du, dv), step = .32 * dt / 1000;
        if (d <= step) { h.u = h.tu; h.v = h.tv; h.mode = "peck"; h.until = now + 1200 + Math.random() * 2400; }
        else { h.u += du / d * step; h.v += dv / d * step; if (Math.abs(du - dv) > .01) h.img.setFlipX(du - dv < 0); }
      } else if (now > h.until) {
        if (h.mode === "peck" && Math.random() < .35) { h.mode = "rest"; h.until = now + 600 + Math.random() * 1200; }
        else { const p = inside(h.area); h.tu = p.u; h.tv = p.v; h.mode = "walk"; }
      }
      const p = at(h.u, h.v), strut = h.mode === "walk" ? Math.abs(Math.sin(now / 90)) * 1.2 : 0;
      h.img.setTexture(h.frames[h.mode === "peck" && Math.floor(now / 190) % 2 ? 1 : 0]!).setPosition(p.x, p.y - strut).setDepth(projection.depth(h.u, h.v) + 1);
    }
  }

  private updateDoves(dt: number, now: number): void {
    // only people walking the streets put the doves up; shoppers standing about do not
    for (const d of this.doves) {
      if (d.flying) {
        d.t += dt / 2200;
        const t = Math.min(1, d.t);
        d.u = d.from.u + (d.to.u - d.from.u) * t; d.v = d.from.v + (d.to.v - d.from.v) * t; d.z = Math.sin(t * Math.PI) * 70;
        const p = at(d.u, d.v, d.z);
        d.img.setPosition(p.x, p.y).setDepth(SKY_DEPTH - 90).setFlipX(d.to.u - d.to.v < d.from.u - d.from.v);
        if (t >= 1) { d.flying = false; d.z = 0; d.img.stop().clearTint().setTexture(CRITTER.dove[0]).setScale(.8 / RES); d.until = now + 800; d.calm = now + 3000; }
        continue;
      }
      // a walker coming through puts up the whole flock
      if (now > d.calm && this.wanderers.some(w => w.wait <= 0 && Math.abs(w.fig.u - d.u) + Math.abs(w.fig.v - d.v) < .8)) { this.scatter(d.flock); continue; }
      if (now > d.until) { d.until = now + 500 + Math.random() * 1800; if (Math.random() < .3) { d.u += (Math.random() - .5) * .3; d.v += (Math.random() - .5) * .2; d.img.setFlipX(Math.random() < .5); } }
      const p = at(d.u, d.v), pecking = Math.floor((now + d.flock * 97 + d.u * 1000) / 260) % 3 === 0;
      d.img.setTexture(CRITTER.dove[pecking ? 1 : 0]).setPosition(p.x, p.y).setDepth(projection.depth(d.u, d.v) + 1);
    }
  }
  private scatter(flock: number): void {
    const others = this.flocks.length > 1 ? this.flocks.filter((_, i) => i !== flock) : this.flocks;
    const dest = others[Math.floor(Math.random() * others.length)]!;
    for (const d of this.doves) if (d.flock === flock && !d.flying) {
      d.flying = true; d.t = -Math.random() * .12; d.from = { u: d.u, v: d.v }; d.to = inside(dest.spots); d.flock = this.flocks.indexOf(dest);
      d.img.setScale(.75 / RES).setTint(0xdfe3ea).play("savepal:gull");
    }
  }

  private updateFlutters(dt: number, now: number): void {
    for (const b of this.flutters) {
      if (b.rest > 0) { b.rest -= dt; b.z = Math.max(4, b.z - dt * .02); }
      else {
        const du = b.tu - b.u, dv = b.tv - b.v, d = Math.hypot(du, dv), step = .55 * dt / 1000;
        if (d <= step) { const p = inside(b.area); b.tu = p.u; b.tv = p.v; if (Math.random() < .3) b.rest = 1200 + Math.random() * 1800; }
        else { b.u += du / d * step + Math.sin(now / 160 + b.seed) * .004; b.v += dv / d * step + Math.cos(now / 190 + b.seed) * .004; }
        b.z += ((12 + Math.sin(now / 300 + b.seed) * 7) - b.z) * .05;
      }
      const p = at(b.u, b.v, b.z), flap = b.rest > 0 ? .55 + .45 * Math.abs(Math.sin(now / 600 + b.seed)) : .2 + .8 * Math.abs(Math.sin(now / 45 + b.seed));
      b.img.setPosition(p.x, p.y).setScale((.7 / RES) * flap, .7 / RES).setDepth(projection.depth(b.u, b.v) + 3).setVisible(this.night < .6);
    }
  }

  private updateDucks(dt: number, now: number): void {
    for (const d of this.ducks) {
      d.a += d.speed * dt / 1000;
      const u = d.cu + Math.cos(d.a) * d.r, v = d.cv + Math.sin(d.a) * d.r * .9, p = at(u, v);
      const heading = -Math.sin(d.a) * d.speed - Math.cos(d.a) * d.speed * .9; // screen x of the velocity
      d.img.setPosition(p.x, p.y + Math.sin(now / 420 + d.a) * .8).setFlipX(heading < 0).setDepth(projection.depth(u, v) + 1);
    }
  }

  /** Glints of sun on the sea (starlight by night), and fish leaping from it. */
  private updateSea(dt: number, now: number): void {
    for (const g of this.glints) {
      g.t += dt;
      if (g.t < 0) continue;
      if (g.t > g.life) {
        const spot = this.seaSpot();
        g.t = -Math.random() * 1600; g.life = 800 + Math.random() * 900;
        if (spot) g.img.setPosition(spot.x, spot.y);
        g.img.setAlpha(0);
        continue;
      }
      const k = Math.sin(g.t / g.life * Math.PI), starlight = this.night;
      g.img.setAlpha(k * (.9 - starlight * .25)).setScale((.12 + k * .2) * (1 - starlight * .3)).setTint(starlight > .5 ? 0xcfe0ff : 0xffffff);
    }
    if (now > this.fishAt) {
      this.fishAt = now + 1800 + Math.random() * 2600;
      const spot = this.seaSpot();
      if (spot) this.leap(spot.x, spot.y);
    }
  }
  private leap(x: number, y: number): void {
    const dir = Math.random() < .5 ? 1 : -1, dx = (26 + Math.random() * 20) * dir, h = 22 + Math.random() * 18;
    const fish = this.add(this.scene.add.image(x, y, CRITTER.fish).setScale(.85 / RES).setDepth(SEA_DEPTH + .2).setFlipX(dir < 0));
    this.ring(x, y); this.fx.emit("splash", x, y, SEA_DEPTH + .3, 6);
    this.scene.tweens.addCounter({ from: 0, to: 1, duration: 820, onUpdate: (tw) => {
      const t = tw.getValue() ?? 0;
      fish.setPosition(x + dx * t, y - Math.sin(t * Math.PI) * h).setAngle((t - .5) * 110 * dir);
    }, onComplete: () => { this.ring(x + dx, y); this.fx.emit("splash", x + dx, y, SEA_DEPTH + .3, 6); fish.destroy(); const i = this.objects.indexOf(fish); if (i >= 0) this.objects.splice(i, 1); } });
  }
  private ring(x: number, y: number): void {
    const r = this.scene.add.ellipse(x, y, 10, 4).setStrokeStyle(1.4, 0xffffff, .85).setDepth(SEA_DEPTH + .1);
    r.isFilled = false;
    this.scene.tweens.add({ targets: r, scaleX: 3.4, scaleY: 3.4, alpha: 0, duration: 1100, ease: "Sine.easeOut", onComplete: () => r.destroy() });
  }

  /** A point of open water in view: not on the island, not behind its cliffs, clear of the dock. */
  private seaSpot(): { x: number; y: number } | null {
    const view = this.scene.cameras.main.worldView, { U0, V0, U1, V1, CLIFF } = ISLAND_BOUNDS;
    const onIsland = (x: number, y: number) => { const g = projection.unproject(x, y); return g.x >= U0 - .4 && g.x <= U1 + .4 && g.y >= V0 - .4 && g.y <= V1 + .4; };
    for (let k = 0; k < 14; k++) {
      const x = view.x + Math.random() * view.width, y = view.y + Math.random() * view.height;
      if (onIsland(x, y) || onIsland(x, y - CLIFF - 14)) continue;
      if (this.dock && Math.abs(x - this.dock.x) < 260 && Math.abs(y - this.dock.y) < 150) continue;
      return { x, y };
    }
    return null;
  }

  /** Reduced motion: everyone and everything stands where it is. */
  private still(): void {
    for (const h of this.hens) { const p = at(h.u, h.v); h.img.setPosition(p.x, p.y).setDepth(projection.depth(h.u, h.v) + 1); }
    for (const d of this.doves) { const p = at(d.u, d.v); d.img.setPosition(p.x, p.y).setDepth(projection.depth(d.u, d.v) + 1); }
    for (const b of this.flutters) b.img.setVisible(false);
    for (const d of this.ducks) { const u = d.cu + Math.cos(d.a) * d.r, v = d.cv + Math.sin(d.a) * d.r, p = at(u, v); d.img.setPosition(p.x, p.y).setDepth(projection.depth(u, v) + 1); }
  }

  /** Money moved: the whole town jumps for joy. */
  cheer(): void { for (const w of this.wanderers) w.fig.cheer(); this.cast.cheer(); }

  /** Everyone walking the streets or working in town, for the night's lanterns. */
  get people(): Figure[] { return [...this.wanderers.map(w => w.fig), ...this.cast.figs]; }

  private clear(): void {
    for (const w of this.wanderers) w.fig.destroy();
    this.wanderers = [];
    this.cast.clear();
    for (const o of this.objects) { this.scene.tweens.killTweensOf(o); o.destroy(); }
    this.objects = []; this.hens = []; this.doves = []; this.flutters = []; this.ducks = []; this.glints = []; this.flocks = [];
    this.fisher = undefined; this.dock = undefined;
  }

  destroy(): void { this.clear(); this.sig = ""; }
}

/*
 * The kingdom's life, alongside the engine's own ambient traffic and ships. Everything here either
 * moves (flags, sails, smoke, people, gulls, biplanes) or reports a real state of the agreement:
 *
 *   PayPal holds the gold   -> the full palace guard is posted and the windmills turn fast
 *   the guild is working    -> the carpenter and the miner are at work in the guild yard
 *   inspectors on patrol    -> the architect stands at the page being read
 *   bounties paid           -> a golden stall in the bazaar for each
 *   an appeal is open       -> archers on watch at the port
 *   any money moves         -> the banner plane flies over with the news
 */
import Phaser from "phaser";
import { SKY_DEPTH, projection } from "../reference-city/world/core/worldConstants";
import type { Structure } from "./layout";
import { CITY_SIZE } from "./layout";
import { PALACE_FLAGS, PALACE_POSTS } from "./textures/palace";
import { BOUNTY_SLOTS, GUILD_FLAG, PORT_FLAG, TOWN } from "./textures/town";
import { WINDMILL_HUB } from "./textures/farms";
import { FLAG_FRAMES, GULL, PLANES, SAILS, flagKey, type FlagColor } from "./textures/sky";
import { RES } from "./textures/atelier";

export const PEOPLE = ["architect", "miner", "carpenter", "gardener", "chef", "spearman", "swordsman", "archer"] as const;
export type Person = (typeof PEOPLE)[number];
export const personKey = (p: Person) => `savepal:person:${p}`;
export const personUrl = (p: Person) => `/realm/people/${p}.png`;
const PERSON_SCALE = .27;

export type LifeState = { held: boolean; paid: boolean; working: boolean; appealOpen: boolean; bounties: number; inspecting: string | null; banner: string; mainFlag: FlagColor };

/** Draw order for a structure's sprite: estates sort by a point just in front of their centre. */
export function structureDepth(s: Structure): number {
  return s.role === "palace" || s.role === "bazaar" ? projection.depth(s.x, s.y + 1) : projection.depth(s.x, s.y) + 5;
}
const at = (gx: number, gy: number, z = 0) => { const p = projection.project(gx, gy); return { x: p.x, y: p.y - z }; };

/** Road walks: [x0, y0] to [x1, y1] along one street, and who walks it. */
const WALKS: Array<{ who: Person; from: [number, number]; to: [number, number]; ms: number }> = [
  { who: "chef", from: [19, 24], to: [41, 24], ms: 30000 },
  { who: "gardener", from: [6, 13], to: [6, 34], ms: 32000 },
  { who: "carpenter", from: [19, 12], to: [46, 12], ms: 36000 },
  { who: "miner", from: [36, 1], to: [36, 34], ms: 42000 },
  { who: "architect", from: [1, 30], to: [30, 30], ms: 38000 },
  { who: "spearman", from: [5, 12], to: [17, 12], ms: 20000 },
  { who: "gardener", from: [42, 1], to: [42, 34], ms: 40000 },
];

export class KingdomLife {
  private fixtures: Phaser.GameObjects.GameObject[] = [];
  private stateful: Phaser.GameObjects.GameObject[] = [];
  private skyObjects: Phaser.GameObjects.GameObject[] = [];
  private timers: Phaser.Time.TimerEvent[] = [];
  private sails: Phaser.Tweens.Tween[] = [];
  private walks: Phaser.Tweens.Tween[] = [];
  private structures: Structure[] = [];
  private planSig = "";
  private stateSig = "";
  private bannerRun?: () => void;
  private bannerText?: Phaser.GameObjects.Text;
  private bannerCloth?: Phaser.GameObjects.Graphics;
  /** Only the viewer's own reduced-motion setting stills the kingdom. */
  private readonly still = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private readonly scene: Phaser.Scene) {}

  private anims(): void {
    const a = this.scene.anims;
    for (const color of ["royal", "crimson", "gold", "green", "paypal"] as FlagColor[]) {
      const key = `savepal:flag:${color}`;
      if (!a.exists(key)) a.create({ key, frames: Array.from({ length: FLAG_FRAMES }, (_, i) => ({ key: flagKey(color, i) })), frameRate: 9, repeat: -1 });
    }
    if (!a.exists("savepal:gull")) a.create({ key: "savepal:gull", frames: GULL.map(key => ({ key })), frameRate: 5, repeat: -1 });
    for (const c of ["red", "blue"] as const) if (!a.exists(`savepal:plane:${c}`)) a.create({ key: `savepal:plane:${c}`, frames: PLANES[c].map(key => ({ key })), frameRate: 18, repeat: -1 });
    for (const p of PEOPLE) { const t = this.scene.textures.get(personKey(p)); if (t && t.key !== "__MISSING") t.setFilter(Phaser.Textures.FilterMode.LINEAR); }
  }

  private flag(x: number, y: number, color: FlagColor, depth: number, i = 0): Phaser.GameObjects.Sprite {
    const s = this.scene.add.sprite(x, y, flagKey(color, 0)).setOrigin(.04, .1).setScale(1 / RES).setDepth(depth);
    if (!this.still) s.play({ key: `savepal:flag:${color}`, startFrame: i % FLAG_FRAMES });
    return s;
  }

  private person(who: Person, gx: number, gy: number, z = 0, flip = false, extraDepth = 1): Phaser.GameObjects.Image {
    const p = at(gx, gy, z);
    return this.scene.add.image(p.x, p.y, personKey(who)).setOrigin(.5, 1).setScale(PERSON_SCALE).setFlipX(flip).setDepth(projection.depth(gx, gy) + extraDepth);
  }

  /** A person standing at work: a small rhythmic bob. */
  private busy(img: Phaser.GameObjects.Image, ms = 520): void {
    if (this.still) return;
    this.scene.tweens.add({ targets: img, y: img.y - 3, duration: ms, yoyo: true, repeat: -1, ease: "Sine.easeInOut", delay: Math.random() * 400 });
  }

  /** Rebuilds the fixed life of the plan: flags, sails, smoke, walkers. Cheap to call; only redraws when the plan changes. */
  build(structures: Structure[]): void {
    const sig = structures.map(s => `${s.path}:${s.kind}`).join("|");
    this.structures = structures;
    if (sig === this.planSig) return;
    this.planSig = sig; this.stateSig = "";
    this.walks.forEach(t => t.stop()); this.walks = [];
    this.clear(this.fixtures); this.sails = [];
    this.timers.forEach(t => t.remove()); this.timers = [];
    this.anims();
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => { this.fixtures.push(o); return o; };
    for (const s of structures) {
      const d = structureDepth(s);
      if (s.kind === "palace") PALACE_FLAGS.forEach((f, i) => { if (f.main) return; const p = at(s.x + f.u, s.y + f.v, f.z); add(this.flag(p.x, p.y, i % 2 ? "crimson" : "royal", d + 2, i)); });
      if (s.kind === "port") { const p = at(s.x + PORT_FLAG.u, s.y + PORT_FLAG.v, PORT_FLAG.z); add(this.flag(p.x, p.y, "paypal", d + 2, 3)); }
      if (s.kind === "windmill") {
        const p = at(s.x + WINDMILL_HUB.u, s.y + WINDMILL_HUB.v, WINDMILL_HUB.z);
        const sail = add(this.scene.add.image(p.x, p.y, SAILS).setScale(1.35 / RES).setDepth(d + 3).setAngle(Math.random() * 90));
        if (!this.still) this.sails.push(this.scene.tweens.add({ targets: sail, angle: "+=360", duration: 9000, repeat: -1 }));
      }
      if (s.kind === "guild" && !this.still) {
        const p = at(s.x + GUILD_FLAG.u, s.y + GUILD_FLAG.v, GUILD_FLAG.z + 4);
        this.timers.push(this.scene.time.addEvent({ delay: 700, loop: true, callback: () => this.puff(p.x, p.y, d + 4) }));
      }
      if (s.kind === "strawberries" || s.kind === "blueberries") { const g = add(this.person("gardener", s.x - .6, s.y + .4, 0, true)); this.busy(g, 700); }
      // the chef stands on open paving in front of the fountain, between the two stall rows
      if (s.kind === "bazaar") { const c = add(this.person("chef", s.x + .05, s.y + 1.8)); this.busy(c, 900); }
      if (s.kind === "barn") add(this.person("miner", s.x + 1.6, s.y + .5, 0, true));
    }
    if (!this.still) for (const w of WALKS) add(this.walker(w.who, w.from, w.to, w.ms));
    if (!this.skyObjects.length) { this.buildSky(); this.buildSeas(); }
  }

  private puff(x: number, y: number, depth: number): void {
    const c = this.scene.add.circle(x + (Math.random() - .5) * 4, y, 4 + Math.random() * 2, 0xf4f1ea, .7).setDepth(depth);
    this.scene.tweens.add({ targets: c, y: y - 46, x: c.x + 14, scale: 2.4, alpha: 0, duration: 2600, ease: "Sine.easeOut", onComplete: () => c.destroy() });
  }

  /** A villager walking a street end to end and back, facing the way they walk. */
  private walker(who: Person, from: [number, number], to: [number, number], ms: number): Phaser.GameObjects.Image {
    const img = this.person(who, from[0], from[1]);
    const goesRight = (to[0] - from[0]) - (to[1] - from[1]) > 0;
    let forward = true;
    this.walks.push(this.scene.tweens.addCounter({
      from: 0, to: 1, duration: ms, yoyo: true, repeat: -1, delay: Math.random() * ms * .5,
      onYoyo: () => { forward = false; }, onRepeat: () => { forward = true; },
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0, gx = from[0] + (to[0] - from[0]) * t, gy = from[1] + (to[1] - from[1]) * t, p = at(gx, gy);
        if (img.active) img.setPosition(p.x, p.y - Math.abs(Math.sin(t * ms / 160)) * 2).setDepth(projection.depth(gx, gy) + 1).setFlipX(forward ? !goesRight : goesRight);
      },
    }));
    return img;
  }

  /** Re-poses the guards, workers, stalls, the main flag and the banner from the agreement's state. */
  setState(state: LifeState): void {
    const sig = JSON.stringify(state);
    if (sig === this.stateSig || !this.structures.length) return;
    this.stateSig = sig;
    this.clear(this.stateful);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => { this.stateful.push(o); return o; };
    const find = (pred: (s: Structure) => boolean) => this.structures.find(pred);
    const palace = find(s => s.kind === "palace"), bazaar = find(s => s.kind === "bazaar"), guild = find(s => s.kind === "guild"), port = find(s => s.kind === "port");
    if (palace) {
      const d = structureDepth(palace), main = PALACE_FLAGS.find(f => f.main)!, p = at(palace.x + main.u, palace.y + main.v, main.z);
      add(this.flag(p.x, p.y, state.mainFlag, d + 3).setScale(1.6 / RES));
      PALACE_POSTS.gate.slice(0, state.held ? 2 : 1).forEach(([u, v], i) => add(this.person("spearman", palace.x + u, palace.y + v, 0, i === 1)));
      PALACE_POSTS.walls.slice(0, state.held ? 4 : 2).forEach(([u, v, z], i) => add(this.person("archer", palace.x + u, palace.y + v, z, i % 2 === 1, 60)));
      const [[pu0, pv0], [pu1, pv1]] = PALACE_POSTS.patrol;
      const knight = add(this.person("swordsman", palace.x + pu0, palace.y + pv0, 0, false, 40));
      if (!this.still) {
        const b = at(palace.x + pu1, palace.y + pv1);
        this.scene.tweens.add({ targets: knight, x: b.x, y: b.y, duration: 5600, yoyo: true, repeat: -1, ease: "Sine.easeInOut", onYoyo: () => knight.setFlipX(true), onRepeat: () => knight.setFlipX(false) });
      }
    }
    if (guild) {
      const c = add(this.person("carpenter", guild.x + 1.25, guild.y + 1.15, 0, true)); if (state.working) this.busy(c, 420);
      if (state.working) { const m = add(this.person("miner", guild.x + 2.05, guild.y + .85)); this.busy(m, 360); }
    }
    const page = state.inspecting ? find(s => s.role === "page" && s.path === `page${state.inspecting!.startsWith("/") ? state.inspecting : `/${state.inspecting}`}`) : undefined;
    if (page) { const arch = add(this.person("architect", page.x + .3, page.y + 2.3)); this.busy(arch, 600); }
    else if (guild) add(this.person("architect", guild.x - .2, guild.y + 2.1));
    if (bazaar) BOUNTY_SLOTS.slice(0, Math.min(state.bounties, BOUNTY_SLOTS.length)).forEach(([u, v]) => {
      const p = at(bazaar.x + u, bazaar.y + v);
      add(this.scene.add.image(p.x, p.y + TOWN.bountyStall.anchorY, TOWN.bountyStall.key).setOrigin(.5, 1).setScale(1 / RES).setDepth(projection.depth(bazaar.x + u, bazaar.y + v) + 1));
    });
    if (port && state.appealOpen) [[3.2, .1], [4.2, -.1]].forEach(([u, v], i) => add(this.person("archer", port.x + u, port.y + v, 3, i === 1)));
    for (const t of this.sails) t.timeScale = state.held ? 2.2 : 1;
    this.setBanner(state.banner);
  }

  /** The kingdom's corners on screen, for the sky's flight paths. */
  private bounds() {
    const top = at(0, 0), right = at(CITY_SIZE.width - 1, 0), bottom = at(CITY_SIZE.width - 1, CITY_SIZE.height - 1), left = at(0, CITY_SIZE.height - 1);
    return { x0: left.x - 700, x1: right.x + 700, y0: top.y, y1: bottom.y };
  }

  private buildSky(): void {
    const b = this.bounds(), sky = (o: Phaser.GameObjects.GameObject) => { this.skyObjects.push(o); return o; };
    // The banner plane: a red biplane towing the agreement's PayPal news across the kingdom.
    const red = this.scene.add.sprite(0, 0, PLANES.red[0]).setScale(1.3 / RES);
    const rope = this.scene.add.graphics();
    const cloth = this.scene.add.graphics();
    const text = this.scene.add.text(0, 0, "", { fontFamily: "Silkscreen, monospace", fontSize: "24px", color: "#003087" }).setOrigin(1, .5).setResolution(2);
    const banner = sky(this.scene.add.container(b.x0, b.y0 + (b.y1 - b.y0) * .2, [rope, cloth, text, red]).setDepth(SKY_DEPTH + 5).setData("baseScale", 1)) as Phaser.GameObjects.Container;
    const redShadow = sky(this.scene.add.ellipse(0, 0, 90, 22, 0x14260f, .16).setDepth(SKY_DEPTH - 50)) as Phaser.GameObjects.Ellipse;
    this.bannerText = text; this.bannerCloth = cloth;
    const drawRope = () => { rope.clear().lineStyle(2, 0x5a4a32, 1).beginPath().moveTo(-58, 8).lineTo(-92, 12).strokePath(); };
    drawRope();
    let flight: Phaser.Tweens.Tween | undefined;
    const run = () => {
      flight?.stop();
      banner.setPosition(b.x0, b.y0 + (b.y1 - b.y0) * (.14 + Math.random() * .2));
      flight = this.scene.tweens.add({
        targets: banner, x: b.x1, duration: 30000, ease: "Linear",
        onUpdate: () => { banner.y += Math.sin(banner.x / 160) * .25; redShadow.setPosition(banner.x - 40, banner.y + 260); },
        onComplete: () => { this.scene.time.delayedCall(14000, run); },
      });
    };
    this.bannerRun = run;
    if (!this.still) { red.play("savepal:plane:red"); run(); } else banner.setVisible(false);
    // A second biplane flies the other way, higher, without a banner.
    const blue = sky(this.scene.add.sprite(b.x1, b.y0 + (b.y1 - b.y0) * .55, PLANES.blue[0]).setFlipX(true).setScale(1.1 / RES).setDepth(SKY_DEPTH + 4).setData("baseScale", 1.1 / RES)) as Phaser.GameObjects.Sprite;
    const blueShadow = sky(this.scene.add.ellipse(0, 0, 70, 18, 0x14260f, .14).setDepth(SKY_DEPTH - 50)) as Phaser.GameObjects.Ellipse;
    if (!this.still) {
      blue.play("savepal:plane:blue");
      const loop = () => { blue.setPosition(b.x1, b.y0 + (b.y1 - b.y0) * (.45 + Math.random() * .3)); this.scene.tweens.add({ targets: blue, x: b.x0, duration: 26000, onUpdate: () => blueShadow.setPosition(blue.x + 30, blue.y + 300), onComplete: () => this.scene.time.delayedCall(9000, loop) }); };
      this.scene.time.delayedCall(6000, loop);
    } else blue.setVisible(false);
    // Gulls in loose flocks.
    if (!this.still) {
      const flock = () => {
        const y = b.y0 + Math.random() * (b.y1 - b.y0) * .8, gulls: Phaser.GameObjects.Sprite[] = [];
        for (let i = 0; i < 6; i++) gulls.push(this.scene.add.sprite(b.x1 + i * 40, y + Math.abs(i - 2.5) * 22, GULL[0]).setScale(1.6 / RES).setDepth(SKY_DEPTH + 6).setData("baseScale", 1.6 / RES).play({ key: "savepal:gull", startFrame: i % 2 }));
        gulls.forEach(g => sky(g));
        this.scene.tweens.add({ targets: gulls, x: `-=${b.x1 - b.x0}`, duration: 34000, onComplete: () => gulls.forEach(g => { const i = this.skyObjects.indexOf(g); if (i >= 0) this.skyObjects.splice(i, 1); g.destroy(); }) });
      };
      flock(); this.timers.push(this.scene.time.addEvent({ delay: 21000, loop: true, callback: flock }));
    }
  }

  /** Galleys under sail on the open sea: one along the southern coast, one up the eastern. */
  private buildSeas(): void {
    if (this.still) return;
    const W = CITY_SIZE.width, H = CITY_SIZE.height;
    const routes: Array<{ from: [number, number]; to: [number, number]; flip: boolean; ms: number }> = [
      { from: [-8, H + 6.5], to: [W + 8, H + 6.5], flip: false, ms: 150000 },
      // the eastern lane runs well outside the port's dock and lighthouse
      { from: [W + 13, -8], to: [W + 13, H + 12], flip: true, ms: 130000 },
      { from: [-16, H + 13], to: [W + 14, H + 13], flip: false, ms: 190000 },
    ];
    routes.forEach((r, i) => {
      const ship = this.scene.add.image(0, 0, TOWN.galley.key).setOrigin(.5, 1 - TOWN.galley.anchorY / TOWN.galley.height).setFlipX(r.flip).setScale(1.25 / RES);
      this.skyObjects.push(ship);
      this.walks.push(this.scene.tweens.addCounter({
        from: 0, to: 1, duration: r.ms, repeat: -1, delay: i * 20000,
        onUpdate: (tw) => {
          const t = tw.getValue() ?? 0, gx = r.from[0] + (r.to[0] - r.from[0]) * t, gy = r.from[1] + (r.to[1] - r.from[1]) * t, p = at(gx, gy);
          if (!ship.active) return;
          ship.setPosition(p.x, p.y + Math.sin(t * 900) * 2).setDepth(projection.depth(gx, gy)).setAlpha(Math.min(1, t * 14, (1 - t) * 14));
        },
      }));
    });
  }

  private setBanner(message: string): void {
    const text = this.bannerText, cloth = this.bannerCloth;
    if (!text || !cloth) return;
    text.setText(message.toUpperCase()).setPosition(-110, 14);
    const w = text.width + 36, h = 40;
    cloth.clear()
      .fillStyle(0x1b2333, .18).fillRect(-92 - w + 4, 14 - h / 2 + 5, w, h)
      .fillStyle(0xfbf3e2, 1).fillRect(-92 - w, 14 - h / 2, w, h)
      .fillStyle(0xc0392b, 1).fillRect(-92 - w, 14 - h / 2, w, 4).fillRect(-92 - w, 14 + h / 2 - 4, w, 4)
      .fillStyle(0x009cde, 1).fillRect(-92 - 8, 14 - h / 2, 8, h);
  }

  /** Keeps the aircraft and gulls readable at any zoom, as the name plates are. */
  scaleSky(k: number): void {
    for (const o of this.skyObjects) {
      const base = o.getData?.("baseScale") as number | undefined;
      if (base === undefined || !("setScale" in o)) continue;
      (o as unknown as Phaser.GameObjects.Components.Transform).setScale(base * k);
    }
  }

  /** Money moved: send the banner plane over now with the news. */
  celebrate(): void { if (!this.still) this.bannerRun?.(); }

  private clear(list: Phaser.GameObjects.GameObject[]): void {
    for (const o of list) { this.scene.tweens.killTweensOf(o); o.destroy(); }
    list.length = 0;
  }

  destroy(): void {
    this.timers.forEach(t => t.remove()); this.timers = [];
    this.walks.forEach(t => t.stop()); this.walks = [];
    this.clear(this.fixtures); this.clear(this.stateful); this.clear(this.skyObjects);
    this.planSig = ""; this.stateSig = "";
  }
}

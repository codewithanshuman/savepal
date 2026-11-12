/*
 * The kingdom's life that answers to the agreement, alongside the town's own bustle (folk.ts).
 * Everything here either moves (flags, sails, smoke, people at work, gulls, biplanes, galleys
 * with their wakes) or reports a real state of the agreement:
 *
 *   PayPal holds the gold   -> the full palace guard is posted and the windmills turn fast
 *   the guild is working    -> the carpenter hammers and the miner swings his pick in the yard
 *   the wheat's stage       -> farmers sow, tend, harvest, then rest by the sheaves when paid
 *   inspectors on patrol    -> the architect stands at the page being read
 *   bounties paid           -> a golden stall in the bazaar for each
 *   an appeal is open       -> archers on watch at the port
 *   any money moves         -> the banner plane flies over with the news and the town cheers
 */
import Phaser from "phaser";
import { SKY_DEPTH, projection } from "../reference-city/world/core/worldConstants";
import type { Structure } from "./layout";
import { CITY_SIZE } from "./layout";
import { PALACE_FLAGS, PALACE_POSTS } from "./textures/palace";
import { BOUNTY_SLOTS, GUILD_FLAG, PORT_FLAG, TOWN } from "./textures/town";
import { WINDMILL_HUB } from "./textures/farms";
import { FLAG_FRAMES, GULL, PLANES, SAILS, flagKey, type FlagColor } from "./textures/sky";
import { RES, unit } from "./textures/atelier";
import { Cast, Figure, PEOPLE, STILL, personKey, personUrl, type Effects, type FxKind, type Person, type Pose, type RoamPlan } from "./rig";

export { PEOPLE, personKey, personUrl, type Person };

export type LifeState = { held: boolean; paid: boolean; working: boolean; appealOpen: boolean; bounties: number; inspecting: string | null; banner: string; mainFlag: FlagColor };

/** Draw order for a structure's sprite: estates sort by a point just in front of their centre. */
export function structureDepth(s: Structure): number {
  return s.role === "palace" || s.role === "bazaar" ? projection.depth(s.x, s.y + 1) : projection.depth(s.x, s.y) + 5;
}
const at = (gx: number, gy: number, z = 0) => { const p = projection.project(gx, gy); return { x: p.x, y: p.y - z }; };
const field = (s: Structure, inset = 1.6) => ({ u0: s.x - inset, u1: s.x + inset, v0: s.y - inset, v1: s.y + inset });

export class KingdomLife {
  private fixtures: Phaser.GameObjects.GameObject[] = [];
  private stateful: Phaser.GameObjects.GameObject[] = [];
  private skyObjects: Phaser.GameObjects.GameObject[] = [];
  private timers: Phaser.Time.TimerEvent[] = [];
  private sails: Phaser.Tweens.Tween[] = [];
  private voyages: Phaser.Tweens.Tween[] = [];
  private readonly planCast = new Cast();
  private readonly stateCast = new Cast();
  private structures: Structure[] = [];
  private planSig = "";
  private stateSig = "";
  private bannerRun?: () => void;
  private bannerText?: Phaser.GameObjects.Text;
  private bannerCloth?: Phaser.GameObjects.Graphics;

  constructor(private readonly scene: Phaser.Scene, private readonly fx: Effects) {}

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
    if (!STILL) s.play({ key: `savepal:flag:${color}`, startFrame: i % FLAG_FRAMES });
    return s;
  }

  /** A person at grid (u, v, z), facing look (1 right, -1 left), in a pose; on a round if a plan is given. */
  private person(cast: Cast, who: Person, u: number, v: number, opts: { z?: number; look?: number; pose?: Pose; fx?: FxKind; bias?: number; fidget?: boolean; plan?: RoamPlan } = {}): Figure {
    const f = new Figure(this.scene, who, this.fx);
    f.depthBias = opts.bias ?? 2;
    f.place(u, v, opts.z ?? 0).look(opts.look ?? 1).setPose(opts.pose ?? "idle");
    f.workFx = opts.fx ?? null; f.fidget = !!opts.fidget;
    return cast.add(f, opts.plan);
  }

  /** Rebuilds the fixed life of the plan: flags, sails, smoke and the farm hands. Only redraws when the plan changes. */
  build(structures: Structure[]): void {
    const sig = structures.map(s => `${s.path}:${s.kind}`).join("|");
    this.structures = structures;
    if (sig === this.planSig) return;
    this.planSig = sig; this.stateSig = "";
    this.clear(this.fixtures); this.planCast.clear(); this.sails = [];
    this.timers.forEach(t => t.remove()); this.timers = [];
    this.anims();
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => { this.fixtures.push(o); return o; };
    const cast = this.planCast;
    for (const s of structures) {
      const d = structureDepth(s);
      if (s.kind === "palace") PALACE_FLAGS.forEach((f, i) => { if (f.main) return; const p = at(s.x + f.u, s.y + f.v, f.z); add(this.flag(p.x, p.y, i % 2 ? "crimson" : "royal", d + 2, i)); });
      if (s.kind === "port") { const p = at(s.x + PORT_FLAG.u, s.y + PORT_FLAG.v, PORT_FLAG.z); add(this.flag(p.x, p.y, "paypal", d + 2, 3)); }
      if (s.kind === "windmill") {
        const p = at(s.x + WINDMILL_HUB.u, s.y + WINDMILL_HUB.v, WINDMILL_HUB.z);
        const sail = add(this.scene.add.image(p.x, p.y, SAILS).setScale(1.35 / RES).setDepth(d + 3).setAngle(Math.random() * 90));
        if (!STILL) this.sails.push(this.scene.tweens.add({ targets: sail, angle: "+=360", duration: 9000, repeat: -1 }));
      }
      if (s.kind === "guild" && !STILL) {
        const p = at(s.x + GUILD_FLAG.u, s.y + GUILD_FLAG.v, GUILD_FLAG.z + 4);
        this.timers.push(this.scene.time.addEvent({ delay: 650, loop: true, callback: () => this.puff(p.x, p.y, d + 4) }));
      }
      // smoke from every house's chimney (its stack stands at the back corner of the roof)
      if ((s.kind.startsWith("homestead") || s.kind.startsWith("workshop")) && !STILL) {
        const top = 12 + (s.kind === "homestead0" ? 1 : 2) * 34 + 36, p = at(s.x - 1.45, s.y - 1.65, top);
        add(this.scene.add.particles(p.x, p.y, "savepal:puff", {
          speedY: { min: -26, max: -14 }, speedX: { min: 3, max: 11 }, lifespan: 3600, scale: { start: .12, end: .62 },
          alpha: { start: .5, end: 0 }, tint: 0xf2efe8, frequency: 520 + Math.random() * 400, quantity: 1,
        }).setDepth(d + 6));
      }
      // farm hands: down the berry rows and through the orchard, picking as they go
      if (s.kind === "strawberries" || s.kind === "blueberries" || s.kind === "orchard")
        this.person(cast, "gardener", s.x - .6, s.y + .4, { look: -1, pose: "tend", fx: "leaf", plan: { area: field(s, 1.5), work: "tend", speed: .5, wait: [3800, 7200] } });
      // the wheat follows the agreement: sown, tended, harvested, then the sheaves are in
      if (s.kind.startsWith("wheat")) {
        const stage = Number(s.kind.slice(5));
        if (stage === 4) this.person(cast, "gardener", s.x + 1.2, s.y + 1.4, { look: -1, fidget: true });
        else this.person(cast, "gardener", s.x, s.y, { pose: "tend", fx: stage === 3 ? "chips" : stage === 0 ? "dust" : "leaf", plan: { area: field(s, 1.7), work: "tend", speed: .45, wait: [4200, 8000] } });
      }
      // the chef presents his dish in front of the bazaar fountain, steam rising off the cloche
      if (s.kind === "bazaar") this.person(cast, "chef", s.x + .05, s.y + 1.8, { pose: "serve" });
      // the woodsman splits logs in the barnyard
      if (s.kind === "barn") this.person(cast, "miner", s.x + 1.6, s.y + .5, { look: -1, pose: "mine", fx: "chips" });
    }
    if (!this.skyObjects.length) { this.buildSky(); this.buildSeas(); }
  }

  private puff(x: number, y: number, depth: number): void {
    const c = this.scene.add.image(x + (Math.random() - .5) * 4, y, "savepal:puff").setTint(0xf4f1ea).setAlpha(.75).setScale(.26).setDepth(depth);
    this.scene.tweens.add({ targets: c, y: y - 54, x: c.x + 16, scale: .9, alpha: 0, duration: 2800, ease: "Sine.easeOut", onComplete: () => c.destroy() });
  }

  /** Re-poses the guards, workers, stalls, the main flag and the banner from the agreement's state. */
  setState(state: LifeState): void {
    const sig = JSON.stringify(state);
    if (sig === this.stateSig || !this.structures.length) return;
    this.stateSig = sig;
    this.clear(this.stateful); this.stateCast.clear();
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => { this.stateful.push(o); return o; };
    const cast = this.stateCast;
    const find = (pred: (s: Structure) => boolean) => this.structures.find(pred);
    const palace = find(s => s.kind === "palace"), bazaar = find(s => s.kind === "bazaar"), guild = find(s => s.kind === "guild"), port = find(s => s.kind === "port");
    if (palace) {
      const d = structureDepth(palace), main = PALACE_FLAGS.find(f => f.main)!, p = at(palace.x + main.u, palace.y + main.v, main.z);
      add(this.flag(p.x, p.y, state.mainFlag, d + 3).setScale(1.6 / RES));
      PALACE_POSTS.gate.slice(0, state.held ? 2 : 1).forEach(([u, v], i) => this.person(cast, "spearman", palace.x + u, palace.y + v, { look: i === 1 ? -1 : 1, pose: "guard" }));
      PALACE_POSTS.walls.slice(0, state.held ? 4 : 2).forEach(([u, v, z], i) => this.person(cast, "archer", palace.x + u, palace.y + v, { z, look: i % 2 ? -1 : 1, pose: "watch", bias: 60 }));
      // the knight marches his rounds across the forecourt and stands to at each end
      const [[pu0, pv0], [pu1, pv1]] = PALACE_POSTS.patrol;
      this.person(cast, "swordsman", palace.x + pu0, palace.y + pv0, { pose: "guard", bias: 40, plan: {
        spots: [{ u: palace.x + pu1, v: palace.y + pv1, pose: "guard", ms: 2400, look: -1 }, { u: palace.x + pu0, v: palace.y + pv0, pose: "guard", ms: 2400, look: 1 }],
        walk: "march", work: "guard", speed: .55,
      } });
    }
    if (guild) {
      this.person(cast, "carpenter", guild.x + 1.25, guild.y + 1.15, { look: -1, pose: state.working ? "hammer" : "idle", fx: "chips", fidget: !state.working });
      if (state.working) this.person(cast, "miner", guild.x + 2.05, guild.y + .85, { pose: "mine", fx: "stone" });
    }
    const page = state.inspecting ? find(s => s.role === "page" && s.path === `page${state.inspecting!.startsWith("/") ? state.inspecting : `/${state.inspecting}`}`) : undefined;
    if (page) this.person(cast, "architect", page.x + .3, page.y + 2.3, { pose: "chat", fidget: true });
    else if (guild) this.person(cast, "architect", guild.x - .2, guild.y + 2.1, { fidget: true });
    if (bazaar) BOUNTY_SLOTS.slice(0, Math.min(state.bounties, BOUNTY_SLOTS.length)).forEach(([u, v]) => {
      const p = at(bazaar.x + u, bazaar.y + v);
      add(this.scene.add.image(p.x, p.y + TOWN.bountyStall.anchorY, TOWN.bountyStall.key).setOrigin(.5, 1).setScale(unit(TOWN.bountyStall.key)).setDepth(projection.depth(bazaar.x + u, bazaar.y + v) + 1));
    });
    if (port && state.appealOpen) [[3.2, .1], [4.2, -.1]].forEach(([u, v], i) => this.person(cast, "archer", port.x + u, port.y + v, { z: 3, look: i === 1 ? -1 : 1, pose: "watch" }));
    for (const t of this.sails) t.timeScale = state.held ? 2.2 : 1;
    this.setBanner(state.banner);
  }

  /** Every frame: the people pose and walk their rounds. */
  update(dt: number): void { this.planCast.update(dt); this.stateCast.update(dt); }

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
    rope.lineStyle(2, 0x5a4a32, 1).beginPath().moveTo(-58, 8).lineTo(-92, 12).strokePath();
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
    if (!STILL) { red.play("savepal:plane:red"); run(); } else banner.setVisible(false);
    // A second biplane flies the other way, higher, without a banner.
    const blue = sky(this.scene.add.sprite(b.x1, b.y0 + (b.y1 - b.y0) * .55, PLANES.blue[0]).setFlipX(true).setScale(1.1 / RES).setDepth(SKY_DEPTH + 4).setData("baseScale", 1.1 / RES)) as Phaser.GameObjects.Sprite;
    const blueShadow = sky(this.scene.add.ellipse(0, 0, 70, 18, 0x14260f, .14).setDepth(SKY_DEPTH - 50)) as Phaser.GameObjects.Ellipse;
    if (!STILL) {
      blue.play("savepal:plane:blue");
      const loop = () => { blue.setPosition(b.x1, b.y0 + (b.y1 - b.y0) * (.45 + Math.random() * .3)); this.scene.tweens.add({ targets: blue, x: b.x0, duration: 26000, onUpdate: () => blueShadow.setPosition(blue.x + 30, blue.y + 300), onComplete: () => this.scene.time.delayedCall(9000, loop) }); };
      this.scene.time.delayedCall(6000, loop);
    } else blue.setVisible(false);
    // Gulls in loose flocks.
    if (!STILL) {
      const flock = () => {
        const y = b.y0 + Math.random() * (b.y1 - b.y0) * .8, gulls: Phaser.GameObjects.Sprite[] = [];
        for (let i = 0; i < 6; i++) gulls.push(this.scene.add.sprite(b.x1 + i * 40, y + Math.abs(i - 2.5) * 22, GULL[0]).setScale(1.6 / RES).setDepth(SKY_DEPTH + 6).setData("baseScale", 1.6 / RES).play({ key: "savepal:gull", startFrame: i % 2 }));
        gulls.forEach(g => sky(g));
        this.scene.tweens.add({ targets: gulls, x: `-=${b.x1 - b.x0}`, duration: 34000, onComplete: () => gulls.forEach(g => { const i = this.skyObjects.indexOf(g); if (i >= 0) this.skyObjects.splice(i, 1); g.destroy(); }) });
      };
      flock(); this.timers.push(this.scene.time.addEvent({ delay: 21000, loop: true, callback: flock }));
    }
  }

  /** Galleys under sail on the open sea, each trailing a foaming wake: one along the southern coast, one up the eastern. */
  private buildSeas(): void {
    if (STILL) return;
    const W = CITY_SIZE.width, H = CITY_SIZE.height;
    const routes: Array<{ from: [number, number]; to: [number, number]; flip: boolean; ms: number }> = [
      { from: [-8, H + 6.5], to: [W + 8, H + 6.5], flip: false, ms: 150000 },
      // the eastern lane runs well outside the port's dock and lighthouse
      { from: [W + 13, -8], to: [W + 13, H + 12], flip: true, ms: 130000 },
      { from: [-16, H + 13], to: [W + 14, H + 13], flip: false, ms: 190000 },
    ];
    routes.forEach((r, i) => {
      const ship = this.scene.add.image(0, 0, TOWN.galley.key).setOrigin(.5, 1 - TOWN.galley.anchorY / TOWN.galley.height).setFlipX(r.flip).setScale(1.25 * unit(TOWN.galley.key));
      const wake = this.scene.add.graphics();
      this.skyObjects.push(ship, wake);
      const len = Math.hypot(r.to[0] - r.from[0], r.to[1] - r.from[1]), du = (r.to[0] - r.from[0]) / len, dv = (r.to[1] - r.from[1]) / len;
      this.voyages.push(this.scene.tweens.addCounter({
        from: 0, to: 1, duration: r.ms, repeat: -1, delay: i * 20000,
        onUpdate: (tw) => {
          const t = tw.getValue() ?? 0, gx = r.from[0] + (r.to[0] - r.from[0]) * t, gy = r.from[1] + (r.to[1] - r.from[1]) * t, p = at(gx, gy);
          if (!ship.active) return;
          const fade = Math.min(1, t * 14, (1 - t) * 14), roll = Math.sin(t * 900) * 2;
          ship.setPosition(p.x, p.y + roll).setDepth(projection.depth(gx, gy)).setAlpha(fade).setAngle(Math.sin(t * 620) * 1.2);
          this.drawWake(wake, gx, gy, du, dv, fade, this.scene.time.now);
          wake.setDepth(ship.depth - 1);
        },
      }));
    });
  }

  /** A V of foam opening behind the stern, a churned trail down the middle and a bow wave. */
  private drawWake(g: Phaser.GameObjects.Graphics, gx: number, gy: number, du: number, dv: number, alpha: number, now: number): void {
    g.clear();
    if (alpha <= 0) return;
    const half = 2.1, pu = -dv, pv = du;
    const sea = (u: number, v: number) => at(u, v);
    const stern = { u: gx - du * half, v: gy - dv * half }, bow = { u: gx + du * half, v: gy + dv * half };
    for (const side of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const a = k / 6, b = (k + 1) / 6, L = 3.4;
        const p0 = sea(stern.u - du * L * a + pu * side * (.25 + L * .32 * a), stern.v - dv * L * a + pv * side * (.25 + L * .32 * a));
        const p1 = sea(stern.u - du * L * b + pu * side * (.25 + L * .32 * b), stern.v - dv * L * b + pv * side * (.25 + L * .32 * b));
        g.lineStyle(3.2 - a * 2, 0xffffff, alpha * .7 * (1 - a)).lineBetween(p0.x, p0.y, p1.x, p1.y);
      }
      const b0 = sea(bow.u + pu * side * .18, bow.v + pv * side * .18), b1 = sea(bow.u - du * .9 + pu * side * .55, bow.v - dv * .9 + pv * side * .55);
      g.lineStyle(2.4, 0xffffff, alpha * .8).lineBetween(b0.x, b0.y, b1.x, b1.y);
    }
    for (let k = 0; k < 9; k++) {
      const a = ((k + (now / 900) % 1) / 9), p = sea(stern.u - du * 3 * a + pu * Math.sin(k * 2.3 + now / 400) * .12, stern.v - dv * 3 * a + pv * Math.sin(k * 2.3 + now / 400) * .12);
      g.fillStyle(0xffffff, alpha * .55 * (1 - a)).fillEllipse(p.x, p.y, 16 * (1 - a * .5), 6 * (1 - a * .5));
    }
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

  /** Sky objects, for the night to dim. */
  get sky(): readonly Phaser.GameObjects.GameObject[] { return this.skyObjects; }

  /** Money moved: send the banner plane over now with the news, and everyone cheers. */
  celebrate(): void {
    if (STILL) return;
    this.bannerRun?.();
    this.planCast.cheer(); this.stateCast.cheer();
  }

  private clear(list: Phaser.GameObjects.GameObject[]): void {
    for (const o of list) { this.scene.tweens.killTweensOf(o); o.destroy(); }
    list.length = 0;
  }

  destroy(): void {
    this.timers.forEach(t => t.remove()); this.timers = [];
    this.voyages.forEach(t => t.stop()); this.voyages = [];
    this.clear(this.fixtures); this.clear(this.stateful); this.clear(this.skyObjects);
    this.planCast.clear(); this.stateCast.clear();
    this.planSig = ""; this.stateSig = "";
  }
}

/*
 * SavePal's Realm scene. The archive's WorldScene (the Claude Clan engine, as adapted in grounded)
 * supplies the machinery -- terrain grid, streets, camera, input, depth sorting and traffic -- and
 * this scene supplies everything you see: SavePal's own ground art, the island with its cliffs and
 * waterfalls (island.ts), the royal treasury in place of the archive's capitol, every structure
 * (textures/), the kingdom's life (life.ts), walk mode (walk.ts), name plates, reward bubbles and
 * the celebrations. Everything is drawn at high resolution and shown smooth, not as pixel blocks.
 */
import Phaser from "phaser";
import { capitolDistrict } from "@sudo-city/protocol";
import { WorldScene } from "../reference-city/WorldScene";
import { SKY_DEPTH, projection } from "../reference-city/world/core/worldConstants";
import { setEstates } from "../reference-city/layouts/terrain";
import { CAPITOL_KEY } from "../reference-city/textures/capitol/base";
import { CLOUD_KEY } from "../reference-city/textures/effects";
import { WOODEN_SHIP_KEYS } from "../reference-city/textures/vehicles";
import { CITY_SIZE, ESTATES, blockedAt, doorsFor, kingdom, type RealmInput, type Structure } from "./layout";
import { Island, ISLAND_BOUNDS } from "./island";
import { bakeCoins, COIN_TEXTURES } from "./coins";
import { bakeAll, bakeOne, RES, unit, type Asset } from "./textures/atelier";
import { PALACE, PALACE_BUILDER, PALACE_FOUNTAIN } from "./textures/palace";
import type { Atelier } from "./textures/atelier";
import { TOWN, TOWN_BUILDERS } from "./textures/town";
import { FARMS, FARM_BUILDERS } from "./textures/farms";
import { TREASURY, TREASURY_BUILDER, TREASURY_FIRES } from "./textures/treasury";
import { NIGHT_DEPTH, Nightfall, type Lit, type SkyMode } from "./night";
import { bakeSky, type FlagColor } from "./textures/sky";
import { bakeCarts, trotKey } from "./textures/carts";
import { KingdomLife, PEOPLE, personKey, personUrl, structureDepth, type Person } from "./life";
import { Effects, bakeFx } from "./rig";
import { Townsfolk } from "./folk";
import { Ocean } from "./ocean";
import { Storms } from "./weather";
import { RealmGrade, addGrade } from "./grade";
import { bakeCritters } from "./textures/critters";
import { WalkMode, type Entrance } from "./walk";

// The kingdom's estates are plain ground for the terrain pass: no street or prop crosses them.
setEstates(ESTATES);

export type RealmPlace = "castle" | "treasury" | "guild" | "market" | "harbour";
export type RealmPick = { place: RealmPlace } | { page: string } | { agreement: string } | { info: string };
export type RealmReward = { key: string; xp: number; place: RealmPlace };

const ASSETS: Record<string, Asset> = { palace: PALACE, ...TOWN, ...FARMS };
const BUILDERS: Partial<Record<string, (a: Atelier) => void>> = { palace: PALACE_BUILDER, ...TOWN_BUILDERS, ...FARM_BUILDERS };
/** Structures with windows or lamps, which light up after dark. */
const LIT = (kind: string) => kind === "palace" || kind in TOWN || kind === "barn" || kind === "windmill" || kind === "park";
const capitol = capitolDistrict(CITY_SIZE);
const at = (gx: number, gy: number, z = 0) => { const p = projection.project(gx, gy); return { x: p.x, y: p.y - z }; };
const ROLE_PLACE: Partial<Record<Structure["role"], RealmPlace>> = { palace: "castle", guild: "guild", bazaar: "market", port: "harbour" };
const SEA = 0x3a9bd5;

export class SavePalScene extends WorldScene {
  private pickHandler?: (pick: RealmPick) => void;
  private collectHandler?: (key: string, screen: { x: number; y: number }) => void;
  private nearHandler?: (label: string | null) => void;
  private structures: Structure[] = [];
  private rewards: RealmReward[] = [];
  private bubbles = new Map<string, Phaser.GameObjects.Container>();
  private plates: Phaser.GameObjects.Text[] = [];
  private life?: KingdomLife;
  private folk?: Townsfolk;
  private fx?: Effects;
  private night?: Nightfall;
  private ocean?: Ocean;
  private storms?: Storms;
  private stormPlaces: RealmPlace[] = [];
  private thunderHandler?: () => void;
  private grade: RealmGrade | null = null;
  /** Frame times sampled once the kingdom has settled, to drop the colour pass on a struggling device. */
  private probe = { from: 0, sum: 0, n: 0, done: false };
  private skyMode: SkyMode = "auto";
  private nightSeen = -1;
  private island?: Island;
  private walk?: WalkMode;
  private treasurySprite?: Phaser.GameObjects.Sprite;
  private effectsBuilt = false;
  private introPlayed = false;
  private ready = false;
  private pending?: RealmInput;
  /** Device pixels per CSS pixel: the canvas renders at full screen density. */
  private dpr = 1;
  /** A tap that collected a bubble must not also open the building beneath it. */
  private suppressPickUntil = 0;
  private readonly still = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor() {
    super();
    // An ancient kingdom: the archive's airport, container port, navy yard and billboards stay unbuilt.
    const quiet = () => undefined;
    Object.assign(this.airportManager, { layoutAirport: quiet });
    Object.assign(this.harbourManager, { layoutHarbour: quiet });
    Object.assign(this.navyManager, { layoutNavyHarbour: quiet });
    Object.assign(this.billboardManager, { layoutBillboards: quiet });
    this.setSelectionListener((building) => {
      if (this.time.now < this.suppressPickUntil || this.walk?.active) return;
      const s = building && this.structures.find(x => x.path === building.path);
      if (!s) return;
      const view = this.buildingManager.getViews().get(s.path);
      if (view) this.bounce(view.sprite);
      const place = ROLE_PLACE[s.role];
      if (place) this.pickHandler?.({ place });
      else if (s.role === "page") this.pickHandler?.({ page: s.path.slice(4) });
      else if (s.role === "agreement" && s.target) this.pickHandler?.({ agreement: s.target });
      else this.pickHandler?.({ info: s.info ?? "A home of the kingdom. More rise as your town levels up." });
    });
    this.setCapitolClickListener(() => {
      if (this.time.now < this.suppressPickUntil || this.walk?.active) return;
      if (this.treasurySprite) this.bounce(this.treasurySprite);
      this.pickHandler?.({ place: "treasury" });
    });
  }

  setDpr(dpr: number): void { this.dpr = dpr; }

  preload(): void { for (const p of PEOPLE) this.load.image(personKey(p), personUrl(p)); }

  override create(): void {
    super.create();
    this.cameras.main.setBackgroundColor(SEA);
    bakeCoins(this);
    // the landmarks every kingdom has; each estate's own art is baked when its building is dressed
    bakeAll(this, { palace: PALACE, treasury: TREASURY }, { palace: PALACE_BUILDER, treasury: TREASURY_BUILDER });
    bakeOne(this, TOWN.galley, TOWN_BUILDERS.galley);
    bakeOne(this, TOWN.bountyStall, TOWN_BUILDERS.bountyStall);
    bakeSky(this);
    bakeCarts(this);
    if (!this.textures.exists("savepal:spark")) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1).fillCircle(8, 8, 8).generateTexture("savepal:spark", 16, 16); g.destroy();
    }
    bakeFx(this);
    bakeCritters(this);
    this.fx = new Effects(this);
    this.life = new KingdomLife(this, this.fx);
    this.folk = new Townsfolk(this, this.fx);
    this.night = new Nightfall(this);
    this.ocean = new Ocean(this);
    this.storms = new Storms(this);
    this.storms.onStrike = () => this.thunderHandler?.();
    this.grade = addGrade(this);
    this.night.setMode(this.skyMode);
    this.island = new Island(this);
    this.walk = new WalkMode(this, {
      blocked: (u, v) => u < ISLAND_BOUNDS.U0 + .35 || v < ISLAND_BOUNDS.V0 + .35 || u > ISLAND_BOUNDS.U1 - .35 || v > ISLAND_BOUNDS.V1 - .35 || blockedAt(this.structures, u, v),
      entrances: () => doorsFor(this.structures).map(d => ({ id: d.id, label: d.label, u: d.u, v: d.v })),
      onNear: (e) => this.nearHandler?.(e ? e.label : null),
      occluders: () => [...[...this.buildingManager.getViews().values()].map(v => v.sprite), ...(this.treasurySprite ? [this.treasurySprite] : [])],
      depthBias: 2,
    }, this.fx);
    this.input.keyboard?.on("keydown-E", () => this.enterNearest());
    this.input.keyboard?.on("keydown-ENTER", () => this.enterNearest());
    this.ready = true;
    this.events.once("shutdown", () => {
      this.ready = false;
      this.walk?.stop(); this.life?.destroy(); this.folk?.destroy(); this.island?.destroy(); this.fx?.destroy(); this.night?.destroy(); this.ocean?.destroy(); this.ocean = undefined; this.storms?.destroy(); this.storms = undefined; this.grade = null;
      this.life = undefined; this.folk = undefined; this.island = undefined; this.walk = undefined; this.fx = undefined; this.night = undefined;
      this.bubbles.clear(); this.plates = []; this.effectsBuilt = false;
    });
    if (this.pending) { const p = this.pending; this.pending = undefined; this.setRealm(p); }
  }

  onPick(handler?: (pick: RealmPick) => void): void { this.pickHandler = handler; }
  onCollect(handler?: (key: string, screen: { x: number; y: number }) => void): void { this.collectHandler = handler; }
  onNear(handler?: (label: string | null) => void): void { this.nearHandler = handler; }

  /** Rebuilds the kingdom from the agreement's state. Safe to call before create(). */
  setRealm(input: RealmInput): void {
    if (!this.ready || !this.scene?.isActive()) { this.pending = input; return; }
    const { snapshot, structures } = kingdom(input);
    this.structures = structures;
    super.setWorld(snapshot, "savepal", `savepal-${input.current.id}`);
    this.restyleEngine();
    this.dress();
    this.layoutPlates();
    const port = structures.find(s => s.role === "port");
    this.island?.build((gx, gy) => !!port && gx > CITY_SIZE.width - 1 && Math.abs(gy - port.y) < 1.6);
    this.life?.build(structures);
    this.folk?.build(structures, this.terrainManager.terrain);
    this.lightUp(structures);
    this.applyStorms();
    const mainFlag: FlagColor = input.current.paid ? "gold" : input.current.held ? "paypal" : "royal";
    this.life?.setState({ held: input.current.held, paid: input.current.paid, working: input.stage === 2, appealOpen: input.appealOpen, bounties: input.bounties, inspecting: input.inspecting, banner: input.banner, mainFlag });
    this.buildEffects();
    this.layoutBubbles();
    this.playIntro();
  }

  /** The places where the agreement is in trouble: a storm cell stands over each. */
  setStorms(places: RealmPlace[]): void { this.stormPlaces = places; this.applyStorms(); }
  onThunder(handler?: () => void): void { this.thunderHandler = handler; }
  private applyStorms(): void {
    if (!this.storms || !this.ready || !this.structures.length) return;
    const role = { castle: "palace", guild: "guild", market: "bazaar", harbour: "port" } as const;
    this.storms.set(this.stormPlaces.flatMap((place): Array<{ key: string; x: number; y: number }> => {
      if (place === "treasury") return [{ key: place, ...at(capitol.centerX, (capitol.minY + capitol.maxY) / 2) }];
      const s = this.structures.find(x => x.role === role[place]);
      return s ? [{ key: place, ...at(s.x, s.y) }] : [];
    }));
  }

  /** What the radar shows: the camera's view of the world, and where the walker stands. */
  mapState(): { view: { x: number; y: number; w: number; h: number }; walker: { x: number; y: number } | null } | null {
    if (!this.ready || !this.structures.length) return null;
    const v = this.cameras.main.worldView;
    return { view: { x: v.x, y: v.y, w: v.width, h: v.height }, walker: this.walk?.spot ?? null };
  }
  /** Flies the camera to a point in the world (a click on the radar). */
  flyTo(x: number, y: number): void {
    if (this.walk?.active) return;
    this.cameraController.moveCameraTo(x, y, Math.max(.75 * this.dpr, this.cameraController.zoomTarget));
  }
  /** The kingdom exactly as it is drawn this frame, as an image. */
  photo(done: (image: HTMLImageElement | null) => void): void {
    try { this.game.renderer.snapshot(image => done(image instanceof HTMLImageElement ? image : null)); } catch { done(null); }
  }

  /** Day, night, or the viewer's own clock. */
  setSky(mode: SkyMode): void { this.skyMode = mode; this.night?.setMode(mode); }

  /** What lights up after dark: every structure's windows and lamps, lanterns, fireflies, the lighthouse. */
  private lightUp(structures: Structure[]): void {
    const night = this.night;
    if (!night) return;
    const lit: Lit[] = [];
    for (const s of structures) {
      const view = this.buildingManager.getViews().get(s.path), asset = ASSETS[s.kind], builder = BUILDERS[s.kind];
      if (view && asset && builder && LIT(s.kind)) lit.push({ sprite: view.sprite, asset, builder, u: s.x, v: s.y });
    }
    if (this.treasurySprite) lit.push({ sprite: this.treasurySprite, asset: TREASURY, builder: TREASURY_BUILDER, u: capitol.centerX, v: (capitol.minY + capitol.maxY) / 2 });
    night.setLit(lit);
    night.setLanterns((this.folk?.people ?? []).filter((_, i) => i % 2 === 0));
    const gardens = structures.filter(s => ["park", "orchard", "strawberries", "blueberries", "vineyard"].includes(s.kind)).map(s => ({ u0: s.x - 2, v0: s.y - 2, u1: s.x + 2, v1: s.y + 2 }));
    night.setGardens(gardens);
    const port = structures.find(s => s.role === "port");
    night.setLighthouse(port ? { u: port.x + 10.8, v: port.y + 3.0, z: -13 } : null);
  }

  setRewards(rewards: RealmReward[]): void { this.rewards = rewards; if (this.ready && this.structures.length) this.layoutBubbles(); }

  /** Money moved: fireworks over the palace and the treasury, and the banner plane flies the news. */
  celebrate(): void {
    this.life?.celebrate(); this.folk?.cheer(); this.walk?.cheer();
    if (this.still) return;
    // bursts sized to the current zoom, so they read as fireworks whether close in or far out
    const k = Phaser.Math.Clamp(.5 * this.dpr / (this.cameras.main.zoom || 1), 1, 5);
    const palace = this.structures.find(s => s.role === "palace");
    const spots = [at(capitol.centerX, capitol.centerY, 420), ...(palace ? [at(palace.x - 5, palace.y, 640), at(palace.x + 5, palace.y, 620), at(palace.x, palace.y - 2, 760)] : [])];
    spots.forEach((p, i) => this.time.delayedCall(i * 420, () => {
      const burst = this.add.particles(p.x, p.y, "savepal:spark", {
        speed: { min: 160 * k, max: 340 * k }, gravityY: 90 * k, lifespan: 1600, scale: { start: .7 * k, end: 0 }, alpha: { start: 1, end: 0 },
        tint: [[0xffd35c, 0xffe48a], [0xff7aa2, 0xffc2d4], [0x8fd0ff, 0xd8f0ff], [0x7fe3a4, 0xd2f7e2]][i % 4]!, blendMode: "ADD", emitting: false,
      }).setDepth(SKY_DEPTH + 45);
      burst.explode(70);
      this.time.delayedCall(2000, () => burst.destroy());
    }));
  }

  /** The + and − buttons: a smooth zoom about the middle of the view. */
  zoomBy(dir: 1 | -1): void {
    if (this.walk?.active) return;
    const cam = this.cameras.main, target = Phaser.Math.Clamp(cam.zoom * (dir > 0 ? 1.35 : 1 / 1.35), .1, 3);
    this.cameraController.moveCameraTo(cam.midPoint.x, cam.midPoint.y, target);
  }

  /** Enter the world as your own character. */
  startWalk(person: Person): void {
    if (!this.walk) return;
    this.cameraController.zoomTarget = 1.15 * this.dpr;
    this.walk.start(person, capitol.centerX, capitol.maxY + 2.4, 1.15 * this.dpr);
  }
  stopWalk(): void { if (!this.walk?.active) return; this.walk.stop(); this.fitCamera(true); }
  setWalkPad(x: number, y: number): void { this.walk?.setPad(x, y); }
  enterNearest(): void {
    const e: Entrance | null | undefined = this.walk?.nearest();
    if (!e) return;
    const cut = e.id.indexOf(":"), kind = e.id.slice(0, cut), value = e.id.slice(cut + 1);
    if (kind === "place") this.pickHandler?.({ place: value as RealmPlace });
    else if (kind === "page") this.pickHandler?.({ page: value });
    else if (kind === "agreement") this.pickHandler?.({ agreement: value });
  }

  /** Frames the whole island, cliffs included. Smooth when asked (after walking). */
  override fitCamera(smooth = false): void {
    const cam = this.cameras.main;
    const { U0, V0, U1, V1, CLIFF } = ISLAND_BOUNDS;
    const pts = [at(U0, V0, 640), at(U1, V0), at(U1, V1, -CLIFF), at(U0, V1, -CLIFF), at(U1 + 12, (V0 + V1) / 2)];
    const left = Math.min(...pts.map(p => p.x)), right = Math.max(...pts.map(p => p.x)), top = Math.min(...pts.map(p => p.y)), bottom = Math.max(...pts.map(p => p.y));
    const narrow = cam.width / this.dpr < 700;
    let zoom = Phaser.Math.Clamp(Math.min((cam.width - 40) / (right - left), (cam.height - 40) / (bottom - top)) * 1.1, .1, 3);
    let cx = (left + right) / 2, cy = (top + bottom) / 2 + 10;
    if (narrow) {
      // A phone is tall: fill the open space between the top cards and the bottom bar, centred on the treasury.
      const topInset = 250 * this.dpr, bottomInset = 130 * this.dpr, freeH = Math.max(200, cam.height - topInset - bottomInset);
      zoom = Phaser.Math.Clamp(freeH / (bottom - top) * 1.35, .1, 3);
      const c = at(capitol.centerX, capitol.centerY);
      cx = c.x; cy = c.y - ((topInset + freeH / 2) - cam.height / 2) / zoom;
    }
    if (smooth) { this.cameraController.moveCameraTo(cx, cy, zoom); return; }
    this.cameraController.zoomTarget = zoom;
    cam.setZoom(zoom).centerOn(cx, cy);
  }

  /** Flies the camera to a place, as the orders board and quest banner do. */
  focusPlace(place: RealmPlace): void {
    if (this.walk?.active) return;
    const a = this.anchor(place);
    if (a) this.cameraController.moveCameraTo(a.x, a.y + 160, Math.max(.75 * this.dpr, this.cameraController.zoomTarget));
  }

  /** Name plates, bubbles and aircraft keep a steady size on screen whatever the zoom. */
  update(time: number, delta: number): void {
    const zoom = this.cameras.main.zoom || 1, d = this.dpr;
    const k = Phaser.Math.Clamp(.46 * d / zoom, .3 * d, 1.6 * d), kb = Phaser.Math.Clamp(.52 * d / zoom, .35 * d, 1.7 * d);
    for (const p of this.plates) p.setScale(k * (p.getData("small") ? .8 : 1));
    this.life?.scaleSky(Phaser.Math.Clamp(.62 * d / zoom, 1, 2.8 * d));
    for (const b of this.bubbles.values()) {
      if (b.getData("leaving")) continue;
      const slot = b.getData("slot") as number, side = slot === 0 ? 0 : (slot % 2 ? 1 : -1) * Math.ceil(slot / 2);
      b.setScale(kb).setPosition(b.getData("ax") + side * 136 * kb, b.getData("ay") + Math.sin(time / 420 + slot) * 7 * kb);
    }
    this.life?.update(delta);
    this.folk?.update(delta, time);
    this.animateTraffic(time);
    this.ocean?.update(time, this.night?.k ?? 0);
    this.storms?.update(time);
    if (this.grade && !this.probe.done && this.structures.length) {
      // judge the frame rate over four seconds, starting eight seconds in; below ~14 fps the grade goes
      if (!this.probe.from) this.probe.from = time + 8000;
      else if (time > this.probe.from) { this.probe.sum += delta; this.probe.n++; }
      if (time > this.probe.from + 4000 && this.probe.n) {
        this.probe.done = true;
        if (this.probe.sum / this.probe.n > 70) { this.cameras.main.removePostPipeline(this.grade); this.grade = null; }
      }
    }
    if (this.night) {
      this.night.update(time, delta);
      const k = this.night.k;
      if (this.grade) this.grade.night = k;
      if (this.folk) this.folk.night = k;
      if (Math.abs(k - this.nightSeen) > .02) { this.nightSeen = k; this.island?.setNight(k); }
    }
    this.walk?.update(delta);
    this.island?.update(time);
  }

  /** The engine's carts: shown at our bake resolution, the horses trotting as they roll. */
  private animateTraffic(time: number): void {
    const traffic = (this as unknown as { ambient?: { traffic?: Phaser.GameObjects.Container } }).ambient?.traffic;
    if (!traffic) return;
    const k = 1 / RES;
    traffic.list.forEach((o, i) => {
      const cart = o as Phaser.GameObjects.Sprite;
      if (cart.scaleX !== k) cart.setScale(k);
      if (this.still) return;
      const key = cart.texture.key, base = key.endsWith(":trot") ? key.slice(0, -5) : key;
      const want = Math.floor(time / 150 + i * .5) % 2 ? trotKey(base) : base;
      if (want !== key && this.textures.exists(want)) cart.setTexture(want);
    });
  }

  /** The archive's own scenery gives way to SavePal's: the capitol becomes the treasury; its props, clouds and ships hide. */
  private restyleEngine(): void {
    for (const sprite of this.terrainManager.propSprites) {
      if (sprite.texture.key === CAPITOL_KEY || sprite.texture.key === TREASURY.key) {
        const p = projection.project(capitol.centerX, (capitol.minY + capitol.maxY) / 2);
        sprite.setTexture(TREASURY.key).setOrigin(.5, 1).setScale(unit(TREASURY.key)).setData("unit", unit(TREASURY.key)).setPosition(p.x, p.y + TREASURY.anchorY);
        this.treasurySprite = sprite;
      } else sprite.setVisible(false);
    }
    for (const o of this.children.list) {
      const key = (o as Phaser.GameObjects.Sprite).texture?.key;
      if (key && (key === CLOUD_KEY || WOODEN_SHIP_KEYS.includes(key))) (o as Phaser.GameObjects.Sprite).setVisible(false);
    }
  }

  /** Swaps every building view onto its authored structure (as grounded does for its landmarks). */
  private dress(): void {
    for (const s of this.structures) {
      const view = this.buildingManager.getViews().get(s.path);
      const asset = ASSETS[s.kind];
      if (!view || !asset) continue;
      const p = projection.project(s.x, s.y), builder = BUILDERS[s.kind];
      if (builder) bakeOne(this, asset, builder);
      if (view.sprite.texture.key !== asset.key) view.sprite.setTexture(asset.key);
      view.sprite.setOrigin((asset.originX ?? asset.width / 2) / asset.width, 1).setScale(unit(asset.key)).setData("unit", unit(asset.key)).setPosition(p.x, p.y + asset.anchorY).setDepth(structureDepth(s));
      view.sprite.setData("constructionAnchorOffset", asset.anchorY - 24);
      view.sprite.setInteractive({ pixelPerfect: true, useHandCursor: true });
    }
  }

  /** A Township-style squash and spring when a building is tapped. */
  private bounce(sprite: Phaser.GameObjects.Sprite): void {
    if (this.still || sprite.getData("bouncing")) return;
    const base = (sprite.getData("unit") as number | undefined) ?? sprite.scaleX;
    sprite.setData("bouncing", true);
    this.tweens.chain({
      targets: sprite,
      tweens: [
        { scaleX: base * 1.05, scaleY: base * .9, duration: 90, ease: "Quad.easeOut" },
        { scaleX: base * .98, scaleY: base * 1.05, duration: 120, ease: "Quad.easeOut" },
        { scaleX: base, scaleY: base, duration: 260, ease: "Back.easeOut" },
      ],
      onComplete: () => { sprite.setScale(base); sprite.setData("bouncing", false); },
    });
  }

  /** Fountain spray, brazier fire and the firework emitter, made once. */
  private buildEffects(): void {
    if (this.effectsBuilt) return;
    this.effectsBuilt = true;
    if (this.still) return;
    const palace = this.structures.find(s => s.role === "palace"), bazaar = this.structures.find(s => s.role === "bazaar");
    const spray = (x: number, y: number, depth: number, s = 1) => this.add.particles(x, y, "savepal:spark", {
      speed: { min: 34 * s, max: 74 * s }, angle: { min: 252, max: 288 }, gravityY: 170, lifespan: 1050, scale: { start: .3 * s, end: .05 }, alpha: { start: .9, end: 0 }, tint: [0xbfe3fb, 0xffffff, 0x8fd0ff], quantity: 2, frequency: 60,
    }).setDepth(depth);
    if (palace) { const p = at(palace.x + PALACE_FOUNTAIN.u, palace.y + PALACE_FOUNTAIN.v, PALACE_FOUNTAIN.z); spray(p.x, p.y, structureDepth(palace) + 3, 1.15); }
    if (bazaar) { const p = at(bazaar.x, bazaar.y + .1, 52); spray(p.x, p.y, structureDepth(bazaar) + 3); }
    for (const [u, v, z] of TREASURY_FIRES) {
      const p = at((capitol.minX + capitol.maxX) / 2 + u, (capitol.minY + capitol.maxY) / 2 + v, z + 4);
      this.add.particles(p.x, p.y, "savepal:spark", {
        speedY: { min: -70, max: -36 }, speedX: { min: -10, max: 10 }, lifespan: 650, scale: { start: .42, end: 0 }, alpha: { start: 1, end: 0 }, tint: [0xffd36a, 0xff8a2a, 0xff5a1a], blendMode: "ADD", quantity: 1, frequency: 50,
      }).setDepth(NIGHT_DEPTH + 2);
    }
  }

  /** Arriving: the camera starts close on the palace and sweeps out over the whole kingdom. */
  private playIntro(): void {
    if (this.introPlayed || this.still) return;
    this.introPlayed = true;
    const cam = this.cameras.main, palace = this.structures.find(s => s.role === "palace");
    if (!palace) return;
    this.fitCamera();
    const fit = { zoom: cam.zoom, x: cam.scrollX, y: cam.scrollY };
    const g = at(palace.x, palace.y + 3, 220);
    cam.setZoom(fit.zoom * 2.6).centerOn(g.x, g.y);
    this.cameraController.zoomTarget = cam.zoom;
    this.tweens.add({ targets: cam, zoom: fit.zoom, scrollX: fit.x, scrollY: fit.y, duration: 3200, delay: 500, ease: "Cubic.easeInOut", onUpdate: () => { this.cameraController.zoomTarget = cam.zoom; } });
  }

  private plate(text: string, x: number, y: number, small = false): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, text, {
      fontFamily: "Silkscreen, monospace", fontSize: small ? "24px" : "32px", color: small ? "#ffffff" : "#ffd15c",
      backgroundColor: small ? "rgba(27,35,51,0.82)" : "rgba(14,22,36,0.92)", padding: { x: small ? 10 : 14, y: small ? 4 : 6 },
    }).setOrigin(.5, 0).setResolution(3).setDepth(SKY_DEPTH + 40);
    t.setData("small", small);
    return t;
  }

  private layoutPlates(): void {
    this.plates.forEach(p => p.destroy()); this.plates = [];
    for (const s of this.structures) {
      if (!s.label) continue;
      const front = s.role === "palace" ? 6.6 : s.role === "bazaar" ? 3.1 : 3;
      const p = at(s.x + (s.role === "palace" ? -6.5 : s.role === "bazaar" ? 0 : .3), s.y + front);
      this.plates.push(this.plate(s.label, p.x, p.y + 6, s.role === "page"));
    }
    // on the open ground west of the treasury, clear of the bazaar and the workshops
    const t = at(capitol.minX - .9, capitol.centerY + 1.5);
    this.plates.push(this.plate("ROYAL TREASURY", t.x, t.y));
  }

  /** Where each place's bubbles float, in world pixels. */
  private anchor(place: RealmPlace): { x: number; y: number } | null {
    if (place === "treasury") return at(capitol.centerX, (capitol.minY + capitol.maxY) / 2, 300);
    const role = ({ castle: "palace", guild: "guild", market: "bazaar", harbour: "port" } as const)[place];
    const s = this.structures.find(x => x.role === role);
    if (!s) return null;
    return role === "palace" ? at(s.x, s.y + 4.4, 260) : role === "bazaar" ? at(s.x, s.y, 150) : at(s.x, s.y, 210);
  }

  /** A coin badge per uncollected reward, bobbing over the place that earned it. Tap to collect. */
  private layoutBubbles(): void {
    const want = new Set(this.rewards.map(r => r.key));
    for (const [key, bubble] of this.bubbles) if (!want.has(key)) { bubble.destroy(); this.bubbles.delete(key); }
    const perPlace = new Map<RealmPlace, number>();
    for (const r of this.rewards) {
      const i = perPlace.get(r.place) ?? 0; perPlace.set(r.place, i + 1);
      if (this.bubbles.has(r.key)) continue;
      const a = this.anchor(r.place); if (!a) continue;
      const card = this.add.graphics();
      card.fillStyle(0x0d1422, .28).fillRoundedRect(-58, -28, 120, 60, 16);
      card.fillStyle(0xfffaf0, 1).fillRoundedRect(-62, -34, 120, 60, 16).lineStyle(4, 0x1b2333, 1).strokeRoundedRect(-62, -34, 120, 60, 16);
      card.fillStyle(0xfffaf0, 1).fillTriangle(-10, 24, 10, 24, 0, 40).lineStyle(4, 0x1b2333, 1).beginPath().moveTo(-10, 26).lineTo(0, 40).lineTo(10, 26).strokePath();
      const coin = this.add.image(-30, -4, COIN_TEXTURES.coin).setScale(.48);
      const label = this.add.text(-6, -4, `+${r.xp}`, { fontFamily: "Silkscreen, monospace", fontSize: "24px", color: "#1b2333" }).setOrigin(0, .5).setResolution(3);
      const bubble = this.add.container(a.x, a.y, [card, coin, label]).setDepth(SKY_DEPTH + 50).setSize(124, 76).setInteractive({ useHandCursor: true });
      bubble.setData({ ax: a.x, ay: a.y, slot: i });
      bubble.on("pointerup", (pointer: Phaser.Input.Pointer) => {
        if (pointer.getDistance() > 8 || !this.bubbles.has(r.key)) return;
        this.suppressPickUntil = this.time.now + 400;
        this.bubbles.delete(r.key); bubble.disableInteractive(); bubble.setData("leaving", true);
        this.collectHandler?.(r.key, { x: pointer.x / this.dpr, y: pointer.y / this.dpr });
        this.tweens.add({ targets: bubble, y: bubble.y - 120 * (bubble.scale || 1), alpha: 0, duration: 520, ease: "Back.easeIn", onComplete: () => bubble.destroy() });
      });
      this.bubbles.set(r.key, bubble);
    }
  }
}

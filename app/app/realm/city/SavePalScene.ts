/*
 * SavePal's Realm scene: the city renderer's WorldScene (Claude Clan engine, as adapted in grounded)
 * driven by one agreement's real state -- the same structure as grounded's GroundedCityScene. The
 * base scene owns terrain, streets, the capitol, ships, carts and the camera; this subclass lays
 * out the kingdom (layout.ts), dresses every building in its authored structure (textures/), adds
 * the kingdom's life (life.ts), the landmark name plates and the reward bubbles.
 */
import Phaser from "phaser";
import { capitolDistrict } from "@sudo-city/protocol";
import { WorldScene } from "../reference-city/WorldScene";
import { SKY_DEPTH, projection } from "../reference-city/world/core/worldConstants";
import { setEstates } from "../reference-city/layouts/terrain";
import { CITY_SIZE, ESTATES, kingdom, type RealmInput, type Structure } from "./layout";
import { bakeCoins, COIN_TEXTURES } from "./coins";
import { bakeAll, type Asset } from "./textures/atelier";
import { PALACE, PALACE_BUILDER } from "./textures/palace";
import { TOWN, TOWN_BUILDERS } from "./textures/town";
import { FARMS, FARM_BUILDERS } from "./textures/farms";
import { bakeSky, type FlagColor } from "./textures/sky";
import { bakeCarts } from "./textures/carts";
import { KingdomLife, PEOPLE, personKey, personUrl, structureDepth } from "./life";

// The kingdom's estates are plain ground for the terrain pass: no street or prop crosses them.
setEstates(ESTATES);

export type RealmPlace = "castle" | "treasury" | "guild" | "market" | "harbour";
export type RealmPick = { place: RealmPlace } | { page: string } | { agreement: string } | { info: string };
export type RealmReward = { key: string; xp: number; place: RealmPlace };

const ASSETS: Record<string, Asset> = { palace: PALACE, ...TOWN, ...FARMS };
const capitol = capitolDistrict(CITY_SIZE);
const at = (gx: number, gy: number, z = 0) => { const p = projection.project(gx, gy); return { x: p.x, y: p.y - z }; };
const ROLE_PLACE: Partial<Record<Structure["role"], RealmPlace>> = { palace: "castle", guild: "guild", bazaar: "market", port: "harbour" };

export class SavePalScene extends WorldScene {
  private pickHandler?: (pick: RealmPick) => void;
  private collectHandler?: (key: string, screen: { x: number; y: number }) => void;
  private structures: Structure[] = [];
  private rewards: RealmReward[] = [];
  private bubbles = new Map<string, Phaser.GameObjects.Container>();
  private plates: Phaser.GameObjects.Text[] = [];
  private life?: KingdomLife;
  private ready = false;
  private pending?: RealmInput;
  /** A tap that collected a bubble must not also open the building beneath it. */
  private suppressPickUntil = 0;

  constructor() {
    super();
    // An ancient kingdom: the archive's airport, container port, navy yard and billboards stay unbuilt.
    const quiet = () => undefined;
    Object.assign(this.airportManager, { layoutAirport: quiet });
    Object.assign(this.harbourManager, { layoutHarbour: quiet });
    Object.assign(this.navyManager, { layoutNavyHarbour: quiet });
    Object.assign(this.billboardManager, { layoutBillboards: quiet });
    this.setSelectionListener((building) => {
      if (this.time.now < this.suppressPickUntil) return;
      const s = building && this.structures.find(x => x.path === building.path);
      if (!s) return;
      const place = ROLE_PLACE[s.role];
      if (place) this.pickHandler?.({ place });
      else if (s.role === "page") this.pickHandler?.({ page: s.path.slice(4) });
      else if (s.role === "agreement" && s.target) this.pickHandler?.({ agreement: s.target });
      else this.pickHandler?.({ info: s.info ?? "A home of the kingdom. More rise as your town levels up." });
    });
    this.setCapitolClickListener(() => { if (this.time.now >= this.suppressPickUntil) this.pickHandler?.({ place: "treasury" }); });
  }

  preload(): void { for (const p of PEOPLE) this.load.image(personKey(p), personUrl(p)); }

  override create(): void {
    super.create();
    bakeCoins(this);
    bakeAll(this, { palace: PALACE }, { palace: PALACE_BUILDER });
    bakeAll(this, TOWN, TOWN_BUILDERS);
    bakeAll(this, FARMS, FARM_BUILDERS);
    bakeSky(this);
    bakeCarts(this);
    this.life = new KingdomLife(this);
    this.ready = true;
    this.events.once("shutdown", () => {
      this.ready = false; this.life?.destroy(); this.life = undefined;
      this.bubbles.clear(); this.plates = [];
    });
    if (this.pending) { const p = this.pending; this.pending = undefined; this.setRealm(p); }
  }

  onPick(handler?: (pick: RealmPick) => void): void { this.pickHandler = handler; }
  onCollect(handler?: (key: string, screen: { x: number; y: number }) => void): void { this.collectHandler = handler; }

  /** Rebuilds the kingdom from the agreement's state. Safe to call before create(). */
  setRealm(input: RealmInput): void {
    if (!this.ready || !this.scene?.isActive()) { this.pending = input; return; }
    const { snapshot, structures } = kingdom(input);
    this.structures = structures;
    super.setWorld(snapshot, "savepal", `savepal-${input.current.id}`);
    this.dress();
    this.layoutPlates();
    this.life?.build(structures);
    const mainFlag: FlagColor = input.current.paid ? "gold" : input.current.held ? "paypal" : "royal";
    this.life?.setState({ held: input.current.held, paid: input.current.paid, working: input.stage === 2, appealOpen: input.appealOpen, bounties: input.bounties, inspecting: input.inspecting, banner: input.banner, mainFlag });
    this.layoutBubbles();
  }

  setRewards(rewards: RealmReward[]): void { this.rewards = rewards; if (this.ready && this.structures.length) this.layoutBubbles(); }
  celebrate(): void { this.life?.celebrate(); }

  /** Frames the whole kingdom (the base fit also frames the archive's airport, which isn't built here). */
  override fitCamera(): void {
    const cam = this.cameras.main;
    const pts = [at(-1, -1, 560), at(CITY_SIZE.width + 1, -1), at(CITY_SIZE.width + 1, CITY_SIZE.height + 1), at(-1, CITY_SIZE.height + 1), at(CITY_SIZE.width + 14, 21)];
    const left = Math.min(...pts.map(p => p.x)), right = Math.max(...pts.map(p => p.x)), top = Math.min(...pts.map(p => p.y)), bottom = Math.max(...pts.map(p => p.y));
    const zoom = Phaser.Math.Clamp(Math.min((cam.width - 60) / (right - left), (cam.height - 60) / (bottom - top)) * 1.12, .2, 1.4);
    this.cameraController.zoomTarget = zoom;
    cam.setZoom(zoom).centerOn((left + right) / 2, (top + bottom) / 2 + 20);
  }

  /** Flies the camera to a place, as the orders board and quest banner do. */
  focusPlace(place: RealmPlace): void {
    const a = this.anchor(place);
    if (a) this.cameraController.moveCameraTo(a.x, a.y + 120, Math.max(.7, this.cameraController.zoomTarget));
  }

  /** Name plates and bubbles keep a steady size on screen whatever the zoom. */
  update(time: number): void {
    const zoom = this.cameras.main.zoom || 1;
    const k = Phaser.Math.Clamp(.46 / zoom, .3, 1.5), kb = Phaser.Math.Clamp(.52 / zoom, .35, 1.6);
    for (const p of this.plates) p.setScale(k * (p.getData("small") ? .8 : 1));
    this.life?.scaleSky(Phaser.Math.Clamp(.62 / zoom, 1, 2.6));
    // bubbles sit side by side over their place at a steady size, bobbing gently
    for (const b of this.bubbles.values()) {
      if (b.getData("leaving")) continue;
      const slot = b.getData("slot") as number, side = slot === 0 ? 0 : (slot % 2 ? 1 : -1) * Math.ceil(slot / 2);
      b.setScale(kb).setPosition(b.getData("ax") + side * 136 * kb, b.getData("ay") + Math.sin(time / 420 + slot) * 7 * kb);
    }
  }

  /** Swaps every building view onto its authored structure (as grounded does for its landmarks). */
  private dress(): void {
    for (const s of this.structures) {
      const view = this.buildingManager.getViews().get(s.path);
      const asset = ASSETS[s.kind];
      if (!view || !asset) continue;
      const p = projection.project(s.x, s.y);
      if (view.sprite.texture.key !== asset.key) view.sprite.setTexture(asset.key);
      view.sprite.setOrigin((asset.originX ?? asset.width / 2) / asset.width, 1).setScale(1).setPosition(p.x, p.y + asset.anchorY).setDepth(structureDepth(s));
      view.sprite.setData("constructionAnchorOffset", asset.anchorY - 24);
      view.sprite.setInteractive({ pixelPerfect: true, useHandCursor: true });
    }
  }

  private plate(text: string, x: number, y: number, small = false): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, text, {
      fontFamily: "Silkscreen, monospace", fontSize: small ? "24px" : "32px", color: small ? "#ffffff" : "#ffd15c",
      backgroundColor: small ? "rgba(27,35,51,0.82)" : "rgba(14,22,36,0.92)", padding: { x: small ? 10 : 14, y: small ? 4 : 6 },
    }).setOrigin(.5, 0).setResolution(2).setDepth(SKY_DEPTH - 40);
    t.setData("small", small);
    return t;
  }

  private layoutPlates(): void {
    this.plates.forEach(p => p.destroy()); this.plates = [];
    for (const s of this.structures) {
      if (!s.label) continue;
      const big = s.role === "palace" || s.role === "bazaar", front = s.role === "palace" ? 7 : s.role === "bazaar" ? 3.1 : 3;
      const p = at(s.x + (big ? 0 : .3), s.y + front);
      this.plates.push(this.plate(s.label, p.x, p.y + 6, s.role === "page"));
    }
    const t = at(capitol.centerX + 1.5, capitol.maxY + .6);
    this.plates.push(this.plate("ROYAL TREASURY", t.x, t.y));
  }

  /** Where each place's bubbles float, in world pixels. */
  private anchor(place: RealmPlace): { x: number; y: number } | null {
    if (place === "treasury") return at(capitol.centerX, capitol.centerY, 250);
    const role = ({ castle: "palace", guild: "guild", market: "bazaar", harbour: "port" } as const)[place];
    const s = this.structures.find(x => x.role === role);
    if (!s) return null;
    return role === "palace" ? at(s.x, s.y + 4.4, 230) : role === "bazaar" ? at(s.x, s.y, 140) : at(s.x, s.y, 200);
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
      const x = a.x, y = a.y;
      const card = this.add.graphics();
      card.fillStyle(0x0d1422, .28).fillRoundedRect(-58, -28, 120, 60, 16);
      card.fillStyle(0xfffaf0, 1).fillRoundedRect(-62, -34, 120, 60, 16).lineStyle(4, 0x1b2333, 1).strokeRoundedRect(-62, -34, 120, 60, 16);
      card.fillStyle(0xfffaf0, 1).fillTriangle(-10, 24, 10, 24, 0, 40).lineStyle(4, 0x1b2333, 1).beginPath().moveTo(-10, 26).lineTo(0, 40).lineTo(10, 26).strokePath();
      const coin = this.add.image(-30, -4, COIN_TEXTURES.coin).setScale(.48);
      const label = this.add.text(-6, -4, `+${r.xp}`, { fontFamily: "Silkscreen, monospace", fontSize: "24px", color: "#1b2333" }).setOrigin(0, .5).setResolution(2);
      const bubble = this.add.container(x, y, [card, coin, label]).setDepth(SKY_DEPTH - 10).setSize(124, 76).setInteractive({ useHandCursor: true });
      bubble.setData({ ax: x, ay: y, slot: i });
      bubble.on("pointerup", (pointer: Phaser.Input.Pointer) => {
        if (pointer.getDistance() > 8 || !this.bubbles.has(r.key)) return;
        this.suppressPickUntil = this.time.now + 400;
        this.bubbles.delete(r.key); bubble.disableInteractive(); bubble.setData("leaving", true);
        this.collectHandler?.(r.key, { x: pointer.x, y: pointer.y });
        this.tweens.add({ targets: bubble, y: bubble.y - 120, alpha: 0, duration: 520, ease: "Back.easeIn", onComplete: () => bubble.destroy() });
      });
      this.bubbles.set(r.key, bubble);
    }
  }
}

/*
 * The kingdom plan: which structure stands on every block, as a WorldSnapshot for the city
 * renderer (the Claude Clan engine, as adapted in grounded). Pure: the same agreements always
 * give the same kingdom. Every block holds exactly one designed structure on its own five-by-five
 * ground, with streets on all four sides, so the spacing is the city grid itself.
 *
 *   royal palace     six blocks at the head of the city  -> the client's seat (checks, approval)
 *   treasury         the capitol at the centre            -> the PayPal hold
 *   grand bazaar     two blocks before the treasury       -> bounties, one golden stall each
 *   guild hall       a block to the north-east            -> the freelancer (accept, deliver)
 *   port & customs   on the east coast                    -> appeals and refunds
 *   countryside      the west: windmills, wheat that ripens with the agreement, berries, vines
 *   town             workshops (delivered pages), manors (other agreements), homes (town level)
 */
import { capitolDistrict, type Building, type WorldSnapshot } from "@sudo-city/protocol";
import type { EstateRect } from "../reference-city/layouts/terrain";
import type { TownKind } from "./textures/town";
import type { FarmKind } from "./textures/farms";

export const CITY_SIZE = { width: 48, height: 36 } as const;
const BLOCK = 6;

export type RealmAgreement = { id: string; title: string; amount_cents: number; held: boolean; paid: boolean };
export type RealmPage = { path: string; bytes: number };
export type RealmInput = {
  current: RealmAgreement; others: RealmAgreement[]; pages: RealmPage[]; homes: number;
  /** 0 waiting, 1 sworn, 2 working with the gold held, 3 delivered or approved, 4 paid. */
  stage: number; bounties: number; appealOpen: boolean; inspecting: string | null; banner: string;
};

export type StructureKind = "palace" | TownKind | FarmKind;
export type Role = "palace" | "bazaar" | "guild" | "port" | "page" | "agreement" | "home" | "farm" | "park";
export type Structure = { path: string; kind: StructureKind; role: Role; x: number; y: number; rect: EstateRect; label?: string; info?: string; target?: string };

export const PATHS = { castle: "civic/castle", guild: "civic/guild", market: "civic/market", customs: "civic/customs" } as const;
export const pagePath = (path: string) => `page${path.startsWith("/") ? path : `/${path}`}`;
export const agreementPath = (id: string) => `agreement/${id}`;

const capitol = capitolDistrict(CITY_SIZE);
const blockRect = (bx: number, by: number): EstateRect => ({ minX: bx * BLOCK + 1, minY: by * BLOCK + 1, maxX: bx * BLOCK + 5, maxY: by * BLOCK + 5 });
const centreOf = (r: EstateRect) => ({ x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 });
const touchesCapitol = (r: EstateRect) => r.maxX >= capitol.minX && r.minX <= capitol.maxX && r.maxY >= capitol.minY && r.minY <= capitol.maxY;

/** The great estates span several blocks; the streets between those blocks are closed. */
export const PALACE_RECT: EstateRect = { minX: 1, minY: 1, maxX: 17, maxY: 11 };
export const BAZAAR_RECT: EstateRect = { minX: 19, minY: 25, maxX: 29, maxY: 29 };
const inside = (r: EstateRect, outer: EstateRect) => r.minX >= outer.minX && r.maxX <= outer.maxX && r.minY >= outer.minY && r.maxY <= outer.maxY;

const GUILD: [number, number] = [6, 1], PORT: [number, number] = [7, 3];
const FARM_PLAN: Array<[number, number, FarmKind | "wheat"]> = [
  [0, 2, "windmill"], [1, 2, "wheat"], [0, 3, "strawberries"], [1, 3, "wheat"],
  [0, 4, "vineyard"], [1, 4, "blueberries"], [0, 5, "barn"], [1, 5, "windmill"], [2, 4, "park"], [2, 5, "orchard"],
];

/** Every free block of the town, nearest the treasury first. */
const TOWN_BLOCKS: Array<[number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (let by = 0; by < CITY_SIZE.height / BLOCK; by++) for (let bx = 0; bx < CITY_SIZE.width / BLOCK; bx++) {
    const r = blockRect(bx, by);
    if (touchesCapitol(r) || inside(r, PALACE_RECT) || inside(r, BAZAAR_RECT)) continue;
    if ((bx === GUILD[0] && by === GUILD[1]) || (bx === PORT[0] && by === PORT[1]) || FARM_PLAN.some(([fx, fy]) => fx === bx && fy === by)) continue;
    out.push([bx, by]);
  }
  const c = { x: capitol.centerX, y: capitol.centerY };
  return out.sort((a, b) => Math.hypot(centreOf(blockRect(...a)).x - c.x, centreOf(blockRect(...a)).y - c.y) - Math.hypot(centreOf(blockRect(...b)).x - c.x, centreOf(blockRect(...b)).y - c.y));
})();

/** Every authored ground, registered with the terrain so no street or stray prop crosses it. */
export const ESTATES: EstateRect[] = [
  PALACE_RECT, BAZAAR_RECT, blockRect(...GUILD), blockRect(...PORT),
  ...FARM_PLAN.map(([bx, by]) => blockRect(bx, by)), ...TOWN_BLOCKS.map(([bx, by]) => blockRect(bx, by)),
];
export const MAX_HOMES = TOWN_BLOCKS.length;

const STAGE_INFO = [
  "Bare furrows: the wheat is sown when the guild swears to the terms.",
  "Sprouting: the terms are sworn. The crop grows once PayPal holds the gold.",
  "Growing green: PayPal holds the gold while the guild works.",
  "Golden and ripe: the work is delivered. It is harvested when PayPal pays.",
  "Harvested: PayPal has paid. The sheaves are in.",
];
const hash = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };

export function kingdom(input: RealmInput): { snapshot: WorldSnapshot; structures: Structure[] } {
  const structures: Structure[] = [];
  const add = (s: Omit<Structure, "x" | "y">) => { const c = centreOf(s.rect); structures.push({ ...s, x: c.x, y: c.y }); };
  add({ path: PATHS.castle, kind: "palace", role: "palace", rect: PALACE_RECT, label: "ROYAL PALACE" });
  add({ path: PATHS.market, kind: "bazaar", role: "bazaar", rect: BAZAAR_RECT, label: "GRAND BAZAAR" });
  add({ path: PATHS.guild, kind: "guild", role: "guild", rect: blockRect(...GUILD), label: "GUILD HALL" });
  add({ path: PATHS.customs, kind: "port", role: "port", rect: blockRect(...PORT), label: "PORT & CUSTOMS" });
  const wheat = `wheat${Math.max(0, Math.min(4, input.stage))}` as FarmKind;
  for (const [bx, by, kind] of FARM_PLAN) {
    const k: FarmKind = kind === "wheat" ? wheat : kind;
    add({ path: `farm/${k}/${bx}/${by}`, kind: k, role: k === "park" ? "park" : "farm", rect: blockRect(bx, by),
      info: kind === "wheat" ? STAGE_INFO[Math.max(0, Math.min(4, input.stage))] : k === "windmill" ? "The windmill turns faster while PayPal holds the gold." : k === "barn" ? "The royal barn stores every harvest." : undefined });
  }
  const free = [...TOWN_BLOCKS];
  const next = () => free.shift();
  input.pages.forEach((page, i) => { const b = next(); if (b) add({ path: pagePath(page.path), kind: i % 2 ? "workshop1" : "workshop0", role: "page", rect: blockRect(...b), label: page.path.length > 14 ? `${page.path.slice(0, 13)}…` : page.path }); });
  for (const other of input.others) { const b = next(); if (b) add({ path: agreementPath(other.id), kind: other.paid ? "manorPaid" : other.held ? "manorHeld" : "manorOpen", role: "agreement", rect: blockRect(...b), target: other.id, info: other.title }); }
  for (let i = 0; i < input.homes; i++) { const b = next(); if (!b) break; add({ path: `home/${b[0]}/${b[1]}`, kind: (["homestead0", "homestead1", "homestead2", "homestead3"] as const)[hash(`${b[0]}:${b[1]}`) % 4]!, role: "home", rect: blockRect(...b) }); }
  free.forEach((b, i) => add({ path: `park/${b[0]}/${b[1]}`, kind: i % 3 === 2 ? "orchard" : "park", role: "park", rect: blockRect(...b), info: "Open ground: new homes rise here as your town levels up." }));

  const buildings: Building[] = structures.map(s => ({ path: s.path, district: "kingdom", language: "HTML", loc: 900, plot: { x: Math.round(s.x), y: Math.round(s.y) } }));
  return {
    structures,
    snapshot: {
      id: `savepal-${input.current.id}`,
      repoPath: `savepal/${input.current.id}`,
      revision: structures.map(s => `${s.path}:${s.kind}`).join("|"),
      generatedAt: new Date(0).toISOString(),
      size: { ...CITY_SIZE },
      layoutVersion: 2,
      districts: [{ path: "kingdom", x: 0, y: 0, width: CITY_SIZE.width, height: CITY_SIZE.height, weight: 1 }],
      buildings,
    },
  };
}

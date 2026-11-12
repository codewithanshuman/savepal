import { TERRAIN_COLORS } from "../math/palette";
import { RoadClass, TerrainKind } from "../layouts/terrain";
import Phaser, { Scene } from "phaser";
import { Baker, TILE_WIDTH, TILE_HEIGHT, HALF_W, HALF_H, fillFace, diamond, strokeFace, shade, Point3 } from "./core";

export const GRASS_VARIANTS = TERRAIN_COLORS.grass.length;

export const PARK_VARIANTS = 2;

export const SAND_VARIANTS = 2;

export const WATER_VARIANTS = 3;


// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export function terrainTextureKey(kind: TerrainKind, variant: number): string {
  return `tile:${kind}:${variant}`;
}


export function roadTextureKey(mask: number, roadClass: RoadClass): string {
  return `tile:road:${roadClass}:${mask}`;
}

/** Every road class the atlas bakes, widest first -- also the bake order. */
export const ROAD_CLASSES: readonly RoadClass[] = ["boulevard", "street", "lane"];


export const TERRAIN_VARIANT_COUNTS: Record<TerrainKind, number> = {
  grass: GRASS_VARIANTS,
  park: PARK_VARIANTS,
  sand: SAND_VARIANTS,
  water: WATER_VARIANTS,
  ground: 1,
  road: 1,
  plaza: 1,
};


/**
 * Every ground tile lives in ONE texture, so the whole terrain plane can be a
 * single batched object. A large repository lays down tens of thousands of
 * tiles; as individual Sprites that is a per-frame culling and depth-sorting
 * cost that dominates the frame budget.
 */
export const TERRAIN_ATLAS_KEY = "terrain-atlas";


/** Half-footprint of a building, in tiles. Leaves a gap between neighbours. */
export const FOOTPRINT = 0.42;


/** Half-width of the asphalt, in tiles. */
export const ROAD_HALF = 0.3;

export const KERB_HALF = 0.4;

/**
 * Carriageway and kerb half-widths per road class. A back lane is deliberately
 * narrower than the block's own frontage row so it reads as service access
 * rather than a street; a boulevard is wider than a block's ordinary road
 * budget allows in most places, which is exactly what marks it as the main
 * road when it crosses one.
 */
export const ROAD_WIDTHS: Record<RoadClass, { road: number; kerb: number }> = {
  boulevard: { road: 0.42, kerb: 0.5 },
  street: { road: ROAD_HALF, kerb: KERB_HALF },
  lane: { road: 0.2, kerb: 0.26 },
};

export const ATLAS_COLUMNS = 8;
/** SavePal: the ground atlas is baked at twice the tile size and drawn at half, so it stays crisp in HD. */
export const ATLAS_RES = 2;


export function bakeTerrainAtlas(scene: Phaser.Scene, baker: Baker): void {
  const slots: Array<{ name: string; x: number; y: number }> = [];
  let index = 0;

  baker.graphics.setScale(ATLAS_RES);
  const place = (name: string, draw: (x: number, y: number) => void): void => {
    const x = (index % ATLAS_COLUMNS) * TILE_WIDTH;
    const y = Math.floor(index / ATLAS_COLUMNS) * TILE_HEIGHT;
    draw(x + HALF_W, y + HALF_H);
    slots.push({ name, x, y });
    index += 1;
  };

  for (let variant = 0; variant < GRASS_VARIANTS; variant += 1) {
    place(terrainTextureKey("grass", variant), (x, y) =>
      drawGroundTile(baker, x, y, TERRAIN_COLORS.grass[variant] as number, variant),
    );
  }
  for (let variant = 0; variant < PARK_VARIANTS; variant += 1) {
    place(terrainTextureKey("park", variant), (x, y) =>
      drawGroundTile(
        baker,
        x,
        y,
        variant === 0 ? TERRAIN_COLORS.park : TERRAIN_COLORS.field,
        variant + 7,
      ),
    );
  }
  for (let variant = 0; variant < SAND_VARIANTS; variant += 1) {
    place(terrainTextureKey("sand", variant), (x, y) =>
      drawGroundTile(
        baker,
        x,
        y,
        variant === 0 ? TERRAIN_COLORS.sand : TERRAIN_COLORS.sandShade,
        variant + 3,
      ),
    );
  }
  place(terrainTextureKey("ground", 0), (x, y) =>
    drawGroundTile(baker, x, y, TERRAIN_COLORS.ground, 11),
  );
  place(terrainTextureKey("plaza", 0), (x, y) => drawPlazaTile(baker, x, y));
  for (let variant = 0; variant < WATER_VARIANTS; variant += 1) {
    place(terrainTextureKey("water", variant), (x, y) =>
      drawWaterTile(baker, x, y, variant),
    );
  }
  for (const roadClass of ROAD_CLASSES) {
    for (let mask = 0; mask < 16; mask += 1) {
      place(roadTextureKey(mask, roadClass), (x, y) => drawRoadTile(baker, x, y, mask, roadClass));
    }
  }

  const rows = Math.ceil(index / ATLAS_COLUMNS);
  // power-of-two sides, so the GPU builds mipmaps and the ground stays clean when zoomed far out
  const pot = (n: number) => 2 ** Math.ceil(Math.log2(n));
  baker.flush(TERRAIN_ATLAS_KEY, pot(ATLAS_COLUMNS * TILE_WIDTH * ATLAS_RES), pot(rows * TILE_HEIGHT * ATLAS_RES));
  baker.graphics.setScale(1);

  const texture = scene.textures.get(TERRAIN_ATLAS_KEY);
  // frames inset by a hair so neighbouring tiles never bleed into each other under smooth filtering
  for (const slot of slots) {
    texture.add(slot.name, 0, slot.x * ATLAS_RES + 1, slot.y * ATLAS_RES + 1, TILE_WIDTH * ATLAS_RES - 2, TILE_HEIGHT * ATLAS_RES - 2);
  }
}


/*
 * SavePal's own ground art, replacing the archive's tiles under the same atlas frames: lush
 * painted grass, warm sand, a deep teal sea, herringbone plaza stone, and ancient roads --
 * flagstone avenues, cobbled streets and dirt lanes with wheel ruts. No outlines between tiles,
 * so fields read as one continuous meadow rather than a grid.
 */
const REALM = {
  grass: [0x79c35a, 0x74be55, 0x7fc85f], park: 0x6db84f, meadow: 0x86cb63, ground: 0x76c057,
  sand: [0xeedca9, 0xe6d19a], plaza: 0xeee2c8, plazaJoint: 0xd6c7a7,
  water: [0x3fa2da, 0x3b9bd2, 0x2f88c2], foam: 0xd8f0ff,
  cobble: 0xc9bc9c, cobbleDark: 0xad9f80, kerb: 0x9c8f78, flag: 0xe6d8b6, flagJoint: 0xcdbd99, dirt: 0xc8a676, rut: 0xa8865a,
};
const hash01 = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

export function drawGroundTile(
  baker: Baker,
  originX: number,
  originY: number,
  _color: number,
  seed: number,
): void {
  const g = baker.graphics;
  const base = seed <= 2 ? REALM.grass[seed]! : seed === 3 ? REALM.sand[0] : seed === 4 ? REALM.sand[1] : seed === 7 ? REALM.park : seed === 8 ? REALM.meadow : REALM.ground;
  const sand = seed === 3 || seed === 4;
  fillFace(baker, base, 1, diamond(0.5), originX, originY);
  // a soft lighter wash so the tile has a sense of light, without a hard edge
  fillFace(baker, shade(base, 7), 0.35, diamond(0.3), originX, originY);
  for (let i = 0; i < 14; i += 1) {
    const u = hash01(seed + 1, i) - 0.5, v = hash01(i + 3, seed + 7) - 0.5;
    if (Math.abs(u) + Math.abs(v) > 0.46) continue;
    const p = baker.at([u * 0.9, v * 0.9, 0], originX, originY);
    if (sand) { g.fillStyle(shade(base, i % 2 ? -8 : 8), 0.6).fillEllipse(p.x, p.y, 6, 1.4); continue; }
    const dark = i % 3 === 0;
    g.lineStyle(1.2, shade(base, dark ? -14 : 14), 0.75).beginPath().moveTo(p.x, p.y).lineTo(p.x + (i % 2 ? 1.2 : -1.2), p.y - 3.4).strokePath();
  }
  if (!sand && seed !== 11 && seed % 2 === 0) {
    const p = baker.at([0.12, -0.08, 0], originX, originY);
    for (const [dx, dy, c] of [[0, 0, 0xffffff], [3, 1, 0xffd15c], [-3, 2, 0xff8fb1]] as const) g.fillStyle(c, 0.95).fillCircle(p.x + dx, p.y + dy, 1.3);
  }
}

export function drawPlazaTile(baker: Baker, originX: number, originY: number): void {
  fillFace(baker, REALM.plaza, 1, diamond(0.5), originX, originY);
  const g = baker.graphics;
  g.lineStyle(1, REALM.plazaJoint, 0.8);
  // herringbone slabs, laid in grid space so they continue tile to tile
  for (let k = -0.5; k <= 0.5; k += 0.25) {
    const a = baker.at([k, -0.5, 0], originX, originY), b = baker.at([k, 0.5, 0], originX, originY);
    g.lineBetween(a.x, a.y, b.x, b.y);
  }
  for (let k = -0.375; k <= 0.5; k += 0.25) for (let j = -0.5; j < 0.5; j += 0.25) {
    const off = Math.round((k + 0.5) / 0.25) % 2 ? 0.125 : 0;
    const a = baker.at([k - 0.25, j + off, 0], originX, originY), b = baker.at([k, j + off, 0], originX, originY);
    g.lineBetween(a.x, a.y, b.x, b.y);
  }
}

export function drawWaterTile(
  baker: Baker,
  originX: number,
  originY: number,
  variant: number,
): void {
  const base = REALM.water[variant] ?? REALM.water[0]!;
  fillFace(baker, base, 1, diamond(0.5), originX, originY);
  fillFace(baker, shade(base, -5), 0.5, diamond(0.32), originX, originY);
  const g = baker.graphics;
  for (let i = 0; i < 3; i += 1) {
    const p = baker.at([hash01(variant, i) * 0.6 - 0.3, hash01(i, variant + 5) * 0.6 - 0.3, 0], originX, originY);
    g.fillStyle(REALM.foam, 0.28).fillEllipse(p.x, p.y, 10 - i * 2, 1.6);
  }
}

export function drawRoadTile(
  baker: Baker,
  originX: number,
  originY: number,
  mask: number,
  roadClass: RoadClass = "street",
): void {
  const { road: roadHalf, kerb: kerbHalf } = ROAD_WIDTHS[roadClass];
  const arms: Array<[number, Point3[]]> = [
    [1, band(-0.5, -roadHalf, "v", roadHalf)],
    [2, band(roadHalf, 0.5, "u", roadHalf)],
    [4, band(roadHalf, 0.5, "v", roadHalf)],
    [8, band(-0.5, -roadHalf, "u", roadHalf)],
  ];
  const kerbArms: Array<[number, Point3[]]> = [
    [1, band(-0.5, -kerbHalf, "v", kerbHalf)],
    [2, band(kerbHalf, 0.5, "u", kerbHalf)],
    [4, band(kerbHalf, 0.5, "v", kerbHalf)],
    [8, band(-0.5, -kerbHalf, "u", kerbHalf)],
  ];
  const g = baker.graphics;
  fillFace(baker, REALM.ground, 1, diamond(0.5), originX, originY);
  // ancient roads: a dirt lane, a cobbled street, or a flagstone avenue with stone kerbs
  const lane = roadClass === "lane", avenue = roadClass === "boulevard";
  const surface = lane ? REALM.dirt : avenue ? REALM.flag : REALM.cobble;
  if (!lane) {
    fillFace(baker, REALM.kerb, 1, diamond(kerbHalf), originX, originY);
    for (const [bit, points] of kerbArms) if (mask & bit) fillFace(baker, REALM.kerb, 1, points, originX, originY);
  }
  fillFace(baker, surface, 1, diamond(roadHalf), originX, originY);
  for (const [bit, points] of arms) if (mask & bit) fillFace(baker, surface, 1, points, originX, originY);
  // the surface texture, kept inside the carriageway
  const inside = (u: number, v: number) => (Math.abs(u) <= roadHalf && Math.abs(v) <= roadHalf)
    || ((mask & 1) && v < 0 && Math.abs(u) <= roadHalf) || ((mask & 4) && v > 0 && Math.abs(u) <= roadHalf)
    || ((mask & 2) && u > 0 && Math.abs(v) <= roadHalf) || ((mask & 8) && u < 0 && Math.abs(v) <= roadHalf);
  if (lane) {
    for (const off of [-0.08, 0.08]) {
      if ((mask & (2 | 8)) && !(mask & (1 | 4))) { const a = baker.at([-0.5, off, 0], originX, originY), b = baker.at([0.5, off, 0], originX, originY); g.lineStyle(1.4, REALM.rut, 0.7).lineBetween(a.x, a.y, b.x, b.y); }
      if ((mask & (1 | 4)) && !(mask & (2 | 8))) { const a = baker.at([off, -0.5, 0], originX, originY), b = baker.at([off, 0.5, 0], originX, originY); g.lineStyle(1.4, REALM.rut, 0.7).lineBetween(a.x, a.y, b.x, b.y); }
    }
    return;
  }
  if (avenue) {
    g.lineStyle(1, REALM.flagJoint, 0.9);
    for (let k = -0.5; k <= 0.5; k += 0.2) for (const [u0, v0, u1, v1] of [[k, -0.5, k, 0.5], [-0.5, k, 0.5, k]] as const) {
      const steps = 10;
      for (let s = 0; s < steps; s += 1) {
        const ua = u0 + (u1 - u0) * s / steps, va = v0 + (v1 - v0) * s / steps, ub = u0 + (u1 - u0) * (s + 1) / steps, vb = v0 + (v1 - v0) * (s + 1) / steps;
        if (!inside((ua + ub) / 2, (va + vb) / 2)) continue;
        const a = baker.at([ua, va, 0], originX, originY), b = baker.at([ub, vb, 0], originX, originY);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
    }
    return;
  }
  for (let i = 0; i < 46; i += 1) {
    const u = hash01(mask + 11, i) - 0.5, v = hash01(i + 5, mask + 3) - 0.5;
    if (!inside(u, v)) continue;
    const p = baker.at([u, v, 0], originX, originY);
    g.fillStyle(i % 3 ? REALM.cobbleDark : shade(REALM.cobble, 10), 0.85).fillEllipse(p.x, p.y, 5, 2.6);
  }
}


/** A rectangular strip in grid space, running along one axis. */
export function band(
  from: number,
  to: number,
  axis: "u" | "v",
  half = ROAD_HALF,
): Point3[] {
  return axis === "u"
    ? [
        [from, -half, 0],
        [to, -half, 0],
        [to, half, 0],
        [from, half, 0],
      ]
    : [
        [-half, from, 0],
        [half, from, 0],
        [half, to, 0],
        [-half, to, 0],
      ];
}

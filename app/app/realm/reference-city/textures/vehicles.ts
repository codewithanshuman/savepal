import { Baker, TILE_ANCHOR_Y, fillFace, shade, TILE_WIDTH, Point3 } from "./core";
import { TERRAIN_COLORS } from "../math/palette";
import { SHIP_HEADING_FRAMES, shipHeadingAngle } from "./harbour/ship";
import { harbourPost } from "./harbour/base";

export const CAR_KEYS = ["fx:car:0", "fx:car:1", "fx:car:2", "fx:car:3"] as const;
export const BUS_KEYS = ["fx:bus:0", "fx:bus:1"] as const;


export const CAR_COLORS = [0xe26943, 0x357fa9, 0xf2eacb, 0x586575, 0x429681, 0xd2a64c] as const;


export const CAR_TEXTURE_HEIGHT = 76;

/** The vehicle's nose is -v at frame zero; height stays vertical at every heading. */
export function trafficHeadingKey(key: string, dx: number, dy: number): string {
  const frame = dx > 0 ? 1 : dy > 0 ? 2 : dx < 0 ? 3 : 0;
  return frame === 0 ? key : `${key}:heading:${frame}`;
}


export function bakeCar(baker: Baker, key: string, index: number): void {
  for (let heading = 0; heading < 4; heading += 1) {
    bakeRoadVehicle(baker, heading === 0 ? key : `${key}:heading:${heading}`, index, heading);
  }
}

/**
 * Uses the archive's heading-baked ship technique for actual car bodies, not
 * screen rotation: roofs, tyres and cabin height remain in the isometric plane.
 * Sedans occupy .70 x .32 tiles; buses 1.10 x .36, within the wider road lanes.
 */
function bakeRoadVehicle(source: Baker, key: string, index: number, heading: number): void {
  const bus = index >= CAR_KEYS.length;
  const paint = CAR_COLORS[index % CAR_COLORS.length]!;
  const length = bus ? 0.55 : 0.35;
  const halfWidth = bus ? 0.18 : 0.16;
  const height = bus ? 21 : 9;
  const ox = TILE_WIDTH / 2;
  const oy = CAR_TEXTURE_HEIGHT - TILE_ANCHOR_Y;
  const angle = heading * Math.PI / 2;
  const cos = Math.round(Math.cos(angle));
  const sin = Math.round(Math.sin(angle));
  const baker: Baker = {
    ...source,
    at: ([u, v, z], x, y) => source.at([u * cos - v * sin, u * sin + v * cos, z], x, y),
  };
  const face = (color: number, points: readonly Point3[], alpha = 1) => fillFace(baker, color, alpha, points, ox, oy);
  const visible = (u: number, v: number) => u * (cos + sin) + v * (cos - sin) > 0;
  const box = (u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, color: number) => {
    for (const side of [-1, 1]) {
      if (visible(side, 0)) {
        const u = side < 0 ? u0 : u1;
        face(shade(color, side * (cos + sin) > 0 ? -16 : -30), [[u,v0,z0],[u,v1,z0],[u,v1,z1],[u,v0,z1]]);
      }
      if (visible(0, side)) {
        const v = side < 0 ? v0 : v1;
        face(shade(color, -25), [[u0,v,z0],[u1,v,z0],[u1,v,z1],[u0,v,z1]]);
      }
    }
    face(shade(color, 12), [[u0,v0,z1],[u1,v0,z1],[u1,v1,z1],[u0,v1,z1]]);
  };
  face(TERRAIN_COLORS.shadow, [[-.22,-length-.06,0],[.23,-length-.06,0],[.23,length+.07,0],[-.22,length+.07,0]], .22);
  box(-halfWidth,-length,halfWidth,length,3,height,paint);
  // Contrasting lower sill and bumpers keep the body separated from its shadow.
  box(-halfWidth,-length-.012,halfWidth,-length+.035,3,5,0x384852);
  box(-halfWidth,length-.03,halfWidth,length+.012,3,5,0x384852);
  for (const side of [-1, 1]) {
    if (!visible(side, 0)) continue;
    const u = side * (halfWidth + .006);
    face(bus ? 0xf2ebd7 : shade(paint,-15), [[u,-length,5],[u,length,5],[u,length,7],[u,-length,7]]);
    // Wheel faces are circles in their own vertical plane, then projected.
    for (const v of [-(length-.13),length-.13]) {
      const wheel: Point3[] = Array.from({length: 12}, (_unused,n) => {
        const a = n * Math.PI / 6;
        return [u,v+Math.cos(a)*.052,3.3+Math.sin(a)*3.2];
      });
      face(0x1c2931,wheel);
      const hub: Point3[] = Array.from({length: 10}, (_unused,n) => {
        const a = n * Math.PI / 5;
        return [u,v+Math.cos(a)*.025,3.3+Math.sin(a)*1.6];
      });
      face(0xb2bcc0,hub);
    }
  }
  if (bus) {
    for (const side of [-1,1]) {
      if (!visible(side,0)) continue;
      const u=side*(halfWidth+.008);
      for(let window=0;window<6;window+=1) {
        const v=-.47+window*.151;
        face(0x223e51,[[u,v,11],[u,v+.126,11],[u,v+.126,18],[u,v,18]]);
        face(0x86bbc7,[[u,v,17],[u,v+.126,17],[u,v+.126,18],[u,v,18]],.7);
      }
      // Passenger door: dark double leaf and a slim silver divider.
      face(0x193343,[[u,-.48,5],[u,-.33,5],[u,-.33,18],[u,-.48,18]]);
      face(0xb9c9c6,[[u,-.408,5],[u,-.40,5],[u,-.40,18],[u,-.408,18]]);
    }
    box(-.10,-.10,.10,.20,height,height+2.7,0xdce5df);
    for(let vent=0;vent<5;vent+=1) {
      const v=-.07+vent*.047;
      face(0x7b918f,[[-.065,v,height+2.8],[.065,v,height+2.8],[.065,v+.016,height+2.8],[-.065,v+.016,height+2.8]]);
    }
    if(visible(0,-1)) {
      face(0x254658,[[-.145,-length-.008,9],[.145,-length-.008,9],[.145,-length-.008,18],[-.145,-length-.008,18]]);
      face(0xeac576,[[-.09,-length-.01,18.4],[.09,-length-.01,18.4],[.09,-length-.01,20],[-.09,-length-.01,20]]);
    }
  } else {
    // Sloped glazing and raised metal roof, with side pillars rather than a cube.
    const roof=15;
    const a=-.12, b=.17;
    for(const side of [-1,1]) {
      if(!visible(side,0)) continue;
      face(shade(paint,-12),[[side*.15,-.23,9],[side*.15,.23,9],[side*.115,b,roof],[side*.115,a,roof]]);
      face(0x24475a,[[side*.152,-.20,9.7],[side*.152,-.008,9.7],[side*.118,-.008,14.2],[side*.118,-.11,14.2]]);
      face(0x294e60,[[side*.152,.011,9.7],[side*.152,.21,9.7],[side*.118,.156,14.2],[side*.118,.011,14.2]]);
    }
    if(visible(0,-1)) face(0x81aab5,[[-.15,-.23,9],[.15,-.23,9],[.115,a,roof],[-.115,a,roof]]);
    if(visible(0,1)) face(0x345c6a,[[-.15,.23,9],[.15,.23,9],[.115,b,roof],[-.115,b,roof]]);
    face(shade(paint,18),[[-.115,a,roof],[.115,a,roof],[.115,b,roof],[-.115,b,roof]]);
  }
  for(const end of [-1,1]) {
    if(!visible(0,end)) continue;
    const v=end*(length+.016);
    for(const side of [-1,1]) {
      const u=side*(halfWidth-.043);
      face(end<0 ? 0xfff3c9 : 0xef6257,[[u-.025,v,6],[u+.025,v,6],[u+.025,v,8.4],[u-.025,v,8.4]]);
    }
  }
  source.finish(key,TILE_WIDTH,CAR_TEXTURE_HEIGHT);
}


/**
 * A small wooden sailboat, baked across the same 24 headings as the harbour
 * fleet. Purely decorative: it plays no part in PR or issue travel, and just
 * tacks a slow loop through open water around the island for atmosphere.
 */
export const WOODEN_SHIP_KEYS = Array.from(
  { length: SHIP_HEADING_FRAMES },
  (_unused, index) => `fx:wooden-ship:${index}`,
);

export const WOODEN_SHIP_KEY = WOODEN_SHIP_KEYS[0]!;

export const WOODEN_SHIP_ANCHOR_Y = 42;


export const WOODEN_SHIP_CANVAS = 140;


/**
 * A small single-mast sailboat, authored bow toward -v like every other
 * heading-baked hull, and turned the same way: rotating (u, v) about her
 * centre swings the bow round while z -- so mast and sail height -- is left
 * alone. See bakeHarbourContainerShip for why this is baked per heading
 * rather than done with setRotation.
 */
export function bakeWoodenShip(source: Baker, key: string, frame: number): void {
  const width = WOODEN_SHIP_CANVAS;
  const height = WOODEN_SHIP_CANVAS;
  const originX = width / 2;
  const originY = height - WOODEN_SHIP_ANCHOR_Y;
  const deck = 8;

  const angle = shipHeadingAngle(frame);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const baker: Baker =
    frame === 0
      ? source
      : {
          ...source,
          at: (point, ox, oy) =>
            source.at(
              [
                point[0] * cos - point[1] * sin,
                point[0] * sin + point[1] * cos,
                point[2],
              ],
              ox,
              oy,
            ),
        };

  const hullColor = 0x8a5a34;
  const bootColor = shade(hullColor, -30);
  const sailColor = 0xf3ead8;

  /** A face's outward normal, turned with the hull -- lighting stays fixed to the world. */
  const facing = (nu: number, nv: number, color: number): number => {
    const length = Math.hypot(nu, nv) || 1;
    const u = (nu * cos - nv * sin) / length;
    const v = (nu * sin + nv * cos) / length;
    return shade(color, Math.round(10 * v - 30 * u));
  };

  // Starboard sheer, bow to stern; mirrored below for a closed hull with a
  // small flat transom rather than a pointed stern.
  const sheer: ReadonlyArray<readonly [number, number]> = [
    [0, -0.55],
    [0.12, -0.35],
    [0.15, -0.05],
    [0.15, 0.22],
    [0.1, 0.4],
  ];
  const outline: ReadonlyArray<readonly [number, number]> = [
    ...sheer,
    ...[...sheer].reverse().map(([u, v]) => [-u, v] as const).slice(0, -1),
  ];

  const waterline = baker.at([0, 0, 0], originX, originY);
  baker.graphics.fillStyle(0xffffff, 0.22);
  baker.graphics.fillEllipse(waterline.x + 4, waterline.y + 3, 46, 12);

  // Hull plating: drop every edge of the outline to the waterline, then a
  // darker boot-topping band along the same run.
  for (let index = 0; index < outline.length; index += 1) {
    const [u0, v0] = outline[index]!;
    const [u1, v1] = outline[(index + 1) % outline.length]!;
    const normalU = v1 - v0;
    const normalV = -(u1 - u0);
    fillFace(
      baker,
      facing(normalU, normalV, hullColor),
      1,
      [[u0, v0, deck], [u1, v1, deck], [u1, v1, 0], [u0, v0, 0]],
      originX,
      originY,
    );
    fillFace(
      baker,
      facing(normalU, normalV, bootColor),
      1,
      [[u0, v0, 3], [u1, v1, 3], [u1, v1, 0], [u0, v0, 0]],
      originX,
      originY,
    );
  }

  // Weather deck.
  fillFace(
    baker,
    shade(hullColor, 16),
    1,
    outline.map(([u, v]) => [u, v, deck] as Point3),
    originX,
    originY,
  );

  // Mast: always a straight vertical screen line at any heading, since z
  // never shifts a projected point's x.
  harbourPost(baker, originX, originY, 0, -0.05, deck, deck + 46, 2, 0x4a3220);

  // Sail, one belly to either side of the mast so the silhouette reads at
  // every heading without needing to know which side faces the viewer.
  fillFace(
    baker,
    sailColor,
    1,
    [[0, -0.05, deck + 44], [0, -0.05, deck + 9], [0.22, -0.14, deck + 27]],
    originX,
    originY,
  );
  fillFace(
    baker,
    shade(sailColor, -14),
    1,
    [[0, -0.05, deck + 44], [0, -0.05, deck + 9], [-0.22, -0.14, deck + 27]],
    originX,
    originY,
  );

  // Pennant at the masthead.
  fillFace(
    baker,
    0xd94f4f,
    1,
    [[0, -0.05, deck + 46], [0, -0.05, deck + 40], [0.09, -0.09, deck + 43]],
    originX,
    originY,
  );

  baker.finish(key, width, height);
}

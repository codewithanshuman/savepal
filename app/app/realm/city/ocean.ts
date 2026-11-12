/*
 * The sea, drawn by a shader behind the whole kingdom. For every pixel it works out where that
 * pixel lies on the sea's surface (the plane at the foot of the cliffs, in the same isometric
 * grid the island is built on), and from there: swell and chop that travel across that plane,
 * colour by depth (turquoise shallows round the island, deep blue beyond), surf breaking in bands
 * toward the shore with white water at the cliff foot and along the beaches, and sun glitter
 * on the wave tops (cool moonlight at night). One full-screen pass; no textures.
 */
import Phaser from "phaser";
import { GROUND_DEPTH } from "../reference-city/world/core/worldConstants";
import { ISLAND_BOUNDS } from "./island";

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec4 uView;    // the camera's view of the world: x, y, width, height
uniform vec4 uIsle;    // the island on the grid: u0, v0, u1, v1
uniform float uCliff;  // how far below the land the sea lies, in pixels
uniform float uClock;  // seconds
uniform float uNight;  // 0 day .. 1 night
uniform float uPx;     // world pixels per screen pixel: fine detail fades out as the view pulls back
varying mediump vec2 outTexCoord;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int k = 0; k < 3; k++) { s += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; } return s / 0.875; }
float outside(vec2 g) { return length(max(max(uIsle.xy - g, g - uIsle.zw), 0.0)); }

void main() {
  vec2 w = uView.xy + vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uView.zw;
  // this pixel on the sea plane, and on the land plane (the far shores are beaches at land level)
  float ys = w.y - uCliff;
  vec2 g = vec2(w.x / 96.0 + ys / 48.0, ys / 48.0 - w.x / 96.0);
  vec2 gl = vec2(w.x / 96.0 + w.y / 48.0, w.y / 48.0 - w.x / 96.0);
  float beachU = step(gl.x, uIsle.x) * smoothstep(uIsle.w + 1.2, uIsle.w - 0.6, gl.y);
  float beachV = step(gl.y, uIsle.y) * smoothstep(uIsle.z + 1.2, uIsle.z - 0.6, gl.x);
  float beach = clamp(beachU + beachV, 0.0, 1.0);
  float shore = mix(outside(g), min(outside(g), outside(gl)), beach);

  float t = uClock;
  float swell = sin(dot(g, vec2(0.9, 0.55)) * 1.5 + t * 0.8) * 0.5 + sin(dot(g, vec2(-0.45, 1.1)) * 2.2 - t * 1.1) * 0.35;
  float chop = fbm(g * 0.9 + vec2(t * 0.12, -t * 0.09));
  float near = smoothstep(2.6, 1.1, uPx);   // 1 when zoomed in, 0 at the whole-kingdom view

  vec3 shallow = vec3(0.33, 0.80, 0.88), mid = vec3(0.17, 0.58, 0.86), deep = vec3(0.10, 0.43, 0.76);
  vec3 col = mix(shallow, mix(mid, deep, smoothstep(5.0, 22.0, shore)), smoothstep(0.2, 6.5, shore));
  // the swell: broad, soft light and dark across the water
  col += (swell * 0.5 + chop - 0.5) * 0.07;
  // pale crests riding the swell, finer ripples only once you are close enough to see them
  col += vec3(0.08, 0.11, 0.12) * smoothstep(0.55, 0.9, chop + swell * 0.18);
  col += vec3(0.05) * (noise(g * 5.0 + vec2(t * 0.5, t * 0.3)) - 0.5) * near;

  // glitter: the sun on wave tops, drifting (cool moonlight at night); only resolvable up close
  float sparkle = noise(g * 6.0 + vec2(t * 0.7, t * 0.45)) * noise(g * 9.0 - vec2(t * 0.55, -t * 0.35));
  sparkle = pow(max(0.0, sparkle * 2.3 - 0.78), 2.0) * 2.2 * near;
  col += mix(vec3(1.0, 0.96, 0.84), vec3(0.72, 0.82, 1.0), uNight) * sparkle * (1.0 - uNight * 0.55);

  // surf: bands marching in to the shore, broken up by the chop, and white water where they land
  float band = sin(shore * 4.6 - t * 1.4 + chop * 3.5);
  float foam = smoothstep(0.72, 0.98, band) * smoothstep(2.6, 0.25, shore) * (0.5 + 0.5 * noise(g * 2.4 + t * 0.2));
  foam += smoothstep(0.42, 0.0, shore) * (0.6 + 0.3 * chop);
  col = mix(col, vec3(1.0), clamp(foam, 0.0, 1.0) * 0.8);

  gl_FragColor = vec4(col, 1.0);
}`;

export class Ocean {
  private readonly shader: Phaser.GameObjects.Shader;
  private readonly still = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private readonly scene: Phaser.Scene) {
    const { U0, V0, U1, V1, CLIFF } = ISLAND_BOUNDS, cam = scene.cameras.main;
    const base = new Phaser.Display.BaseShader("savepal:ocean", FRAG, undefined, {
      uView: { type: "4f", value: { x: 0, y: 0, z: 1, w: 1 } },
      uIsle: { type: "4f", value: { x: U0, y: V0, z: U1, w: V1 } },
      uCliff: { type: "1f", value: CLIFF },
      uClock: { type: "1f", value: 0 },
      uNight: { type: "1f", value: 0 },
      uPx: { type: "1f", value: 1 },
    });
    this.shader = scene.add.shader(base, 0, 0, cam.width, cam.height).setScrollFactor(0).setDepth(GROUND_DEPTH - 50);
  }

  /** Keeps the sea filling the view and moving. */
  update(time: number, night: number): void {
    const cam = this.scene.cameras.main, v = cam.worldView, s = this.shader;
    if (s.width !== cam.width || s.height !== cam.height) s.setSize(cam.width, cam.height);
    s.setPosition(cam.width / 2, cam.height / 2).setScale(1 / (cam.zoom || 1));
    s.setUniform("uView.value", { x: v.x, y: v.y, z: v.width, w: v.height });
    s.setUniform("uClock.value", this.still ? 0 : time / 1000);
    s.setUniform("uNight.value", night);
    s.setUniform("uPx.value", v.width / Math.max(1, cam.width));
  }

  destroy(): void { this.shader.destroy(); }
}

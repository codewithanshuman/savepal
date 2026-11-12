/*
 * The kingdom's colour grade: one pass over the finished frame, the way a film is graded. A soft
 * S-curve for contrast, a little more colour, warm highlights against cool shadows by day
 * (cooler and quieter at night), and a gentle vignette that draws the eye to the middle. It does
 * not blur anything: every pixel stays as sharp as it was drawn.
 */
import Phaser from "phaser";

const FRAG = `
precision mediump float;
uniform sampler2D uMainSampler;
uniform float uNight;
uniform float uAmount;
varying vec2 outTexCoord;
void main() {
  vec4 src = texture2D(uMainSampler, outTexCoord);
  vec3 col = src.rgb;
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.26 * uAmount);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, 1.0 + 0.16 * uAmount * (1.0 - uNight * 0.6));
  col += (vec3(0.040, 0.020, -0.022) * smoothstep(0.55, 1.0, l) + vec3(-0.014, 0.0, 0.026) * smoothstep(0.45, 0.0, l)) * uAmount * (1.0 - uNight);
  vec2 q = (outTexCoord - 0.5) * vec2(1.0, 1.12);
  col *= mix(1.0, smoothstep(0.92, 0.28, length(q)), 0.34 * uAmount);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
}`;

export class RealmGrade extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  night = 0;
  amount = 1;
  constructor(game: Phaser.Game) { super({ game, name: "RealmGrade", fragShader: FRAG }); }
  onPreRender(): void { this.set1f("uNight", this.night); this.set1f("uAmount", this.amount); }
}

/** Puts the grade on the scene's main camera and returns it, or null where WebGL post-processing is unavailable. */
export function addGrade(scene: Phaser.Scene): RealmGrade | null {
  const renderer = scene.game.renderer;
  if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return null;
  try {
    if (!renderer.pipelines.postPipelineClasses.has("RealmGrade")) renderer.pipelines.addPostPipeline("RealmGrade", RealmGrade);
    scene.cameras.main.setPostPipeline(RealmGrade);
    const fx = scene.cameras.main.getPostPipeline(RealmGrade);
    return (Array.isArray(fx) ? fx[0] : fx) as RealmGrade ?? null;
  } catch { return null; }
}

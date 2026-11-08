/*
 * Gold star coin stacks: the owner-supplied drawing (gold-coin-stacks.html), kept as a code-native
 * asset like the rest of the city's textures. One source draws three things: the treasury's gold
 * piles in the world, the reward bubbles, and the HUD's coin icons, so they always match.
 */

type Ctx = CanvasRenderingContext2D;
const SIZE = 512;

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); }
function frontArc(ctx: Ctx, x: number, y: number, rx: number, ry: number) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI, false); }
function gradient(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, stops: Array<[number, string]>) {
  const g = ctx.createLinearGradient(x1, y1, x2, y2);
  for (const [at, color] of stops) g.addColorStop(at, color);
  return g;
}
function starPath(ctx: Ctx, x: number, y: number, rx: number, ry: number, inner = .48) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 === 0 ? 1 : inner;
    const px = x + Math.cos(a) * rx * r, py = y + Math.sin(a) * ry * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawStar(ctx: Ctx, x: number, y: number, rx: number, ry: number) {
  ctx.save();
  starPath(ctx, x + 1, y + 6, rx, ry); ctx.fillStyle = "#da7500"; ctx.fill(); ctx.lineWidth = 3.2; ctx.strokeStyle = "#de7900"; ctx.stroke();
  starPath(ctx, x, y, rx, ry);
  ctx.fillStyle = gradient(ctx, x - rx, y - ry, x + rx * .8, y + ry, [[0, "#fff87c"], [.25, "#fff534"], [.65, "#ffd600"], [1, "#ffb000"]]);
  ctx.fill(); ctx.strokeStyle = "#ffb81d"; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.restore();
}

function drawCoin(ctx: Ctx, x: number, y: number, rx: number, ry: number, depth: number, top = false) {
  ellipse(ctx, x, y + depth, rx, ry);
  ctx.fillStyle = gradient(ctx, x - rx, y, x + rx, y + depth, [[0, "#ffdf21"], [.22, "#ffbd00"], [.58, "#ff9900"], [.86, "#e66b00"], [1, "#bb4800"]]);
  ctx.fill(); ctx.strokeStyle = "#da6a00"; ctx.lineWidth = 2.3; ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - rx, y);
  ctx.bezierCurveTo(x - rx, y + ry * .56, x - rx * .57, y + ry, x, y + ry);
  ctx.bezierCurveTo(x + rx * .57, y + ry, x + rx, y + ry * .56, x + rx, y);
  ctx.lineTo(x + rx, y + depth);
  ctx.bezierCurveTo(x + rx, y + depth + ry * .56, x + rx * .57, y + depth + ry, x, y + depth + ry);
  ctx.bezierCurveTo(x - rx * .57, y + depth + ry, x - rx, y + depth + ry * .56, x - rx, y + depth);
  ctx.closePath();
  ctx.fillStyle = gradient(ctx, x - rx, y, x + rx, y + depth, [[0, "#ffda10"], [.15, "#ffb600"], [.47, "#f99a00"], [.70, "#f17e00"], [.88, "#de6300"], [1, "#bf4700"]]);
  ctx.fill();

  frontArc(ctx, x, y + depth - 1, rx - 1.5, ry - 1.5); ctx.lineWidth = 3.2; ctx.strokeStyle = "#ffba05"; ctx.stroke();
  frontArc(ctx, x, y + depth + 1, rx - 3, ry - 3); ctx.lineWidth = 1.4; ctx.strokeStyle = "#d76500"; ctx.stroke();

  ellipse(ctx, x, y, rx, ry);
  ctx.fillStyle = gradient(ctx, x - rx * .7, y - ry, x + rx * .5, y + ry, [[0, "#fff35b"], [.3, "#ffd51b"], [.7, "#f8a500"], [1, "#e47a00"]]);
  ctx.fill(); ctx.strokeStyle = "#ffa300"; ctx.lineWidth = 2.1; ctx.stroke();

  if (top) {
    ellipse(ctx, x, y - 2, rx - 10, ry - 9);
    ctx.fillStyle = gradient(ctx, x - rx, y - ry, x + rx, y + ry, [[0, "#fff77a"], [.32, "#ffcd17"], [.77, "#ffad00"], [1, "#e57e00"]]);
    ctx.fill(); ctx.strokeStyle = "#ffea33"; ctx.lineWidth = 3; ctx.stroke();
    ellipse(ctx, x, y - 4, rx - 20, ry - 17);
    ctx.fillStyle = gradient(ctx, x - rx / 2, y - ry, x + rx / 3, y + ry, [[0, "#ffcc16"], [.48, "#ffc017"], [1, "#f89a00"]]);
    ctx.fill(); ctx.strokeStyle = "#ec8b00"; ctx.lineWidth = 4.5; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x, y - 4, rx - 20, ry - 17, 0, Math.PI * 1.07, Math.PI * 1.92); ctx.strokeStyle = "#ffe84e"; ctx.lineWidth = 3.2; ctx.stroke();
    drawStar(ctx, x, y - 7, rx * .53, ry * .72);
    ctx.save();
    ellipse(ctx, x, y - 2, rx - 19, ry - 16); ctx.clip();
    ctx.translate(x - rx * .28, y - ry * .22); ctx.rotate(-.37);
    ctx.fillStyle = gradient(ctx, -18, -70, 28, 75, [[0, "rgba(255,255,255,0)"], [.44, "rgba(255,255,255,0)"], [.5, "rgba(255,255,255,.23)"], [.62, "rgba(255,255,255,0)"], [1, "rgba(255,255,255,0)"]]);
    ctx.fillRect(-12, -85, 32, 170);
    ctx.restore();
  } else {
    frontArc(ctx, x, y, rx - 5, ry - 5); ctx.lineWidth = 2.8; ctx.strokeStyle = "#ffcc14"; ctx.stroke();
  }
}

function stack(ctx: Ctx, x: number, topY: number, rx: number, ry: number, count: number, pitch: number, depth = 17) {
  for (let i = count - 1; i >= 0; i--) drawCoin(ctx, x, topY + i * pitch, rx, ry, depth, i === 0);
}

function sparkle(ctx: Ctx, x: number, y: number, radius: number, opacity = 1) {
  ctx.save();
  ctx.globalAlpha = opacity;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.6);
  glow.addColorStop(0, "rgba(255,255,255,0.9)"); glow.addColorStop(.18, "rgba(255,255,220,.7)"); glow.addColorStop(.55, "rgba(255,240,130,.14)"); glow.addColorStop(1, "rgba(255,240,130,0)");
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, radius * 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y - radius * 1.65);
  ctx.quadraticCurveTo(x + radius * .14, y - radius * .15, x + radius * 1.3, y);
  ctx.quadraticCurveTo(x + radius * .16, y + radius * .1, x, y + radius * 1.65);
  ctx.quadraticCurveTo(x - radius * .1, y + radius * .1, x - radius * 1.3, y);
  ctx.quadraticCurveTo(x - radius * .1, y - radius * .1, x, y - radius * 1.65);
  ctx.closePath(); ctx.fillStyle = "#fffdf3"; ctx.fill();
  ctx.restore();
}

/** The full treasury pile: scattered coins behind four columns, with gleams. */
export function drawCoinStacks(ctx: Ctx) {
  drawCoin(ctx, 135, 282, 57, 34, 13, true); drawCoin(ctx, 277, 282, 68, 38, 13, true); drawCoin(ctx, 362, 288, 64, 38, 13, true);
  drawCoin(ctx, 416, 306, 67, 40, 15, true); drawCoin(ctx, 474, 338, 65, 40, 15, true);
  stack(ctx, 59, 393, 86, 53, 8, 19, 18); stack(ctx, 171, 333, 100, 60, 11, 19, 19); stack(ctx, 327, 347, 91, 56, 9, 19, 18); stack(ctx, 463, 415, 94, 58, 8, 19, 19);
  sparkle(ctx, 49, 428, 8.5, .9); sparkle(ctx, 287, 386, 12.5, 1); sparkle(ctx, 454, 465, 8.5, .95); sparkle(ctx, 305, 474, 5, .45);
}

/** One star coin, face up: the icon for rewards and counters. */
export function drawSingleCoin(ctx: Ctx) {
  drawCoin(ctx, 256, 230, 190, 120, 46, true);
  sparkle(ctx, 150, 170, 18, .9);
}

/** Renders a drawing at `px` pixels square onto a fresh canvas. */
export function coinCanvas(px: number, draw: (ctx: Ctx) => void = drawCoinStacks): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = px; c.height = px;
  const ctx = c.getContext("2d", { alpha: true })!;
  ctx.setTransform(px / SIZE, 0, 0, px / SIZE, 0, 0);
  draw(ctx);
  return c;
}

export const COIN_TEXTURES = { pile: "savepal-coins", coin: "savepal-coin" } as const;

/** Bakes both textures into a Phaser scene once (idempotent). */
export function bakeCoins(scene: { textures: { exists(key: string): boolean; addCanvas(key: string, canvas: HTMLCanvasElement): unknown } }) {
  if (!scene.textures.exists(COIN_TEXTURES.pile)) scene.textures.addCanvas(COIN_TEXTURES.pile, coinCanvas(256));
  if (!scene.textures.exists(COIN_TEXTURES.coin)) scene.textures.addCanvas(COIN_TEXTURES.coin, coinCanvas(96, drawSingleCoin));
}

let iconCache: string | null = null;
/** A data URL of the single coin, for HUD icons. */
export function coinIconUrl(): string {
  if (typeof document === "undefined") return "";
  return iconCache ??= coinCanvas(64, drawSingleCoin).toDataURL("image/png");
}

let pileCache: string | null = null;
/** A data URL of the full treasury pile, for the treasury's own panel. */
export function coinPileUrl(): string {
  if (typeof document === "undefined") return "";
  return pileCache ??= coinCanvas(256).toDataURL("image/png");
}

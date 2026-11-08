/* 8-bit sound effects for the Realm, synthesised with the Web Audio API (no audio files).
 * In the spirit of Claude Clan's chiptune UI click, but our own sounds: every one is a few
 * square/triangle notes or a burst of noise, so they stay tiny and never need a download. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const KEY = "savepal-sfx";

export function sfxEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
export function setSfxEnabled(on: boolean) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private mode: keep it in memory only */ }
}

function audio(): AudioContext | null {
  if (typeof window === "undefined" || !sfxEnabled()) return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) { ctx = new AC(); master = ctx.createGain(); master.gain.value = .22; master.connect(ctx.destination); }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** One note: a waveform sliding from `f0` to `f1`, with a fast attack and a short decay. */
function note(f0: number, dur: number, opts: { type?: OscillatorType; f1?: number; at?: number; vol?: number } = {}) {
  const a = audio(); if (!a || !master) return;
  const t = a.currentTime + (opts.at ?? 0), o = a.createOscillator(), g = a.createGain();
  o.type = opts.type ?? "square";
  o.frequency.setValueAtTime(f0, t);
  if (opts.f1) o.frequency.exponentialRampToValueAtTime(opts.f1, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(opts.vol ?? .5, t + .005);
  g.gain.exponentialRampToValueAtTime(.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + .02);
}

/** A short burst of filtered noise: thuds, stamps and chest drops. */
function noise(dur: number, opts: { at?: number; freq?: number; vol?: number } = {}) {
  const a = audio(); if (!a || !master) return;
  const t = a.currentTime + (opts.at ?? 0), len = Math.ceil(a.sampleRate * dur), buf = a.createBuffer(1, len, a.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf; f.type = "lowpass"; f.frequency.value = opts.freq ?? 900; g.gain.value = opts.vol ?? .6;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

export const sfx = {
  /** Any HUD button. */
  click: () => note(1046, .045, { f1: 784, vol: .35 }),
  /** A building's door opens (a court panel). */
  open: () => { note(523, .07, { vol: .3 }); note(784, .09, { at: .06, vol: .3 }); },
  close: () => { note(784, .06, { vol: .25 }); note(523, .08, { at: .05, vol: .25 }); },
  /** Gold lands in the treasury: three coins. */
  coins: () => [0, .09, .18].forEach((at, i) => { note(988 + i * 120, .06, { at, vol: .3 }); note(1319 + i * 160, .16, { at: at + .05, vol: .3 }); }),
  /** A chest is set down. */
  chest: () => { noise(.12, { freq: 500, vol: .7 }); note(110, .12, { type: "triangle", f1: 70, vol: .6 }); },
  /** The client's wax seal on the decree. */
  seal: () => { noise(.09, { freq: 1400, vol: .5 }); note(196, .18, { type: "triangle", f1: 98, at: .02, vol: .7 }); [523, 659, 784].forEach((f, i) => note(f, .22, { at: .14 + i * .07, vol: .22 })); },
  /** The galleon's horn as it sails out with the gold. */
  horn: () => { note(196, .9, { type: "sawtooth", f1: 185, vol: .18 }); note(294, .9, { type: "triangle", f1: 277, vol: .14 }); },
  /** A quest appears, or the inspectors set out. */
  quest: () => [523, 659, 784, 1046].forEach((f, i) => note(f, .1, { at: i * .07, vol: .28 })),
  /** An inspector's finding: up for verified, down for failed, flat for unsure. */
  found: (verdict: "VERIFIED" | "FAILED" | "INCONCLUSIVE") => verdict === "VERIFIED" ? (note(784, .07, { vol: .25 }), note(1175, .12, { at: .06, vol: .25 }))
    : verdict === "FAILED" ? (note(330, .09, { vol: .3 }), note(220, .16, { at: .08, vol: .3 })) : note(587, .12, { type: "triangle", vol: .3 }),
  /** Something went wrong. */
  error: () => { note(220, .1, { vol: .3 }); note(165, .2, { at: .09, vol: .3 }); },
};

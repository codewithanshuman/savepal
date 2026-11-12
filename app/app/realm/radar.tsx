"use client";
/*
 * The kingdom's radar: a small live map in the corner. It draws the island and every estate from
 * the same plan the world is built from (kingdom()), marks the treasury, pulses a gold blip on the
 * place where the agreement's next step waits, outlines what the camera is looking at, and shows
 * where you stand when you walk. Click anywhere on it to fly there.
 */
import { useEffect, useMemo, useRef } from "react";
import { capitolDistrict } from "@sudo-city/protocol";
import { CITY_SIZE, kingdom, type RealmInput, type Role } from "./city/layout";

export type RadarState = { view: { x: number; y: number; w: number; h: number }; walker: { x: number; y: number } | null };
export type RadarTarget = Role | "treasury";

const HW = 48, HH = 24, RING = 2.5, CLIFF = 130;
const U0 = -RING, V0 = -RING, U1 = CITY_SIZE.width - 1 + RING, V1 = CITY_SIZE.height - 1 + RING;
const X0 = (U0 - V1) * HW, X1 = (U1 - V0) * HW, Y0 = (U0 + V0) * HH, Y1 = (U1 + V1) * HH + CLIFF;
const W = 204, H = 112, PAD = 7, S = (W - PAD * 2) / (X1 - X0);
const TONE: Record<Role, string> = { palace: "#93a2ea", bazaar: "#ee9a5a", guild: "#57c4ab", port: "#f0deb0", page: "#9dbcf0", agreement: "#c39bee", home: "#edca8e", farm: "#dcb95e", park: "#5aa24a" };
const capitol = capitolDistrict(CITY_SIZE);

const sx = (x: number) => PAD + (x - X0) * S, sy = (y: number) => (H - (Y1 - Y0) * S) / 2 + (y - Y0) * S;
const gx = (u: number, v: number) => sx((u - v) * HW), gy = (u: number, v: number) => sy((u + v) * HH);

export function Radar({ input, quest, read, onTravel }: {
  input: RealmInput; quest: RadarTarget | null; read(): RadarState | null; onTravel(x: number, y: number): void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const structures = useMemo(() => kingdom(input).structures, [input]);
  const questSpot = useMemo(() => {
    if (!quest) return null;
    if (quest === "treasury") return { u: capitol.centerX, v: (capitol.minY + capitol.maxY) / 2 };
    const s = structures.find(x => x.role === quest);
    return s ? { u: s.x, v: s.y } : null;
  }, [quest, structures]);

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr; canvas.height = H * dpr;
    const c = canvas.getContext("2d"); if (!c) return;
    // the land and its estates change only with the plan: draw them once
    const land = document.createElement("canvas"); land.width = canvas.width; land.height = canvas.height;
    const l = land.getContext("2d")!; l.scale(dpr, dpr);
    const diamond = (u0: number, v0: number, u1: number, v1: number, drop = 0) => { l.beginPath(); l.moveTo(gx(u0, v0), gy(u0, v0) + drop); l.lineTo(gx(u1, v0), gy(u1, v0) + drop); l.lineTo(gx(u1, v1), gy(u1, v1) + drop); l.lineTo(gx(u0, v1), gy(u0, v1) + drop); l.closePath(); };
    l.fillStyle = "#6b5a44"; diamond(U0, V0, U1, V1, CLIFF * S); l.fill();
    l.fillStyle = "#ecd9a6"; diamond(U0, V0, U1, V1); l.fill();
    l.fillStyle = "#79bf58"; diamond(U0 + .5, V0 + .5, U1, V1); l.fill();
    l.strokeStyle = "rgba(226,214,186,.55)"; l.lineWidth = .6;
    for (let u = 0; u < CITY_SIZE.width; u += 6) { l.beginPath(); l.moveTo(gx(u, 0), gy(u, 0)); l.lineTo(gx(u, CITY_SIZE.height - 1), gy(u, CITY_SIZE.height - 1)); l.stroke(); }
    for (let v = 0; v < CITY_SIZE.height; v += 6) { l.beginPath(); l.moveTo(gx(0, v), gy(0, v)); l.lineTo(gx(CITY_SIZE.width - 1, v), gy(CITY_SIZE.width - 1, v)); l.stroke(); }
    for (const s of structures) { l.fillStyle = TONE[s.role]; diamond(s.rect.minX - .4, s.rect.minY - .4, s.rect.maxX + .4, s.rect.maxY + .4); l.fill(); }
    l.fillStyle = "#ffd15c"; diamond(capitol.minX, capitol.minY, capitol.maxX, capitol.maxY); l.fill();
    l.strokeStyle = "#8a5a00"; l.lineWidth = .8; l.stroke();

    let raf = 0, last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 70) return;
      last = now;
      const state = read();
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, canvas.width, canvas.height); c.drawImage(land, 0, 0); c.scale(dpr, dpr);
      if (questSpot) {
        const x = gx(questSpot.u, questSpot.v), y = gy(questSpot.u, questSpot.v), beat = (now % 1400) / 1400;
        c.strokeStyle = `rgba(255,209,92,${1 - beat})`; c.lineWidth = 1.6; c.beginPath(); c.arc(x, y, 3 + beat * 11, 0, Math.PI * 2); c.stroke();
        c.fillStyle = "#ffd15c"; c.strokeStyle = "#0d1422"; c.lineWidth = 1.2; c.beginPath(); c.arc(x, y, 3.4, 0, Math.PI * 2); c.fill(); c.stroke();
      }
      if (state) {
        const v = state.view;
        c.strokeStyle = "rgba(255,255,255,.95)"; c.lineWidth = 1.2; c.strokeRect(sx(v.x), sy(v.y), v.w * S, v.h * S);
        c.fillStyle = "rgba(255,255,255,.08)"; c.fillRect(sx(v.x), sy(v.y), v.w * S, v.h * S);
        if (state.walker) {
          const x = sx(state.walker.x), y = sy(state.walker.y);
          c.fillStyle = "#ffc439"; c.strokeStyle = "#0d1422"; c.lineWidth = 1.2;
          c.beginPath(); c.moveTo(x, y - 5); c.lineTo(x + 4, y + 3.5); c.lineTo(x, y + 1.5); c.lineTo(x - 4, y + 3.5); c.closePath(); c.fill(); c.stroke();
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [structures, questSpot, read]);

  const travel = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - box.left) * (W / box.width), py = (e.clientY - box.top) * (H / box.height);
    onTravel(X0 + (px - PAD) / S, Y0 + (py - (H - (Y1 - Y0) * S) / 2) / S);
  };
  return <div className="hud hud-radar">
    <canvas ref={ref} style={{ width: W, height: H }} onClick={travel} role="img" aria-label="Map of the kingdom. Click to travel." />
    <span>KINGDOM MAP{quest ? " · GOLD BLIP = YOUR NEXT STEP" : ""}</span>
  </div>;
}

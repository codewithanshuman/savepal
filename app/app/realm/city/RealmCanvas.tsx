"use client";
/*
 * Mounts the Realm: a Phaser game hosting SavePalScene, the same way grounded's GameCanvas hosts
 * its city scene. Phaser loads only in the browser. The canvas renders at the screen's full pixel
 * density with smooth (anti-aliased) drawing, so the kingdom is sharp rather than blocky. Data is
 * pushed into the scene imperatively; React never re-creates the game.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { RealmInput } from "./layout";
import type { Person } from "./life";
import type { RealmPick, RealmPlace, RealmReward, SavePalScene } from "./SavePalScene";
import type { SkyMode } from "./night";

export type RealmCanvasHandle = {
  focus(place: RealmPlace): void; zoom(dir: 1 | -1): void; fit(): void; celebrate(): void;
  walk(person: Person): void; stopWalk(): void; pad(x: number, y: number): void; enter(): void;
};

type Props = {
  input: RealmInput; rewards: RealmReward[];
  onPick(pick: RealmPick): void; onCollect(key: string, screen: { x: number; y: number }): void;
  onNear(label: string | null): void;
  /** Day, night or the viewer's clock. */
  sky: SkyMode;
};

export const RealmCanvas = forwardRef<RealmCanvasHandle, Props>(function RealmCanvas(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SavePalScene | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(ref, () => ({
    focus: (place) => scene.current?.focusPlace(place),
    zoom: (dir) => scene.current?.zoomBy(dir),
    fit: () => scene.current?.fitCamera(true),
    celebrate: () => scene.current?.celebrate(),
    walk: (person) => scene.current?.startWalk(person),
    stopWalk: () => scene.current?.stopWalk(),
    pad: (x, y) => scene.current?.setWalkPad(x, y),
    enter: () => scene.current?.enterNearest(),
  }), []);

  useEffect(() => {
    const el = host.current; if (!el) return;
    let game: import("phaser").Game | null = null, observer: ResizeObserver | null = null, disposed = false;
    (async () => {
      const [{ default: Phaser }, { SavePalScene }] = await Promise.all([import("phaser"), import("./SavePalScene")]);
      if (disposed) return;
      // Render at the screen's real pixel density (capped for very dense phones), shown at CSS size.
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const s = new SavePalScene();
      s.setDpr(dpr);
      s.setSky(latest.current.sky);
      s.onPick(pick => latest.current.onPick(pick));
      s.onCollect((key, at) => latest.current.onCollect(key, at));
      s.onNear(label => latest.current.onNear(label));
      scene.current = s;
      if (process.env.NODE_ENV !== "production") (window as unknown as { __realm?: unknown }).__realm = s;
      game = new Phaser.Game({
        type: Phaser.WEBGL, parent: el, width: Math.round(el.clientWidth * dpr), height: Math.round(el.clientHeight * dpr), backgroundColor: "#3a9bd5", scene: s,
        scale: { mode: Phaser.Scale.NONE, zoom: 1 / dpr },
        render: { antialias: true, antialiasGL: true, pixelArt: false, roundPixels: false, mipmapFilter: "LINEAR_MIPMAP_LINEAR", clearBeforeRender: true },
      });
      const hydrate = () => {
        if (disposed) return;
        const p = latest.current;
        s.setRealm(p.input); s.setRewards(p.rewards);
      };
      game.events.once(Phaser.Core.Events.READY, () => { if (s.scene.isActive()) hydrate(); else s.events.once(Phaser.Scenes.Events.CREATE, hydrate); });
      observer = new ResizeObserver(([entry]) => {
        if (!entry || entry.contentRect.width <= 0 || entry.contentRect.height <= 0 || !game) return;
        const w = Math.round(entry.contentRect.width * dpr), h = Math.round(entry.contentRect.height * dpr);
        game.scale.resize(w, h);
        s.resizeViewport(w, h);
      });
      observer.observe(el);
    })();
    return () => { disposed = true; observer?.disconnect(); game?.destroy(true); scene.current = null; };
  }, []);

  const inputKey = JSON.stringify(props.input);
  useEffect(() => { if (scene.current?.scene?.isActive()) scene.current.setRealm(latest.current.input); }, [inputKey]);
  useEffect(() => { scene.current?.setSky(props.sky); }, [props.sky]);
  const rewardKey = props.rewards.map(r => r.key).join("|");
  useEffect(() => { scene.current?.setRewards(latest.current.rewards); }, [rewardKey]);

  return <div ref={host} className="realm-world" aria-label="The Realm: your agreement as a kingdom" />;
});

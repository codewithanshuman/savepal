"use client";
/*
 * Mounts the Realm city: a Phaser game hosting SavePalScene, the same way grounded's GameCanvas
 * hosts its city scene. Phaser loads only in the browser. Data is pushed into the scene
 * imperatively; React never re-creates the game.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { RealmInput } from "./layout";
import type { RealmPick, RealmPlace, RealmReward, SavePalScene } from "./SavePalScene";

export type RealmCanvasHandle = { focus(place: RealmPlace): void; zoom(dir: 1 | -1): void; fit(): void; celebrate(): void };

type Props = {
  input: RealmInput; rewards: RealmReward[];
  onPick(pick: RealmPick): void; onCollect(key: string, screen: { x: number; y: number }): void;
};

export const RealmCanvas = forwardRef<RealmCanvasHandle, Props>(function RealmCanvas(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SavePalScene | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(ref, () => ({
    focus: (place) => scene.current?.focusPlace(place),
    zoom: (dir) => { const s = scene.current; if (s) s.zoomTarget = Math.max(.35, Math.min(3, s.zoomTarget * (dir > 0 ? 1.3 : 1 / 1.3))); },
    fit: () => scene.current?.fitCamera(),
    celebrate: () => scene.current?.celebrate(),
  }), []);

  useEffect(() => {
    const el = host.current; if (!el) return;
    let game: import("phaser").Game | null = null, observer: ResizeObserver | null = null, disposed = false;
    (async () => {
      const [{ default: Phaser }, { SavePalScene }] = await Promise.all([import("phaser"), import("./SavePalScene")]);
      if (disposed) return;
      const s = new SavePalScene();
      s.onPick(pick => latest.current.onPick(pick));
      s.onCollect((key, at) => latest.current.onCollect(key, at));
      scene.current = s;
      if (process.env.NODE_ENV !== "production") (window as unknown as { __realm?: unknown }).__realm = s;
      game = new Phaser.Game({
        type: Phaser.WEBGL, parent: el, width: el.clientWidth, height: el.clientHeight, backgroundColor: "#2e9fe0", scene: s,
        scale: { mode: Phaser.Scale.RESIZE },
        render: { antialias: false, pixelArt: true, roundPixels: true, clearBeforeRender: true },
      });
      const hydrate = () => {
        if (disposed) return;
        const p = latest.current;
        s.setRealm(p.input); s.setRewards(p.rewards);
      };
      game.events.once(Phaser.Core.Events.READY, () => { if (s.scene.isActive()) hydrate(); else s.events.once(Phaser.Scenes.Events.CREATE, hydrate); });
      observer = new ResizeObserver(([entry]) => {
        if (!entry || entry.contentRect.width <= 0 || entry.contentRect.height <= 0 || !game) return;
        game.scale.resize(entry.contentRect.width, entry.contentRect.height);
        s.resizeViewport(entry.contentRect.width, entry.contentRect.height);
      });
      observer.observe(el);
    })();
    return () => { disposed = true; observer?.disconnect(); game?.destroy(true); scene.current = null; };
  }, []);

  const inputKey = JSON.stringify(props.input);
  useEffect(() => { if (scene.current?.scene?.isActive()) scene.current.setRealm(latest.current.input); }, [inputKey]);
  const rewardKey = props.rewards.map(r => r.key).join("|");
  useEffect(() => { scene.current?.setRewards(latest.current.rewards); }, [rewardKey]);

  return <div ref={host} className="realm-world" aria-label="The Realm: your agreement as a city" />;
});

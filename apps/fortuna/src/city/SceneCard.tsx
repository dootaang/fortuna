import { useEffect, useState, type ReactNode } from "react";
import { LINES, STATIONS, normalizeSprite, type PlaceId, type SceneEffect } from "@fortuna/core";
import type { SceneDoc, SceneImageDoc } from "@fortuna/data";
import { cx } from "../ui/kit.tsx";
import { DefaultArt } from "./DefaultArt.tsx";
import { imageStyle } from "./images.ts";
import { faceUrl } from "./sprites.ts";
import type { ActorRow, CityData } from "./useCity.ts";

/**
 * 장면 카드: [기본 그림 또는 딜러 이미지 + 필터] → [효과] → [아르데코 틀] → [이름판·감각 한 줄].
 * docs/SPEC-CITY-MAP.md 3절. 어떤 그림이 들어와도 틀과 글씨가 같아 화면 전체가 한 톤을 유지한다.
 */
const PULSE_MS = 1_600;

export function SceneCard({ place, scene, image, compact, children }: {
  place: PlaceId;
  scene: SceneDoc | null;
  image: (SceneImageDoc & { id: string }) | null;
  compact?: boolean;
  children?: ReactNode;
}) {
  const station = STATIONS[place], line = LINES[station.line];
  const sense = scene?.sense || image?.sense || station.sense;
  const pulse = usePulse(scene?.pulse ?? null);
  const persistent = scene?.persistent ?? null;
  return (
    <figure className={cx("scene-card", pulse && `scene-pulse-${pulse}`, persistent && `scene-fx-${persistent}`)}
      style={{ "--line": line.light, "--line-dark": line.dark } as React.CSSProperties} aria-label={`${station.name} 장면`}>
      <div className="scene-art">
        {image
          ? <img key={image.id} src={image.url} alt="" className="scene-img" style={imageStyle(image)} />
          : <DefaultArt line={station.line} />}
        {image && image.filter !== "frame" && <div className="scene-tint" />}
      </div>
      {persistent && <div className={cx("scene-overlay", `scene-overlay-${persistent}`)} aria-hidden="true" />}
      <div className="scene-frame" aria-hidden="true"><span /><span /><span /><span /></div>
      <figcaption className={cx("scene-caption", compact && "scene-caption-compact")}>
        <p className="deco-caps text-[0.6rem]" style={{ color: line.light }}>{station.line === "wheel" ? "Fortuna Terminus" : line.name}</p>
        <p className="deco-title text-xl leading-tight sm:text-2xl">{station.name}</p>
        {!compact && <p className="mt-0.5 text-[0.8rem] italic text-ivory/85">{sense}</p>}
      </figcaption>
      {image?.credit && <p className="scene-credit">{image.credit}</p>}
      {children}
    </figure>
  );
}

/** A one-shot effect plays for a moment after it fires (on every screen that sees it in time). */
function usePulse(pulse: SceneDoc["pulse"]): SceneEffect | null {
  const [active, setActive] = useState<SceneEffect | null>(null);
  const at = pulse?.at?.toMillis?.() ?? 0;
  useEffect(() => {
    if (!pulse || !at || Math.abs(Date.now() - at) > 15_000) return undefined;
    setActive(pulse.kind);
    const timer = window.setTimeout(() => setActive(null), PULSE_MS);
    return () => window.clearTimeout(timer);
  }, [at]);
  return active;
}

/** Face of a character: the uploaded portrait, or the dot portrait. */
export function ActorFace({ actor, data, size = 32, className }: { actor: ActorRow | undefined; data: CityData; size?: number; className?: string }) {
  const portrait = actor?.data.portrait ? data.images.get(actor.data.portrait) : undefined;
  if (portrait) return <img src={portrait.url} alt="" width={size} height={size} className={cx("face face-photo", className)} style={{ width: size, height: size, ...imageStyle(portrait) }} />;
  return <img src={faceUrl(normalizeSprite(actor?.data.sprite))} alt="" width={size} height={size} className={cx("face pixelated", className)} style={{ width: size, height: size }} />;
}

/** Face of an NPC: the dealer's portrait, or a monogram in the district's colors. */
export function NpcFace({ npcId, name, data, size = 32, className }: { npcId: string | null; name: string; data: CityData; size?: number; className?: string }) {
  const npc = npcId ? data.npcs.get(npcId) : undefined;
  const portrait = npc?.portraitId ? data.images.get(npc.portraitId) : undefined;
  if (portrait) return <img src={portrait.url} alt="" width={size} height={size} className={cx("face face-photo face-npc", className)} style={{ width: size, height: size, ...imageStyle(portrait) }} />;
  const line = npc ? LINES[npc.line] : LINES.wheel;
  return (
    <span className={cx("face face-npc grid place-items-center font-bold", className)} aria-hidden="true"
      style={{ width: size, height: size, background: line.dark, color: line.light, fontSize: size * 0.45 }}>{name.slice(0, 1)}</span>
  );
}

/** The dealer's mark (GM speech). */
export function DealerFace({ size = 32 }: { size?: number }) {
  return <span className="face face-npc grid place-items-center bg-ink text-gold-300" style={{ width: size, height: size, fontSize: size * 0.5 }} aria-hidden="true">◆</span>;
}

import { PLACES, PROPS, TILE, mapSize, type Facing, type GroundChar, type PlaceId, type SpriteChoice } from "@fortuna/core";
import { Pix } from "./pix.ts";
import { PAINTERS } from "./props.ts";
import { paintGround } from "./tiles.ts";
import { SPRITE_H, SPRITE_W, spriteCanvas } from "./sprites.ts";

/**
 * 장소 하나를 그린다. 바닥과 움직이지 않는 소품은 처음에 한 장으로 미리 그려 두고, 매 프레임에는
 * 움직이는 소품·캐릭터·위층(지붕, 등불, 샹들리에)·글자만 그린다.
 */
export interface SceneActor {
  id: string;
  name: string;
  sprite: SpriteChoice;
  /** Tile coordinates (float while walking). */
  x: number;
  y: number;
  facing: Facing;
  frame: number;
  away: boolean;
  me: boolean;
  bubble: string | null;
}

interface Animated { x: number; y: number; w: number; h: number; frames: HTMLCanvasElement[]; fps: number; over: [number, number][]; }

export interface Camera { x: number; y: number; scale: number; dpr?: number; }

const FONT = '"Noto Sans KR", "Pretendard", system-ui, sans-serif';

export class PlaceScene {
  readonly width: number;
  readonly height: number;
  private readonly base: HTMLCanvasElement;
  private readonly overlay: HTMLCanvasElement;
  private readonly animated: Animated[] = [];

  constructor(readonly id: PlaceId) {
    const place = PLACES[id], { width, height } = mapSize(place);
    this.width = width; this.height = height;
    const base = new Pix(width * TILE, height * TILE), over = new Pix(width * TILE, height * TILE);
    const at = (x: number, y: number) => place.ground[y]?.[x] ?? "";
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      paintGround(base, place.ground[y]![x] as GroundChar, x * TILE, y * TILE, { place: id, x, y, at: (dx, dy) => at(x + dx, y + dy) });
    }
    for (const [prop, px, py, variant = 0] of place.props) {
      const def = PROPS[prop], mask = "mask" in def ? (def.mask as readonly string[]) : undefined;
      const overCells: [number, number][] = [];
      for (let dy = 0; dy < def.h; dy += 1) for (let dx = 0; dx < def.w; dx += 1) {
        const cell = mask?.[dy]?.[dx] ?? "#";
        if (cell === "^" || cell === "%") overCells.push([dx, dy]);
      }
      const frames = "frames" in def ? def.frames : 1;
      if (frames > 1) {
        const canvases: HTMLCanvasElement[] = [];
        for (let frame = 0; frame < frames; frame += 1) {
          const pix = new Pix(def.w * TILE, def.h * TILE);
          PAINTERS[prop](pix, variant, frame);
          canvases.push(pix.toCanvas());
        }
        this.animated.push({ x: px, y: py, w: def.w, h: def.h, frames: canvases, fps: "fps" in def ? def.fps : 2, over: overCells });
      } else {
        const pix = new Pix(def.w * TILE, def.h * TILE);
        PAINTERS[prop](pix, variant, 0);
        base.blit(pix, px * TILE, py * TILE);
        for (const [dx, dy] of overCells) {
          for (let y = 0; y < TILE; y += 1) for (let x = 0; x < TILE; x += 1) {
            const c = pix.get(dx * TILE + x, dy * TILE + y);
            if (c >>> 24) over.set((px + dx) * TILE + x, (py + dy) * TILE + y, c);
          }
        }
      }
    }
    this.base = base.toCanvas();
    this.overlay = over.toCanvas();
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, viewW: number, viewH: number, nowMs: number, actors: readonly SceneActor[]): void {
    const place = PLACES[this.id], s = camera.scale, d = camera.dpr ?? 1;
    const ox = Math.round(-camera.x * s + viewW / 2), oy = Math.round(-camera.y * s + viewH / 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0b0809";
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(s, 0, 0, s, ox, oy);
    ctx.drawImage(this.base, 0, 0);
    const frameOf = (a: Animated) => Math.floor((nowMs / 1000) * a.fps) % a.frames.length;
    for (const a of this.animated) ctx.drawImage(a.frames[frameOf(a)]!, a.x * TILE, a.y * TILE);

    const sorted = [...actors].sort((a, b) => a.y - b.y || (a.me ? 1 : -1));
    for (const actor of sorted) {
      const px = Math.round(actor.x * TILE), py = Math.round(actor.y * TILE);
      ctx.globalAlpha = actor.away ? 0.45 : 1;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(px + 8, py + 14.5, 5.5, 2, 0, 0, Math.PI * 2); ctx.fill();
      if (actor.me) { ctx.strokeStyle = "rgba(241,217,138,0.85)"; ctx.lineWidth = 1 / s * 1.5; ctx.beginPath(); ctx.ellipse(px + 8, py + 14.5, 7, 2.8, 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.drawImage(spriteCanvas(actor.sprite, actor.facing, actor.frame), px + (TILE - SPRITE_W) / 2, py + TILE - SPRITE_H);
      ctx.globalAlpha = 1;
    }

    ctx.drawImage(this.overlay, 0, 0);
    for (const a of this.animated) {
      const canvas = a.frames[frameOf(a)]!;
      for (const [dx, dy] of a.over) ctx.drawImage(canvas, dx * TILE, dy * TILE, TILE, TILE, (a.x + dx) * TILE, (a.y + dy) * TILE, TILE, TILE);
    }

    // Mood: a soft vignette, warmer indoors.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const vignette = ctx.createRadialGradient(viewW / 2, viewH / 2, Math.min(viewW, viewH) * 0.35, viewW / 2, viewH / 2, Math.max(viewW, viewH) * 0.75);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, place.mood === "lamp" ? "rgba(40,16,4,0.45)" : place.mood === "station" ? "rgba(4,16,20,0.4)" : "rgba(0,0,0,0.28)");
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, viewW, viewH);

    // Signs and place names.
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const label of place.labels) {
      const lx = ox + label.x * TILE * s, ly = oy + label.y * TILE * s;
      if (label.kind === "place") {
        ctx.font = `700 ${Math.max(11, Math.round(s * 4.6))}px ${FONT}`;
        ctx.fillStyle = "#f1d98a"; ctx.strokeStyle = "rgba(11,8,9,0.85)"; ctx.lineWidth = 3;
        ctx.strokeText(label.text, lx, ly); ctx.fillText(label.text, lx, ly);
      } else if (label.kind === "sign") {
        ctx.font = `700 ${Math.max(10, Math.round(s * 4))}px ${FONT}`;
        ctx.fillStyle = "#e6c564"; ctx.fillText(label.text, lx, ly);
      } else {
        ctx.font = `600 ${Math.max(10, Math.round(s * 3.6))}px ${FONT}`;
        const w = ctx.measureText(label.text).width + 10 * d, h = Math.max(14 * d, Math.round(s * 6));
        ctx.fillStyle = "rgba(11,8,9,0.72)"; roundRect(ctx, lx - w / 2, ly - h / 2, w, h, 3); ctx.fill();
        ctx.strokeStyle = "rgba(212,175,55,0.6)"; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = "#f3ead2"; ctx.fillText(label.text, lx, ly + 0.5);
      }
    }

    // Names, then speech bubbles on top.
    ctx.font = `600 ${Math.round(11 * d)}px ${FONT}`;
    for (const actor of sorted) {
      const nx = ox + (actor.x * TILE + 8) * s, ny = oy + (actor.y * TILE + TILE - SPRITE_H - 3) * s;
      ctx.globalAlpha = actor.away ? 0.55 : 1;
      ctx.lineWidth = 3 * d; ctx.strokeStyle = "rgba(11,8,9,0.9)"; ctx.strokeText(actor.name, nx, ny);
      ctx.fillStyle = actor.me ? "#f1d98a" : "#f3ead2"; ctx.fillText(actor.name, nx, ny);
      ctx.globalAlpha = 1;
    }
    for (const actor of sorted) if (actor.bubble) bubble(ctx, ox + (actor.x * TILE + 8) * s, oy + (actor.y * TILE + TILE - SPRITE_H - 3) * s - 12 * d, actor.bubble, d);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function bubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, d: number): void {
  ctx.font = `500 ${Math.round(12 * d)}px ${FONT}`;
  const shown = text.length > 22 ? `${text.slice(0, 21)}…` : text;
  const w = Math.min(190 * d, ctx.measureText(shown).width + 14 * d), h = 20 * d;
  ctx.fillStyle = "rgba(243,234,210,0.96)"; roundRect(ctx, x - w / 2, y - h, w, h, 6 * d); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 4 * d, y - 0.5); ctx.lineTo(x, y + 5 * d); ctx.lineTo(x + 4 * d, y - 0.5); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(143,111,21,0.9)"; ctx.lineWidth = d; roundRect(ctx, x - w / 2, y - h, w, h, 6 * d); ctx.stroke();
  ctx.fillStyle = "#1a1410"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(shown, x, y - h / 2 + 0.5);
}

const scenes = new Map<PlaceId, PlaceScene>();
export function sceneOf(id: PlaceId): PlaceScene {
  let scene = scenes.get(id);
  if (!scene) { scene = new PlaceScene(id); scenes.set(id, scene); }
  return scene;
}

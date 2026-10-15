import { HAIR_COLORS, OUTFIT_COLORS, SKIN_TONES, spriteKey, type SpriteChoice } from "@fortuna/core";
import { Pix, shade } from "./pix.ts";

/**
 * 도트 캐릭터 (16×24). 몸 → 옷 → 머리 → 소품 순서로 겹쳐 그리고 마지막에 외곽선을 두른다.
 * 방향은 아래·위·왼쪽 셋을 그리고, 오른쪽은 왼쪽을 뒤집어 쓴다. 걷기는 3프레임(서기, 왼발, 오른발).
 */
export const SPRITE_W = 16, SPRITE_H = 24;
type View = "down" | "up" | "left";
export type Facing = "down" | "up" | "left" | "right";

const OUTLINE = "#1a1210", SHOE = "#2a1d17", WHITE = "#f3ead2";

interface Palette { skin: string; skinDark: string; hair: string; hairLight: string; hairDark: string; cloth: string; clothDark: string; clothLight: string; }

function palette(c: SpriteChoice): Palette {
  const skin = SKIN_TONES[c.skin]!, hair = HAIR_COLORS[c.hairColor]!, cloth = OUTFIT_COLORS[c.outfitColor]!;
  return { skin, skinDark: shade(skin, -0.18), hair, hairLight: shade(hair, 0.28), hairDark: shade(hair, -0.3), cloth, clothDark: shade(cloth, -0.32), clothLight: shade(cloth, 0.22) };
}

/** Leg offsets for the walk: which leg is lifted. */
function legs(frame: number): [number, number] { return frame === 1 ? [-1, 0] : frame === 2 ? [0, -1] : [0, 0]; }

function body(p: Pix, k: Palette, view: View, frame: number, outfit: number): void {
  const long = outfit === 1 || outfit === 2; // robe and dopo hide the legs
  const [lUp, rUp] = legs(frame);
  if (view === "left") {
    // Head.
    p.rect(4, 3, 7, 8, k.skin); p.clear(4, 3); p.clear(10, 3); p.clear(4, 10); p.clear(10, 10);
    p.vline(10, 4, 9, k.skinDark);
    p.set(5, 7, OUTLINE); p.set(5, 6, OUTLINE); p.set(4, 8, k.skinDark);
    p.rect(7, 11, 2, 1, k.skin);
    // Legs stride.
    const strides: Record<number, [number, number]> = { 0: [6, 8], 1: [4, 9], 2: [8, 5] };
    const [front, back] = strides[frame]!;
    if (!long) {
      p.rect(back, 18, 2, 4, k.clothDark); p.rect(back - 1, 22, 3, 1, SHOE);
      p.rect(front, 18, 2, 4, k.clothDark); p.rect(front - 1, 22, 3, 1, SHOE);
    } else {
      p.rect(front - 1, 22, 3, 1, SHOE); p.rect(back - 1, 22, 2, 1, SHOE);
    }
    return;
  }
  // Front and back share the silhouette.
  p.rect(4, 3, 8, 8, k.skin); p.clear(4, 3); p.clear(11, 3); p.clear(4, 10); p.clear(11, 10);
  p.vline(11, 4, 9, k.skinDark); p.hline(5, 10, 10, k.skinDark);
  if (view === "down") {
    p.rect(6, 6, 1, 2, OUTLINE); p.rect(9, 6, 1, 2, OUTLINE);
    p.set(5, 8, shade(k.skin, -0.08)); p.set(10, 8, shade(k.skin, -0.08));
  }
  p.rect(7, 11, 2, 1, k.skinDark);
  // Hands (arms are drawn by the outfit).
  const armSwing = frame === 1 ? [0, -1] : frame === 2 ? [-1, 0] : [0, 0];
  p.set(3, 17 + armSwing[0]!, k.skin); p.set(12, 17 + armSwing[1]!, k.skin);
  if (!long) {
    p.rect(5, 18 + lUp, 3, 4, k.clothDark); p.rect(8, 18 + rUp, 3, 4, k.clothDark);
    p.vline(7, 18 + lUp, 21 + lUp, shade(k.clothDark, -0.2));
    p.rect(5, 22 + lUp, 3, 1, SHOE); p.rect(8, 22 + rUp, 3, 1, SHOE);
  } else {
    p.rect(5, 22 + lUp, 3, 1, SHOE); p.rect(8, 22 + rUp, 3, 1, SHOE);
  }
}

function outfit(p: Pix, k: Palette, view: View, frame: number, kind: number): void {
  const swing = frame === 1 ? [0, -1] : frame === 2 ? [-1, 0] : [0, 0];
  const side = view === "left";
  const x0 = side ? 5 : 4, x1 = side ? 10 : 11;
  const torso = (color: string, from = 11, to = 17) => {
    p.rect(x0, from, x1 - x0 + 1, to - from + 1, color);
    p.vline(x1, from, to, shade(color, -0.25)); p.vline(x0, from, to, shade(color, 0.12));
  };
  const arms = (color: string, wide = false) => {
    if (side) { p.rect(7, 12, 2, 5, color); if (wide) p.rect(6, 15, 4, 2, color); p.set(7 + (frame === 1 ? -1 : frame === 2 ? 1 : 0), 17, k.skin); return; }
    p.rect(3, 12 + swing[0]!, 1, 5, color); p.rect(12, 12 + swing[1]!, 1, 5, color);
    if (wide) { p.rect(2, 14 + swing[0]!, 2, 3, color); p.rect(12, 14 + swing[1]!, 2, 3, color); }
  };
  const skirt = (color: string, top: number, bottom: number) => {
    for (let y = top; y <= bottom; y += 1) {
      const spread = Math.floor((y - top) / 2);
      const a = (side ? 5 : 4) - spread, b = (side ? 10 : 11) + spread;
      p.hline(a, b, y, color); p.set(b, y, shade(color, -0.25)); p.set(a, y, shade(color, 0.12));
    }
  };
  switch (kind) {
    case 0: // 정장
      torso(k.cloth); arms(k.cloth);
      if (view === "down") { p.rect(7, 11, 2, 2, WHITE); p.rect(7, 12, 2, 4, "#b8323a"); p.set(7, 12, "#d84a4a"); p.vline(6, 11, 13, k.clothDark); p.vline(9, 11, 13, k.clothDark); p.set(7, 16, "#e6c564"); }
      if (side) p.set(5, 12, WHITE);
      p.hline(x0, x1, 17, k.clothDark);
      break;
    case 1: // 로브
      torso(k.cloth); arms(k.cloth, true); skirt(k.cloth, 17, 21);
      p.hline(x0, x1, 15, "#d4af37"); if (view === "down") { p.vline(8, 11, 21, k.clothDark); p.set(8, 15, "#f1d98a"); }
      break;
    case 2: // 도포
      torso(k.cloth); arms(k.cloth, true); skirt(k.cloth, 17, 21);
      if (view === "down") { p.set(6, 11, WHITE); p.set(7, 12, WHITE); p.set(8, 13, WHITE); p.set(9, 11, WHITE); p.set(8, 12, WHITE); p.vline(8, 14, 21, k.clothDark); }
      p.hline(x0, x1, 15, k.clothDark); if (view === "down") { p.set(10, 16, "#b8323a"); p.set(10, 17, "#b8323a"); }
      break;
    case 3: { // 갑옷
      const metal = "#9aa3ad";
      torso(metal); arms(metal);
      if (!side) { p.rect(2, 11, 3, 2, "#c9ced6"); p.rect(11, 11, 3, 2, "#c9ced6"); }
      if (view !== "up") p.rect(side ? 6 : 6, 12, side ? 3 : 4, 6, k.cloth); else p.rect(6, 12, 4, 6, k.cloth);
      if (view === "down") p.set(7, 14, "#f1d98a");
      p.hline(x0, x1, 16, "#5a3b22");
      if (!side) { p.rect(5, 18, 3, 3, "#7d858f"); p.rect(8, 18, 3, 3, "#7d858f"); }
      break;
    }
    case 4: // 코트
      torso(k.cloth, 11, 20); arms(k.cloth);
      if (view === "down") { p.rect(7, 11, 2, 9, shade(k.cloth, 0.45)); p.vline(6, 11, 20, k.clothDark); p.vline(9, 11, 20, k.clothDark); p.set(6, 13, "#e6c564"); p.set(6, 16, "#e6c564"); }
      p.hline(x0, x1, 15, k.clothDark);
      break;
    case 5: // 드레스
      torso(k.cloth, 11, 14); arms(k.skin); skirt(k.cloth, 15, 20);
      if (view === "down") { p.hline(5, 10, 11, k.clothLight); p.set(8, 12, "#f1d98a"); }
      for (let x = side ? 3 : 2; x <= (side ? 12 : 13); x += 2) p.set(x, 20, k.clothLight);
      if (!side) { p.rect(6, 21, 1, 1, k.skin); p.rect(9, 21, 1, 1, k.skin); }
      break;
    case 6: { // 작업복
      const shirt = shade(k.cloth, 0.6);
      torso(shirt); arms(shirt);
      p.rect(side ? 6 : 5, 13, side ? 4 : 6, 5, k.cloth);
      if (view === "down") { p.vline(5, 11, 12, k.cloth); p.vline(10, 11, 12, k.cloth); p.rect(7, 14, 2, 2, k.clothDark); p.set(5, 13, "#e6c564"); p.set(10, 13, "#e6c564"); }
      if (!side) { p.rect(5, 18, 3, 4, k.cloth); p.rect(8, 18, 3, 4, k.cloth); }
      break;
    }
    case 7: { // 우주복
      const suit = "#e8e8ee";
      p.rect(side ? 4 : 3, 11, side ? 8 : 10, 8, suit); p.vline(side ? 11 : 12, 11, 18, "#b9bcc6");
      arms(suit, true);
      p.hline(side ? 4 : 3, side ? 11 : 12, 14, k.cloth);
      if (view === "down") { p.rect(6, 15, 4, 2, "#3a3f4b"); p.set(7, 15, "#4fc08d"); p.set(8, 15, "#e06a5c"); }
      p.hline(4, 11, 10, "#9aa3ad");
      if (!side) { p.rect(4, 18, 4, 4, suit); p.rect(8, 18, 4, 4, suit); p.rect(4, 22, 4, 1, k.clothDark); p.rect(8, 22, 4, 1, k.clothDark); }
      p.set(3, 17 + swing[0]!, k.cloth); p.set(12, 17 + swing[1]!, k.cloth);
      break;
    }
  }
}

function hair(p: Pix, k: Palette, view: View, style: number): void {
  const H = k.hair, L = k.hairLight, D = k.hairDark;
  if (style === 7) { // 삭발
    if (view === "left") { p.hline(5, 9, 3, D); p.set(9, 4, D); } else { p.hline(5, 10, 3, D); if (view === "up") p.rect(5, 3, 6, 3, D); }
    return;
  }
  if (view === "down") {
    p.rect(4, 2, 8, 3, H); p.hline(5, 10, 1, H); p.hline(5, 9, 2, L);
    p.set(4, 5, H); p.set(11, 5, H); p.set(4, 6, H); p.set(11, 6, H);
    for (const x of [5, 7, 9]) p.set(x, 5, H);
    if (style === 1) { p.rect(3, 4, 2, 7, H); p.rect(11, 4, 2, 7, H); p.vline(3, 5, 10, D); }
    if (style === 2) { p.rect(3, 4, 2, 12, H); p.rect(11, 4, 2, 12, H); p.vline(3, 6, 15, D); p.vline(12, 6, 15, D); }
    if (style === 3) { for (const x of [5, 8, 10]) { p.set(x, 0, H); p.set(x, 1, H); } p.set(6, 6, H); p.set(9, 6, H); p.set(4, 7, H); p.set(11, 7, H); }
    if (style === 4) { p.disc(8, 1, 2, H); p.set(7, 0, L); }
    if (style === 5) { p.rect(12, 5, 1, 5, H); p.set(12, 10, D); }
    if (style === 6) { for (let y = 6; y < 17; y += 1) { p.set(11, y, y % 2 ? H : D); p.set(12, y, y % 2 ? D : H); } p.set(11, 17, "#b8323a"); }
    p.set(6, 2, L); p.set(7, 2, L);
    return;
  }
  if (view === "up") {
    p.rect(4, 2, 8, 9, H); p.hline(5, 10, 1, H); p.vline(11, 3, 10, D); p.hline(5, 9, 2, L);
    if (style === 1) { p.rect(3, 4, 10, 7, H); p.hline(3, 12, 10, D); }
    if (style === 2) { p.rect(4, 10, 8, 6, H); p.hline(4, 11, 15, D); p.rect(3, 4, 1, 10, H); p.rect(12, 4, 1, 10, H); }
    if (style === 3) { for (const x of [5, 8, 10]) { p.set(x, 0, H); p.set(x, 1, H); } }
    if (style === 4) { p.disc(8, 1, 2, H); }
    if (style === 5) { p.rect(7, 10, 2, 6, H); p.set(7, 10, "#b8323a"); p.set(8, 10, "#b8323a"); }
    if (style === 6) { for (let y = 10; y < 18; y += 1) { p.set(7, y, y % 2 ? H : D); p.set(8, y, y % 2 ? D : H); } }
    return;
  }
  // Side view (facing left): the back of the head is on the right.
  p.rect(4, 2, 7, 3, H); p.hline(5, 9, 1, H); p.rect(8, 4, 3, 6, H); p.set(4, 5, H); p.set(5, 5, H); p.hline(5, 8, 2, L);
  if (style === 1) { p.rect(8, 4, 4, 7, H); p.vline(11, 5, 10, D); }
  if (style === 2) { p.rect(8, 4, 4, 12, H); p.vline(11, 5, 15, D); }
  if (style === 3) { for (const x of [5, 7, 9]) { p.set(x, 0, H); p.set(x + 1, 1, H); } p.set(11, 4, H); }
  if (style === 4) { p.disc(9, 1, 2, H); }
  if (style === 5) { p.rect(11, 4, 2, 7, H); p.set(11, 4, "#b8323a"); p.vline(12, 6, 11, D); }
  if (style === 6) { for (let y = 9; y < 17; y += 1) p.set(10, y, y % 2 ? H : D); }
}

function accessory(p: Pix, k: Palette, view: View, kind: number): void {
  switch (kind) {
    case 1: // 모자
      if (view === "left") { p.hline(3, 11, 3, OUTLINE); p.rect(5, 0, 5, 3, "#2a1d17"); p.hline(5, 9, 2, "#d4af37"); }
      else { p.hline(3, 12, 3, OUTLINE); p.rect(5, 0, 6, 3, "#2a1d17"); p.hline(5, 10, 2, "#d4af37"); }
      break;
    case 2: // 안경
      if (view === "down") { p.frame(5, 6, 3, 3, "#d4af37"); p.frame(8, 6, 3, 3, "#d4af37"); p.set(6, 7, "#bfe3ff"); p.set(9, 7, "#bfe3ff"); }
      if (view === "left") { p.frame(4, 6, 3, 3, "#d4af37"); p.set(5, 7, "#bfe3ff"); p.hline(7, 9, 6, "#d4af37"); }
      break;
    case 3: { // 뿔
      const bone = "#e8e0c8", tip = "#a8987a";
      if (view === "left") { p.set(8, 1, bone); p.set(7, 0, tip); p.set(9, 2, bone); }
      else { p.set(4, 2, bone); p.set(3, 1, bone); p.set(3, 0, tip); p.set(11, 2, bone); p.set(12, 1, bone); p.set(12, 0, tip); }
      break;
    }
    case 4: // 고양이 귀
      if (view === "left") { p.set(8, 0, k.hair); p.set(8, 1, k.hair); p.set(9, 1, k.hair); p.set(9, 0, k.hairDark); }
      else { for (const [x, inner] of [[4, 5], [11, 10]] as const) { p.set(x, 0, k.hair); p.set(x, 1, k.hair); p.set(inner, 1, k.hair); p.set(inner, 0, view === "down" ? "#e88aa0" : k.hair); } }
      break;
    case 5: // 의체 눈
      if (view === "down") { p.rect(9, 5, 2, 4, "#9aa3ad"); p.rect(9, 6, 1, 2, "#ff3b5c"); p.set(10, 7, "#ff3b5c88"); }
      if (view === "left") p.set(5, 7, "#ff3b5c");
      if (view === "up") p.set(11, 7, "#9aa3ad");
      break;
  }
}

export function drawSprite(choice: SpriteChoice, view: View, frame: number): Pix {
  const p = new Pix(SPRITE_W, SPRITE_H), k = palette(choice);
  body(p, k, view, frame, choice.outfit);
  outfit(p, k, view, frame, choice.outfit);
  hair(p, k, view, choice.hair);
  accessory(p, k, view, choice.accessory);
  p.outline(OUTLINE);
  return p;
}

const sheets = new Map<string, HTMLCanvasElement>();

/** Canvas for one pose; right-facing is the left pose mirrored. */
export function spriteCanvas(choice: SpriteChoice, facing: Facing, frame: number): HTMLCanvasElement {
  const key = `${spriteKey(choice)}:${facing}:${frame}`;
  let canvas = sheets.get(key);
  if (!canvas) {
    const view: View = facing === "right" ? "left" : facing;
    const pix = drawSprite(choice, view, frame);
    if (facing === "right") { const mirrored = new Pix(SPRITE_W, SPRITE_H); mirrored.blit(pix, 0, 0, true); canvas = mirrored.toCanvas(); }
    else canvas = pix.toCanvas();
    sheets.set(key, canvas);
  }
  return canvas;
}

const faces = new Map<string, string>();

/** A small head-and-shoulders portrait (data URL) for chat. */
export function faceUrl(choice: SpriteChoice): string {
  const key = spriteKey(choice);
  let url = faces.get(key);
  if (!url) {
    const pix = drawSprite(choice, "down", 0), crop = new Pix(14, 14);
    for (let y = 0; y < 14; y += 1) for (let x = 0; x < 14; x += 1) { const c = pix.get(x + 1, y); if (c >>> 24) crop.set(x, y, c); }
    url = crop.toCanvas().toDataURL();
    faces.set(key, url);
  }
  return url;
}

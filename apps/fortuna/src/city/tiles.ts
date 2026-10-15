import type { GroundChar, PlaceId } from "@fortuna/core";
import { Grain, Pix, seedOf, shade } from "./pix.ts";

/**
 * 바닥 타일(16×16). 같은 칸은 늘 같은 무늬가 나오게 장소·좌표로 씨앗을 정한다.
 * 건물 벽(B)은 장소마다 색이 다르다: 광장은 크림색 석조, 판돈로는 붉은 벽돌, 환전가는 청록 회벽.
 */
export interface CellContext { place: PlaceId; x: number; y: number; at: (dx: number, dy: number) => string; }

const FACADES: Partial<Record<PlaceId, { wall: string; trim: string; mortar: string; glass: string; lit: string; awning?: string }>> = {
  "wheel-plaza": { wall: "#d6c7a3", trim: "#b38f22", mortar: "#bba987", glass: "#1d3b33", lit: "#f1d98a" },
  "wheel-pandon": { wall: "#6a2f27", trim: "#d4af37", mortar: "#4a1f19", glass: "#20161c", lit: "#ff9e5e" },
  "wheel-exchange": { wall: "#2f6e66", trim: "#e6c564", mortar: "#25554f", glass: "#14232a", lit: "#f1d98a" },
  "wheel-platform": { wall: "#3a3d42", trim: "#b38f22", mortar: "#2c2e33", glass: "#1a2228", lit: "#e8d9a8" },
};

function stones(p: Pix, ox: number, oy: number, g: Grain, base: readonly string[], mortar: string): void {
  p.rect(ox, oy, 16, 16, mortar);
  const layout = g.next() < 0.5
    ? [[0, 0, 7, 8], [7, 0, 9, 8], [0, 8, 5, 8], [5, 8, 6, 8], [11, 8, 5, 8]]
    : [[0, 0, 9, 8], [9, 0, 7, 8], [0, 8, 6, 8], [6, 8, 10, 8]];
  for (const [x, y, w, h] of layout) {
    const color = g.pick(base), x0 = ox + x! + 1, y0 = oy + y! + 1, w0 = w! - 1, h0 = h! - 1;
    p.rect(x0, y0, w0, h0, color);
    p.hline(x0 + 1, x0 + w0 - 2, y0, shade(color, 0.18));
    p.hline(x0 + 1, x0 + w0 - 2, y0 + h0 - 1, shade(color, -0.18));
    p.clear(x0, y0); p.set(x0, y0, mortar);
    p.set(x0 + w0 - 1, y0 + h0 - 1, mortar);
    if (g.next() < 0.35) p.set(x0 + 1 + g.int(Math.max(1, w0 - 2)), y0 + 1 + g.int(Math.max(1, h0 - 2)), shade(color, -0.12));
  }
}

export function paintGround(p: Pix, char: GroundChar, ox: number, oy: number, ctx: CellContext): void {
  const g = new Grain(seedOf(ctx.place, ctx.x, ctx.y, char));
  switch (char) {
    case ".": stones(p, ox, oy, g, ["#a39985", "#9a907c", "#aca28d", "#958b77"], "#746a59"); break;
    case ",": stones(p, ox, oy, g, ["#5b5a60", "#545359", "#625f66", "#4f4e54"], "#3c3b41"); break;
    case ":": {
      const alt = (ctx.x + ctx.y) % 2 === 0;
      p.rect(ox, oy, 16, 16, alt ? "#cdbd98" : "#c4b48e");
      p.speckle(ox, oy, 16, 16, ["#d6c7a3", "#bcab84"], 0.08, g);
      p.hline(ox, ox + 15, oy, "#a8966d"); p.vline(ox, oy, oy + 15, "#a8966d");
      if (alt) {
        // Gold diamond inlay, the plaza's deco motif.
        for (let i = 0; i < 4; i += 1) { p.hline(ox + 8 - i, ox + 8 + i, oy + 4 + i, "#d4af37"); p.hline(ox + 8 - i, ox + 8 + i, oy + 12 - i, "#d4af37"); }
        p.set(ox + 8, oy + 6, "#f1d98a"); p.set(ox + 7, oy + 7, "#f1d98a"); p.set(ox + 8, oy + 8, "#8f6f15");
      } else {
        p.set(ox + 8, oy + 8, "#155a43"); p.set(ox + 7, oy + 8, "#1d6b51"); p.set(ox + 8, oy + 7, "#1d6b51");
      }
      break;
    }
    case "_":
      p.rect(ox, oy, 16, 16, "#8a6a46");
      p.speckle(ox, oy, 16, 16, ["#7a5c3b", "#9a7a52", "#836341"], 0.18, g);
      if (g.next() < 0.3) { const x = ox + 2 + g.int(12), y = oy + 2 + g.int(12); p.set(x, y, "#b3a48a"); p.set(x + 1, y, "#8f826c"); }
      break;
    case "g":
      p.rect(ox, oy, 16, 16, "#4f7a3d");
      p.speckle(ox, oy, 16, 16, ["#62904a", "#406a32", "#5a8545"], 0.22, g);
      for (let i = 0; i < 5; i += 1) { const x = ox + g.int(16), y = oy + 2 + g.int(13); p.set(x, y, "#75a656"); p.set(x, y - 1, "#75a656"); }
      if (g.next() < 0.2) { const x = ox + 3 + g.int(10), y = oy + 3 + g.int(10); p.set(x, y, g.pick(["#e8d46a", "#e88aa0", "#f3ead2"])); }
      break;
    case "=":
      p.rect(ox, oy, 16, 16, "#8a5a32");
      for (let y = 0; y < 16; y += 4) { p.hline(ox, ox + 15, oy + y, "#5e3c20"); p.hline(ox, ox + 15, oy + y + 1, "#9c6a3e"); }
      break;
    case "r": {
      p.rect(ox, oy, 16, 16, "#7a1622");
      for (let y = 2; y < 16; y += 6) for (let x = 3; x < 16; x += 6) { p.set(ox + x, oy + y, "#a3283a"); p.set(ox + x + 1, oy + y + 1, "#a3283a"); p.set(ox + x - 1, oy + y + 1, "#a3283a"); p.set(ox + x, oy + y + 2, "#a3283a"); }
      if (ctx.at(-1, 0) !== "r") { p.vline(ox, oy, oy + 15, "#5a0f18"); p.vline(ox + 1, oy, oy + 15, "#d4af37"); }
      if (ctx.at(1, 0) !== "r") { p.vline(ox + 15, oy, oy + 15, "#5a0f18"); p.vline(ox + 14, oy, oy + 15, "#d4af37"); }
      break;
    }
    case "m": {
      const dark = (ctx.x + ctx.y) % 2 === 1;
      p.rect(ox, oy, 16, 16, dark ? "#16211e" : "#e6e0d3");
      const vein = dark ? "#8f7a3a" : "#b9b2a4";
      let vx = ox + g.int(16), vy = oy;
      for (let i = 0; i < 16; i += 1) { p.set(vx, vy, vein); vy += 1; vx += g.int(3) - 1; vx = Math.max(ox, Math.min(ox + 15, vx)); }
      p.hline(ox, ox + 15, oy, dark ? "#0d1412" : "#f3eee4"); p.vline(ox, oy, oy + 15, dark ? "#0d1412" : "#f3eee4");
      break;
    }
    case "c":
      p.rect(ox, oy, 16, 16, "#9d9b93");
      p.speckle(ox, oy, 16, 16, ["#8d8b84", "#aba9a1"], 0.15, g);
      p.hline(ox, ox + 15, oy, "#88867f"); p.vline(ox, oy, oy + 15, "#88867f");
      break;
    case "y":
      p.rect(ox, oy, 16, 16, "#9d9b93");
      p.speckle(ox, oy + 5, 16, 11, ["#8d8b84", "#aba9a1"], 0.15, g);
      p.rect(ox, oy, 16, 3, "#e0b23a"); p.hline(ox, ox + 15, oy + 3, "#7a6320");
      for (let x = 1; x < 16; x += 3) for (let y = 6; y < 12; y += 3) p.set(ox + x, oy + y, "#c8a54a");
      break;
    case "t": {
      p.rect(ox, oy, 16, 16, "#6b6660");
      p.speckle(ox, oy, 16, 16, ["#5c5752", "#7b7670", "#827d76"], 0.35, g);
      for (const x of [1, 9]) { p.rect(ox + x, oy + 1, 5, 14, "#5a3b22"); p.vline(ox + x, oy + 1, oy + 14, "#6e4a2c"); p.vline(ox + x + 4, oy + 1, oy + 14, "#432a17"); }
      for (const y of [3, 11]) { p.rect(ox, oy + y, 16, 2, "#7d838c"); p.hline(ox, ox + 15, oy + y, "#c9ced6"); p.hline(ox, ox + 15, oy + y + 2, "#3b3f45"); }
      break;
    }
    case "v":
      p.rect(ox, oy, 16, 16, "#6f6a63");
      p.speckle(ox, oy, 16, 16, ["#5f5a54", "#827c74", "#77716a", "#8d877e"], 0.45, g);
      break;
    case "B": paintFacade(p, ox, oy, ctx, g); break;
    case "R": {
      p.rect(ox, oy, 16, 16, "#3a3f4b");
      for (let y = 0; y < 16; y += 4) {
        const shift = (y / 4 + ctx.x) % 2 ? 4 : 0;
        p.hline(ox, ox + 15, oy + y + 3, "#272b34");
        for (let x = shift; x < 16; x += 8) { p.vline(ox + x, oy + y, oy + y + 3, "#2c3039"); p.set(ox + x + 1, oy + y, "#4b5160"); }
        p.hline(ox, ox + 15, oy + y, "#454b58");
      }
      break;
    }
    case "#":
      p.rect(ox, oy, 16, 16, "#24170f");
      p.speckle(ox, oy, 16, 16, ["#2c1d13", "#1d120b"], 0.2, g);
      if (ctx.at(0, 1) !== "#" && ctx.at(0, 1) !== "W") { p.hline(ox, ox + 15, oy + 14, "#b38f22"); p.hline(ox, ox + 15, oy + 15, "#5a4512"); }
      if (ctx.at(1, 0) !== "#" && ctx.at(1, 0) !== "") { p.vline(ox + 14, oy, oy + 15, "#b38f22"); p.vline(ox + 15, oy, oy + 15, "#5a4512"); }
      if (ctx.at(-1, 0) !== "#" && ctx.at(-1, 0) !== "") { p.vline(ox + 1, oy, oy + 15, "#b38f22"); p.vline(ox, oy, oy + 15, "#5a4512"); }
      if (ctx.at(0, -1) !== "#" && ctx.at(0, -1) !== "") { p.hline(ox, ox + 15, oy + 1, "#b38f22"); p.hline(ox, ox + 15, oy, "#5a4512"); }
      break;
    case "W":
      p.rect(ox, oy, 16, 16, "#0f4634");
      for (let x = 1; x < 16; x += 4) p.vline(ox + x, oy + 2, oy + 11, "#1b5c45");
      for (let x = 3; x < 16; x += 4) p.vline(ox + x, oy + 2, oy + 11, "#8a6d1c");
      p.rect(ox, oy, 16, 2, "#d4af37"); p.hline(ox, ox + 15, oy + 2, "#6f5713");
      p.rect(ox, oy + 12, 16, 4, "#3a2416"); p.hline(ox, ox + 15, oy + 12, "#b38f22");
      break;
    case "F":
      p.rect(ox, oy, 16, 16, "#7a5c3b");
      p.speckle(ox, oy, 16, 16, ["#6a4e32", "#8a6a46"], 0.2, g);
      for (const y of [4, 10]) { p.rect(ox, oy + y, 16, 2, "#6b4a2b"); p.hline(ox, ox + 15, oy + y, "#8a6238"); }
      for (const x of [2, 12]) { p.rect(ox + x, oy + 1, 2, 14, "#4e331c"); p.vline(ox + x, oy + 1, oy + 14, "#6b4a2b"); p.rect(ox + x, oy, 2, 1, "#a87c48"); }
      break;
  }
}

/** Building fronts: a cornice on top, windows, and a plinth where they meet the street. */
function paintFacade(p: Pix, ox: number, oy: number, ctx: CellContext, g: Grain): void {
  const f = FACADES[ctx.place] ?? FACADES["wheel-plaza"]!;
  p.rect(ox, oy, 16, 16, f.wall);
  // Courses of masonry.
  for (let y = 3; y < 16; y += 4) p.hline(ox, ox + 15, oy + y, f.mortar);
  for (let y = 0; y < 16; y += 4) { const shift = (y / 4 + ctx.x) % 2 ? 8 : 0; p.vline(ox + shift, oy + y, oy + y + 2, f.mortar); }
  const top = ctx.at(0, -1) !== "B", bottom = ctx.at(0, 1) !== "B" && ctx.at(0, 1) !== "";
  if (top) { p.rect(ox, oy, 16, 3, f.trim); p.hline(ox, ox + 15, oy + 3, shade(f.trim, -0.45)); p.hline(ox, ox + 15, oy, shade(f.trim, 0.3)); }
  if (bottom) {
    p.rect(ox, oy + 12, 16, 4, shade(f.wall, -0.35)); p.hline(ox, ox + 15, oy + 12, f.trim);
  } else if (!top || ctx.y > 0) {
    // A window on most cells, some lit.
    if ((ctx.x + ctx.y * 3) % 4 !== 3) {
      const lit = g.next() < 0.45;
      p.rect(ox + 4, oy + 3, 8, 8, shade(f.wall, -0.55));
      p.rect(ox + 5, oy + 4, 6, 6, lit ? f.lit : f.glass);
      p.vline(ox + 8, oy + 4, oy + 9, shade(f.wall, -0.55)); p.hline(ox + 5, ox + 10, oy + 6, shade(f.wall, -0.55));
      if (lit) { p.set(ox + 5, oy + 4, shade(f.lit, 0.4)); } else { p.set(ox + 10, oy + 4, "#5e8a9c"); }
      p.hline(ox + 3, ox + 12, oy + 11, f.trim);
    }
  }
}

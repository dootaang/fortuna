import type { PropId } from "@fortuna/core";
import { Grain, Pix, shade } from "./pix.ts";

/**
 * 소품 그림. 소품마다 w×h칸 크기의 투명 버퍼에 그린다(투명한 곳은 바닥이 보인다).
 * 움직이는 소품은 frame 번호를 받아 장면마다 다르게 그린다.
 */
type Painter = (p: Pix, variant: number, frame: number) => void;

const GOLD = "#d4af37", GOLD_LIGHT = "#f1d98a", GOLD_DARK = "#8f6f15", INK = "#14100c", IVORY = "#f3ead2", EMERALD = "#155a43";

function shadow(p: Pix, x: number, y: number, w: number): void { p.rect(x, y, w, 2, "#00000040"); }

const station: Painter = (p) => {
  const stone = "#d8c9a8", stoneDark = "#b9a986", W = p.w;
  // Wings.
  p.box(0, 22, W, 58, stone, "#e6d9bb", stoneDark);
  p.rect(0, 18, W, 5, GOLD); p.hline(0, W - 1, 18, GOLD_LIGHT); p.hline(0, W - 1, 22, GOLD_DARK);
  for (const x of [8, 30, 140, 162]) {
    p.rect(x, 30, 18, 34, "#7a6a4a");
    p.rect(x + 2, 32, 14, 30, EMERALD);
    for (let i = 0; i < 7; i += 1) p.hline(x + 2 + i, x + 15 - i, 32 + i - 7 + 7, i < 3 ? EMERALD : EMERALD);
    p.rect(x + 2, 32, 14, 3, "#1d6b51");
    p.vline(x + 8, 32, 61, GOLD_DARK); p.hline(x + 2, x + 15, 46, GOLD_DARK);
    p.set(x + 4, 36, "#3fae7a"); p.set(x + 5, 37, "#3fae7a");
    p.hline(x - 1, x + 18, 64, GOLD); p.hline(x - 1, x + 18, 29, GOLD_DARK);
  }
  // Center tower, stepped like a deco crown.
  p.box(78, 0, 36, 10, stone); p.box(70, 6, 52, 12, stone); p.box(62, 14, 68, 66, stone, "#e6d9bb", stoneDark);
  p.rect(84, 0, 24, 2, GOLD); p.rect(76, 6, 40, 2, GOLD); p.rect(68, 14, 56, 2, GOLD);
  for (const x of [64, 127]) { p.rect(x, 16, 2, 64, GOLD); p.vline(x, 16, 79, GOLD_LIGHT); }
  // Clock.
  p.disc(96, 26, 10, GOLD_DARK); p.disc(96, 26, 9, GOLD); p.disc(96, 26, 7, IVORY);
  for (let i = 0; i < 12; i += 1) { const a = (i / 12) * Math.PI * 2; p.set(96 + Math.round(Math.cos(a) * 6), 26 + Math.round(Math.sin(a) * 6), "#6b5a3a"); }
  p.line(96, 26, 96, 21, INK); p.line(96, 26, 100, 27, INK); p.set(96, 26, "#c4473a");
  // Name plate (text is drawn over it by the map label).
  p.rect(70, 42, 52, 13, INK); p.frame(70, 42, 52, 13, GOLD); p.frame(71, 43, 50, 11, GOLD_DARK);
  // Entrance arch opening onto the platform.
  p.rect(80, 58, 32, 22, "#2a1d17");
  for (let i = 0; i < 6; i += 1) p.hline(80 + 6 - i, 111 - 6 + i, 58 + i - 6 + 6, "#2a1d17");
  p.rect(82, 60, 28, 20, "#3b2a1c");
  p.rect(84, 62, 24, 18, "#f1d98a40");
  p.hline(80, 111, 57, GOLD); p.vline(79, 57, 79, GOLD); p.vline(112, 57, 79, GOLD);
  p.rect(84, 76, 24, 4, "#5a4632");
  shadow(p, 0, 78, 80); shadow(p, 112, 78, 80);
};

const fountain: Painter = (p, _v, frame) => {
  const cx = 32, cy = 34;
  p.ellipse(cx, cy + 2, 31, 28, "#00000033");
  p.disc(cx, cy, 30, "#8f826a"); p.disc(cx, cy, 29, "#c9b994"); p.disc(cx, cy, 26, "#a39470");
  p.disc(cx, cy, 25, "#2f6f8f");
  // Ripples move outward with the frame.
  for (let r = 6; r < 25; r += 6) {
    const rr = ((r + frame * 0.75) % 24) + 3;
    for (let a = 0; a < 40; a += 1) {
      if ((a + frame) % 3 === 0) continue;
      const t = (a / 40) * Math.PI * 2;
      p.set(cx + Math.round(Math.cos(t) * rr), cy + Math.round(Math.sin(t) * rr * 0.9), "#5aa0bf");
    }
  }
  p.set(cx - 14 + (frame % 4), cy - 8, "#d8f0f8"); p.set(cx + 10 - (frame % 3), cy + 12, "#d8f0f8");
  // Pedestal and the golden roulette wheel that names the square.
  p.disc(cx, cy + 4, 7, "#8f826a"); p.disc(cx, cy + 3, 6, "#c9b994");
  const wy = cy - 8;
  p.disc(cx, wy, 13, GOLD_DARK); p.disc(cx, wy, 12, GOLD);
  const pockets = 16;
  for (let i = 0; i < pockets; i += 1) {
    const a0 = (i / pockets) * Math.PI * 2 + frame * (Math.PI / 32);
    const color = i === 0 ? "#155a43" : i % 2 ? "#c4473a" : INK;
    for (let r = 8; r <= 11; r += 1) for (let s = 0; s < 4; s += 1) {
      const a = a0 + (s / 4) * ((Math.PI * 2) / pockets);
      p.set(cx + Math.round(Math.cos(a) * r), wy + Math.round(Math.sin(a) * r), color);
    }
  }
  p.disc(cx, wy, 7, GOLD_DARK); p.disc(cx, wy, 6, GOLD);
  for (let i = 0; i < 4; i += 1) { const a = (i / 4) * Math.PI * 2 + frame * (Math.PI / 32); p.line(cx, wy, cx + Math.round(Math.cos(a) * 6), wy + Math.round(Math.sin(a) * 6), GOLD_DARK); }
  p.disc(cx, wy, 2, GOLD_LIGHT);
  p.set(cx - 4, wy - 10, GOLD_LIGHT); p.set(cx - 5, wy - 9, GOLD_LIGHT);
};

const lamp: Painter = (p, _v, frame) => {
  // Bottom tile: post.
  p.rect(6, 30, 4, 2, "#00000040");
  p.rect(5, 28, 6, 3, "#2b2f3a"); p.rect(7, 12, 2, 17, "#2b2f3a"); p.vline(7, 12, 28, "#4a5060");
  // Top tile: lantern head with a warm glow.
  const glow = frame ? "#f1d98a" : "#ffe7a3";
  if (frame === 0) { p.disc(8, 7, 6, "#f1d98a22"); }
  p.rect(4, 3, 8, 2, "#2b2f3a"); p.rect(5, 5, 6, 6, glow); p.frame(4, 4, 8, 8, "#2b2f3a"); p.vline(8, 5, 10, "#b38f22");
  p.rect(6, 12, 4, 1, "#2b2f3a"); p.set(8, 1, GOLD); p.set(8, 2, "#2b2f3a");
};

const bench: Painter = (p) => {
  shadow(p, 2, 13, 28);
  for (const x of [3, 27]) p.rect(x, 9, 2, 5, "#2b2f3a");
  p.box(1, 3, 30, 3, "#8a5a32"); p.box(1, 8, 30, 3, "#8a5a32");
  p.hline(1, 30, 6, "#5e3c20");
};

const kiosk: Painter = (p) => {
  shadow(p, 1, 30, 30);
  p.box(2, 12, 28, 18, "#3a2a1e");
  p.rect(4, 14, 24, 9, "#e6dcc4");
  for (let i = 0; i < 6; i += 1) p.rect(5 + i * 4, 15 + (i % 2), 3, 7, i % 2 ? "#d6c7a3" : "#f3ead2");
  p.hline(5, 26, 17, "#6b5a3a"); p.hline(5, 26, 19, "#6b5a3a");
  for (let x = 0; x < 32; x += 4) p.rect(x, 4, 4, 8, (x / 4) % 2 ? IVORY : EMERALD);
  p.hline(0, 31, 4, GOLD); p.hline(0, 31, 11, "#0b3326");
  for (let x = 1; x < 32; x += 4) p.set(x, 12, (x / 4) % 2 ? EMERALD : IVORY);
  p.rect(10, 0, 12, 4, INK); p.frame(10, 0, 12, 4, GOLD);
};

const planter: Painter = (p, v) => {
  shadow(p, 2, 14, 12);
  p.box(2, 8, 12, 7, "#b9a986");
  p.rect(3, 4, 10, 5, "#3f6a30");
  const g = new Grain(17 + v);
  for (let i = 0; i < 7; i += 1) p.set(3 + g.int(10), 3 + g.int(5), g.pick(["#c4473a", "#e8d46a", "#f3ead2", "#e88aa0"]));
};

const barrier: Painter = (p) => {
  shadow(p, 2, 14, 28);
  for (const x of [4, 26]) { p.line(x - 2, 14, x, 6, "#3a3a40"); p.line(x + 2, 14, x, 6, "#3a3a40"); }
  p.rect(1, 4, 30, 5, IVORY);
  for (let x = 0; x < 30; x += 6) for (let i = 0; i < 3; i += 1) p.vline(1 + x + i, 4, 8, "#c4473a");
  p.frame(1, 4, 30, 5, "#5a1f1a");
  p.disc(28, 2, 1, "#ffb347");
};

const ticketGate: Painter = (p) => {
  for (const x of [0, 48]) {
    shadow(p, x + 2, 14, 12);
    p.box(x + 2, 2, 12, 12, "#8f6f15", GOLD_LIGHT, "#5a4512");
    p.rect(x + 4, 4, 8, 3, INK); p.set(x + 6, 5, "#3fae7a"); p.set(x + 9, 5, "#c4473a");
    p.hline(x + 3, x + 12, 9, GOLD);
  }
  p.hline(14, 49, 8, "#b38f2288");
};

const pillar: Painter = (p, v) => {
  p.rect(4, 30, 8, 2, "#00000040");
  p.box(4, 6, 8, 25, "#c9b994", "#ddd0b0", "#9c8c6c");
  for (const x of [6, 9]) p.vline(x, 8, 28, "#b0a07c");
  p.rect(2, 2, 12, 4, GOLD); p.hline(2, 13, 2, GOLD_LIGHT); p.rect(3, 28, 10, 3, "#b38f22");
  if (v === 1) { p.disc(8, 14, 5, GOLD); p.disc(8, 14, 4, IVORY); p.line(8, 14, 8, 11, INK); p.line(8, 14, 10, 15, INK); p.vline(8, 6, 9, "#2b2f3a"); }
};

const platformSign: Painter = (p) => {
  for (const x of [6, 56]) p.rect(x, 9, 2, 7, "#2b2f3a");
  p.rect(1, 1, 62, 10, "#0b3326"); p.frame(1, 1, 62, 10, GOLD); p.frame(2, 2, 60, 8, GOLD_DARK);
};

const crate: Painter = (p) => {
  shadow(p, 2, 14, 13);
  p.box(2, 3, 12, 11, "#a8743c", "#c28c50", "#6b4a2b");
  p.frame(2, 3, 12, 11, "#5e3c20"); p.line(3, 4, 12, 12, "#7a5230"); p.line(12, 4, 3, 12, "#7a5230");
};

const barrel: Painter = (p) => {
  shadow(p, 3, 14, 11);
  p.rect(4, 2, 8, 12, "#8a5a32"); p.rect(3, 4, 10, 8, "#8a5a32");
  p.vline(5, 3, 12, "#a06c3c"); p.vline(10, 3, 12, "#6b4426");
  for (const y of [4, 10]) p.hline(3, 12, y, "#3a3a40");
  p.ellipse(8, 2, 4, 1, "#6b4426");
};

const SHOP_COLORS = [
  { awning: ["#c4473a", IVORY], wall: "#5a2a22", neon: "#ff5e7a" },
  { awning: [EMERALD, GOLD_LIGHT], wall: "#4a2620", neon: "#5effc0" },
  { awning: ["#5b2a6e", GOLD], wall: "#3e1f24", neon: "#c08bff" },
];

const shop: Painter = (p, v, frame) => {
  const c = SHOP_COLORS[v % SHOP_COLORS.length]!;
  p.box(0, 0, 64, 64, c.wall, shade(c.wall, 0.15), shade(c.wall, -0.4));
  // Sign board (the name is a map label).
  p.rect(6, 2, 52, 12, INK); p.frame(6, 2, 52, 12, GOLD); p.frame(7, 3, 50, 10, GOLD_DARK);
  // Awning.
  for (let x = 0; x < 64; x += 6) p.rect(x, 18, 6, 10, c.awning[(x / 6) % 2]!);
  for (let x = 0; x < 64; x += 6) { p.set(x + 1, 28, c.awning[(x / 6) % 2]!); p.set(x + 2, 29, c.awning[(x / 6) % 2]!); p.set(x + 3, 28, c.awning[(x / 6) % 2]!); }
  p.hline(0, 63, 18, shade(c.awning[0]!, 0.3));
  // Display window with wares.
  p.rect(4, 32, 34, 24, "#2a1d17"); p.rect(6, 34, 30, 20, "#f1d98a55"); p.frame(4, 32, 34, 24, GOLD_DARK);
  const g = new Grain(99 + v);
  for (let i = 0; i < 5; i += 1) {
    const x = 8 + i * 6, y = 44 + g.int(4);
    if (v === 0) { p.disc(x + 2, y + 2, 2, GOLD); p.set(x + 2, y + 2, GOLD_LIGHT); }
    else if (v === 1) { p.box(x, y, 5, 5, IVORY); p.set(x + 1, y + 1, INK); p.set(x + 3, y + 3, INK); }
    else { p.box(x, y - 2, 4, 6, IVORY); p.set(x + 1, y, i % 2 ? "#c4473a" : INK); }
  }
  // Door.
  p.rect(44, 32, 14, 30, "#20161c"); p.frame(44, 32, 14, 30, GOLD_DARK); p.set(54, 47, GOLD);
  p.rect(42, 60, 18, 4, shade(c.wall, -0.5));
  // Neon suit sign beside the board, blinking.
  const on = frame === 0;
  const neon = on ? c.neon : shade(c.neon, -0.6);
  const s = v === 0 ? "♣" : v === 1 ? "♦" : "♠";
  const cx = 60, cy = 8;
  if (s === "♦") { for (let i = 0; i < 4; i += 1) { p.hline(cx - i, cx + i, cy - 3 + i, neon); p.hline(cx - i, cx + i, cy + 3 - i, neon); } }
  else { p.disc(cx, cy - 1, 2, neon); p.disc(cx - 2, cy + 1, 2, neon); p.disc(cx + 2, cy + 1, 2, neon); p.vline(cx, cy + 2, cy + 4, neon); }
  if (on) p.set(cx, cy - 4, "#ffffffaa");
};

const alley: Painter = (p, _v, frame) => {
  p.rect(0, 0, 32, 64, "#120c0e");
  for (let y = 0; y < 64; y += 4) { p.hline(0, 4, y, "#3a1a16"); p.hline(27, 31, y, "#3a1a16"); }
  p.rect(0, 0, 5, 64, "#4a2620"); p.rect(27, 0, 5, 64, "#4a2620");
  for (let y = 0; y < 64; y += 4) { p.hline(0, 4, y + 3, "#2c1512"); p.hline(27, 31, y + 3, "#2c1512"); }
  // Fading light deeper in.
  for (let y = 0; y < 50; y += 1) if (y % 2) p.hline(6, 25, y, "#1c1416");
  p.vline(16, 6, 12, "#2b2f3a");
  const lit = frame === 0 ? "#ff6a4a" : "#c94a33";
  p.rect(13, 12, 7, 8, lit); p.frame(13, 12, 7, 8, "#2b2f3a"); p.disc(16, 16, 8, frame === 0 ? "#ff6a4a1c" : "#ff6a4a10");
  p.box(6, 48, 9, 9, "#7a5230"); p.box(18, 52, 8, 7, "#6b4426"); p.box(8, 41, 7, 7, "#8a5a32");
  p.set(22, 34, IVORY); p.set(21, 35, IVORY); p.set(23, 35, IVORY); p.set(22, 36, IVORY); p.set(22, 37, IVORY);
  p.rect(5, 60, 22, 4, "#0b0809");
};

const house: Painter = (p, _v, frame) => {
  const W = p.w;
  p.rect(0, 10, W, 70, INK);
  for (let x = 0; x < W; x += 8) p.vline(x, 12, 79, "#1f1813");
  // Stepped crown.
  p.rect(36, 0, 72, 12, INK); p.rect(48, 0, 48, 3, GOLD); p.hline(36, 107, 11, GOLD); p.hline(0, W - 1, 11, GOLD);
  // Sign band (text is the map label "THE HOUSE").
  p.rect(30, 4, 84, 13, "#0b0809"); p.frame(30, 4, 84, 13, GOLD); p.frame(31, 5, 82, 11, GOLD_DARK);
  // Marquee bulbs chase around the sign.
  for (let i = 0; i < 44; i += 1) {
    const x = i < 22 ? 32 + i * 4 : 32 + (43 - i) * 4, y = i < 22 ? 2 : 19;
    p.set(x, y, (i + frame) % 4 === 0 ? "#fff6c8" : (i + frame) % 2 ? GOLD : GOLD_DARK);
  }
  // Columns.
  for (const x of [8, 26, 112, 130]) { p.rect(x, 22, 6, 58, GOLD_DARK); p.vline(x + 1, 22, 79, GOLD); p.vline(x + 3, 22, 79, GOLD_LIGHT); p.rect(x - 1, 22, 8, 3, GOLD); }
  // Sunburst over the door.
  const cx = 72, cy = 64;
  for (let i = 0; i <= 12; i += 1) {
    const a = Math.PI + (i / 12) * Math.PI;
    p.line(cx, cy, cx + Math.round(Math.cos(a) * 34), cy + Math.round(Math.sin(a) * 34), i % 2 ? GOLD_DARK : GOLD);
  }
  p.disc(cx, cy, 20, INK);
  // Open golden doors onto a warm lobby.
  p.rect(48, 48, 48, 32, "#3a1810");
  p.rect(52, 50, 40, 30, "#f1d98a"); for (let y = 50; y < 80; y += 1) p.hline(52, 91, y, y < 60 ? "#f6e3a0" : y < 70 ? "#e9c870" : "#c4473a");
  p.rect(66, 62, 12, 18, "#7a1622"); p.vline(66, 62, 79, GOLD); p.vline(77, 62, 79, GOLD);
  p.box(44, 48, 8, 32, GOLD, GOLD_LIGHT, GOLD_DARK); p.box(92, 48, 8, 32, GOLD, GOLD_LIGHT, GOLD_DARK);
  p.hline(44, 99, 47, GOLD_LIGHT);
  // Windows with blinds.
  for (const x of [14, 116]) { p.rect(x - 2, 30, 14, 20, "#f1d98a"); for (let y = 31; y < 50; y += 3) p.hline(x - 2, x + 11, y, "#c79d3a"); p.frame(x - 3, 29, 16, 22, GOLD); }
};

const chandelier: Painter = (p, _v, frame) => {
  p.disc(16, 16, 15, frame ? "#f1d98a14" : "#f1d98a20");
  p.vline(16, 0, 6, GOLD_DARK);
  p.ellipse(16, 12, 10, 4, GOLD); p.ellipse(16, 12, 8, 2, GOLD_LIGHT);
  for (let i = 0; i < 7; i += 1) {
    const x = 8 + i * 2 + (i > 3 ? 1 : 0);
    p.vline(x, 14, 18 + (i % 3), "#e8f4ff");
    p.set(x, 19 + (i % 3), (i + frame) % 3 === 0 ? "#ffffff" : "#bfe3ff");
  }
  p.disc(16, 9, 3, GOLD); p.set(16, 8, "#ffffff");
};

const cardTable: Painter = (p, v) => {
  shadow(p, 2, 30, 44);
  p.ellipse(24, 15, 23, 13, GOLD_DARK); p.ellipse(24, 15, 22, 12, "#5a2d1d"); p.ellipse(24, 15, 19, 10, EMERALD); p.ellipse(24, 14, 17, 8, "#1d6b51");
  const g = new Grain(41 + v);
  for (let i = 0; i < 5; i += 1) { const x = 10 + i * 6, y = 10 + g.int(5); p.box(x, y, 4, 6, IVORY, "#ffffff", "#b9b2a4"); p.set(x + 1, y + 2, i % 2 ? "#c4473a" : INK); }
  for (const [x, y, c] of [[14, 20, "#c4473a"], [30, 19, INK], [34, 8, GOLD]] as const) { p.ellipse(x, y, 2, 1, c); p.ellipse(x, y - 1, 2, 1, shade(c, 0.3)); }
  for (const [x, y] of [[4, 4], [42, 4], [4, 26], [42, 26]]) { p.box(x!, y!, 5, 5, "#7a1622"); }
};

const rouletteTable: Painter = (p, _v, frame) => {
  shadow(p, 2, 30, 44);
  p.box(1, 3, 46, 26, "#5a2d1d"); p.rect(3, 5, 42, 22, EMERALD);
  p.disc(13, 16, 9, GOLD_DARK); p.disc(13, 16, 8, "#3a2416");
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2 + frame * (Math.PI / 4);
    p.line(13, 16, 13 + Math.round(Math.cos(a) * 7), 16 + Math.round(Math.sin(a) * 7), i % 2 ? "#c4473a" : INK);
  }
  p.disc(13, 16, 3, GOLD); p.set(13 + Math.round(Math.cos(-frame) * 6), 16 + Math.round(Math.sin(-frame) * 6), "#ffffff");
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 6; c += 1) p.rect(25 + c * 3, 9 + r * 5, 2, 4, (r + c) % 2 ? "#c4473a" : INK);
  p.frame(24, 8, 19, 16, IVORY);
};

const bar: Painter = (p) => {
  p.box(0, 2, 96, 13, "#5a2d1d", "#7a4028", "#3a1c12");
  p.rect(0, 2, 96, 3, "#8a5a32"); p.hline(0, 95, 2, GOLD_LIGHT);
  for (let x = 6; x < 96; x += 12) { p.rect(x, 8, 2, 5, GOLD_DARK); }
  for (const x of [10, 30, 52, 74]) { p.rect(x, 0, 3, 3, "#bfe3ff"); p.set(x + 1, 0, "#ffffff"); }
};

const cashier: Painter = (p) => {
  shadow(p, 1, 30, 62);
  p.box(0, 2, 64, 28, "#3a2416", "#5a3a22", "#24170f");
  p.rect(4, 4, 56, 16, "#f1d98a55");
  for (let x = 4; x < 60; x += 4) p.vline(x, 4, 19, GOLD);
  p.hline(2, 61, 4, GOLD_LIGHT); p.hline(2, 61, 20, GOLD);
  p.rect(24, 12, 16, 8, "#0b0809"); p.frame(24, 12, 16, 8, GOLD);
  for (let i = 0; i < 6; i += 1) p.disc(8 + i * 3, 25, 1, GOLD_LIGHT);
};

const palm: Painter = (p) => {
  p.rect(4, 30, 8, 2, "#00000040");
  p.box(4, 22, 8, 9, GOLD, GOLD_LIGHT, GOLD_DARK);
  p.vline(8, 10, 22, "#6b4a2b");
  for (const [dx, dy] of [[-7, -3], [7, -3], [-6, 3], [6, 3], [0, -7]]) p.line(8, 10, 8 + dx!, 10 + dy!, "#3f7a3a");
  for (const [dx, dy] of [[-5, -2], [5, -2], [-4, 2], [4, 2]]) p.line(8, 11, 8 + dx!, 11 + dy!, "#5f9447");
};

const portrait: Painter = (p, v) => {
  const hue = ["#3a2a4a", "#2a3a4a", "#4a2a2a", "#2a4a3a"][v % 4]!;
  p.rect(2, 2, 12, 11, GOLD); p.frame(2, 2, 12, 11, GOLD_DARK);
  p.rect(4, 4, 8, 7, hue);
  p.disc(8, 7, 2, "#1a1410"); p.rect(6, 9, 5, 2, "#1a1410");
};

const BOOTH_COLORS = ["#2a5a56", "#4a3a6a", "#6a4a24", "#2a3f5a"];
const booth: Painter = (p, v) => {
  const wall = BOOTH_COLORS[v % 4]!;
  p.box(0, 0, 64, 64, wall);
  p.rect(6, 2, 52, 12, INK); p.frame(6, 2, 52, 12, GOLD); p.frame(7, 3, 50, 10, GOLD_DARK);
  p.rect(6, 20, 52, 26, "#f1d98a44"); p.frame(6, 20, 52, 26, GOLD);
  for (let x = 10; x < 58; x += 5) p.vline(x, 20, 34, GOLD_DARK);
  p.rect(6, 34, 52, 4, "#2a1d17"); p.hline(6, 57, 34, GOLD);
  for (let i = 0; i < 8; i += 1) p.disc(14 + i * 5, 41, 1, i % 3 ? GOLD : GOLD_LIGHT);
  p.box(4, 46, 56, 10, "#3a2416");
  p.rect(26, 50, 12, 14, "#1a1410");
  p.rect(0, 60, 64, 4, shade(wall, -0.5));
};

const priceBoard: Painter = (p, _v, frame) => {
  p.rect(0, 0, 64, 64, "#0b0809"); p.frame(0, 0, 64, 64, GOLD); p.frame(2, 2, 60, 60, GOLD_DARK);
  p.rect(4, 4, 56, 9, "#1a1410"); p.hline(4, 59, 13, GOLD_DARK);
  for (let i = 0; i < 7; i += 1) p.rect(7 + i * 7, 6, 5, 5, (i + frame) % 7 === 0 ? GOLD_LIGHT : GOLD_DARK);
  const g = new Grain(5 + frame);
  for (let row = 0; row < 6; row += 1) {
    const y = 17 + row * 7, up = g.next() < 0.55;
    p.rect(6, y, 10, 4, "#2a2a2a"); for (let i = 0; i < 3; i += 1) p.rect(7 + i * 3, y + 1, 2, 2, "#e6c564");
    for (let d = 0; d < 6; d += 1) if (g.next() < 0.8) p.rect(20 + d * 4, y, 3, 4, up ? "#4fc08d" : "#e06a5c");
    p.set(48, y + (up ? 0 : 3), up ? "#4fc08d" : "#e06a5c"); p.hline(47, 49, y + (up ? 1 : 2), up ? "#4fc08d" : "#e06a5c");
  }
  for (const x of [10, 52]) p.rect(x, 58, 3, 6, "#2b2f3a");
};

const STALL = [["#c4473a", IVORY], [EMERALD, GOLD_LIGHT], ["#3f6fd6", IVORY], ["#d4af37", "#7a1622"]] as const;
const stall: Painter = (p, v) => {
  const [a, b] = STALL[v % 4]!;
  shadow(p, 2, 30, 44);
  for (const x of [3, 43]) p.rect(x, 8, 2, 22, "#5a3b22");
  for (let x = 0; x < 48; x += 6) p.rect(x, 2, 6, 8, (x / 6) % 2 ? a : b);
  p.hline(0, 47, 2, shade(a, 0.3)); for (let x = 0; x < 48; x += 6) p.set(x + 3, 10, (x / 6) % 2 ? a : b);
  p.box(2, 18, 44, 10, "#8a5a32");
  const g = new Grain(70 + v);
  for (let i = 0; i < 9; i += 1) { const x = 5 + i * 4 + g.int(2), y = 15 + g.int(2); p.disc(x, y, 1, g.pick(["#e8d46a", "#c4473a", "#7ab648", GOLD, "#e88aa0"])); }
};

const TENT = ["#8a6a46", "#6b8a6a", "#9a5a4a", "#5a6a8a"];
const tent: Painter = (p, v) => {
  const c = TENT[v % 4]!;
  shadow(p, 1, 29, 30);
  for (let y = 0; y < 26; y += 1) { const half = Math.floor(y * 0.6) + 2; p.hline(16 - half, 15 + half, 3 + y, y % 5 === 0 ? shade(c, -0.15) : c); }
  for (let y = 0; y < 26; y += 1) { const half = Math.floor(y * 0.6) + 2; p.set(16 - half, 3 + y, shade(c, 0.2)); p.set(15 + half, 3 + y, shade(c, -0.3)); }
  for (let y = 12; y < 29; y += 1) { const half = Math.floor((y - 12) * 0.35) + 1; p.hline(16 - half, 15 + half, y, "#1a1410"); }
  p.vline(16, 0, 4, "#5a3b22"); p.rect(4 + v * 3, 16, 5, 4, shade(c, 0.25));
};

const shack: Painter = (p, v) => {
  shadow(p, 1, 46, 46);
  p.box(2, 16, 44, 30, v ? "#6b4a2b" : "#7a5838");
  for (let x = 4; x < 46; x += 5) p.vline(x, 17, 44, shade(v ? "#6b4a2b" : "#7a5838", -0.25));
  for (let y = 2; y < 18; y += 1) { p.hline(0, 47, y, (y % 3) ? "#8a8f99" : "#6a6f78"); }
  p.hline(0, 47, 2, "#c9ced6"); p.rect(8, 6, 8, 4, "#a05a3a"); p.rect(30, 9, 6, 3, "#5f6470");
  p.rect(18, 30, 10, 16, "#2a1d17"); p.set(26, 38, GOLD);
  p.rect(34, 24, 8, 7, "#f1d98a"); p.frame(33, 23, 10, 9, "#3a2416"); p.vline(37, 24, 30, "#3a2416");
};

const campfire: Painter = (p, _v, frame) => {
  p.disc(8, 11, 7, "#ff8a3c18");
  for (let i = 0; i < 8; i += 1) { const a = (i / 8) * Math.PI * 2; p.disc(8 + Math.round(Math.cos(a) * 5), 11 + Math.round(Math.sin(a) * 3), 1, "#7d7870"); }
  p.line(4, 12, 12, 10, "#5a3b22"); p.line(4, 10, 12, 12, "#6b4426");
  const h = [6, 8, 7, 9][frame]!;
  for (let y = 0; y < h; y += 1) { const half = Math.max(0, Math.round((h - y) / 2.4)); p.hline(8 - half, 8 + half, 11 - y, y < 2 ? "#c4473a" : y < h - 2 ? "#ff8a3c" : "#ffd36a"); }
  p.set(8 + (frame % 2 ? 1 : -1), 11 - h - 1, "#ffd36a");
};

const log: Painter = (p) => {
  shadow(p, 2, 13, 12);
  p.box(2, 7, 12, 6, "#6b4426"); p.ellipse(13, 10, 1, 3, "#a87c48"); p.set(13, 10, "#6b4426");
};

const laundry: Painter = (p, _v, frame) => {
  for (const x of [1, 46]) p.rect(x, 0, 2, 8, "#5a3b22");
  for (let x = 2; x < 46; x += 1) p.set(x, 2 + Math.round(Math.sin((x / 46) * Math.PI) * 2), "#d6c7a3");
  const cloths = [["#c4473a", 6], [IVORY, 16], ["#3f6fd6", 26], ["#e8d46a", 36]] as const;
  for (const [color, x] of cloths) {
    const sway = frame ? 1 : 0, y = 4 + Math.round(Math.sin(((x + 3) / 46) * Math.PI) * 2);
    p.rect(x + sway, y, 7, 8, color); p.hline(x + sway, x + sway + 6, y + 8, shade(color, -0.3)); p.hline(x, x + 6, y, shade(color, 0.3));
  }
};

const pump: Painter = (p) => {
  p.rect(4, 30, 8, 2, "#00000040");
  p.box(5, 18, 6, 13, "#3a3f4b", "#5a6070", "#23262e");
  p.line(11, 19, 14, 15, "#3a3f4b"); p.rect(3, 22, 3, 2, "#3a3f4b");
  p.box(2, 26, 5, 5, "#8a5a32"); p.rect(3, 26, 3, 1, "#5aa0bf");
  p.set(8, 16, "#5a6070"); p.set(8, 17, "#5a6070");
};

export const PAINTERS: Record<PropId, Painter> = {
  station, fountain, lamp, bench, kiosk, planter, barrier, ticketGate, pillar, platformSign, crate, barrel,
  shop, alley, house, chandelier, cardTable, rouletteTable, bar, cashier, palm, portrait, booth, priceBoard, stall,
  tent, shack, campfire, log, laundry, pump,
};

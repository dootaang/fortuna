/**
 * 도트 그림 붓. 32비트 픽셀 버퍼 위에 사각형·선·원을 찍고, 마지막에 캔버스로 옮긴다.
 * 지도 타일과 캐릭터는 전부 이 붓으로 코드에서 그린다(그림 파일 없음).
 */
export type Color = number;

const cache = new Map<string, Color>();

/** "#rrggbb" or "#rrggbbaa" → packed little-endian RGBA. */
export function hex(value: string): Color {
  let color = cache.get(value);
  if (color === undefined) {
    const v = value.replace("#", ""), r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
    const a = v.length >= 8 ? parseInt(v.slice(6, 8), 16) : 255;
    color = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    cache.set(value, color);
  }
  return color;
}

/** Lighten (amount > 0) or darken (< 0) a color, -1..1. */
export function shade(color: string, amount: number): string {
  const v = color.replace("#", "");
  const channel = (i: number) => {
    const c = parseInt(v.slice(i, i + 2), 16);
    const out = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(out))).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(2)}${channel(4)}${v.slice(6)}`;
}

/** Deterministic little random source for texture (not game randomness). */
export class Grain {
  private state: number;
  constructor(seed: number) { this.state = (seed >>> 0) || 0x9e3779b9; }
  next(): number { let x = this.state; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.state = x >>> 0; return this.state / 0x1_0000_0000; }
  int(n: number): number { return Math.floor(this.next() * n); }
  pick<T>(items: readonly T[]): T { return items[this.int(items.length)]!; }
}

export function seedOf(...parts: (string | number)[]): number {
  let hash = 0x811c9dc5;
  const text = parts.join(":");
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
}

export class Pix {
  readonly data: Uint32Array;
  constructor(readonly w: number, readonly h: number) { this.data = new Uint32Array(w * h); }

  set(x: number, y: number, color: string | Color): void {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const c = typeof color === "string" ? hex(color) : color;
    const alpha = c >>> 24;
    if (alpha === 255) { this.data[y * this.w + x] = c; return; }
    if (alpha === 0) return;
    // Blend over what is there (used for glows and shadows).
    const under = this.data[y * this.w + x]!, a = alpha / 255;
    const mix = (shift: number) => Math.round(((c >>> shift) & 255) * a + ((under >>> shift) & 255) * (1 - a));
    const outA = Math.max(under >>> 24, alpha);
    this.data[y * this.w + x] = ((outA << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0;
  }
  get(x: number, y: number): Color { return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.data[y * this.w + x]!; }
  clear(x: number, y: number): void { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = 0; }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) this.set(x + i, y + j, color);
  }
  hline(x1: number, x2: number, y: number, color: string): void { for (let x = x1; x <= x2; x += 1) this.set(x, y, color); }
  vline(x: number, y1: number, y2: number, color: string): void { for (let y = y1; y <= y2; y += 1) this.set(x, y, color); }
  frame(x: number, y: number, w: number, h: number, color: string): void {
    this.hline(x, x + w - 1, y, color); this.hline(x, x + w - 1, y + h - 1, color);
    this.vline(x, y, y + h - 1, color); this.vline(x + w - 1, y, y + h - 1, color);
  }
  /** Filled box with a lit top-left and shaded bottom-right edge. */
  box(x: number, y: number, w: number, h: number, fill: string, light = shade(fill, 0.22), dark = shade(fill, -0.3)): void {
    this.rect(x, y, w, h, fill);
    this.hline(x, x + w - 1, y, light); this.vline(x, y, y + h - 1, light);
    this.hline(x, x + w - 1, y + h - 1, dark); this.vline(x + w - 1, y, y + h - 1, dark);
  }
  disc(cx: number, cy: number, r: number, color: string): void {
    for (let y = -r; y <= r; y += 1) for (let x = -r; x <= r; x += 1) if (x * x + y * y <= r * r + r * 0.6) this.set(cx + x, cy + y, color);
  }
  ring(cx: number, cy: number, r: number, color: string): void {
    for (let y = -r; y <= r; y += 1) for (let x = -r; x <= r; x += 1) {
      const d = x * x + y * y;
      if (d <= r * r + r * 0.6 && d > (r - 1) * (r - 1) + (r - 1) * 0.6) this.set(cx + x, cy + y, color);
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, color: string): void {
    for (let y = -ry; y <= ry; y += 1) for (let x = -rx; x <= rx; x += 1) if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1.05) this.set(cx + x, cy + y, color);
  }
  line(x0: number, y0: number, x1: number, y1: number, color: string): void {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, x = x0, y = y0;
    for (let guard = 0; guard < 512; guard += 1) {
      this.set(x, y, color);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }
  /** Scatter single pixels of `colors` over a box with the given density. */
  speckle(x: number, y: number, w: number, h: number, colors: readonly string[], density: number, grain: Grain): void {
    for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) if (grain.next() < density) this.set(x + i, y + j, grain.pick(colors));
  }
  /** Paint `src` at (dx, dy), skipping transparent pixels; optionally mirrored. */
  blit(src: Pix, dx: number, dy: number, mirror = false): void {
    for (let y = 0; y < src.h; y += 1) for (let x = 0; x < src.w; x += 1) {
      const c = src.data[y * src.w + (mirror ? src.w - 1 - x : x)]!;
      if (c >>> 24) this.set(dx + x, dy + y, c);
    }
  }
  /** Dark rim around every opaque shape (the classic sprite outline). */
  outline(color: string): void {
    const c = hex(color), copy = this.data.slice();
    for (let y = 0; y < this.h; y += 1) for (let x = 0; x < this.w; x += 1) {
      if (copy[y * this.w + x]! >>> 24) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const nx = x + dx!, ny = y + dy!;
        return nx >= 0 && ny >= 0 && nx < this.w && ny < this.h && (copy[ny * this.w + nx]! >>> 24) === 255;
      });
      if (near) this.data[y * this.w + x] = c;
    }
  }

  toCanvas(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = this.w; canvas.height = this.h;
    const context = canvas.getContext("2d")!;
    const image = context.createImageData(this.w, this.h);
    new Uint32Array(image.data.buffer).set(this.data);
    context.putImageData(image, 0, 0);
    return canvas;
  }
}

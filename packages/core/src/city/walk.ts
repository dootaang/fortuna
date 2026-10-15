import { XorShift32, fnv1a32 } from "../rng.ts";
import type { Grid } from "./types.ts";

/**
 * 걷기. 저장되는 것은 { 출발 칸, 도착 칸, 출발 시각 } 한 번뿐이고, 경로는 모두의 화면이 같은 지도로
 * 똑같이 계산한다. 그래서 A*의 동점 처리까지 결정적이어야 한다. docs/SPEC-CITY-MAP.md 3-3절.
 */
export type Cell = readonly [number, number];
export type Facing = "down" | "up" | "left" | "right";

/** Tiles per second. */
export const WALK_SPEED = 5;

export function walkable(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height && grid.solid[y * grid.width + x] === 0;
}

const STEPS: readonly Cell[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** Shortest 4-way path from `from` to `to`, both included; null when unreachable. */
export function findPath(grid: Grid, from: Cell, to: Cell): Cell[] | null {
  const { width, height } = grid, start = from[1] * width + from[0], goal = to[1] * width + to[0];
  if (!walkable(grid, to[0], to[1])) return null;
  if (start === goal) return [from];
  const cost = new Int32Array(width * height).fill(-1), parent = new Int32Array(width * height).fill(-1);
  // Binary heap of [priority, order, cell]; `order` breaks ties the same way on every device.
  const heap: [number, number, number][] = [];
  let order = 0;
  const push = (entry: [number, number, number]) => {
    heap.push(entry);
    for (let i = heap.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (less(heap[up]!, heap[i]!)) break;
      [heap[up], heap[i]] = [heap[i]!, heap[up]!]; i = up;
    }
  };
  const pop = () => {
    const top = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l]!, heap[m]!)) m = l;
        if (r < heap.length && less(heap[r]!, heap[m]!)) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!]; i = m;
      }
    }
    return top;
  };
  const h = (cell: number) => Math.abs((cell % width) - to[0]) + Math.abs(Math.floor(cell / width) - to[1]);
  cost[start] = 0;
  push([h(start), order++, start]);
  while (heap.length) {
    const [, , cell] = pop();
    if (cell === goal) break;
    const cx = cell % width, cy = Math.floor(cell / width);
    for (const [dx, dy] of STEPS) {
      const nx = cx + dx, ny = cy + dy;
      if (!walkable(grid, nx, ny)) continue;
      const next = ny * width + nx, nextCost = cost[cell]! + 1;
      if (cost[next] !== -1 && cost[next]! <= nextCost) continue;
      cost[next] = nextCost; parent[next] = cell;
      push([nextCost + h(next), order++, next]);
    }
  }
  if (cost[goal] === -1) return null;
  const path: Cell[] = [];
  for (let cell = goal; cell !== -1; cell = parent[cell]!) path.push([cell % width, Math.floor(cell / width)]);
  return path.reverse();
}

function less(a: readonly [number, number, number], b: readonly [number, number, number]): boolean { return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]); }

/**
 * Where to actually walk when the tapped cell is a wall or out of reach: the reachable walkable
 * cell nearest to it (ties go to the one closer to `from`). Returns `from` when nothing is reachable.
 */
export function resolveTarget(grid: Grid, from: Cell, tapped: Cell): Cell {
  if (findPath(grid, from, tapped)) return tapped;
  const reach = new Int32Array(grid.width * grid.height).fill(-1), queue = [from[1] * grid.width + from[0]];
  reach[queue[0]!] = 0;
  for (let head = 0; head < queue.length; head += 1) {
    const cell = queue[head]!, cx = cell % grid.width, cy = Math.floor(cell / grid.width);
    for (const [dx, dy] of STEPS) {
      const nx = cx + dx, ny = cy + dy, next = ny * grid.width + nx;
      if (!walkable(grid, nx, ny) || reach[next] !== -1) continue;
      reach[next] = reach[cell]! + 1; queue.push(next);
    }
  }
  let best: Cell = from, bestScore = Infinity;
  for (const cell of queue) {
    const x = cell % grid.width, y = Math.floor(cell / grid.width);
    const score = (Math.abs(x - tapped[0]) + Math.abs(y - tapped[1])) * 1000 + reach[cell]!;
    if (score < bestScore) { bestScore = score; best = [x, y]; }
  }
  return best;
}

export interface WalkPose { x: number; y: number; cell: Cell; facing: Facing; moving: boolean; step: number; arrived: boolean; /** The cell being walked into (the end cell once arrived). */ heading: Cell; }

const pathCache = new Map<string, Cell[] | null>();
function cachedPath(grid: Grid, key: string, from: Cell, to: Cell): Cell[] | null {
  if (!pathCache.has(key)) {
    if (pathCache.size > 500) pathCache.clear();
    pathCache.set(key, findPath(grid, from, to));
  }
  return pathCache.get(key) ?? null;
}

function facingOf(dx: number, dy: number, fallback: Facing): Facing {
  if (dx > 0) return "right";
  if (dx < 0) return "left";
  if (dy < 0) return "up";
  if (dy > 0) return "down";
  return fallback;
}

/** Position `elapsedMs` after leaving `from` for `to` (tile units, float). */
export function walkPose(grid: Grid, placeKey: string, from: Cell, to: Cell, elapsedMs: number, rest: Facing = "down"): WalkPose {
  const path = cachedPath(grid, `${placeKey}:${from[0]},${from[1]}>${to[0]},${to[1]}`, from, to) ?? [from];
  const travelled = Math.max(0, (elapsedMs / 1000) * WALK_SPEED), last = path.length - 1;
  if (travelled >= last) {
    const end = path[last]!, before = path[last - 1] ?? end;
    return { x: end[0], y: end[1], cell: end, facing: last ? facingOf(end[0] - before[0], end[1] - before[1], rest) : rest, moving: false, step: 0, arrived: true, heading: end };
  }
  const index = Math.floor(travelled), t = travelled - index, a = path[index]!, b = path[index + 1]!;
  return {
    x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, cell: t < 0.5 ? a : b,
    facing: facingOf(b[0] - a[0], b[1] - a[1], rest), moving: true, step: Math.floor(travelled * 2) % 4, arrived: false, heading: b,
  };
}

// ── 봉인된 주사위 ── 결과는 메시지 id와 서버 시각에서만 정해진다(도박판과 같은 봉인 방식).

export interface DiceExpr { count: number; sides: number; bonus: number; }

export function parseDice(text: string): DiceExpr | null {
  const match = /^(\d{1,2})d(\d{1,3})([+-]\d{1,3})?$/i.exec(text.trim());
  if (!match) return null;
  const count = Number(match[1]), sides = Number(match[2]), bonus = Number(match[3] ?? 0);
  if (count < 1 || count > 20 || sides < 2 || sides > 100) return null;
  return { count, sides, bonus };
}

export function rollDice(expr: DiceExpr, messageId: string, serverMs: number): { faces: number[]; total: number } {
  const rng = new XorShift32(fnv1a32(`dice:${messageId}:${serverMs}`));
  const faces = Array.from({ length: expr.count }, () => rng.die(expr.sides));
  return { faces, total: faces.reduce((sum, face) => sum + face, 0) + expr.bonus };
}

export function diceText(expr: DiceExpr): string { return `${expr.count}d${expr.sides}${expr.bonus ? (expr.bonus > 0 ? `+${expr.bonus}` : `${expr.bonus}`) : ""}`; }

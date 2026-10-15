import { WALK_SPEED, findPath, walkable, type Cell, type Facing, type Grid, type PlaceId } from "@fortuna/core";

/**
 * 내 캐릭터의 걸음은 이 기기에서 바로 재생한다. 서버 시각을 기다리지 않으므로 누르는 순간 움직이고,
 * 걷는 도중에 방향을 바꿔도 지금 있는 자리(칸 사이)에서 그대로 이어진다.
 * 서버에는 { 출발 칸, 도착 칸 }만 쓰고, 다른 사람 화면은 그것으로 같은 길을 재생한다.
 */
export interface LocalWalk {
  place: PlaceId;
  /** Polyline in tile units; the first point may sit between cells. */
  points: [number, number][];
  /** performance.now() when walking began. */
  start: number;
  target: Cell;
  rest: Facing;
}

export interface LocalPose { x: number; y: number; facing: Facing; moving: boolean; step: number; arrived: boolean; cell: Cell; heading: Cell; }

function facingOf(dx: number, dy: number, fallback: Facing): Facing {
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? "right" : "left";
  if (dy !== 0) return dy > 0 ? "down" : "up";
  return fallback;
}

export function localPose(walk: LocalWalk, now: number): LocalPose {
  let left = Math.max(0, ((now - walk.start) / 1000) * WALK_SPEED);
  const travelled = left;
  const points = walk.points;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, ay] = points[i]!, [bx, by] = points[i + 1]!;
    const length = Math.hypot(bx - ax, by - ay);
    if (left < length) {
      const t = length ? left / length : 1, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      return {
        x, y, facing: facingOf(bx - ax, by - ay, walk.rest), moving: true, step: Math.floor(travelled * 2) % 4, arrived: false,
        cell: [Math.round(x), Math.round(y)], heading: [Math.round(bx), Math.round(by)],
      };
    }
    left -= length;
  }
  const [ex, ey] = points.at(-1)!;
  const before = points.at(-2);
  const facing = before ? facingOf(ex - before[0], ey - before[1], walk.rest) : walk.rest;
  return { x: ex, y: ey, facing, moving: false, step: 0, arrived: true, cell: [Math.round(ex), Math.round(ey)], heading: [Math.round(ex), Math.round(ey)] };
}

/**
 * A new walk from wherever the character is now. Returns null when there is nowhere to go.
 * `from` is the cell written to the server: the one the character is heading into.
 */
export function startWalk(grid: Grid, place: PlaceId, pose: { x: number; y: number; heading: Cell; facing: Facing }, target: Cell, now: number): { walk: LocalWalk; from: Cell } | null {
  const from = pose.heading;
  const path = findPath(grid, from, target);
  if (!path) return null;
  const points: [number, number][] = [[pose.x, pose.y]];
  for (const [x, y] of path) if (x !== points.at(-1)![0] || y !== points.at(-1)![1]) points.push([x, y]);
  return { walk: { place, points, start: now, target, rest: pose.facing }, from };
}

/** The last walkable cell going straight from `from` in a direction (keyboard walking). */
export function straightTarget(grid: Grid, from: Cell, dx: number, dy: number): Cell {
  let [x, y] = from;
  for (let i = 0; i < 60 && walkable(grid, x + dx, y + dy); i += 1) { x += dx; y += dy; }
  return [x, y];
}

/** By physical key (event.code), so WASD works on a Korean keyboard layout too. */
export const KEY_DIRECTIONS: Readonly<Record<string, Cell>> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
};

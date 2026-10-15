import { describe, expect, it } from "vitest";
import {
  GROUND, PLACES, PLACE_IDS, PROPS, buildGrid, diceText, findPath, gridOf, mapSize, normalizeSprite, parseDice, resolveTarget, rollDice, walkPose, walkable,
  type PlaceId,
} from "../src/index.ts";

describe("city maps", () => {
  for (const id of PLACE_IDS) {
    const place = PLACES[id];
    it(`${id} is well formed`, () => {
      const { width, height } = mapSize(place);
      for (const [index, row] of place.ground.entries()) {
        expect(row.length, `${id} row ${index}`).toBe(width);
        for (const char of row) expect(char in GROUND, `${id} row ${index} '${char}'`).toBe(true);
      }
      for (const [prop, x, y] of place.props) {
        const def = PROPS[prop];
        expect(x >= 0 && y >= 0 && x + def.w <= width && y + def.h <= height, `${id} ${prop} at ${x},${y}`).toBe(true);
      }
      const grid = gridOf(id);
      expect(walkable(grid, ...place.spawn), `${id} spawn`).toBe(true);
      for (const exit of place.exits) {
        expect(walkable(grid, exit.x, exit.y), `${id} exit ${exit.x},${exit.y}`).toBe(true);
        expect(findPath(grid, place.spawn, [exit.x, exit.y]), `${id} reach exit ${exit.x},${exit.y}`).not.toBeNull();
        const target = PLACES[exit.to], targetGrid = gridOf(exit.to);
        expect(walkable(targetGrid, ...exit.at), `${id} → ${exit.to} ${exit.at}`).toBe(true);
        expect(target.exits.some((back) => back.x === exit.at[0] && back.y === exit.at[1]), `${id} → ${exit.to} lands on an exit`).toBe(false);
      }
      expect(height).toBeGreaterThan(5);
    });
  }

  it("connects every place to the plaza", () => {
    const seen = new Set<PlaceId>(["wheel-plaza"]), queue: PlaceId[] = ["wheel-plaza"];
    while (queue.length) for (const exit of PLACES[queue.shift()!].exits) if (!seen.has(exit.to)) { seen.add(exit.to); queue.push(exit.to); }
    expect([...seen].sort()).toEqual([...PLACE_IDS].sort());
  });
});

describe("walking", () => {
  const grid = buildGrid({ ...PLACES["wheel-plaza"], props: [["fountain", 13, 9]] });
  it("finds the same shortest path every time and walks around obstacles", () => {
    const a = findPath(grid, [12, 10], [17, 10]), b = findPath(grid, [12, 10], [17, 10]);
    expect(a).toEqual(b);
    expect(a!.length - 1).toBe(9); // around the 4×4 fountain
    expect(a!.every(([x, y]) => walkable(grid, x, y))).toBe(true);
    expect(findPath(grid, [12, 10], [14, 10])).toBeNull();
  });

  it("walks to the nearest reachable cell when a wall is tapped", () => {
    expect(resolveTarget(grid, [12, 10], [14, 10])).toEqual([12, 10]); // already as close as it gets
    const target = resolveTarget(grid, [5, 5], [14, 10]);
    expect(walkable(grid, ...target)).toBe(true);
    expect(Math.abs(target[0] - 14) + Math.abs(target[1] - 10)).toBe(2);
  });

  it("interpolates the walk over time", () => {
    const start = walkPose(grid, "p", [5, 5], [8, 5], 0);
    expect(start).toMatchObject({ x: 5, y: 5, moving: true, facing: "right" });
    expect(walkPose(grid, "p", [5, 5], [8, 5], 300).x).toBeCloseTo(6.5);
    expect(walkPose(grid, "p", [5, 5], [8, 5], 5_000)).toMatchObject({ x: 8, y: 5, moving: false, arrived: true });
  });
});

describe("dice and sprites", () => {
  it("parses and rolls sealed dice", () => {
    expect(parseDice("2d6+1")).toEqual({ count: 2, sides: 6, bonus: 1 });
    expect(parseDice("2D6")).toEqual({ count: 2, sides: 6, bonus: 0 });
    expect(parseDice("0d6")).toBeNull();
    expect(parseDice("2d6+x")).toBeNull();
    expect(diceText({ count: 1, sides: 20, bonus: -2 })).toBe("1d20-2");
    const roll = rollDice({ count: 3, sides: 6, bonus: 2 }, "abc", 1_700_000_000_000);
    expect(rollDice({ count: 3, sides: 6, bonus: 2 }, "abc", 1_700_000_000_000)).toEqual(roll);
    expect(roll.faces.every((face) => face >= 1 && face <= 6)).toBe(true);
    expect(roll.total).toBe(roll.faces.reduce((a, b) => a + b, 0) + 2);
  });

  it("normalizes sprite choices", () => {
    expect(normalizeSprite({ skin: 3, hair: 99, outfit: 2.5 })).toMatchObject({ skin: 3, hair: 0, outfit: 0 });
  });
});

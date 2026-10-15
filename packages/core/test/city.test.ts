import { describe, expect, it } from "vitest";
import { LINES, LINE_IDS, PLACE_IDS, STATIONS, diceText, normalizeSprite, parseDice, rollDice, stationsOf } from "../src/index.ts";

describe("line map", () => {
  it("has every station on exactly one line, inside the map box", () => {
    const seen = new Set<string>();
    for (const line of LINE_IDS) for (const station of stationsOf(line)) {
      expect(seen.has(station.id)).toBe(false);
      seen.add(station.id);
      expect(station.x).toBeGreaterThan(40); expect(station.x).toBeLessThan(960);
      expect(station.y).toBeGreaterThan(40); expect(station.y).toBeLessThan(960);
      expect(station.sense.length).toBeGreaterThan(8);
    }
    expect([...seen].sort()).toEqual([...PLACE_IDS].sort());
    expect(STATIONS["wheel-plaza"]).toMatchObject({ x: 500, y: 500, outer: true });
  });

  it("keeps stations apart so names do not collide", () => {
    const all = PLACE_IDS.map((id) => STATIONS[id]);
    for (const a of all) for (const b of all) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.id}/${b.id}`).toBeGreaterThan(55);
  });

  it("gives each district line one outer stop and its colors", () => {
    for (const line of LINE_IDS) {
      expect(stationsOf(line).filter((station) => station.outer)).toHaveLength(1);
      expect(LINES[line].dark).toMatch(/^#[0-9a-f]{6}$/);
    }
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

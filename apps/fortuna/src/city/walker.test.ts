import { describe, expect, it } from "vitest";
import { gridOf } from "@fortuna/core";
import { localPose, startWalk, straightTarget } from "./walker.ts";

describe("local walker", () => {
  const grid = gridOf("wheel-plaza");

  it("re-routes mid-step from exactly where the character stands", () => {
    const first = startWalk(grid, "wheel-plaza", { x: 3, y: 6, heading: [3, 6], facing: "down" }, [10, 6], 0)!;
    const mid = localPose(first.walk, 330); // 1.65 tiles along
    expect(mid.x).toBeCloseTo(4.65);
    expect(mid.heading).toEqual([5, 6]);
    const second = startWalk(grid, "wheel-plaza", mid, [3, 6], 330)!;
    const resumed = localPose(second.walk, 330);
    expect(resumed.x).toBeCloseTo(mid.x);
    expect(resumed.y).toBeCloseTo(mid.y);
    expect(second.from).toEqual([5, 6]);
    // A frame later it has moved only a frame's worth.
    const later = localPose(second.walk, 346);
    expect(Math.abs(later.x - mid.x)).toBeLessThan(0.1);
    expect(localPose(second.walk, 5_000)).toMatchObject({ x: 3, y: 6, arrived: true, moving: false });
  });

  it("walks straight until something blocks the way", () => {
    expect(straightTarget(grid, [3, 6], 1, 0)).toEqual([28, 6]);
    expect(straightTarget(grid, [12, 8], 0, 1)).toEqual([12, 19]);
  });
});

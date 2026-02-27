import { describe, expect, it } from "vitest";
import { ensureVisibleBounds } from "../src/main/window-state.js";

describe("window state visibility", () => {
  const primaryDisplay = { x: 0, y: 0, width: 1920, height: 1080 };
  const secondaryDisplay = { x: 1920, y: 0, width: 1920, height: 1080 };

  it("keeps bounds that intersect a visible display", () => {
    const bounds = { x: 2000, y: 100, width: 800, height: 600 };

    expect(ensureVisibleBounds(bounds, [primaryDisplay, secondaryDisplay])).toEqual(bounds);
  });

  it("moves off-screen bounds onto the primary display", () => {
    const bounds = { x: 2000, y: 100, width: 800, height: 600 };

    expect(ensureVisibleBounds(bounds, [primaryDisplay])).toEqual({ ...bounds, x: 1120, y: 100 });
  });

  it("clamps negative coordinates onto the primary display", () => {
    const bounds = { x: -2500, y: -100, width: 800, height: 600 };

    expect(ensureVisibleBounds(bounds, [primaryDisplay])).toEqual({ ...bounds, x: 0, y: 0 });
  });
});

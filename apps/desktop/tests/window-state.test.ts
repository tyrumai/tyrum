import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureWindowState,
  ensureVisibleBounds,
  loadWindowState,
  saveWindowState,
} from "../src/main/window-state.js";

describe("window state visibility", () => {
  const primaryDisplay = { x: 0, y: 0, width: 1920, height: 1080 };
  const secondaryDisplay = { x: 1920, y: 0, width: 1920, height: 1080 };

  it("returns bounds unchanged when no display work areas are provided", () => {
    const bounds = { x: 2000, y: 100, width: 800, height: 600 };

    expect(ensureVisibleBounds(bounds, [])).toEqual(bounds);
  });

  it("keeps bounds that intersect a visible display", () => {
    const bounds = { x: 2000, y: 100, width: 800, height: 600 };

    expect(ensureVisibleBounds(bounds, [primaryDisplay, secondaryDisplay])).toEqual(bounds);
  });

  it("moves off-screen bounds onto the primary display", () => {
    const bounds = { x: 2000, y: 100, width: 800, height: 600 };

    expect(ensureVisibleBounds(bounds, [primaryDisplay])).toEqual({ ...bounds, x: 1120, y: 100 });
  });

  it("clamps window dimensions to the primary display when relocating", () => {
    const bounds = { x: 3000, y: 100, width: 3000, height: 2000 };

    expect(ensureVisibleBounds(bounds, [primaryDisplay])).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  it("clamps negative coordinates onto the primary display", () => {
    const bounds = { x: -2500, y: -100, width: 800, height: 600 };

    expect(ensureVisibleBounds(bounds, [primaryDisplay])).toEqual({ ...bounds, x: 0, y: 0 });
  });

  it("clamps bounds onto a primary display with a non-zero origin", () => {
    const bounds = { x: 2000, y: 100, width: 800, height: 600 };
    const primary = { x: -1920, y: 0, width: 1920, height: 1080 };

    expect(ensureVisibleBounds(bounds, [primary])).toEqual({ ...bounds, x: -800, y: 100 });
  });

  it("returns bounds unchanged when primary work area is missing", () => {
    const bounds = { x: 2000, y: 100, width: 800, height: 600 };
    const holes = new Array(1) as unknown as Array<typeof bounds>;

    expect(ensureVisibleBounds(bounds, holes)).toEqual(bounds);
  });
});

describe("window state capture", () => {
  it("captures normal bounds when a window is minimized", () => {
    const getBounds = vi.fn(() => ({ x: -32000, y: -32000, width: 800, height: 600 }));
    const getNormalBounds = vi.fn(() => ({ x: 100, y: 120, width: 900, height: 700 }));

    const window = {
      isMaximized: vi.fn(() => false),
      getBounds,
      getNormalBounds,
    };

    expect(captureWindowState(window as never)).toEqual({
      bounds: { x: 100, y: 120, width: 900, height: 700 },
      isMaximized: false,
    });
    expect(getNormalBounds).toHaveBeenCalledTimes(1);
    expect(getBounds).not.toHaveBeenCalled();
  });
});

describe("window state persistence", () => {
  it("loads and saves valid window state JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "tyrum-window-state-"));

    try {
      const state = {
        bounds: { x: 10, y: 20, width: 800, height: 600 },
        isMaximized: false,
      };

      expect(loadWindowState(dir)).toBeNull();
      saveWindowState(dir, state);

      const loaded = loadWindowState(dir);
      expect(loaded).toEqual(state);

      const raw = readFileSync(join(dir, "window-state.json"), "utf-8");
      expect(raw.endsWith("\n")).toBe(true);
      expect(JSON.parse(raw)).toEqual(state);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when window state JSON is invalid", () => {
    const dir = mkdtempSync(join(tmpdir(), "tyrum-window-state-"));
    try {
      writeFileSync(join(dir, "window-state.json"), "{ this is not json }");
      expect(loadWindowState(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when window state JSON shape is invalid", () => {
    const dir = mkdtempSync(join(tmpdir(), "tyrum-window-state-"));
    try {
      writeFileSync(join(dir, "window-state.json"), JSON.stringify([]));
      expect(loadWindowState(dir)).toBeNull();

      writeFileSync(
        join(dir, "window-state.json"),
        JSON.stringify({ bounds: { x: 0, y: 0, width: 0, height: 0 }, isMaximized: false }),
      );
      expect(loadWindowState(dir)).toBeNull();

      writeFileSync(
        join(dir, "window-state.json"),
        JSON.stringify({ bounds: { x: 0, y: 0, width: 100, height: 100 }, isMaximized: "nope" }),
      );
      expect(loadWindowState(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

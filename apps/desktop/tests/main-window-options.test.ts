import { describe, expect, it } from "vitest";
import { MAIN_WINDOW_OPTIONS } from "../src/main/window-options.js";

describe("main window defaults", () => {
  it("starts with a comfortable desktop size", () => {
    expect(MAIN_WINDOW_OPTIONS.width).toBe(1280);
    expect(MAIN_WINDOW_OPTIONS.height).toBe(860);
    expect(MAIN_WINDOW_OPTIONS.minWidth).toBe(1100);
    expect(MAIN_WINDOW_OPTIONS.minHeight).toBe(760);
  });

  it("starts hidden to avoid startup flashes", () => {
    expect(MAIN_WINDOW_OPTIONS.show).toBe(false);
  });

  it("uses a background color that matches the initial renderer theme", () => {
    expect(MAIN_WINDOW_OPTIONS.backgroundColor).toBe("#000000");
  });
});

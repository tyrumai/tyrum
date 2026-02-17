import { describe, expect, it } from "vitest";

describe("NutJsDesktopBackend", () => {
  it("can be constructed without throwing", async () => {
    const { NutJsDesktopBackend } = await import(
      "../src/main/providers/backends/nutjs-desktop-backend.js"
    );
    const backend = new NutJsDesktopBackend();
    expect(backend).toBeDefined();
  });

  it("pressKey rejects unknown key names", async () => {
    const { NutJsDesktopBackend } = await import(
      "../src/main/providers/backends/nutjs-desktop-backend.js"
    );
    const backend = new NutJsDesktopBackend();
    await expect(backend.pressKey("NonExistentKey")).rejects.toThrow(
      /Unknown key: "NonExistentKey"/,
    );
  });

  // Integration tests that require a display server. Skipped in headless CI.
  const hasDisplay =
    !!process.env["DISPLAY"] ||
    process.platform === "darwin" ||
    process.platform === "win32";

  it.skipIf(!hasDisplay)("captureScreen returns a PNG buffer", async () => {
    const { NutJsDesktopBackend } = await import(
      "../src/main/providers/backends/nutjs-desktop-backend.js"
    );
    const backend = new NutJsDesktopBackend();
    const capture = await backend.captureScreen("primary");

    expect(capture.width).toBeGreaterThan(0);
    expect(capture.height).toBeGreaterThan(0);
    expect(capture.buffer.length).toBeGreaterThan(0);

    // Verify PNG magic bytes: \x89PNG
    expect(capture.buffer[0]).toBe(0x89);
    expect(capture.buffer[1]).toBe(0x50); // P
    expect(capture.buffer[2]).toBe(0x4e); // N
    expect(capture.buffer[3]).toBe(0x47); // G
  });
});

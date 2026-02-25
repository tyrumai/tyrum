import { describe, expect, it } from "vitest";
import {
  DesktopScreenshotArgs,
  DesktopMouseArgs,
  DesktopKeyboardArgs,
  DesktopActionArgs,
} from "../src/index.js";

describe("DesktopScreenshotArgs", () => {
  it("parses with primary display", () => {
    const parsed = DesktopScreenshotArgs.parse({
      op: "screenshot",
      display: "primary",
    });
    expect(parsed.op).toBe("screenshot");
    expect(parsed.display).toBe("primary");
    expect(parsed.format).toBe("png");
    expect(parsed.max_width).toBeUndefined();
  });

  it("parses with all displays", () => {
    const parsed = DesktopScreenshotArgs.parse({
      op: "screenshot",
      display: "all",
      format: "jpeg",
    });
    expect(parsed.display).toBe("all");
    expect(parsed.format).toBe("jpeg");
  });

  it("parses with display id object", () => {
    const parsed = DesktopScreenshotArgs.parse({
      op: "screenshot",
      display: { id: "monitor-2" },
    });
    expect(parsed.display).toEqual({ id: "monitor-2" });
  });

  it("applies default format of png", () => {
    const parsed = DesktopScreenshotArgs.parse({
      op: "screenshot",
      display: "primary",
    });
    expect(parsed.format).toBe("png");
  });

  it("accepts optional max_width", () => {
    const parsed = DesktopScreenshotArgs.parse({
      op: "screenshot",
      display: "primary",
      max_width: 1920,
    });
    expect(parsed.max_width).toBe(1920);
  });

  it("rejects missing display", () => {
    expect(() => DesktopScreenshotArgs.parse({ op: "screenshot" })).toThrow();
  });

  it("rejects invalid display value", () => {
    expect(() => DesktopScreenshotArgs.parse({ op: "screenshot", display: "secondary" })).toThrow();
  });

  it("rejects non-positive max_width", () => {
    expect(() =>
      DesktopScreenshotArgs.parse({
        op: "screenshot",
        display: "primary",
        max_width: 0,
      }),
    ).toThrow();
  });

  it("rejects non-integer max_width", () => {
    expect(() =>
      DesktopScreenshotArgs.parse({
        op: "screenshot",
        display: "primary",
        max_width: 1920.5,
      }),
    ).toThrow();
  });

  it("round-trips through JSON serialization", () => {
    const input = {
      op: "screenshot" as const,
      display: { id: "hdmi-1" },
      format: "jpeg" as const,
      max_width: 1280,
    };
    const parsed = DesktopScreenshotArgs.parse(input);
    const json = JSON.parse(JSON.stringify(parsed));
    const restored = DesktopScreenshotArgs.parse(json);
    expect(restored).toEqual(parsed);
  });
});

describe("DesktopMouseArgs", () => {
  it("parses click action with coordinates", () => {
    const parsed = DesktopMouseArgs.parse({
      op: "mouse",
      action: "click",
      x: 100,
      y: 200,
    });
    expect(parsed.op).toBe("mouse");
    expect(parsed.action).toBe("click");
    expect(parsed.x).toBe(100);
    expect(parsed.y).toBe(200);
    expect(parsed.button).toBeUndefined();
    expect(parsed.duration_ms).toBeUndefined();
  });

  it("parses move action", () => {
    const parsed = DesktopMouseArgs.parse({
      op: "mouse",
      action: "move",
      x: 50,
      y: 75,
    });
    expect(parsed.action).toBe("move");
  });

  it("parses drag action with duration", () => {
    const parsed = DesktopMouseArgs.parse({
      op: "mouse",
      action: "drag",
      x: 300,
      y: 400,
      duration_ms: 500,
    });
    expect(parsed.action).toBe("drag");
    expect(parsed.duration_ms).toBe(500);
  });

  it("accepts optional button", () => {
    const parsed = DesktopMouseArgs.parse({
      op: "mouse",
      action: "click",
      x: 10,
      y: 20,
      button: "right",
    });
    expect(parsed.button).toBe("right");
  });

  it("accepts middle button", () => {
    const parsed = DesktopMouseArgs.parse({
      op: "mouse",
      action: "click",
      x: 10,
      y: 20,
      button: "middle",
    });
    expect(parsed.button).toBe("middle");
  });

  it("rejects missing x coordinate", () => {
    expect(() => DesktopMouseArgs.parse({ op: "mouse", action: "click", y: 100 })).toThrow();
  });

  it("rejects missing y coordinate", () => {
    expect(() => DesktopMouseArgs.parse({ op: "mouse", action: "click", x: 100 })).toThrow();
  });

  it("rejects invalid action", () => {
    expect(() =>
      DesktopMouseArgs.parse({
        op: "mouse",
        action: "scroll",
        x: 0,
        y: 0,
      }),
    ).toThrow();
  });

  it("rejects negative duration_ms", () => {
    expect(() =>
      DesktopMouseArgs.parse({
        op: "mouse",
        action: "drag",
        x: 0,
        y: 0,
        duration_ms: -1,
      }),
    ).toThrow();
  });

  it("accepts zero duration_ms", () => {
    const parsed = DesktopMouseArgs.parse({
      op: "mouse",
      action: "drag",
      x: 0,
      y: 0,
      duration_ms: 0,
    });
    expect(parsed.duration_ms).toBe(0);
  });

  it("round-trips through JSON serialization", () => {
    const input = {
      op: "mouse" as const,
      action: "click" as const,
      x: 512,
      y: 384,
      button: "left" as const,
      duration_ms: 100,
    };
    const parsed = DesktopMouseArgs.parse(input);
    const json = JSON.parse(JSON.stringify(parsed));
    const restored = DesktopMouseArgs.parse(json);
    expect(restored).toEqual(parsed);
  });
});

describe("DesktopKeyboardArgs", () => {
  it("parses type action with text", () => {
    const parsed = DesktopKeyboardArgs.parse({
      op: "keyboard",
      action: "type",
      text: "hello world",
    });
    expect(parsed.op).toBe("keyboard");
    expect(parsed.action).toBe("type");
    expect(parsed.text).toBe("hello world");
    expect(parsed.key).toBeUndefined();
  });

  it("parses press action with key", () => {
    const parsed = DesktopKeyboardArgs.parse({
      op: "keyboard",
      action: "press",
      key: "Enter",
    });
    expect(parsed.action).toBe("press");
    expect(parsed.key).toBe("Enter");
    expect(parsed.text).toBeUndefined();
  });

  it("accepts both text and key", () => {
    const parsed = DesktopKeyboardArgs.parse({
      op: "keyboard",
      action: "type",
      text: "a",
      key: "KeyA",
    });
    expect(parsed.text).toBe("a");
    expect(parsed.key).toBe("KeyA");
  });

  it("accepts type action without text (both optional)", () => {
    const parsed = DesktopKeyboardArgs.parse({
      op: "keyboard",
      action: "type",
    });
    expect(parsed.text).toBeUndefined();
    expect(parsed.key).toBeUndefined();
  });

  it("rejects invalid action", () => {
    expect(() =>
      DesktopKeyboardArgs.parse({
        op: "keyboard",
        action: "hold",
        key: "Shift",
      }),
    ).toThrow();
  });

  it("round-trips through JSON serialization", () => {
    const input = {
      op: "keyboard" as const,
      action: "press" as const,
      key: "Escape",
    };
    const parsed = DesktopKeyboardArgs.parse(input);
    const json = JSON.parse(JSON.stringify(parsed));
    const restored = DesktopKeyboardArgs.parse(json);
    expect(restored).toEqual(parsed);
  });
});

describe("DesktopActionArgs (discriminated union)", () => {
  it("dispatches screenshot op correctly", () => {
    const parsed = DesktopActionArgs.parse({
      op: "screenshot",
      display: "primary",
    });
    expect(parsed.op).toBe("screenshot");
  });

  it("dispatches mouse op correctly", () => {
    const parsed = DesktopActionArgs.parse({
      op: "mouse",
      action: "click",
      x: 100,
      y: 200,
    });
    expect(parsed.op).toBe("mouse");
  });

  it("dispatches keyboard op correctly", () => {
    const parsed = DesktopActionArgs.parse({
      op: "keyboard",
      action: "press",
      key: "Tab",
    });
    expect(parsed.op).toBe("keyboard");
  });

  it("rejects unknown op", () => {
    expect(() => DesktopActionArgs.parse({ op: "network", url: "https://example.com" })).toThrow();
  });

  it("rejects missing op", () => {
    expect(() => DesktopActionArgs.parse({ action: "click", x: 0, y: 0 })).toThrow();
  });

  it("validates fields for the selected op variant", () => {
    // Mouse op must have x and y, even via the union
    expect(() => DesktopActionArgs.parse({ op: "mouse", action: "click" })).toThrow();
  });

  it("narrows type correctly for screenshot", () => {
    const parsed = DesktopActionArgs.parse({
      op: "screenshot",
      display: "all",
      format: "jpeg",
      max_width: 800,
    });
    if (parsed.op === "screenshot") {
      expect(parsed.display).toBe("all");
      expect(parsed.format).toBe("jpeg");
      expect(parsed.max_width).toBe(800);
    }
  });

  it("narrows type correctly for mouse", () => {
    const parsed = DesktopActionArgs.parse({
      op: "mouse",
      action: "drag",
      x: 10,
      y: 20,
      button: "left",
      duration_ms: 250,
    });
    if (parsed.op === "mouse") {
      expect(parsed.action).toBe("drag");
      expect(parsed.x).toBe(10);
      expect(parsed.y).toBe(20);
      expect(parsed.button).toBe("left");
      expect(parsed.duration_ms).toBe(250);
    }
  });

  it("narrows type correctly for keyboard", () => {
    const parsed = DesktopActionArgs.parse({
      op: "keyboard",
      action: "type",
      text: "Hello",
    });
    if (parsed.op === "keyboard") {
      expect(parsed.action).toBe("type");
      expect(parsed.text).toBe("Hello");
    }
  });
});

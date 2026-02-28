import { describe, expect, it, vi } from "vitest";
import type { ActionPrimitive } from "@tyrum/schemas";
import { resolvePermissions } from "../src/main/config/permissions.js";
import { DesktopProvider, type ConfirmationFn } from "../src/main/providers/desktop-provider.js";
import { MockDesktopBackend } from "../src/main/providers/backends/desktop-backend.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAction(args: Record<string, unknown>): ActionPrimitive {
  return { type: "Desktop", args };
}

function makeProvider(profile: "safe" | "balanced" | "poweruser", confirmFn?: ConfirmationFn) {
  const permissions = resolvePermissions(profile, {});
  const backend = new MockDesktopBackend();
  return new DesktopProvider(backend, permissions, confirmFn ?? vi.fn<ConfirmationFn>());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DesktopProvider", () => {
  // -- Safe profile ----------------------------------------------------------

  it("safe profile blocks mouse input", async () => {
    const provider = makeProvider("safe");
    const result = await provider.execute(
      makeAction({ op: "mouse", action: "click", x: 100, y: 200 }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("disabled by permission profile");
  });

  it("safe profile blocks keyboard input", async () => {
    const provider = makeProvider("safe");
    const result = await provider.execute(
      makeAction({ op: "keyboard", action: "type", text: "hello" }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("disabled by permission profile");
  });

  it("safe profile allows screenshot", async () => {
    const provider = makeProvider("safe");
    const result = await provider.execute(makeAction({ op: "screenshot", display: "primary" }));
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "screenshot",
      mime: "image/png",
    });
  });

  it("safe profile allows snapshot in pixel mode", async () => {
    const provider = makeProvider("safe");
    const result = await provider.execute(makeAction({ op: "snapshot" }));
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      op: "snapshot",
      backend: {
        mode: "pixel",
        permissions: {
          accessibility: false,
          screen_capture: true,
          input_control: false,
        },
      },
      windows: [],
    });
    expect(result.evidence).toMatchObject({
      type: "snapshot",
      mime: "image/png",
      width: 1920,
      height: 1080,
    });
  });

  it("safe profile allows query in pixel mode (returns screenshot + coordinate metadata)", async () => {
    const provider = makeProvider("safe");
    const result = await provider.execute(
      makeAction({
        op: "query",
        selector: { kind: "a11y", role: "button", name: "Save" },
      }),
    );
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ op: "query", matches: [] });
    expect(result.evidence).toMatchObject({
      type: "query",
      mime: "image/png",
      width: 1920,
      height: 1080,
      coordinate_space: {
        origin: "top-left",
        units: "px",
      },
    });
  });

  // -- Balanced profile (confirmation required) ------------------------------

  it("balanced profile requires confirmation for mouse action", async () => {
    const confirmFn = vi.fn<ConfirmationFn>().mockResolvedValue(true);
    const provider = makeProvider("balanced", confirmFn);
    const result = await provider.execute(
      makeAction({ op: "mouse", action: "click", x: 50, y: 75 }),
    );
    expect(confirmFn).toHaveBeenCalledOnce();
    expect(confirmFn).toHaveBeenCalledWith("Allow mouse click at (50, 75)?");
    expect(result.success).toBe(true);
  });

  it("balanced profile: confirmation denied returns error", async () => {
    const confirmFn = vi.fn<ConfirmationFn>().mockResolvedValue(false);
    const provider = makeProvider("balanced", confirmFn);
    const result = await provider.execute(
      makeAction({ op: "mouse", action: "move", x: 10, y: 20 }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("User denied mouse action");
  });

  it("balanced profile: keyboard confirmation denied returns error", async () => {
    const confirmFn = vi.fn<ConfirmationFn>().mockResolvedValue(false);
    const provider = makeProvider("balanced", confirmFn);
    const result = await provider.execute(
      makeAction({ op: "keyboard", action: "type", text: "secret" }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("User denied keyboard action");
  });

  it("balanced profile: keyboard confirmation approved succeeds", async () => {
    const confirmFn = vi.fn<ConfirmationFn>().mockResolvedValue(true);
    const provider = makeProvider("balanced", confirmFn);
    const result = await provider.execute(
      makeAction({ op: "keyboard", action: "type", text: "hello world" }),
    );
    expect(confirmFn).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "keyboard",
      action: "type",
      text: "hello world",
    });
  });

  // -- PowerUser profile (no confirmation) -----------------------------------

  it("poweruser skips confirmation for mouse action", async () => {
    const confirmFn = vi.fn<ConfirmationFn>();
    const provider = makeProvider("poweruser", confirmFn);
    const result = await provider.execute(
      makeAction({ op: "mouse", action: "click", x: 300, y: 400 }),
    );
    expect(confirmFn).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "mouse",
      action: "click",
      x: 300,
      y: 400,
    });
  });

  it("poweruser skips confirmation for keyboard action", async () => {
    const confirmFn = vi.fn<ConfirmationFn>();
    const provider = makeProvider("poweruser", confirmFn);
    const result = await provider.execute(
      makeAction({ op: "keyboard", action: "press", key: "Enter" }),
    );
    expect(confirmFn).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "keyboard",
      action: "press",
      key: "Enter",
    });
  });

  it("poweruser supports act(click) on a pixel ref", async () => {
    const permissions = resolvePermissions("poweruser", {});
    const backend = new MockDesktopBackend();
    const provider = new DesktopProvider(backend, permissions, vi.fn<ConfirmationFn>());

    const result = await provider.execute(
      makeAction({
        op: "act",
        target: { kind: "ref", ref: "pixel:10,20" },
        action: { kind: "click" },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      op: "act",
      target: { kind: "ref", ref: "pixel:10,20" },
      action: { kind: "click" },
      resolved_element_ref: "pixel:10,20",
    });
    expect(backend.calls).toContainEqual({ method: "clickMouse", args: [10, 20, undefined] });
  });

  it("poweruser accepts whitespace in pixel refs", async () => {
    const permissions = resolvePermissions("poweruser", {});
    const backend = new MockDesktopBackend();
    const provider = new DesktopProvider(backend, permissions, vi.fn<ConfirmationFn>());

    const result = await provider.execute(
      makeAction({
        op: "act",
        target: { kind: "ref", ref: "pixel:10, 20" },
        action: { kind: "click" },
      }),
    );

    expect(result.success).toBe(true);
    expect(backend.calls).toContainEqual({ method: "clickMouse", args: [10, 20, undefined] });
  });

  it("poweruser supports act(double_click) on a pixel ref", async () => {
    const permissions = resolvePermissions("poweruser", {});
    const backend = new MockDesktopBackend();
    const provider = new DesktopProvider(backend, permissions, vi.fn<ConfirmationFn>());

    const result = await provider.execute(
      makeAction({
        op: "act",
        target: { kind: "ref", ref: "pixel:10,20" },
        action: { kind: "double_click" },
      }),
    );

    expect(result.success).toBe(true);
    expect(backend.calls.filter((c) => c.method === "clickMouse")).toHaveLength(2);
  });

  it("poweruser supports act(right_click) on a pixel ref", async () => {
    const permissions = resolvePermissions("poweruser", {});
    const backend = new MockDesktopBackend();
    const provider = new DesktopProvider(backend, permissions, vi.fn<ConfirmationFn>());

    const result = await provider.execute(
      makeAction({
        op: "act",
        target: { kind: "ref", ref: "pixel:10,20" },
        action: { kind: "right_click" },
      }),
    );

    expect(result.success).toBe(true);
    expect(backend.calls).toContainEqual({ method: "clickMouse", args: [10, 20, "right"] });
  });

  it("poweruser supports wait_for with bounded sleep semantics", async () => {
    const permissions = resolvePermissions("poweruser", {});
    const backend = new MockDesktopBackend();
    const provider = new DesktopProvider(backend, permissions, vi.fn<ConfirmationFn>());

    const result = await provider.execute(
      makeAction({
        op: "wait_for",
        selector: { kind: "a11y", role: "dialog", name: "Settings" },
        state: "visible",
        timeout_ms: 0,
        poll_ms: 50,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      op: "wait_for",
      selector: { kind: "a11y", role: "dialog", name: "Settings", states: [] },
      state: "visible",
      status: "timeout",
    });
    expect((result.result as Record<string, unknown>)["elapsed_ms"]).toBeDefined();
    expect(backend.calls).toEqual([]);
  });

  // -- Argument validation ---------------------------------------------------

  it("invalid args rejected with parse error", async () => {
    const provider = makeProvider("poweruser");
    const result = await provider.execute(makeAction({ op: "unknown_op" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid desktop args");
  });

  it("missing required mouse fields rejected", async () => {
    const provider = makeProvider("poweruser");
    const result = await provider.execute(makeAction({ op: "mouse", action: "click" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid desktop args");
  });

  // -- Evidence contents -----------------------------------------------------

  it("keyboard type with text returns evidence containing text", async () => {
    const provider = makeProvider("poweruser");
    const result = await provider.execute(
      makeAction({ op: "keyboard", action: "type", text: "test input" }),
    );
    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect(evidence.type).toBe("keyboard");
    expect(evidence.action).toBe("type");
    expect(evidence.text).toBe("test input");
    expect(evidence.timestamp).toBeDefined();
  });

  it("mouse click with button returns evidence containing button info", async () => {
    const provider = makeProvider("poweruser");
    const result = await provider.execute(
      makeAction({
        op: "mouse",
        action: "click",
        x: 500,
        y: 600,
        button: "right",
      }),
    );
    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect(evidence.type).toBe("mouse");
    expect(evidence.action).toBe("click");
    expect(evidence.x).toBe(500);
    expect(evidence.y).toBe(600);
    expect(evidence.timestamp).toBeDefined();
  });

  it("screenshot evidence includes dimensions and mime type", async () => {
    const provider = makeProvider("poweruser");
    const result = await provider.execute(makeAction({ op: "screenshot", display: "primary" }));
    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect(evidence.type).toBe("screenshot");
    expect(evidence.mime).toBe("image/png");
    expect(evidence.width).toBe(1920);
    expect(evidence.height).toBe(1080);
    expect(evidence.timestamp).toBeDefined();
  });

  // -- Capability field ------------------------------------------------------

  it("capability field is 'desktop'", () => {
    const provider = makeProvider("safe");
    expect(provider.capability).toBe("desktop");
  });
});

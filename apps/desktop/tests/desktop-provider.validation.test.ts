import { describe, expect, it, vi } from "vitest";
import type { ActionPrimitive } from "@tyrum/contracts";
import { DesktopProvider, MockDesktopBackend, type ConfirmationFn } from "@tyrum/desktop-node";
import { resolvePermissions } from "../src/main/config/permissions.js";

function makeAction(args: Record<string, unknown>): ActionPrimitive {
  return { type: "Desktop", args };
}

function makeProvider(profile: "safe" | "balanced" | "poweruser") {
  return new DesktopProvider(
    new MockDesktopBackend(),
    resolvePermissions(profile, {}),
    vi.fn<ConfirmationFn>(),
  );
}

describe("DesktopProvider validation and evidence", () => {
  it("rejects invalid args with a parse error", async () => {
    const result = await makeProvider("poweruser").execute(makeAction({ op: "unknown_op" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid desktop args");
  });

  it("rejects mouse actions that omit required fields", async () => {
    const result = await makeProvider("poweruser").execute(
      makeAction({ op: "mouse", action: "click" }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid desktop args");
  });

  it("includes typed keyboard evidence for text input", async () => {
    const result = await makeProvider("poweruser").execute(
      makeAction({ op: "keyboard", action: "type", text: "test input" }),
    );

    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect(evidence.type).toBe("keyboard");
    expect(evidence.action).toBe("type");
    expect(evidence.text).toBe("test input");
    expect(evidence.timestamp).toBeDefined();
  });

  it("includes mouse coordinates in click evidence", async () => {
    const result = await makeProvider("poweruser").execute(
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

  it("includes dimensions and mime type in screenshot evidence", async () => {
    const result = await makeProvider("poweruser").execute(
      makeAction({ op: "screenshot", display: "primary" }),
    );

    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect(evidence.type).toBe("screenshot");
    expect(evidence.mime).toBe("image/png");
    expect(evidence.width).toBe(1920);
    expect(evidence.height).toBe(1080);
    expect(evidence.timestamp).toBeDefined();
  });

  it("retains the legacy desktop capability field", () => {
    expect(makeProvider("safe").capability).toBe("desktop");
  });
});

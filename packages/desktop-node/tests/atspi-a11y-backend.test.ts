import { describe, expect, it, vi } from "vitest";
import { DesktopQueryResult } from "@tyrum/schemas";
import { AtSpiDesktopA11yBackend } from "../src/providers/backends/atspi-a11y-backend.js";

describe("AtSpiDesktopA11yBackend", () => {
  it("does not treat the desktop frame as the focused window root", async () => {
    const backend = new AtSpiDesktopA11yBackend() as any;

    const focus = { busName: "app", objectPath: "/focus" };
    const windowFrame = { busName: "app", objectPath: "/frame" };
    const application = { busName: "app", objectPath: "/app" };
    const desktopFrame = { busName: "app", objectPath: "/desktop" };

    backend.getFocusedAccessible = vi.fn(async () => focus);
    backend.getParent = vi.fn(async (ref: { objectPath: string }) => {
      switch (ref.objectPath) {
        case "/focus":
          return windowFrame;
        case "/frame":
          return application;
        case "/app":
          return desktopFrame;
        default:
          return null;
      }
    });
    backend.describeAccessible = vi.fn(async (ref: { objectPath: string }) => ({
      elementRef: `atspi:app|${ref.objectPath}`,
      role:
        ref.objectPath === "/frame"
          ? "frame"
          : ref.objectPath === "/desktop"
            ? "desktop frame"
            : "application",
      name: "",
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      actions: [],
      states: [],
    }));

    const resolved = await backend.resolveRootAccessible();
    expect(resolved).toEqual(windowFrame);
  });

  it("caps GetChildAtIndex enumeration per call", async () => {
    const backend = new AtSpiDesktopA11yBackend() as any;

    const getChildAtIndex = vi.fn(async (i: number) => ["app", `/child/${String(i)}`]);
    const iface = {
      GetChildCount: vi.fn(async () => 20),
      GetChildAtIndex: getChildAtIndex,
    };

    backend.getInterface = vi.fn(async () => iface);

    const children = await backend.getChildren({ busName: "app", objectPath: "/root" }, 5);

    expect(getChildAtIndex).toHaveBeenCalledTimes(5);
    expect(children).toHaveLength(5);
  });

  it("caps GetChildren results per call", async () => {
    const backend = new AtSpiDesktopA11yBackend() as any;

    const iface = {
      GetChildren: vi.fn(async () =>
        Array.from({ length: 10 }, (_, i) => ["app", `/child/${String(i)}`]),
      ),
    };

    backend.getInterface = vi.fn(async () => iface);

    const children = await backend.getChildren({ busName: "app", objectPath: "/root" }, 3);

    expect(children).toHaveLength(3);
  });

  it("returns schema-compliant query(ref) matches", async () => {
    const backend = new AtSpiDesktopA11yBackend() as any;

    const accessible = {
      GetRoleName: vi.fn(async () => "x".repeat(100)),
      GetName: vi.fn(async () => "y".repeat(600)),
    };

    const component = {
      GetExtents: vi.fn(async () => [10, 20, 80, 24]),
    };

    const action = {
      GetNActions: vi.fn(async () => 40),
      GetName: vi.fn(async (i: number) => (i === 0 ? "click" : "a".repeat(100))),
      DoAction: vi.fn(async () => undefined),
    };

    backend.getInterface = vi.fn(async (_ref: unknown, name: string) => {
      if (name === "org.a11y.atspi.Accessible") return accessible;
      if (name === "org.a11y.atspi.Component") return component;
      if (name === "org.a11y.atspi.Action") return action;
      return null;
    });

    const matches = await backend.query({
      op: "query",
      selector: { kind: "ref", ref: "atspi:app|/node" },
      limit: 1,
    });

    const parsed = DesktopQueryResult.safeParse({ op: "query", matches });
    expect(parsed.success).toBe(true);
  });

  it("rejects right_click and double_click actions", async () => {
    const backend = new AtSpiDesktopA11yBackend() as any;

    backend.connect = vi.fn(async () => undefined);
    backend.getInterface = vi.fn(async (_ref: unknown, name: string) => {
      if (name !== "org.a11y.atspi.Action") return null;
      return {
        GetNActions: vi.fn(async () => 1),
        GetName: vi.fn(async () => "click"),
        DoAction: vi.fn(async () => undefined),
      };
    });

    await expect(
      backend.act({
        op: "act",
        target: { kind: "ref", ref: "atspi:app|/node" },
        action: { kind: "right_click" },
      }),
    ).rejects.toThrow(/right_click/);

    await expect(
      backend.act({
        op: "act",
        target: { kind: "ref", ref: "atspi:app|/node" },
        action: { kind: "double_click" },
      }),
    ).rejects.toThrow(/double_click/);
  });
});


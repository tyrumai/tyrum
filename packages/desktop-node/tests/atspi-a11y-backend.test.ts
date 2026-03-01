import { describe, expect, it, vi } from "vitest";
import { DesktopQueryResult } from "@tyrum/schemas";
import { AtSpiDesktopA11yBackend } from "../src/providers/backends/atspi-a11y-backend.js";
import { DEFAULT_A11Y_MAX_DEPTH } from "../src/providers/a11y/prune-ui-tree.js";

describe("AtSpiDesktopA11yBackend", () => {
  it("uses the AT-SPI root accessible as the snapshot/query root", async () => {
    const backend = new AtSpiDesktopA11yBackend() as any;
    backend.isAvailable = vi.fn(async () => true);

    const resolved = await backend.resolveRootAccessible();
    expect(resolved).toEqual({
      busName: "org.a11y.atspi.Registry",
      objectPath: "/org/a11y/atspi/accessible/root",
    });
  });

  it("isAvailable returns true when the root accessible provides a role name", async () => {
    const backend = new AtSpiDesktopA11yBackend() as any;

    const accessible = {
      GetRoleName: vi.fn(async () => "desktop frame"),
    };

    backend.connect = vi.fn(async () => undefined);
    backend.getInterface = vi.fn(async (_ref: unknown, name: string) => {
      if (name === "org.a11y.atspi.Accessible") return accessible;
      return null;
    });

    await expect(backend.isAvailable()).resolves.toBe(true);
    expect(accessible.GetRoleName).toHaveBeenCalledTimes(1);
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

  it("unwraps dbus-next Variant action names for click actions", async () => {
    const backend = new AtSpiDesktopA11yBackend() as any;

    const doAction = vi.fn(async () => undefined);
    backend.connect = vi.fn(async () => undefined);
    backend.getInterface = vi.fn(async (_ref: unknown, name: string) => {
      if (name !== "org.a11y.atspi.Action") return null;
      return {
        GetNActions: vi.fn(async () => 1n),
        GetName: vi.fn(async () => ({ value: "click" })),
        DoAction: doAction,
      };
    });

    await expect(
      backend.act({
        op: "act",
        target: { kind: "ref", ref: "atspi:app|/node" },
        action: { kind: "click" },
      }),
    ).resolves.toEqual({ resolved_element_ref: "atspi:app|/node" });
    expect(doAction).toHaveBeenCalledTimes(1);
    expect(doAction).toHaveBeenCalledWith(0);
  });

  it("falls back to DoAction(0) when click/activate action names are unavailable", async () => {
    const backend = new AtSpiDesktopA11yBackend() as any;

    const doAction = vi.fn(async () => undefined);
    backend.connect = vi.fn(async () => undefined);
    backend.getInterface = vi.fn(async (_ref: unknown, name: string) => {
      if (name !== "org.a11y.atspi.Action") return null;
      return {
        GetNActions: vi.fn(async () => 1n),
        GetName: vi.fn(async () => ({ value: "invoke" })),
        DoAction: doAction,
      };
    });

    await expect(
      backend.act({
        op: "act",
        target: { kind: "ref", ref: "atspi:app|/node" },
        action: { kind: "click" },
      }),
    ).resolves.toEqual({ resolved_element_ref: "atspi:app|/node" });
    expect(doAction).toHaveBeenCalledTimes(1);
    expect(doAction).toHaveBeenCalledWith(0);
  });

  it("matches state-filtered queries when GetState indicates focused", async () => {
    const backend = new AtSpiDesktopA11yBackend() as any;

    const rootRef = { busName: "app", objectPath: "/root" };
    backend.resolveRootAccessible = vi.fn(async () => rootRef);
    backend.getChildren = vi.fn(async () => []);

    const accessible = {
      GetRoleName: vi.fn(async () => "frame"),
      GetName: vi.fn(async () => "Root"),
      GetState: vi.fn(async () => [1 << 12, 0]),
    };

    backend.getInterface = vi.fn(async (_ref: unknown, name: string) => {
      if (name === "org.a11y.atspi.Accessible") return accessible;
      if (name === "org.a11y.atspi.Component") {
        return { GetExtents: vi.fn(async () => [0, 0, 100, 80]) };
      }
      return null;
    });

    const matches = await backend.query({
      op: "query",
      selector: { kind: "a11y", role: "frame", name: "Root", states: ["focused"] },
      limit: 1,
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      kind: "a11y",
      element_ref: "atspi:app|/root",
      node: { states: ["focused"] },
    });
    expect(accessible.GetState).toHaveBeenCalledTimes(1);
  });

  it("does not consume snapshot node budget on visited nodes", async () => {
    const backend = new AtSpiDesktopA11yBackend() as any;

    const rootRef = { busName: "app", objectPath: "/root" };
    backend.resolveRootAccessible = vi.fn(async () => rootRef);
    backend.getChildren = vi.fn(async (ref: { objectPath: string }, maxChildren: number) => {
      if (ref.objectPath === "/root") {
        return [
          { busName: "app", objectPath: "/a" },
          { busName: "app", objectPath: "/b" },
        ].slice(0, maxChildren);
      }
      if (ref.objectPath === "/a") {
        return [{ busName: "app", objectPath: "/a" }].slice(0, maxChildren);
      }
      return [];
    });
    backend.describeAccessible = vi.fn(async (ref: { busName: string; objectPath: string }) => ({
      elementRef: `atspi:${ref.busName}|${ref.objectPath}`,
      role: "frame",
      name: ref.objectPath,
      bounds: { x: 0, y: 0, width: 100, height: 80 },
      actions: [],
      states: [],
    }));

    const snapshot = await backend.snapshot({
      op: "snapshot",
      include_tree: true,
      max_nodes: 3,
      max_text_chars: 512,
    });

    expect(snapshot.tree.root.children.map((n: { name: string }) => n.name)).toEqual(["/a", "/b"]);
  });

  it("includes top-level frame nodes as windows in snapshot()", async () => {
    const backend = new AtSpiDesktopA11yBackend() as any;

    backend.resolveRootAccessible = vi.fn(async () => ({ busName: "app", objectPath: "/root" }));
    backend.getChildren = vi.fn(async (ref: { objectPath: string }) => {
      if (ref.objectPath === "/root") {
        return [
          { busName: "app", objectPath: "/win1" },
          { busName: "app", objectPath: "/win2" },
        ];
      }
      return [];
    });
    backend.describeAccessible = vi.fn(async (ref: { busName: string; objectPath: string }) => {
      if (ref.objectPath === "/root") {
        return {
          elementRef: "atspi:app|/root",
          role: "desktop frame",
          name: "",
          bounds: { x: 0, y: 0, width: 1280, height: 720 },
          actions: [],
          states: [],
        };
      }

      if (ref.objectPath === "/win1") {
        return {
          elementRef: "atspi:app|/win1",
          role: "frame",
          name: "Window One",
          bounds: { x: 10, y: 20, width: 300, height: 200 },
          actions: [],
          states: ["active"],
        };
      }

      return {
        elementRef: "atspi:app|/win2",
        role: "frame",
        name: "Window Two",
        bounds: { x: 400, y: 20, width: 300, height: 200 },
        actions: [],
        states: [],
      };
    });

    const snapshot = await backend.snapshot({
      op: "snapshot",
      include_tree: true,
      max_nodes: 16,
      max_text_chars: 1024,
    });

    expect(snapshot.windows).toEqual([
      {
        ref: "atspi:app|/win1",
        title: "Window One",
        bounds: { x: 10, y: 20, width: 300, height: 200 },
        focused: true,
      },
      {
        ref: "atspi:app|/win2",
        title: "Window Two",
        bounds: { x: 400, y: 20, width: 300, height: 200 },
        focused: false,
      },
    ]);
  });

  it("does not consume query node budget on visited nodes", async () => {
    const backend = new AtSpiDesktopA11yBackend() as any;

    const rootRef = { busName: "app", objectPath: "/node0" };
    backend.resolveRootAccessible = vi.fn(async () => rootRef);
    backend.getChildren = vi.fn(async (ref: { objectPath: string }, maxChildren: number) => {
      const idxRaw = ref.objectPath.replace("/node", "");
      const idx = Number(idxRaw);
      if (!Number.isFinite(idx) || idx < 0) return [];
      if (idx >= 19) return [];

      const duplicates = Array.from({ length: 127 }, () => ({
        busName: "app",
        objectPath: "/node0",
      }));
      const next = { busName: "app", objectPath: `/node${String(idx + 1)}` };
      const children = [...duplicates, next];
      return children.slice(0, maxChildren);
    });
    backend.describeAccessible = vi.fn(async (ref: { busName: string; objectPath: string }) => ({
      elementRef: `atspi:${ref.busName}|${ref.objectPath}`,
      role: "button",
      name: ref.objectPath === "/node19" ? "Target" : ref.objectPath,
      bounds: { x: 0, y: 0, width: 100, height: 80 },
      actions: [],
      states: [],
    }));

    const matches = await backend.query({
      op: "query",
      selector: { kind: "a11y", role: "button", name: "target", states: [] },
      limit: 1,
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.kind).toBe("a11y");
    expect((matches[0] as { element_ref?: string }).element_ref).toBe("atspi:app|/node19");
  });

  it("finds nodes at the maximum depth", async () => {
    const backend = new AtSpiDesktopA11yBackend() as any;

    backend.resolveRootAccessible = vi.fn(async () => ({ busName: "app", objectPath: "/node1" }));
    backend.getChildren = vi.fn(async (ref: { objectPath: string }, maxChildren: number) => {
      const idxRaw = ref.objectPath.replace("/node", "");
      const idx = Number(idxRaw);
      if (!Number.isFinite(idx) || idx <= 0) return [];
      if (idx >= DEFAULT_A11Y_MAX_DEPTH) return [];
      return [{ busName: "app", objectPath: `/node${String(idx + 1)}` }].slice(0, maxChildren);
    });
    backend.describeAccessible = vi.fn(async (ref: { busName: string; objectPath: string }) => ({
      elementRef: `atspi:${ref.busName}|${ref.objectPath}`,
      role: "button",
      name: ref.objectPath === `/node${String(DEFAULT_A11Y_MAX_DEPTH)}` ? "Target" : ref.objectPath,
      bounds: { x: 0, y: 0, width: 100, height: 80 },
      actions: [],
      states: [],
    }));

    const matches = await backend.query({
      op: "query",
      selector: { kind: "a11y", role: "button", name: "target", states: [] },
      limit: 1,
    });

    expect(matches).toHaveLength(1);
    expect((matches[0] as { element_ref?: string }).element_ref).toBe(
      `atspi:app|/node${String(DEFAULT_A11Y_MAX_DEPTH)}`,
    );
  });
});

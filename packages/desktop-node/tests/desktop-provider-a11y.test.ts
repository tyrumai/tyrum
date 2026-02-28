import { describe, expect, it, vi } from "vitest";
import type { ActionPrimitive } from "@tyrum/schemas";
import { DesktopProvider, MockDesktopBackend, type ConfirmationFn } from "@tyrum/desktop-node";
import type { DesktopA11yBackend } from "../src/providers/backends/desktop-a11y-backend.js";

function makeAction(args: Record<string, unknown>): ActionPrimitive {
  return { type: "Desktop", args };
}

describe("DesktopProvider (a11y)", () => {
  it("snapshot(include_tree) uses injected a11y backend when available", async () => {
    const backend = new MockDesktopBackend();
    const permissions = {
      desktopScreenshot: true,
      desktopInput: false,
      desktopInputRequiresConfirmation: false,
    };

    const a11yBackend: DesktopA11yBackend = {
      isAvailable: vi.fn(async () => true),
      snapshot: vi.fn(async () => ({
        windows: [
          {
            ref: "window:1",
            title: "Test Window",
            bounds: { x: 0, y: 0, width: 100, height: 80 },
            focused: true,
          },
        ],
        tree: {
          root: {
            ref: "atspi:app|/node",
            role: "window",
            name: "Test Window",
            states: ["focused"],
            bounds: { x: 0, y: 0, width: 100, height: 80 },
            actions: ["click"],
            children: [],
          },
        },
      })),
      query: vi.fn(async () => []),
      act: vi.fn(async () => ({})),
    };

    const provider = new DesktopProvider(
      backend,
      permissions,
      vi.fn<ConfirmationFn>(),
      undefined,
      a11yBackend,
    );

    const result = await provider.execute(makeAction({ op: "snapshot", include_tree: true }));

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      op: "snapshot",
      backend: {
        permissions: {
          accessibility: true,
          screen_capture: true,
          input_control: false,
        },
      },
    });
    expect(result.result).toHaveProperty("tree");
    const tree = (result.result as { tree?: { root?: { role?: string } } }).tree;
    expect(tree?.root?.role).toBe("window");
  });

  it("snapshot(include_tree) prunes the tree to max_nodes", async () => {
    const backend = new MockDesktopBackend();
    const permissions = {
      desktopScreenshot: true,
      desktopInput: false,
      desktopInputRequiresConfirmation: false,
    };

    const a11yBackend: DesktopA11yBackend = {
      isAvailable: vi.fn(async () => true),
      snapshot: vi.fn(async () => ({
        windows: [],
        tree: {
          root: {
            role: "window",
            name: "Root",
            bounds: { x: 0, y: 0, width: 100, height: 80 },
            states: [],
            actions: [],
            children: [
              {
                role: "button",
                name: "A",
                bounds: { x: 0, y: 0, width: 10, height: 10 },
                states: [],
                actions: ["click"],
                children: [],
              },
              {
                role: "button",
                name: "B",
                bounds: { x: 0, y: 0, width: 10, height: 10 },
                states: [],
                actions: ["click"],
                children: [],
              },
              {
                role: "button",
                name: "C",
                bounds: { x: 0, y: 0, width: 10, height: 10 },
                states: [],
                actions: ["click"],
                children: [],
              },
            ],
          },
        },
      })),
      query: vi.fn(async () => []),
      act: vi.fn(async () => ({})),
    };

    const provider = new DesktopProvider(
      backend,
      permissions,
      vi.fn<ConfirmationFn>(),
      undefined,
      a11yBackend,
    );

    const result = await provider.execute(
      makeAction({
        op: "snapshot",
        include_tree: true,
        max_nodes: 2,
        max_text_chars: 1024,
      }),
    );

    expect(result.success).toBe(true);
    const tree = (result.result as { tree?: { root?: { children?: unknown[] } } }).tree;
    expect(tree?.root?.children).toHaveLength(1);
  });

  it("query(a11y) uses the a11y backend without screen capture", async () => {
    const backend = new MockDesktopBackend();
    const permissions = {
      desktopScreenshot: true,
      desktopInput: false,
      desktopInputRequiresConfirmation: false,
    };

    const a11yBackend: DesktopA11yBackend = {
      isAvailable: vi.fn(async () => true),
      snapshot: vi.fn(async () => ({
        windows: [],
        tree: {
          root: {
            role: "window",
            name: "Test",
            bounds: { x: 0, y: 0, width: 100, height: 80 },
            states: [],
            actions: [],
            children: [],
          },
        },
      })),
      query: vi.fn(async () => [
        {
          kind: "a11y",
          element_ref: "atspi:app|/node",
          node: {
            role: "button",
            name: "Save",
            states: ["enabled"],
            bounds: { x: 10, y: 20, width: 80, height: 24 },
            actions: ["click"],
          },
        },
      ]),
      act: vi.fn(async () => ({})),
    };

    const provider = new DesktopProvider(
      backend,
      permissions,
      vi.fn<ConfirmationFn>(),
      undefined,
      a11yBackend,
    );

    const result = await provider.execute(
      makeAction({
        op: "query",
        selector: { kind: "a11y", role: "button", name: "Save" },
        limit: 1,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      op: "query",
      matches: [
        {
          kind: "a11y",
          element_ref: "atspi:app|/node",
          node: { role: "button", name: "Save" },
        },
      ],
    });
    expect(backend.calls).toEqual([]);
  });

  it("act(a11y) uses the a11y backend", async () => {
    const backend = new MockDesktopBackend();
    const permissions = {
      desktopScreenshot: true,
      desktopInput: true,
      desktopInputRequiresConfirmation: false,
    };

    const a11yBackend: DesktopA11yBackend = {
      isAvailable: vi.fn(async () => true),
      snapshot: vi.fn(async () => ({
        windows: [],
        tree: {
          root: {
            role: "window",
            name: "Test",
            bounds: { x: 0, y: 0, width: 100, height: 80 },
            states: [],
            actions: [],
            children: [],
          },
        },
      })),
      query: vi.fn(async () => []),
      act: vi.fn(async () => ({ resolved_element_ref: "atspi:app|/node" })),
    };

    const provider = new DesktopProvider(
      backend,
      permissions,
      vi.fn<ConfirmationFn>(),
      undefined,
      a11yBackend,
    );

    const result = await provider.execute(
      makeAction({
        op: "act",
        target: { kind: "a11y", role: "button", name: "Save" },
        action: { kind: "click" },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      op: "act",
      resolved_element_ref: "atspi:app|/node",
    });
    expect(backend.calls).toEqual([]);
  });

  it.skipIf(process.platform !== "linux")(
    "act(a11y) falls back to OCR when a11y backend is unavailable",
    async () => {
      const backend = new MockDesktopBackend();
      const permissions = {
        desktopScreenshot: true,
        desktopInput: true,
        desktopInputRequiresConfirmation: false,
      };

      const ocr = {
        recognize: vi.fn(async () => [
          {
            text: "Save",
            bounds: { x: 10, y: 20, width: 80, height: 24 },
            confidence: 0.9,
          },
        ]),
      };

      const a11yBackend: DesktopA11yBackend = {
        isAvailable: vi.fn(async () => false),
        snapshot: vi.fn(async () => ({
          windows: [],
          tree: {
            root: {
              role: "window",
              name: "Test",
              bounds: { x: 0, y: 0, width: 100, height: 80 },
              states: [],
              actions: [],
              children: [],
            },
          },
        })),
        query: vi.fn(async () => []),
        act: vi.fn(async () => ({})),
      };

      const provider = new DesktopProvider(
        backend,
        permissions,
        vi.fn<ConfirmationFn>(),
        ocr,
        a11yBackend,
      );

      const result = await provider.execute(
        makeAction({
          op: "act",
          target: { kind: "a11y", role: "button", name: "Save" },
          action: { kind: "click" },
        }),
      );

      expect(result.success).toBe(true);
      expect(backend.calls).toEqual([
        { method: "captureScreen", args: ["primary"] },
        { method: "clickMouse", args: [50, 32, undefined] },
      ]);
      expect(ocr.recognize).toHaveBeenCalledTimes(1);
    },
  );

  it.skipIf(process.platform !== "linux")(
    "query(a11y) surfaces a11y backend errors instead of falling back silently",
    async () => {
      const backend = new MockDesktopBackend();
      const permissions = {
        desktopScreenshot: true,
        desktopInput: false,
        desktopInputRequiresConfirmation: false,
      };

      const a11yBackend: DesktopA11yBackend = {
        isAvailable: vi.fn(async () => true),
        snapshot: vi.fn(async () => ({
          windows: [],
          tree: {
            root: {
              role: "window",
              name: "Test",
              bounds: { x: 0, y: 0, width: 100, height: 80 },
              states: [],
              actions: [],
              children: [],
            },
          },
        })),
        query: vi.fn(async () => {
          throw new Error("AT-SPI query failed");
        }),
        act: vi.fn(async () => ({})),
      };

      const provider = new DesktopProvider(
        backend,
        permissions,
        vi.fn<ConfirmationFn>(),
        undefined,
        a11yBackend,
      );

      const result = await provider.execute(
        makeAction({
          op: "query",
          selector: { kind: "a11y", role: "button", name: "Save" },
          limit: 1,
        }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/AT-SPI query failed/);
    },
  );

  it.skipIf(process.platform !== "linux")(
    "act(a11y) surfaces a11y backend errors instead of falling back silently",
    async () => {
      const backend = new MockDesktopBackend();
      const permissions = {
        desktopScreenshot: true,
        desktopInput: true,
        desktopInputRequiresConfirmation: false,
      };

      const a11yBackend: DesktopA11yBackend = {
        isAvailable: vi.fn(async () => true),
        snapshot: vi.fn(async () => ({
          windows: [],
          tree: {
            root: {
              role: "window",
              name: "Test",
              bounds: { x: 0, y: 0, width: 100, height: 80 },
              states: [],
              actions: [],
              children: [],
            },
          },
        })),
        query: vi.fn(async () => []),
        act: vi.fn(async () => {
          throw new Error("AT-SPI act failed");
        }),
      };

      const provider = new DesktopProvider(
        backend,
        permissions,
        vi.fn<ConfirmationFn>(),
        undefined,
        a11yBackend,
      );

      const result = await provider.execute(
        makeAction({
          op: "act",
          target: { kind: "a11y", role: "button", name: "Save" },
          action: { kind: "click" },
        }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/AT-SPI act failed/);
    },
  );

  it.skipIf(process.platform !== "linux")(
    "snapshot(include_tree) errors do not mark the a11y backend unavailable",
    async () => {
      const backend = new MockDesktopBackend();
      const permissions = {
        desktopScreenshot: true,
        desktopInput: false,
        desktopInputRequiresConfirmation: false,
      };

      const a11yBackend: DesktopA11yBackend = {
        isAvailable: vi.fn(async () => true),
        snapshot: vi.fn(async () => {
          throw new Error("AT-SPI snapshot failed");
        }),
        query: vi.fn(async () => [
          {
            kind: "a11y",
            element_ref: "atspi:app|/node",
            node: {
              role: "button",
              name: "Save",
              states: ["enabled"],
              bounds: { x: 10, y: 20, width: 80, height: 24 },
              actions: ["click"],
            },
          },
        ]),
        act: vi.fn(async () => ({})),
      };

      const provider = new DesktopProvider(
        backend,
        permissions,
        vi.fn<ConfirmationFn>(),
        undefined,
        a11yBackend,
      );

      const snapshot = await provider.execute(makeAction({ op: "snapshot", include_tree: true }));
      expect(snapshot.success).toBe(true);

      const query = await provider.execute(
        makeAction({
          op: "query",
          selector: { kind: "a11y", role: "button", name: "Save" },
          limit: 1,
        }),
      );

      expect(query.success).toBe(true);
      expect(a11yBackend.query).toHaveBeenCalledTimes(1);
      expect(backend.calls).toHaveLength(1);
    },
  );
});

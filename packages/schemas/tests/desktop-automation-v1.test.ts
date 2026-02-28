import { describe, expect, it } from "vitest";
import {
  DesktopActionArgs,
  DesktopActArgs,
  DesktopBackendMode,
  DesktopElementRef,
  DesktopQueryArgs,
  DesktopQueryResult,
  DesktopSnapshotArgs,
  DesktopSnapshotResult,
  DesktopUiNode,
  DesktopUiTree,
  DesktopWaitForArgs,
} from "../src/index.js";

describe("Desktop automation contract v1 (schemas)", () => {
  it("DesktopSnapshotArgs parses minimal input", () => {
    const parsed = DesktopSnapshotArgs.parse({ op: "snapshot" });
    expect(parsed.op).toBe("snapshot");
  });

  it("DesktopQueryArgs parses a11y selector query", () => {
    const parsed = DesktopQueryArgs.parse({
      op: "query",
      selector: { kind: "a11y", role: "button", name: "Save" },
    });
    expect(parsed.op).toBe("query");
    expect(parsed.selector.kind).toBe("a11y");
  });

  it("DesktopActArgs parses element-ref click", () => {
    const parsed = DesktopActArgs.parse({
      op: "act",
      target: { kind: "ref", ref: "el_123" },
      action: { kind: "click" },
    });
    expect(parsed.op).toBe("act");
    expect(parsed.target.kind).toBe("ref");
    expect(parsed.action.kind).toBe("click");
  });

  it("DesktopWaitForArgs parses visible wait", () => {
    const parsed = DesktopWaitForArgs.parse({
      op: "wait_for",
      selector: { kind: "a11y", role: "dialog", name: "Settings" },
      state: "visible",
      timeout_ms: 5_000,
    });
    expect(parsed.op).toBe("wait_for");
    expect(parsed.state).toBe("visible");
    expect(parsed.timeout_ms).toBe(5_000);
  });

  it("DesktopActionArgs accepts new ops in the discriminated union", () => {
    expect(DesktopActionArgs.parse({ op: "snapshot" })).toMatchObject({ op: "snapshot" });

    expect(
      DesktopActionArgs.parse({
        op: "query",
        selector: { kind: "a11y", role: "link", name: "Home" },
      }),
    ).toMatchObject({ op: "query" });

    expect(
      DesktopActionArgs.parse({
        op: "act",
        target: { kind: "ref", ref: "el_abc" },
        action: { kind: "focus" },
      }),
    ).toMatchObject({ op: "act" });

    expect(
      DesktopActionArgs.parse({
        op: "wait_for",
        selector: { kind: "a11y", role: "textbox", name: "Email" },
        state: "exists",
      }),
    ).toMatchObject({ op: "wait_for" });
  });

  it("DesktopSnapshotResult includes backend mode and permission flags", () => {
    const parsed = DesktopSnapshotResult.parse({
      op: "snapshot",
      backend: {
        mode: DesktopBackendMode.parse("a11y"),
        permissions: {
          accessibility: true,
          screen_capture: false,
          input_control: true,
        },
      },
      windows: [
        {
          ref: "win_1",
          title: "Terminal",
          bounds: { x: 0, y: 0, width: 800, height: 600 },
          focused: true,
        },
      ],
      tree: {
        root: {
          ref: DesktopElementRef.parse("el_root"),
          role: "window",
          name: "Terminal",
          bounds: { x: 0, y: 0, width: 800, height: 600 },
          states: [],
          actions: [],
          children: [],
        },
      },
    });

    expect(parsed.backend.mode).toBe("a11y");
    expect(parsed.backend.permissions.accessibility).toBe(true);
    expect(parsed.windows).toHaveLength(1);
  });

  it("DesktopQueryResult supports both a11y and OCR matches", () => {
    const parsed = DesktopQueryResult.parse({
      op: "query",
      matches: [
        {
          kind: "a11y",
          element_ref: "el_btn_save",
          node: {
            role: "button",
            name: "Save",
            bounds: { x: 10, y: 20, width: 80, height: 24 },
            states: ["enabled"],
            actions: ["click"],
          },
        },
        {
          kind: "ocr",
          text: "Welcome",
          bounds: { x: 100, y: 200, width: 120, height: 30 },
          confidence: 0.9,
        },
      ],
    });
    expect(parsed.op).toBe("query");
    expect(parsed.matches).toHaveLength(2);
  });

  it("DesktopUiNode bounds name length and children count", () => {
    const ok = DesktopUiNode.parse({
      role: "textbox",
      name: "username",
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      states: [],
      actions: [],
      children: [],
    });
    expect(ok.role).toBe("textbox");

    expect(() =>
      DesktopUiNode.parse({
        role: "textbox",
        name: "a".repeat(10_000),
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        states: [],
        actions: [],
        children: [],
      }),
    ).toThrow();

    expect(() =>
      DesktopUiNode.parse({
        role: "group",
        name: "container",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        states: [],
        actions: [],
        children: Array.from({ length: 1_000 }, () => ({
          role: "button",
          name: "child",
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          states: [],
          actions: [],
          children: [],
        })),
      }),
    ).toThrow();
  });

  it("DesktopUiTree enforces an overall max node count", () => {
    const ok = DesktopUiTree.parse({
      root: {
        role: "group",
        name: "root",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        states: [],
        actions: [],
        children: [],
      },
    });
    expect(ok.root.role).toBe("group");

    const root = {
      role: "group",
      name: "root",
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      states: [],
      actions: [],
      children: Array.from({ length: 100 }, () => ({
        role: "group",
        name: "branch",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        states: [],
        actions: [],
        children: Array.from({ length: 100 }, () => ({
          role: "button",
          name: "leaf",
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          states: [],
          actions: [],
          children: [],
        })),
      })),
    };

    expect(() => DesktopUiTree.parse({ root })).toThrow();
  });

  it("DesktopUiTree enforces an overall max text char count", () => {
    const chunk = "s".repeat(64);
    const states = Array.from({ length: 32 }, () => chunk);
    const actions = Array.from({ length: 32 }, () => chunk);

    const leaf = {
      role: "group",
      name: "a".repeat(512),
      value: "b".repeat(512),
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      states,
      actions,
      children: [],
    } as const;

    const root = {
      ...leaf,
      children: Array.from({ length: 7 }, () => leaf),
    };

    expect(() => DesktopUiTree.parse({ root })).toThrow();
  });
});

// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTestRoot, createTestRoot, type TestRoot } from "../../../packages/operator-ui/tests/test-utils.js";
import { getButtonByText, press } from "./test-utils/dom.js";

describe("Logs page", () => {
  let testRoot: TestRoot;
  let onLog: ((payload: unknown) => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
    testRoot = createTestRoot();
    onLog = null;

    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = {
      onLog: vi.fn((cb: (payload: unknown) => void) => {
        onLog = cb;
        return () => {};
      }),
    };
  });

  afterEach(() => {
    cleanupTestRoot(testRoot);
    delete (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
  });

  it("disables auto-scroll when the viewport is scrolled up", async () => {
    const { Logs } = await import("../src/renderer/pages/Logs.js");

    await act(async () => {
      testRoot.root.render(createElement(Logs));
    });

    expect(document.body.textContent).toContain("No log entries yet");
    if (!onLog) {
      throw new Error("expected to subscribe to desktop log events");
    }

    const viewport = document.querySelector('[data-scroll-area-viewport=""]');
    expect(viewport).not.toBeNull();
    if (!(viewport instanceof HTMLElement)) {
      throw new Error("expected scroll viewport element");
    }

    Object.defineProperty(viewport, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 400, configurable: true });

    await act(async () => {
      onLog?.({ source: "gateway", level: "info", message: "hello" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.body.textContent).toContain("hello");
    expect(viewport.scrollTop).toBe(1000);

    await act(async () => {
      viewport.scrollTop = 0;
      viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    await act(async () => {
      onLog?.({ source: "gateway", level: "info", message: "second" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(viewport.scrollTop).toBe(0);

    await act(async () => {
      viewport.scrollTop = 600;
      viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    await act(async () => {
      onLog?.({ source: "gateway", level: "info", message: "third" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(viewport.scrollTop).toBe(1000);

    await act(async () => {
      press(getButtonByText("Node"));
    });
    expect(document.body.textContent).toContain("No log entries yet");
  });
});

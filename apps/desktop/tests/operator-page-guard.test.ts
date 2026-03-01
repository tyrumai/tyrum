// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupTestRoot,
  createTestRoot,
  type TestRoot,
} from "../../../packages/operator-ui/tests/test-utils.js";

vi.mock("@tyrum/operator-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tyrum/operator-ui")>();
  return {
    ...actual,
    AdminModeProvider: ({ children }: { children: unknown }) => children,
  };
});

describe("OperatorPageGuard", () => {
  let testRoot: TestRoot;

  beforeEach(() => {
    document.body.innerHTML = "";
    testRoot = createTestRoot();
  });

  afterEach(() => {
    cleanupTestRoot(testRoot);
    delete (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
  });

  it("shows error when tyrumDesktop is unavailable", async () => {
    delete (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
    const { OperatorPageGuard } = await import("../src/renderer/components/OperatorPageGuard.js");
    await act(async () => {
      testRoot.root.render(
        createElement(OperatorPageGuard, {
          core: null,
          busy: false,
          errorMessage: null,
          retry: () => {},
          render: () => createElement("div", null, "content"),
        }),
      );
    });
    expect(document.body.textContent).toContain("Desktop API not available");
  });

  it("shows error alert with retry button for errorMessage", async () => {
    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = {};
    const retrySpy = vi.fn();
    const { OperatorPageGuard } = await import("../src/renderer/components/OperatorPageGuard.js");
    await act(async () => {
      testRoot.root.render(
        createElement(OperatorPageGuard, {
          core: null,
          busy: false,
          errorMessage: "connection failed",
          retry: retrySpy,
          render: () => createElement("div", null, "content"),
        }),
      );
    });
    expect(document.body.textContent).toContain("connection failed");
    expect(document.body.textContent).not.toContain("content");

    const retryButton = document.querySelector("button");
    expect(retryButton).not.toBeNull();
    expect(retryButton!.textContent).toBe("Retry");
    await act(async () => {
      retryButton!.click();
    });
    expect(retrySpy).toHaveBeenCalledOnce();
  });

  it("shows loading spinner when core is null and busy", async () => {
    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = {};
    const { OperatorPageGuard } = await import("../src/renderer/components/OperatorPageGuard.js");
    await act(async () => {
      testRoot.root.render(
        createElement(OperatorPageGuard, {
          core: null,
          busy: true,
          errorMessage: null,
          retry: () => {},
          render: () => createElement("div", null, "content"),
        }),
      );
    });
    expect(document.body.textContent).toContain("Loading...");
    expect(document.body.textContent).not.toContain("content");
  });

  it("renders children via render prop when core is available", async () => {
    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = {};
    const { OperatorPageGuard } = await import("../src/renderer/components/OperatorPageGuard.js");
    const fakeCore = {} as import("@tyrum/operator-core").OperatorCore;
    await act(async () => {
      testRoot.root.render(
        createElement(OperatorPageGuard, {
          core: fakeCore,
          busy: false,
          errorMessage: null,
          retry: () => {},
          render: () => createElement("div", { "data-testid": "child" }, "rendered"),
        }),
      );
    });
    expect(document.querySelector('[data-testid="child"]')).not.toBeNull();
    expect(document.body.textContent).toContain("rendered");
  });
});

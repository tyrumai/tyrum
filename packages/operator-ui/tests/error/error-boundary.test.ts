// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("ErrorBoundary", () => {
  it("catches render errors and can reset", () => {
    const ErrorBoundary = (operatorUi as Record<string, unknown>)["ErrorBoundary"];
    expect(ErrorBoundary).toBeDefined();

    let shouldThrow = true;

    function FlakyChild() {
      if (shouldThrow) {
        throw new Error("boom");
      }
      return React.createElement("div", { "data-testid": "ok" }, "ok");
    }

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const onReloadPage = vi.fn();

    const { container, root } = renderIntoDocument(
      React.createElement(
        ErrorBoundary as React.ComponentType<{ children: React.ReactNode }>,
        { onReloadPage },
        React.createElement(FlakyChild),
      ),
    );

    try {
      expect(container.textContent).toContain("boom");

      const reloadButton = Array.from(container.querySelectorAll("button")).find((button) =>
        (button.textContent ?? "").includes("Reload Page"),
      );
      expect(reloadButton).toBeDefined();

      act(() => {
        shouldThrow = false;
        (reloadButton as HTMLButtonElement).click();
      });

      expect(onReloadPage).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[data-testid="ok"]')).not.toBeNull();
    } finally {
      cleanupTestRoot({ container, root });
      consoleSpy.mockRestore();
    }
  });

  it("renders fallback when the thrown value is falsy", () => {
    const ErrorBoundary = (operatorUi as Record<string, unknown>)["ErrorBoundary"];
    expect(ErrorBoundary).toBeDefined();

    function FalsyThrower() {
      throw 0;
    }

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container, root } = renderIntoDocument(
      React.createElement(
        ErrorBoundary as React.ComponentType<{ children: React.ReactNode }>,
        null,
        React.createElement(FalsyThrower),
      ),
    );

    try {
      expect(container.textContent).toContain("Something went wrong");
      expect(container.textContent).toContain("0");

      const reloadButton = Array.from(container.querySelectorAll("button")).find((button) =>
        (button.textContent ?? "").includes("Reload Page"),
      );
      expect(reloadButton).toBeDefined();

      expect(container.querySelector('[data-testid="ok"]')).toBeNull();
    } finally {
      cleanupTestRoot({ container, root });
      consoleSpy.mockRestore();
    }
  });
});

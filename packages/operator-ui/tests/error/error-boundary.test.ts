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

    const { container, root } = renderIntoDocument(
      React.createElement(
        ErrorBoundary as React.ComponentType<{ children: React.ReactNode }>,
        null,
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

      expect(container.querySelector('[data-testid="ok"]')).not.toBeNull();
    } finally {
      cleanupTestRoot({ container, root });
      consoleSpy.mockRestore();
    }
  });
});

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("JsonViewer", () => {
  it("renders a JSON tree", () => {
    const JsonViewer = (operatorUi as Record<string, unknown>)["JsonViewer"];
    expect(JsonViewer).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(JsonViewer as React.ComponentType<{ value: unknown }>, {
        value: { hello: "world", nested: { count: 2 } },
      }),
    );

    expect(container.textContent).toContain("hello");
    expect(container.textContent).toContain("world");
    expect(container.textContent).toContain("nested");
    expect(container.textContent).toContain("count");
    expect(container.textContent).toContain("2");

    cleanupTestRoot({ container, root });
  });

  it("copies JSON to clipboard", () => {
    const JsonViewer = (operatorUi as Record<string, unknown>)["JsonViewer"];
    expect(JsonViewer).toBeDefined();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const { container, root } = renderIntoDocument(
      React.createElement(JsonViewer as React.ComponentType<{ value: unknown }>, {
        value: { a: 1 },
      }),
    );

    const button = container.querySelector("button[aria-label='Copy JSON']");
    expect(button).not.toBeNull();

    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(writeText).toHaveBeenCalledTimes(1);

    const copied = writeText.mock.calls[0]?.[0];
    expect(copied).toContain('"a"');
    expect(copied).toContain("1");

    cleanupTestRoot({ container, root });
  });
});

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("JsonTextarea", () => {
  it("shows parse errors for invalid JSON", () => {
    const JsonTextarea = (operatorUi as Record<string, unknown>)["JsonTextarea"];
    expect(JsonTextarea).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(JsonTextarea as React.ComponentType, {
        id: "payload",
        label: "Payload",
        value: "{",
        onChange: () => {},
      }),
    );

    expect(container.textContent).toContain("Invalid JSON");

    const textarea = container.querySelector("textarea#payload");
    expect(textarea?.getAttribute("aria-invalid")).toBe("true");

    cleanupTestRoot({ container, root });
  });

  it("reports parsed JSON when valid", () => {
    const JsonTextarea = (operatorUi as Record<string, unknown>)["JsonTextarea"];
    expect(JsonTextarea).toBeDefined();

    const onJsonChange = vi.fn();
    const { container, root } = renderIntoDocument(
      React.createElement(JsonTextarea as React.ComponentType, {
        id: "payload",
        label: "Payload",
        value: "{\"a\":1}",
        onChange: () => {},
        onJsonChange,
      }),
    );

    const last = onJsonChange.mock.calls.at(-1);
    expect(last).toBeDefined();
    expect(last?.[0]).toEqual({ a: 1 });
    expect(last?.[1]).toBeNull();

    cleanupTestRoot({ container, root });
  });
});


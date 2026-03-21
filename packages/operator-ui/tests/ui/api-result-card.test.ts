// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("ApiResultCard", () => {
  it("renders successful responses with structured values", () => {
    const ApiResultCard = (operatorUi as Record<string, unknown>)["ApiResultCard"];
    expect(ApiResultCard).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(ApiResultCard as React.ComponentType, {
        heading: "Result",
        value: { hello: "world" },
      }),
    );

    expect(container.textContent).toContain("Success");
    expect(container.textContent).toContain("Hello");
    expect(container.textContent).toContain("world");

    cleanupTestRoot({ container, root });
  });

  it("renders errors with details", () => {
    const ApiResultCard = (operatorUi as Record<string, unknown>)["ApiResultCard"];
    expect(ApiResultCard).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(ApiResultCard as React.ComponentType, {
        heading: "Result",
        error: new Error("Nope"),
      }),
    );

    expect(container.textContent).toContain("Error");
    expect(container.textContent).toContain("Nope");

    cleanupTestRoot({ container, root });
  });
});

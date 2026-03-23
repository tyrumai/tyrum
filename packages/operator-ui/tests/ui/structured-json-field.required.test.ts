// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("StructuredJsonField required label", () => {
  it("shows the required indicator for labeled JSON editors", () => {
    const StructuredJsonField = (operatorUi as Record<string, unknown>)["StructuredJsonField"];
    expect(StructuredJsonField).toBeDefined();

    const treeRoot = renderIntoDocument(
      React.createElement(StructuredJsonField as React.ComponentType, {
        label: "Payload",
        required: true,
        value: undefined,
      }),
    );
    expect(treeRoot.container.querySelector("label")?.textContent).toContain("*");
    cleanupTestRoot(treeRoot);

    const schemaRoot = renderIntoDocument(
      React.createElement(StructuredJsonField as React.ComponentType, {
        label: "Budgets",
        required: true,
        schema: {
          type: "object",
          properties: {},
        },
        value: undefined,
      }),
    );
    expect(schemaRoot.container.querySelector("label")?.textContent).toContain("*");
    cleanupTestRoot(schemaRoot);
  });
});

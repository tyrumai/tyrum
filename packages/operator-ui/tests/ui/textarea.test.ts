// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Textarea", () => {
  it("renders label and textarea", () => {
    const Textarea = (operatorUi as Record<string, unknown>)["Textarea"];
    expect(Textarea).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(Textarea as React.ComponentType, {
        id: "notes",
        label: "Notes",
        helperText: "Add more context",
      }),
    );

    expect(container.querySelector("label")?.textContent).toContain("Notes");
    expect(container.querySelector("textarea#notes")).not.toBeNull();
    expect(container.textContent).toContain("Add more context");

    cleanupTestRoot({ container, root });
  });
});

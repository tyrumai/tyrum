// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("Label", () => {
  it("supports required indicator", () => {
    const Label = (operatorUi as Record<string, unknown>)["Label"];
    expect(Label).toBeDefined();

    const { container, root } = renderIntoDocument(
      React.createElement(Label as React.ComponentType, { required: true }, "Email"),
    );

    const label = container.querySelector("label");
    expect(label?.textContent).toContain("Email");
    expect(label?.textContent).toContain("*");

    cleanupTestRoot({ container, root });
  });
});

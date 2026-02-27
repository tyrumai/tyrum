// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import * as operatorUi from "../../src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("RadioGroup", () => {
  it("renders checked item with an indicator", () => {
    const RadioGroup = (operatorUi as Record<string, unknown>)["RadioGroup"];
    const RadioGroupItem = (operatorUi as Record<string, unknown>)["RadioGroupItem"];

    expect(RadioGroup).toBeDefined();
    expect(RadioGroupItem).toBeDefined();

    const { root, container } = renderIntoDocument(
      React.createElement(
        RadioGroup as React.ComponentType,
        { defaultValue: "a" },
        React.createElement(RadioGroupItem as React.ComponentType, { value: "a" }),
        React.createElement(RadioGroupItem as React.ComponentType, { value: "b" }),
      ),
    );

    const checked = container.querySelector("[data-state='checked']");
    expect(checked).not.toBeNull();
    expect(checked?.querySelector("span")).not.toBeNull();

    cleanupTestRoot({ root, container });
  });
});

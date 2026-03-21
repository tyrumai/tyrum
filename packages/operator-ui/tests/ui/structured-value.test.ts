// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";
import { formatFieldLabel, StructuredValue } from "../../src/components/ui/structured-value.js";

function renderText(value: unknown, maxDepth?: number): string {
  const { container, root } = renderIntoDocument(
    React.createElement(StructuredValue, { value, maxDepth }),
  );
  const text = container.textContent ?? "";
  cleanupTestRoot({ container, root });
  return text;
}

describe("formatFieldLabel", () => {
  it("converts snake_case to title case", () => {
    expect(formatFieldLabel("timeout_ms")).toBe("Timeout ms");
    expect(formatFieldLabel("retry_count")).toBe("Retry count");
  });

  it("converts camelCase to title case", () => {
    expect(formatFieldLabel("retryCount")).toBe("Retry count");
    expect(formatFieldLabel("maxTurns")).toBe("Max turns");
  });

  it("handles single words", () => {
    expect(formatFieldLabel("status")).toBe("Status");
  });

  it("returns key unchanged when empty", () => {
    expect(formatFieldLabel("")).toBe("");
  });
});

describe("StructuredValue", () => {
  it("renders null as a dash", () => {
    expect(renderText(null)).toBe("—");
  });

  it("renders undefined as a dash", () => {
    expect(renderText(undefined)).toBe("—");
  });

  it("renders strings as-is", () => {
    expect(renderText("hello world")).toBe("hello world");
  });

  it("renders numbers as text", () => {
    expect(renderText(42)).toBe("42");
    expect(renderText(0)).toBe("0");
  });

  it("renders booleans as Yes/No", () => {
    expect(renderText(true)).toBe("Yes");
    expect(renderText(false)).toBe("No");
  });

  it("renders empty array as a dash", () => {
    expect(renderText([])).toBe("—");
  });

  it("renders array items with numbering", () => {
    const text = renderText(["alpha", "beta"]);
    expect(text).toContain("1.");
    expect(text).toContain("alpha");
    expect(text).toContain("2.");
    expect(text).toContain("beta");
  });

  it("renders empty object as a dash", () => {
    expect(renderText({})).toBe("—");
  });

  it("renders object entries with formatted labels", () => {
    const text = renderText({ retry_count: 3, is_enabled: true });
    expect(text).toContain("Retry count");
    expect(text).toContain("3");
    expect(text).toContain("Is enabled");
    expect(text).toContain("Yes");
  });

  it("renders nested objects", () => {
    const text = renderText({ outer: { inner_key: "val" } });
    expect(text).toContain("Outer");
    expect(text).toContain("Inner key");
    expect(text).toContain("val");
  });

  it("truncates at maxDepth", () => {
    const deep = { a: { b: { c: { d: "end" } } } };
    const text = renderText(deep, 2);
    expect(text).toContain("…");
    expect(text).not.toContain("end");
  });

  it("renders full depth at default maxDepth", () => {
    const deep = { a: { b: { c: "end" } } };
    const text = renderText(deep);
    expect(text).toContain("end");
  });
});

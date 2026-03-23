import { describe, expect, it } from "vitest";
import { parseFrontmatterDocument } from "../../src/modules/agent/frontmatter.js";

describe("parseFrontmatterDocument", () => {
  it("returns empty frontmatter and full body when no frontmatter delimiters", () => {
    const result = parseFrontmatterDocument("just some text");
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("just some text");
  });

  it("parses YAML frontmatter", () => {
    const doc = "---\ntitle: Hello\ntags:\n  - a\n  - b\n---\nBody content here";
    const result = parseFrontmatterDocument(doc);
    expect(result.frontmatter).toEqual({ title: "Hello", tags: ["a", "b"] });
    expect(result.body).toBe("Body content here");
  });

  it("handles empty frontmatter block", () => {
    const doc = "---\n\n---\nBody content";
    const result = parseFrontmatterDocument(doc);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("Body content");
  });

  it("handles frontmatter that parses to a non-object (e.g. string)", () => {
    const doc = "---\njust a string\n---\nBody";
    const result = parseFrontmatterDocument(doc);
    // YAML parses "just a string" as a string, not an object
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("Body");
  });

  it("handles frontmatter that parses to null", () => {
    const doc = "---\nnull\n---\nBody";
    const result = parseFrontmatterDocument(doc);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("Body");
  });

  it("handles frontmatter with CRLF line endings", () => {
    const doc = "---\r\ntitle: Test\r\n---\r\nBody\r\nMore";
    const result = parseFrontmatterDocument(doc);
    expect(result.frontmatter).toEqual({ title: "Test" });
    expect(result.body).toContain("Body");
  });

  it("handles body with no trailing content", () => {
    const doc = "---\nkey: value\n---\n";
    const result = parseFrontmatterDocument(doc);
    expect(result.frontmatter).toEqual({ key: "value" });
    expect(result.body).toBe("");
  });

  it("handles multi-line body after frontmatter", () => {
    const doc = "---\nkey: value\n---\nLine 1\nLine 2\nLine 3";
    const result = parseFrontmatterDocument(doc);
    expect(result.frontmatter).toEqual({ key: "value" });
    expect(result.body).toBe("Line 1\nLine 2\nLine 3");
  });
});

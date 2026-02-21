import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../src/modules/markdown/parser.js";
import { renderTelegram } from "../../src/modules/markdown/renderers/telegram.js";
import { renderPlain } from "../../src/modules/markdown/renderers/plain.js";

describe("renderTelegram", () => {
  it("renders headings as bold", () => {
    const nodes = parseMarkdown("# Hello");
    const result = renderTelegram(nodes);
    expect(result).toContain("*");
  });

  it("renders code blocks with backticks", () => {
    const nodes = parseMarkdown("```js\ncode();\n```");
    const result = renderTelegram(nodes);
    expect(result).toContain("```js");
    expect(result).toContain("code();");
  });

  it("escapes special characters in text", () => {
    const nodes = parseMarkdown("Use the . and - characters");
    const result = renderTelegram(nodes);
    expect(result).toContain("\\.");
    expect(result).toContain("\\-");
  });

  it("renders unordered lists with bullets", () => {
    const nodes = parseMarkdown("- item 1\n- item 2");
    const result = renderTelegram(nodes);
    expect(result).toContain("\u2022");
  });
});

describe("renderPlain", () => {
  it("strips formatting from headings", () => {
    const nodes = parseMarkdown("# Hello");
    const result = renderPlain(nodes);
    expect(result).toBe("Hello");
  });

  it("renders code blocks as-is", () => {
    const nodes = parseMarkdown("```\ncode();\n```");
    const result = renderPlain(nodes);
    expect(result).toBe("code();");
  });

  it("renders links with URL", () => {
    const nodes = parseMarkdown("[click](https://example.com)");
    const result = renderPlain(nodes);
    expect(result).toContain("click");
    expect(result).toContain("https://example.com");
  });

  it("renders lists with dashes", () => {
    const nodes = parseMarkdown("- a\n- b");
    const result = renderPlain(nodes);
    expect(result).toContain("- a");
    expect(result).toContain("- b");
  });
});

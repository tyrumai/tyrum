import { describe, expect, it } from "vitest";
import {
  parseMarkdown,
  parseInline,
} from "../../src/modules/markdown/parser.js";

describe("parseMarkdown", () => {
  it("parses headings", () => {
    const nodes = parseMarkdown("# Title\n## Subtitle");
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.kind).toBe("heading");
    expect(nodes[0]!.level).toBe(1);
    expect(nodes[1]!.level).toBe(2);
  });

  it("parses code blocks", () => {
    const nodes = parseMarkdown("```typescript\nconst x = 1;\n```");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.kind).toBe("code_block");
    expect(nodes[0]!.language).toBe("typescript");
    expect(nodes[0]!.content).toBe("const x = 1;");
  });

  it("parses unordered lists", () => {
    const nodes = parseMarkdown("- item 1\n- item 2\n- item 3");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.kind).toBe("list");
    expect(nodes[0]!.ordered).toBe(false);
    expect(nodes[0]!.children).toHaveLength(3);
  });

  it("parses ordered lists", () => {
    const nodes = parseMarkdown("1. first\n2. second");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.kind).toBe("list");
    expect(nodes[0]!.ordered).toBe(true);
  });

  it("parses paragraphs", () => {
    const nodes = parseMarkdown(
      "Hello world.\nThis is a paragraph.\n\nSecond paragraph.",
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.kind).toBe("paragraph");
    expect(nodes[1]!.kind).toBe("paragraph");
  });

  it("parses horizontal rules", () => {
    const nodes = parseMarkdown("---");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.kind).toBe("horizontal_rule");
  });

  it("handles mixed content", () => {
    const md = "# Title\n\nSome text.\n\n```js\ncode();\n```\n\n- list item";
    const nodes = parseMarkdown(md);
    expect(nodes.length).toBeGreaterThanOrEqual(4);
  });
});

describe("parseInline", () => {
  it("parses bold text", () => {
    const nodes = parseInline("hello **bold** world");
    expect(nodes).toHaveLength(3);
    expect(nodes[1]!.kind).toBe("bold");
    expect(nodes[1]!.content).toBe("bold");
  });

  it("parses italic text", () => {
    const nodes = parseInline("hello *italic* world");
    expect(nodes).toHaveLength(3);
    expect(nodes[1]!.kind).toBe("italic");
  });

  it("parses inline code", () => {
    const nodes = parseInline("use `code` here");
    expect(nodes).toHaveLength(3);
    expect(nodes[1]!.kind).toBe("code_inline");
  });

  it("parses links", () => {
    const nodes = parseInline("click [here](https://example.com)");
    expect(nodes).toHaveLength(2);
    expect(nodes[1]!.kind).toBe("link");
    expect(nodes[1]!.url).toBe("https://example.com");
  });

  it("handles plain text", () => {
    const nodes = parseInline("just plain text");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.kind).toBe("text");
  });
});

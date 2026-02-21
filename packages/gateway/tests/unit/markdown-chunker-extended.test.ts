import { describe, expect, it } from "vitest";
import { chunkIrNodes, estimateNodeSize } from "../../src/modules/markdown/chunker.js";
import type { IrNode } from "../../src/modules/markdown/parser.js";

describe("chunkIrNodes — extended edge cases", () => {
  it("splitCodeBlock — splits a large code block across multiple chunks", () => {
    const longContent = Array.from({ length: 100 }, (_, i) => `line ${String(i)}: ${"x".repeat(40)}`).join("\n");
    const node: IrNode = {
      kind: "code_block",
      content: longContent,
      language: "typescript",
    };

    const chunks = chunkIrNodes([node], { maxChars: 200 });
    expect(chunks.length).toBeGreaterThan(1);

    // Every chunk should contain a code_block node
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThanOrEqual(1);
      expect(chunk[0]!.kind).toBe("code_block");
    }
  });

  it("code block split preserves language annotation", () => {
    const longContent = Array.from({ length: 50 }, (_, i) => `console.log(${String(i)});`).join("\n");
    const node: IrNode = {
      kind: "code_block",
      content: longContent,
      language: "javascript",
    };

    const chunks = chunkIrNodes([node], { maxChars: 100 });
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      for (const n of chunk) {
        if (n.kind === "code_block") {
          expect(n.language).toBe("javascript");
        }
      }
    }
  });

  it("single node larger than maxChars is included as-is (non-code_block)", () => {
    const node: IrNode = {
      kind: "paragraph",
      children: [{ kind: "text", content: "x".repeat(500) }],
    };

    const chunks = chunkIrNodes([node], { maxChars: 100 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]![0]!.kind).toBe("paragraph");
  });
});

describe("estimateNodeSize", () => {
  it("accounts for heading level overhead", () => {
    const h1: IrNode = { kind: "heading", level: 1, children: [{ kind: "text", content: "Title" }] };
    const h3: IrNode = { kind: "heading", level: 3, children: [{ kind: "text", content: "Title" }] };

    const sizeH1 = estimateNodeSize(h1);
    const sizeH3 = estimateNodeSize(h3);

    // h1 overhead = 1 + 1 = 2, h3 overhead = 3 + 1 = 4
    expect(sizeH3).toBe(sizeH1 + 2);
  });

  it("accounts for code_block formatting overhead", () => {
    const codeBlock: IrNode = { kind: "code_block", content: "const x = 1;" };
    const size = estimateNodeSize(codeBlock);
    // content (13) + 8 (``` markers)
    expect(size).toBe("const x = 1;".length + 8);
  });

  it("accounts for bold/italic/code_inline overhead", () => {
    const bold: IrNode = { kind: "bold", content: "text" };
    const italic: IrNode = { kind: "italic", content: "text" };
    const codeInline: IrNode = { kind: "code_inline", content: "text" };

    // bold: 4 chars content + 4 overhead = 8
    expect(estimateNodeSize(bold)).toBe(8);
    // italic: 4 chars content + 2 overhead = 6
    expect(estimateNodeSize(italic)).toBe(6);
    // code_inline: 4 chars content + 2 overhead = 6
    expect(estimateNodeSize(codeInline)).toBe(6);
  });

  it("accounts for link URL length", () => {
    const link: IrNode = { kind: "link", content: "Click", url: "https://example.com" };
    const size = estimateNodeSize(link);
    // content (5) + 4 overhead + url length (19) = 28
    expect(size).toBe(5 + 4 + "https://example.com".length);
  });

  it("handles deeply nested children", () => {
    const node: IrNode = {
      kind: "paragraph",
      children: [
        {
          kind: "bold",
          content: "outer",
          children: [
            { kind: "text", content: "inner" },
          ],
        },
      ],
    };

    const size = estimateNodeSize(node);
    // paragraph: no overhead
    // bold child: "outer" (5) + bold overhead (4) + "inner" child (5) = 14
    expect(size).toBe(14);
  });
});

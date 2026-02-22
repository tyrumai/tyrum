import { describe, expect, it } from "vitest";
import { StreamingChunker } from "../../src/modules/markdown/streaming-chunker.js";
import { parseMarkdown } from "../../src/modules/markdown/parser.js";
import type { IrNode } from "../../src/modules/markdown/parser.js";

function collectChunks(text: string, maxChars: number): IrNode[][] {
  const chunks: IrNode[][] = [];
  const chunker = new StreamingChunker({
    maxChars,
    onChunk: (nodes) => chunks.push([...nodes]),
  });
  // Push one character at a time to stress-test token splitting
  for (const ch of text) {
    chunker.push(ch);
  }
  chunker.flush();
  return chunks;
}

describe("StreamingChunker", () => {
  it("produces output for simple paragraph", () => {
    const chunks = collectChunks("Hello world.\n\nSecond paragraph.", 5000);
    expect(chunks.length).toBeGreaterThanOrEqual(1);

    // Should contain paragraph nodes
    const allNodes = chunks.flat();
    expect(allNodes.length).toBeGreaterThan(0);
  });

  it("respects paragraph boundary by emitting when maxChars exceeded", () => {
    const text = "Short line.\n\nAnother line.\n\nThird paragraph.\n";
    const chunks = collectChunks(text, 15);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("never splits inside code fences", () => {
    const text = [
      "Before code.",
      "",
      "```js",
      "const x = 1;",
      "const y = 2;",
      "const z = 3;",
      "const w = 4;",
      "const v = 5;",
      "```",
      "",
      "After code.",
    ].join("\n");

    const chunks = collectChunks(text, 20);

    const expected = parseMarkdown(text);
    const expectedCode = expected.find((n) => n.kind === "code_block");
    expect(expectedCode).toBeDefined();

    const allNodes = chunks.flat();
    const codeBlocks = allNodes.filter((n) => n.kind === "code_block");
    expect(codeBlocks).toHaveLength(1);
    expect(codeBlocks[0]!.language).toBe("js");
    expect(codeBlocks[0]!.content).toBe(expectedCode!.content);
    expect(codeBlocks[0]!.content).toContain("const x = 1;");
    expect(codeBlocks[0]!.content).toContain("const v = 5;");
  });

  it("does not close fences on indented ``` lines", () => {
    const text = [
      "Before code.",
      "",
      "```md",
      "Some code line",
      "    ```",
      "Still inside code",
      "```",
      "",
      "After code.",
    ].join("\n");

    const chunks = collectChunks(text, 20);
    const allNodes = chunks.flat();

    const codeBlocks = allNodes.filter((n) => n.kind === "code_block");
    expect(codeBlocks).toHaveLength(1);
    expect(codeBlocks[0]!.language).toBe("md");
    expect(codeBlocks[0]!.content).toContain("Some code line");
    expect(codeBlocks[0]!.content).toContain("    ```");
    expect(codeBlocks[0]!.content).toContain("Still inside code");
    expect(codeBlocks[0]!.content).not.toContain("After code.");

    const afterParagraph = allNodes.find(
      (n) =>
        n.kind === "paragraph"
        && n.children?.some((c) => c.kind === "text" && c.content === "After code."),
    );
    expect(afterParagraph).toBeDefined();
  });

  it("handles token splitting (character-by-character push)", () => {
    const text = "Hello world.\n";
    const chunks: IrNode[][] = [];
    const chunker = new StreamingChunker({
      maxChars: 5000,
      onChunk: (nodes) => chunks.push([...nodes]),
    });

    for (const ch of text) {
      chunker.push(ch);
    }
    chunker.flush();

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.length).toBeGreaterThan(0);
  });

  it("tracks chunkCount correctly", () => {
    const chunker = new StreamingChunker({
      maxChars: 10,
      onChunk: () => {},
    });

    expect(chunker.chunkCount).toBe(0);

    chunker.push("Hello world!\nSecond paragraph that is quite long.\n");
    chunker.flush();

    expect(chunker.chunkCount).toBeGreaterThanOrEqual(1);
  });

  it("flush emits remaining content", () => {
    const chunks: IrNode[][] = [];
    const chunker = new StreamingChunker({
      maxChars: 5000,
      onChunk: (nodes) => chunks.push([...nodes]),
    });

    chunker.push("some text without newline");
    expect(chunks).toHaveLength(0);

    chunker.flush();
    expect(chunks).toHaveLength(1);
  });

  it("maxChars controls chunk size", () => {
    const longText = Array(50).fill("Word").join(" ") + ".\n\n"
      + Array(50).fill("More").join(" ") + ".\n";

    const smallChunks = collectChunks(longText, 50);
    const bigChunks = collectChunks(longText, 5000);

    expect(smallChunks.length).toBeGreaterThanOrEqual(bigChunks.length);
  });
});

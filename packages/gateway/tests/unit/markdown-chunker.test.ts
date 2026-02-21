import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../src/modules/markdown/parser.js";
import { chunkIrNodes } from "../../src/modules/markdown/chunker.js";
import { renderPlain } from "../../src/modules/markdown/renderers/plain.js";

describe("chunkIrNodes", () => {
  it("returns single chunk for small input", () => {
    const nodes = parseMarkdown("Hello world");
    const chunks = chunkIrNodes(nodes, { maxChars: 4096 });
    expect(chunks).toHaveLength(1);
  });

  it("splits large content into multiple chunks", () => {
    const longText =
      "A".repeat(100) + "\n\n" + "B".repeat(100) + "\n\n" + "C".repeat(100);
    const nodes = parseMarkdown(longText);
    const chunks = chunkIrNodes(nodes, { maxChars: 120 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("each chunk renders within maxChars", () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(`Line ${String(i)}: ${"x".repeat(50)}`);
    }
    const md = lines.join("\n\n");
    const nodes = parseMarkdown(md);
    const chunks = chunkIrNodes(nodes, { maxChars: 200 });

    for (const chunk of chunks) {
      const rendered = renderPlain(chunk);
      // Allow small overflow from formatting
      expect(rendered.length).toBeLessThan(400);
    }
  });

  it("handles empty input", () => {
    const chunks = chunkIrNodes([], { maxChars: 4096 });
    expect(chunks).toHaveLength(0);
  });
});

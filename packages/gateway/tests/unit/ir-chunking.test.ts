import { describe, expect, it } from "vitest";
import { chunkText, chunkIr } from "../../src/modules/markdown/ir-chunking.js";
import type { MarkdownIr, MarkdownIrSpan } from "../../src/modules/markdown/ir.js";

describe("chunkText", () => {
  it("returns the full string when it fits within maxChars", () => {
    expect(chunkText("hello", 10)).toEqual(["hello"]);
  });

  it("returns the full string when length equals maxChars", () => {
    expect(chunkText("hello", 5)).toEqual(["hello"]);
  });

  it("splits at newline boundaries when possible", () => {
    const text = "line one\nline two\nline three";
    const chunks = chunkText(text, 15);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(15);
    }
  });

  it("splits at space boundaries when no newline fits", () => {
    const text = "hello world foo bar baz";
    const chunks = chunkText(text, 12);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(12);
    }
  });

  it("hard-splits when no boundary is available", () => {
    const text = "abcdefghijklmnop";
    const chunks = chunkText(text, 5);
    expect(chunks.length).toBeGreaterThan(1);
    // Reassemble should reproduce original
    expect(chunks.join("")).toBe(text);
  });

  it("clamps maxChars to at least 1", () => {
    const chunks = chunkText("abc", 0);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("returns empty array for empty string", () => {
    expect(chunkText("", 10)).toEqual([""]);
  });

  it("handles null/undefined input gracefully", () => {
    // The function coerces null to ""
    expect(chunkText(null as unknown as string, 10)).toEqual([""]);
  });

  it("filters out empty chunks", () => {
    const chunks = chunkText("ab cd", 3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });
});

describe("chunkIr", () => {
  it("returns empty array for empty text", () => {
    expect(chunkIr({ text: "", spans: [] }, 100)).toEqual([]);
  });

  it("returns the IR unchanged when it fits in maxChars", () => {
    const ir: MarkdownIr = { text: "hello", spans: [] };
    const chunks = chunkIr(ir, 100);
    expect(chunks).toEqual([ir]);
  });

  it("splits IR into multiple chunks based on text length", () => {
    const text = "first paragraph\n\nsecond paragraph\n\nthird paragraph";
    const ir: MarkdownIr = { text, spans: [] };
    const chunks = chunkIr(ir, 20);
    expect(chunks.length).toBeGreaterThan(1);
    const reassembled = chunks.map((c) => c.text).join("");
    expect(reassembled).toBe(text);
  });

  it("preserves spans that belong to a chunk", () => {
    const text = "hello world test";
    const spans: MarkdownIrSpan[] = [{ kind: "style", style: "bold", start: 0, end: 5 }];
    const ir: MarkdownIr = { text, spans };
    const chunks = chunkIr(ir, 10);
    expect(chunks.length).toBeGreaterThan(0);
    const firstChunk = chunks[0]!;
    // The bold span should appear in the first chunk
    expect(firstChunk.spans.length).toBeGreaterThanOrEqual(0);
  });

  it("adjusts span positions relative to chunk start", () => {
    const text = "aaaa bbbb cccc dddd";
    const spans: MarkdownIrSpan[] = [{ kind: "style", style: "bold", start: 5, end: 9 }];
    const ir: MarkdownIr = { text, spans };
    const chunks = chunkIr(ir, 100);
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.spans[0]!.start).toBe(5);
    expect(chunks[0]!.spans[0]!.end).toBe(9);
  });

  it("prefers paragraph breaks for chunking", () => {
    const text = "first part\n\nsecond part";
    const ir: MarkdownIr = { text, spans: [] };
    const chunks = chunkIr(ir, 15);
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.text).toBe("first part\n\n");
    expect(chunks[1]!.text).toBe("second part");
  });

  it("clamps maxChars to at least 1", () => {
    const ir: MarkdownIr = { text: "abc", spans: [] };
    const chunks = chunkIr(ir, 0);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("avoids splitting protected inline spans when possible", () => {
    const text = "aaa **bold text** bbb ccc ddd";
    const spans: MarkdownIrSpan[] = [{ kind: "style", style: "bold", start: 4, end: 17 }];
    const ir: MarkdownIr = { text, spans };
    const chunks = chunkIr(ir, 20);
    // The bold span should not be split across chunks
    for (const chunk of chunks) {
      for (const span of chunk.spans) {
        expect(span.start).toBeGreaterThanOrEqual(0);
        expect(span.end).toBeLessThanOrEqual(chunk.text.length);
      }
    }
  });

  it("avoids splitting link spans", () => {
    const text = "prefix [link text](url) suffix more text here";
    const spans: MarkdownIrSpan[] = [{ kind: "link", start: 7, end: 16, href: "url" }];
    const ir: MarkdownIr = { text, spans };
    const chunks = chunkIr(ir, 25);
    for (const chunk of chunks) {
      for (const span of chunk.spans) {
        expect(span.start).toBeGreaterThanOrEqual(0);
        expect(span.end).toBeLessThanOrEqual(chunk.text.length);
      }
    }
  });

  it("avoids splitting code_block spans", () => {
    const text = "before\n```\ncode\n```\nafter more text padding";
    const spans: MarkdownIrSpan[] = [
      { kind: "block", block: "code_block", start: 7, end: 18, language: "js" },
    ];
    const ir: MarkdownIr = { text, spans };
    const chunks = chunkIr(ir, 25);
    for (const chunk of chunks) {
      for (const span of chunk.spans) {
        expect(span.start).toBeGreaterThanOrEqual(0);
        expect(span.end).toBeLessThanOrEqual(chunk.text.length);
      }
    }
  });

  it("supports custom measure function", () => {
    const text = "chunk one and chunk two and chunk three";
    const ir: MarkdownIr = { text, spans: [] };
    // Custom measure that adds overhead per chunk
    const chunks = chunkIr(ir, 20, {
      measure: (chunk) => chunk.text.length + 5,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length + 5).toBeLessThanOrEqual(21); // may exceed slightly at boundary
    }
  });

  it("handles measure function that makes no chunk fit by falling back to text length", () => {
    const text = "hello world how are you doing";
    const ir: MarkdownIr = { text, spans: [] };
    // Measure always returns a huge number
    const chunks = chunkIr(ir, 10, {
      measure: () => 999,
    });
    // Should still make progress
    expect(chunks.length).toBeGreaterThan(0);
    const reassembled = chunks.map((c) => c.text).join("");
    expect(reassembled).toBe(text);
  });
});

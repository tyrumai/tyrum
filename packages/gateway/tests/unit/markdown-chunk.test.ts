import { describe, expect, it } from "vitest";
import { chunkIr, chunkText, irToPlainText, markdownToIr } from "../../src/modules/markdown/ir.js";

describe("chunkText", () => {
  it("does not emit a chunk that exceeds maxChars when a paragraph boundary begins at end - 1", () => {
    const chunks = chunkText("abcd\n\nefgh", 5);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(5);
    }
  });
});

describe("chunkIr", () => {
  it("returns no chunks for empty input", () => {
    expect(chunkIr(markdownToIr(""), 5)).toEqual([]);
  });

  it("does not emit a chunk that exceeds maxChars when a paragraph boundary begins at hardEnd - 1", () => {
    const ir = markdownToIr("abcd\n\nefgh");
    const chunks = chunkIr(ir, 5);

    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(5);
    }
  });

  it("prefers breaking at paragraph boundaries (including the separator)", () => {
    const ir = markdownToIr("one\n\ntwo");
    expect(chunkIr(ir, 5)).toEqual([
      {
        text: "one\n\n",
        spans: [
          { kind: "block", block: "paragraph", start: 0, end: 3 },
        ],
      },
      {
        text: "two",
        spans: [
          { kind: "block", block: "paragraph", start: 0, end: 3 },
        ],
      },
    ]);
  });

  it("never splits inside link label spans when possible", () => {
    const ir = markdownToIr("a [link](https://example.com) b");
    expect(chunkIr(ir, 5)).toEqual([
      {
        text: "a ",
        spans: [
          { kind: "block", block: "paragraph", start: 0, end: 2 },
        ],
      },
      {
        text: "link ",
        spans: [
          { kind: "block", block: "paragraph", start: 0, end: 5 },
          { kind: "link", start: 0, end: 4, href: "https://example.com" },
        ],
      },
      {
        text: "b",
        spans: [
          { kind: "block", block: "paragraph", start: 0, end: 1 },
        ],
      },
    ]);
  });

  it("splits inline style spans across chunks when forced", () => {
    const ir = markdownToIr("**abcdef**");
    expect(chunkIr(ir, 4)).toEqual([
      {
        text: "abcd",
        spans: [
          { kind: "block", block: "paragraph", start: 0, end: 4 },
          { kind: "style", style: "bold", start: 0, end: 4 },
        ],
      },
      {
        text: "ef",
        spans: [
          { kind: "block", block: "paragraph", start: 0, end: 2 },
          { kind: "style", style: "bold", start: 0, end: 2 },
        ],
      },
    ]);
  });

  it("keeps fenced code blocks balanced by closing and reopening when split", () => {
    const ir = markdownToIr("```ts\n0123456789\n```");
    const chunks = chunkIr(ir, 6);
    expect(chunks).toEqual([
      {
        text: "012345",
        spans: [
          { kind: "block", block: "code_block", language: "ts", start: 0, end: 6 },
        ],
      },
      {
        text: "6789",
        spans: [
          { kind: "block", block: "code_block", language: "ts", start: 0, end: 4 },
        ],
      },
    ]);

    expect(chunks.map(irToPlainText)).toEqual([
      "```ts\n012345\n```",
      "```ts\n6789\n```",
    ]);
  });

  it("does not loop when protected spans overlap across the chunk cut", () => {
    const ir = {
      text: "abcdefghijklmno",
      spans: [
        { kind: "block", block: "paragraph", start: 0, end: 15 },
        { kind: "style", style: "bold", start: 0, end: 8 },
        { kind: "link", start: 5, end: 12, href: "https://example.com" },
      ],
    } as const;

    expect(chunkIr(ir, 10)).toEqual([
      {
        text: "abcdefghij",
        spans: [
          { kind: "block", block: "paragraph", start: 0, end: 10 },
          { kind: "style", style: "bold", start: 0, end: 8 },
          { kind: "link", start: 5, end: 10, href: "https://example.com" },
        ],
      },
      {
        text: "klmno",
        spans: [
          { kind: "block", block: "paragraph", start: 0, end: 5 },
          { kind: "link", start: 0, end: 2, href: "https://example.com" },
        ],
      },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { irToPlainText, markdownToIr } from "../../src/modules/markdown/ir.js";

describe("markdownToIr", () => {
  it("parses plain text into a paragraph block", () => {
    expect(markdownToIr("Hello")).toEqual({
      text: "Hello",
      spans: [
        { kind: "block", block: "paragraph", start: 0, end: 5 },
      ],
    });
  });

  it("emits multiple paragraph blocks when separated by blank lines", () => {
    expect(markdownToIr("Hello\n\nWorld")).toEqual({
      text: "Hello\n\nWorld",
      spans: [
        { kind: "block", block: "paragraph", start: 0, end: 5 },
        { kind: "block", block: "paragraph", start: 7, end: 12 },
      ],
    });
  });

  it("captures bold spans and strips formatting markers from text", () => {
    expect(markdownToIr("**bold**")).toEqual({
      text: "bold",
      spans: [
        { kind: "block", block: "paragraph", start: 0, end: 4 },
        { kind: "style", style: "bold", start: 0, end: 4 },
      ],
    });
  });

  it("captures italic spans and strips formatting markers from text", () => {
    expect(markdownToIr("*italic*")).toEqual({
      text: "italic",
      spans: [
        { kind: "block", block: "paragraph", start: 0, end: 6 },
        { kind: "style", style: "italic", start: 0, end: 6 },
      ],
    });
  });

  it("does not close italic spans on bold delimiters", () => {
    expect(markdownToIr("*foo **bar** baz*")).toEqual({
      text: "foo bar baz",
      spans: [
        { kind: "block", block: "paragraph", start: 0, end: 11 },
        { kind: "style", style: "italic", start: 0, end: 11 },
        { kind: "style", style: "bold", start: 4, end: 7 },
      ],
    });
  });

  it("captures strike spans and strips formatting markers from text", () => {
    expect(markdownToIr("~~strike~~")).toEqual({
      text: "strike",
      spans: [
        { kind: "block", block: "paragraph", start: 0, end: 6 },
        { kind: "style", style: "strike", start: 0, end: 6 },
      ],
    });
  });

  it("captures inline code spans and strips formatting markers from text", () => {
    expect(markdownToIr("`code`")).toEqual({
      text: "code",
      spans: [
        { kind: "block", block: "paragraph", start: 0, end: 4 },
        { kind: "style", style: "inline_code", start: 0, end: 4 },
      ],
    });
  });

  it("captures spoiler spans and strips formatting markers from text", () => {
    expect(markdownToIr("||spoiler||")).toEqual({
      text: "spoiler",
      spans: [
        { kind: "block", block: "paragraph", start: 0, end: 7 },
        { kind: "style", style: "spoiler", start: 0, end: 7 },
      ],
    });
  });

  it("captures link spans and strips formatting markers from text", () => {
    expect(markdownToIr("[label](https://example.com)")).toEqual({
      text: "label",
      spans: [
        { kind: "block", block: "paragraph", start: 0, end: 5 },
        { kind: "link", start: 0, end: 5, href: "https://example.com" },
      ],
    });
  });

  it("parses styles inside link labels", () => {
    expect(markdownToIr("[**b**](https://example.com)")).toEqual({
      text: "b",
      spans: [
        { kind: "block", block: "paragraph", start: 0, end: 1 },
        { kind: "link", start: 0, end: 1, href: "https://example.com" },
        { kind: "style", style: "bold", start: 0, end: 1 },
      ],
    });
  });

  it("captures fenced code blocks as block spans", () => {
    expect(
      markdownToIr("```ts\nconst x = 1;\n```"),
    ).toEqual({
      text: "const x = 1;",
      spans: [
        { kind: "block", block: "code_block", language: "ts", start: 0, end: 12 },
      ],
    });
  });

  it("captures fenced code blocks as block spans when mixed with paragraphs", () => {
    expect(
      markdownToIr("Hello\n\n```ts\ncode\n```\n\nWorld"),
    ).toEqual({
      text: "Hello\n\ncode\n\nWorld",
      spans: [
        { kind: "block", block: "paragraph", start: 0, end: 5 },
        { kind: "block", block: "code_block", language: "ts", start: 7, end: 11 },
        { kind: "block", block: "paragraph", start: 13, end: 18 },
      ],
    });
  });

  it("does not drop trailing content after a leading fenced code block", () => {
    expect(
      markdownToIr("```ts\ncode\n```\n\nafter"),
    ).toEqual({
      text: "code\n\nafter",
      spans: [
        { kind: "block", block: "code_block", language: "ts", start: 0, end: 4 },
        { kind: "block", block: "paragraph", start: 6, end: 11 },
      ],
    });
  });

  it("parses fenced code blocks with blank lines when mixed with other blocks", () => {
    expect(
      markdownToIr("before\n\n```ts\nline1\n\nline3\n```\n\nafter"),
    ).toEqual({
      text: "before\n\nline1\n\nline3\n\nafter",
      spans: [
        { kind: "block", block: "paragraph", start: 0, end: 6 },
        { kind: "block", block: "code_block", language: "ts", start: 8, end: 20 },
        { kind: "block", block: "paragraph", start: 22, end: 27 },
      ],
    });
  });

  it("captures blockquotes as block spans", () => {
    expect(markdownToIr("> quoted")).toEqual({
      text: "quoted",
      spans: [
        { kind: "block", block: "blockquote", start: 0, end: 6 },
      ],
    });
  });

  it("captures multiline blockquotes as a single block span", () => {
    expect(markdownToIr("> one\n> two")).toEqual({
      text: "one\ntwo",
      spans: [
        { kind: "block", block: "blockquote", start: 0, end: 7 },
      ],
    });
  });

  it("captures unordered list items as block spans", () => {
    expect(markdownToIr("- one\n- two")).toEqual({
      text: "one\ntwo",
      spans: [
        { kind: "block", block: "list_item", ordered: false, depth: 0, start: 0, end: 3 },
        { kind: "block", block: "list_item", ordered: false, depth: 0, start: 4, end: 7 },
      ],
    });
  });

  it("does not insert phantom separators for empty list items", () => {
    expect(markdownToIr("- \n- two")).toEqual({
      text: "two",
      spans: [
        { kind: "block", block: "list_item", ordered: false, depth: 0, start: 0, end: 3 },
      ],
    });
  });

  it("preserves blank line separators when skipping empty list items", () => {
    expect(markdownToIr("- a\n\n- \n- c")).toEqual({
      text: "a\n\nc",
      spans: [
        { kind: "block", block: "list_item", ordered: false, depth: 0, start: 0, end: 1 },
        { kind: "block", block: "list_item", ordered: false, depth: 0, start: 3, end: 4 },
      ],
    });
  });

  it("captures ordered list items as block spans", () => {
    expect(markdownToIr("1. one\n2. two")).toEqual({
      text: "one\ntwo",
      spans: [
        { kind: "block", block: "list_item", ordered: true, index: 1, depth: 0, start: 0, end: 3 },
        { kind: "block", block: "list_item", ordered: true, index: 2, depth: 0, start: 4, end: 7 },
      ],
    });
  });

  it("captures nested inline styles deterministically", () => {
    expect(markdownToIr("**`code`**")).toEqual({
      text: "code",
      spans: [
        { kind: "block", block: "paragraph", start: 0, end: 4 },
        { kind: "style", style: "bold", start: 0, end: 4 },
        { kind: "style", style: "inline_code", start: 0, end: 4 },
      ],
    });
  });

  it("does not insert phantom separators for empty fenced code blocks", () => {
    expect(markdownToIr("before\n\n```\n```\n\nafter")).toEqual({
      text: "before\n\nafter",
      spans: [
        { kind: "block", block: "paragraph", start: 0, end: 6 },
        { kind: "block", block: "paragraph", start: 8, end: 13 },
      ],
    });
  });
});

describe("irToPlainText", () => {
  it("re-renders list markers for plain text fallback", () => {
    expect(irToPlainText(markdownToIr("- one\n- two"))).toBe("- one\n- two");
  });

  it("re-renders ordered list markers for plain text fallback", () => {
    expect(irToPlainText(markdownToIr("1. one\n2. two"))).toBe("1. one\n2. two");
  });

  it("re-renders blockquote markers for plain text fallback", () => {
    expect(irToPlainText(markdownToIr("> quoted"))).toBe("> quoted");
  });

  it("re-renders fenced code blocks for plain text fallback", () => {
    expect(irToPlainText(markdownToIr("```ts\ncode\n```"))).toBe("```ts\ncode\n```");
  });

  it("renders labeled links as label (url) in plain text fallback", () => {
    expect(irToPlainText(markdownToIr("[label](https://example.com)"))).toBe("label (https://example.com)");
  });
});

import { describe, expect, it } from "vitest";
import { renderMarkdownForTelegram } from "../../src/modules/markdown/telegram.js";

describe("renderMarkdownForTelegram", () => {
  it("chunks fenced code blocks without breaking fences", () => {
    const chunks = renderMarkdownForTelegram("```ts\n0123456789\n```", { maxChars: 18 });
    expect(chunks).toEqual([
      "```ts\n01234567\n```",
      "```ts\n89\n```",
    ]);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(18);
      expect(chunk.startsWith("```")).toBe(true);
      expect(chunk.endsWith("```")).toBe(true);
    }
  });

  it("never returns a chunk that exceeds maxChars, even when formatting overhead is unavoidable", () => {
    const chunks = renderMarkdownForTelegram("```ts\nX\n```", { maxChars: 5 });
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(5);
    }
    expect(chunks.join("")).toBe("```ts\nX\n```");
  });

  it("trims leading and trailing whitespace consistently when chunked", () => {
    const chunks = renderMarkdownForTelegram("   0123456789   ", { maxChars: 4 });
    expect(chunks.join("")).toBe("0123456789");
    expect(chunks.at(0)?.startsWith(" ")).toBe(false);
    expect(chunks.at(-1)?.endsWith(" ")).toBe(false);
  });
});

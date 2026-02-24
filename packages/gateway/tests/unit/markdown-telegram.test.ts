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
});


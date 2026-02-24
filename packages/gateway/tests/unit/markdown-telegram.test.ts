import { describe, expect, it } from "vitest";
import { renderMarkdownForTelegram } from "../../src/modules/markdown/telegram.js";

describe("renderMarkdownForTelegram", () => {
  it("renders fenced code blocks as Telegram HTML and chunks without breaking <pre><code> wrappers", () => {
    const chunks = renderMarkdownForTelegram("```ts\n0123456789\n```", { maxChars: 50 });
    expect(chunks).toEqual([
      '<pre><code class="language-ts">012345</code></pre>',
      '<pre><code class="language-ts">6789</code></pre>',
    ]);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(50);
      expect(chunk.startsWith("<pre><code")).toBe(true);
      expect(chunk.endsWith("</code></pre>")).toBe(true);
    }
  });

  it("falls back to plain text and reports a formatting-fallback event when maxChars is too small for Telegram HTML wrappers", () => {
    const fallbacks: unknown[] = [];
    const opts = {
      maxChars: 5,
      onFormattingFallback: (event: unknown) => {
        fallbacks.push(event);
      },
    };
    const chunks = renderMarkdownForTelegram("```ts\nX\n```", opts);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(5);
    }
    expect(chunks.join("")).toBe("```ts\nX\n```");
    expect(fallbacks.length).toBeGreaterThan(0);
  });

  it("trims leading and trailing whitespace consistently when chunked", () => {
    const chunks = renderMarkdownForTelegram("   0123456789   ", { maxChars: 4 });
    expect(chunks.join("")).toBe("0123456789");
    expect(chunks.at(0)?.startsWith(" ")).toBe(false);
    expect(chunks.at(-1)?.endsWith(" ")).toBe(false);
  });

  it("renders bold and escapes HTML special characters", () => {
    const chunks = renderMarkdownForTelegram("Hello **<world> & friends**");
    expect(chunks).toEqual(["Hello <b>&lt;world&gt; &amp; friends</b>"]);
  });

  it("renders labeled links as Telegram HTML anchors with safe escaping", () => {
    const chunks = renderMarkdownForTelegram("[label](https://example.com?a=1&b=2)");
    expect(chunks).toEqual(['<a href="https://example.com?a=1&amp;b=2">label</a>']);
  });

  it("keeps plain-text fallback chunks within maxChars even when HTML escaping expands the output", () => {
    const maxChars = 5;
    const chunks = renderMarkdownForTelegram("```ts\n<<<<<\n```", { maxChars });
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(maxChars);
    }
  });
});

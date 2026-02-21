import { describe, expect, it } from "vitest";
import {
  chunkMarkdownIr,
  parseMarkdownToIr,
  renderTelegramHtml,
} from "../../src/modules/formatting/markdown-ir.js";

describe("Markdown IR pipeline", () => {
  it("parses basic inline formatting and renders Telegram-safe HTML", () => {
    const input =
      "Hello **bold** and *italic* and ~~strike~~ and `code` and [link](https://example.com)\n" +
      "```js\nconst x = 1 < 2;\n```\nDone";

    const tokens = parseMarkdownToIr(input);
    const html = renderTelegramHtml(tokens);

    expect(html).toContain("Hello ");
    expect(html).toContain("<b>bold</b>");
    expect(html).toContain("<i>italic</i>");
    expect(html).toContain("<s>strike</s>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('<a href="https://example.com">link</a>');
    expect(html).toContain("<pre><code>");
    expect(html).toContain("const x = 1 &lt; 2;");
    expect(html).toContain("</code></pre>");
    expect(html).toContain("Done");
  });

  it("falls back to plain text link rendering for disallowed schemes", () => {
    const tokens = parseMarkdownToIr("[x](javascript:alert(1))");
    const html = renderTelegramHtml(tokens);
    expect(html).toContain("x (javascript:alert(1))");
    expect(html).not.toContain("<a href=");
  });

  it("escapes HTML special characters in text", () => {
    const html = renderTelegramHtml(parseMarkdownToIr("<script>alert(1)</script>"));
    expect(html).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("chunks large code blocks by closing and reopening per message", () => {
    const code = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const tokens = parseMarkdownToIr(["```", code, "```"].join("\n"));
    const { chunks } = chunkMarkdownIr(tokens, 200);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const html = renderTelegramHtml(chunk);
      expect(html.startsWith("<pre><code>")).toBe(true);
      expect(html.endsWith("</code></pre>")).toBe(true);
    }
  });

  it("degrades formatting when a single style token exceeds the chunk limit", () => {
    const huge = `**${"x".repeat(200)}**`;
    const tokens = parseMarkdownToIr(huge);
    const res = chunkMarkdownIr(tokens, 50);
    expect(res.degraded).toBe(true);
    expect(res.chunks.length).toBeGreaterThan(1);
    // Rendered output should not contain bold tags since it was degraded.
    const rendered = res.chunks.map((c) => renderTelegramHtml(c)).join("");
    expect(rendered).not.toContain("<b>");
  });
});


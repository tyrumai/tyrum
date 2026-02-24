import { describe, expect, it, vi } from "vitest";

describe("renderMarkdownForTelegram", () => {
  it("renders inline spans even when a chunk has no block spans", async () => {
    vi.resetModules();
    vi.doMock("../../src/modules/markdown/ir.js", () => {
      return {
        markdownToIr: () => ({
          text: "Hello world",
          spans: [
            { kind: "style", style: "bold", start: 0, end: 5 },
          ],
        }),
        irToPlainText: (ir: any) => {
          return ir.text;
        },
        chunkIr: (ir: any) => {
          return [ir];
        },
      };
    });

    const { renderMarkdownForTelegram } = await import("../../src/modules/markdown/telegram.js");

    expect(renderMarkdownForTelegram("ignored")).toEqual(["<b>Hello</b> world"]);
  });
});


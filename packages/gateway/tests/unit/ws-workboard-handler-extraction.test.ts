import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("workboard WS handler extraction", () => {
  it("extracts work.* handlers into a dedicated module", async () => {
    const handlerSource = await readFile(new URL("../../src/ws/protocol/handler.ts", import.meta.url), {
      encoding: "utf8",
    });

    expect(handlerSource).toContain("handleWorkboardMessage");
    expect(handlerSource).not.toContain('msg.type === "work.create"');

    await expect(
      readFile(new URL("../../src/ws/protocol/workboard-handlers.ts", import.meta.url), {
        encoding: "utf8",
      }),
    ).resolves.toContain("handleWorkboardMessage");
  });
});


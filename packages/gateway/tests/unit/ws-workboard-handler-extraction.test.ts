import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("workboard WS handler extraction", () => {
  it("extracts work.* handlers into a dedicated module", async () => {
    const handlerSource = await readFile(
      new URL("../../src/ws/protocol/handler.ts", import.meta.url),
      {
        encoding: "utf8",
      },
    );

    expect(handlerSource).toContain("handleWorkboardMessage(");
    expect(handlerSource).not.toMatch(/msg\\.type === \"work\\./);

    const workboardSource = await readFile(
      new URL("../../src/ws/protocol/workboard-handlers.ts", import.meta.url),
      { encoding: "utf8" },
    );
    expect(workboardSource).toContain("handleWorkboardMessage");
    expect(workboardSource).toContain('"work.create"');
  });
});

import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

describe("memory and subagent WS handler extraction", () => {
  let handlerSource = "";

  beforeAll(async () => {
    handlerSource = await readFile(new URL("../../src/ws/protocol/handler.ts", import.meta.url), {
      encoding: "utf8",
    });
  });

  it("extracts memory.* handlers into a dedicated module", async () => {
    expect(handlerSource).toContain("handleMemoryMessage(");
    const inlineCheckExample = 'if (msg.type === "memory.search") {';
    expect(inlineCheckExample).toMatch(/msg\.type === "memory\./);
    expect(handlerSource).not.toMatch(/msg\.type === "memory\./);

    const memorySource = await readFile(
      new URL("../../src/ws/protocol/memory-handlers.ts", import.meta.url),
      { encoding: "utf8" },
    );
    expect(memorySource).toContain("handleMemoryMessage");
    expect(memorySource).toContain('"memory.search"');
  });

  it("extracts subagent.* handlers into a dedicated module", async () => {
    expect(handlerSource).toContain("handleSubagentMessage(");
    const inlineCheckExample = 'if (msg.type === "subagent.spawn") {';
    expect(inlineCheckExample).toMatch(/msg\.type === "subagent\./);
    expect(handlerSource).not.toMatch(/msg\.type === "subagent\./);

    const subagentSource = await readFile(
      new URL("../../src/ws/protocol/subagent-handlers.ts", import.meta.url),
      { encoding: "utf8" },
    );
    expect(subagentSource).toContain("handleSubagentMessage");
    expect(subagentSource).toContain('"subagent.spawn"');
  });
});

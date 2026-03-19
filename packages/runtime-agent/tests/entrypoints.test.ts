import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("@tyrum/runtime-agent entrypoints", () => {
  it("re-exports the runtime orchestrator and context pruning helpers", async () => {
    const indexSource = await readFile(resolve(__dirname, "../src/index.ts"), "utf8");

    expect(indexSource).toContain("AgentRuntime");
    expect(indexSource).toContain("applyDeterministicContextCompactionAndToolPruning");
  });
});

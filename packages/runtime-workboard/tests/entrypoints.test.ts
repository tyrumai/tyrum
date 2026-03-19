import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("@tyrum/runtime-workboard entrypoints", () => {
  it("re-exports orchestration and coordination primitives from the package root", async () => {
    const indexSource = await readFile(resolve(__dirname, "../src/index.ts"), "utf8");

    expect(indexSource).toContain("SubagentService");
    expect(indexSource).toContain("WorkboardDispatcher");
    expect(indexSource).toContain("WorkboardOrchestrator");
    expect(indexSource).toContain("WorkboardReconciler");
  });
});

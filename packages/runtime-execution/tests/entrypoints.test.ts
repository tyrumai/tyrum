import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("@tyrum/runtime-execution entrypoints", () => {
  it("re-exports worker loop logger types from the package root", async () => {
    const indexSource = await readFile(resolve(__dirname, "../src/index.ts"), "utf8");

    expect(indexSource).toContain("ExecutionWorkerLogger");
    expect(indexSource).toContain('} from "./worker-loop.js";');
  });
});

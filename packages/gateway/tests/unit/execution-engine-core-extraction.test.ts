import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("execution engine core extraction", () => {
  it("sources the gateway execution engine wrapper from @tyrum/runtime-execution", async () => {
    const runtimeWrapperPath = join(
      __dirname,
      "../../src/modules/execution/engine/execution-engine.ts",
    );
    const raw = await readFile(runtimeWrapperPath, "utf-8");

    expect(raw).toContain('from "@tyrum/runtime-execution"');
  });
});

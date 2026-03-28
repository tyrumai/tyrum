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

  it("re-exports execution engine adapter ports from the package root", async () => {
    const indexSource = await readFile(resolve(__dirname, "../src/index.ts"), "utf8");

    expect(indexSource).toContain("ExecutionEngine");
    expect(indexSource).toContain("ExecutionApprovalPort");
    expect(indexSource).toContain("ExecutionArtifactPort");
    expect(indexSource).toContain("ExecutionEventPort");
    expect(indexSource).toContain("ExecutionMaybeRetryOrFailStepOptions");
    expect(indexSource).toContain("ExecutionPauseRunForApprovalInput");
    expect(indexSource).toContain("ExecutionPauseRunForApprovalOptions");
    expect(indexSource).toContain("RunnableTurnRow");
    expect(indexSource).toContain("StepRow");
  });
});

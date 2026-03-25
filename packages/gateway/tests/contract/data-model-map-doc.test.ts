import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("docs: data model map", () => {
  it("documents the target-state schema map with retention + pruning notes", async () => {
    const docUrl = new URL(
      "../../../../docs/architecture/scaling-ha/data-model-map.md",
      import.meta.url,
    );

    let content: string | undefined;
    try {
      content = await readFile(docUrl, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    expect(content, "docs/architecture/scaling-ha/data-model-map.md should exist").toBeTypeOf(
      "string",
    );
    expect(content).toContain("target-state schema contract");
    expect(content).toContain("ARCH-20 conversation and turn clean-break decision");
    expect(content).toContain("Timestamp audit");
    expect(content).toContain("channel_accounts.status");
    expect(content).toContain("channel_threads");
    expect(content).toContain("work_signals");
    expect(content).toContain("conversations");
    expect(content).toContain("turns");
    expect(content).toContain("Pruning checklist");
    expect(content).toContain("Retention");
    expect(content).toContain("PII");
  });
});

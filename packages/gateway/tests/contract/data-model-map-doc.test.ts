import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("docs: data model map", () => {
  it("documents the v2 schema with retention + pruning notes", async () => {
    const docUrl = new URL("../../../../docs/architecture/data-model-map.md", import.meta.url);

    let content: string | undefined;
    try {
      content = await readFile(docUrl, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    expect(content, "docs/architecture/data-model-map.md should exist").toBeTypeOf("string");
    expect(content).toContain("packages/gateway/migrations/sqlite/100_rebuild_v2.sql");
    expect(content).toContain("packages/gateway/migrations/postgres/100_rebuild_v2.sql");
    expect(content).toContain("Timestamp audit");
    expect(content).toContain("channel_accounts.status");
    expect(content).toContain("channel_threads");
    expect(content).toContain("work_signals");
    expect(content).toContain("Pruning checklist");
    expect(content).toContain("Retention");
    expect(content).toContain("PII");
  });
});
